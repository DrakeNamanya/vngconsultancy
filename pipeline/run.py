#!/usr/bin/env python3
"""
Audio transcription worker for the Trade Order dashboard (v2).

  pip install faster-whisper requests numpy av        (no ffmpeg needed)
  export DASH_URL=https://<your-dashboard>   ADMIN_KEY=<INGEST_TOKEN>
  python worker.py                 # transcribe everything waiting, then stop
  python worker.py --loop          # keep polling (leave running during fieldwork)
  python worker.py --ids 922717678,922731281   # only these submissions (also re-does finished ones)

What it does
  1. asks the dashboard which recordings are waiting (interviews with the least typed text first)
  2. claims one, downloads it through the dashboard's audio proxy (no Kobo token needed here)
  3. decodes in chunks (long recordings do not need much RAM) and transcribes locally with faster-whisper.
     Damaged AAC packets, common in phone recordings, are replaced by silence so timestamps stay correct
  4. runs quality gates. Unreliable transcripts go to 'review' and are NOT coded until a person accepts them
  5. posts transcript + confidence + flags, and a heartbeat every ~20 s so the dashboard can show progress

Device: a CUDA GPU is used automatically (model large-v3-turbo, float16). Otherwise CPU (model small, int8).
Flags raised: repetition, low_confidence, little_speech, uncertain_language, very_short_audio, damaged_audio
"""
import argparse, collections, math, os, platform, re, socket, sys, tempfile, threading, time, zlib
import numpy as np
import requests

SR = 16000
VERSION = "2"


# ---------------------------------------------------------------- network helpers
def call(method, url, tries=3, **kw):
    kw.setdefault("timeout", 60)
    for i in range(tries):
        try:
            r = requests.request(method, url, **kw)
            if r.status_code >= 500 and i < tries - 1:
                time.sleep(2 * (i + 1))
                continue
            return r
        except requests.RequestException:
            if i == tries - 1:
                raise
            time.sleep(2 * (i + 1))


# ---------------------------------------------------------------- audio decoding
class Audio:
    """Streams a recording as 16 kHz mono float32 chunks.
    A damaged packet is replaced by the same amount of silence (so the timeline stays true) and counted."""

    def __init__(self, path, chunk_s):
        import av
        self.av = av
        self.c = av.open(path)
        self.st = self.c.streams.audio[0]
        self.declared = float(self.c.duration) / 1e6 if self.c.duration else None
        self.chunk = int(chunk_s * SR)
        self.bad = 0
        self.bad_s = 0.0

    def chunks(self):
        av = self.av
        rs = av.AudioResampler(format="s16", layout="mono", rate=SR)
        buf, n = [], 0
        rate = self.st.codec_context.sample_rate or 32000
        for pkt in self.c.demux(self.st):
            if pkt.size == 0:
                continue
            try:
                frames = pkt.decode()
                parts = [o.to_ndarray().reshape(-1) for fr in frames for o in rs.resample(fr)]
            except av.error.FFmpegError:
                self.bad += 1
                secs = float(pkt.duration * pkt.time_base) if pkt.duration and pkt.time_base else 1024.0 / rate
                self.bad_s += secs
                parts = [np.zeros(int(secs * SR), dtype=np.int16)]
            for a in parts:
                buf.append(a)
                n += len(a)
            while n >= self.chunk:
                arr = np.concatenate(buf)
                out, rest = arr[:self.chunk], arr[self.chunk:]
                buf, n = [rest], len(rest)
                yield out.astype(np.float32) / 32768.0
        try:
            for o in rs.resample(None):
                a = o.to_ndarray().reshape(-1)
                buf.append(a)
                n += len(a)
        except av.error.FFmpegError:
            pass
        if n > SR:
            yield np.concatenate(buf).astype(np.float32) / 32768.0
        self.c.close()


# ---------------------------------------------------------------- quality gates (tuned on real recordings: keep in step with src/api.ts transcriptProblems)
def quality(segs, duration, lang_prob, wanted_lang):
    flags = []
    texts = [s["text"].strip().lower() for s in segs if s["text"].strip()]
    words = sum(len(t.split()) for t in texts)
    if duration < 20:
        flags.append("very_short_audio")
    if len(texts) >= 6:
        counts = collections.Counter(texts)
        top, n = counts.most_common(1)[0]
        if n >= 4 and n / len(texts) >= 0.25:
            flags.append("repetition")
        elif len(counts) / len(texts) < 0.5:
            flags.append("repetition")
    # same phrase back to back (one-word fillers such as "Okay." are normal speech: they need a much longer run to count)
    run = best = 1
    best_text = texts[0] if texts else ""
    for a, b in zip(texts, texts[1:]):
        run = run + 1 if a == b else 1
        if run > best:
            best, best_text = run, a
    short = len(best_text.split()) < 3
    if ((best >= 3 and not short) or best >= 8) and "repetition" not in flags:
        flags.append("repetition")
    # looping INSIDE segments: compression ratio on 600-character windows (a whole transcript of ordinary speech compresses ~2.4x)
    full = " ".join(texts)
    toks = re.findall(r"[a-z']+", full)
    if len(toks) >= 30:
        ratio = len(full.encode()) / max(1, len(zlib.compress(full.encode()))) if len(full) < 700 else 0.0
        for i in range(0, max(1, len(full) - 600), 300):
            b = full[i:i + 600].encode()
            ratio = max(ratio, len(b) / max(1, len(zlib.compress(b))))
        grams = collections.Counter(tuple(toks[i:i + 3]) for i in range(len(toks) - 2))
        top_share = grams.most_common(1)[0][1] / max(1, len(toks) - 2)
        distinct = len(set(toks)) / len(toks)
        if ratio > 3.0 or top_share > 0.2 or distinct < 0.12:
            if "repetition" not in flags:
                flags.append("repetition")
    conf = float(np.mean([s["conf"] for s in segs])) if segs else 0.0
    if segs and conf < 0.55:
        flags.append("low_confidence")
    wpm = words / (duration / 60) if duration else 0
    if duration >= 60 and wpm < 25:
        flags.append("little_speech")
    if wanted_lang is None and lang_prob < 0.6:
        flags.append("uncertain_language")
    return flags, conf, wpm


# ---------------------------------------------------------------- transcription
def transcribe(model, path, a, lang, prog):
    audio = Audio(path, a.chunk)
    prog.update(declared=audio.declared, done_s=0.0)
    segs, offset, info = [], 0.0, None
    for chunk in audio.chunks():
        kw = dict(beam_size=a.beam, language=lang, vad_filter=True, condition_on_previous_text=False, temperature=[0.0, 0.2, 0.4],
                  compression_ratio_threshold=2.2, no_speech_threshold=0.6)
        if a.hotwords:
            kw["hotwords"] = a.hotwords
        it, ci = model.transcribe(chunk, **kw)
        if info is None:
            info = ci
            if lang is None:
                lang = ci.language          # decide the language once, on the first chunk
        for s in it:
            t = s.text.strip()
            if t:
                segs.append({"start": round(s.start + offset, 2), "end": round(s.end + offset, 2), "text": t,
                             "conf": math.exp(s.avg_logprob) if s.avg_logprob is not None else 0.0})
        offset += len(chunk) / SR
        prog["done_s"] = offset
    return segs, info, offset, audio


class Beat(threading.Thread):
    """Tells the dashboard every ~20 s that the worker is alive and how far the current recording has got."""

    def __init__(self, a, state):
        super().__init__(daemon=True)
        self.a, self.state, self.stop = a, state, threading.Event()

    def send(self):
        s = self.state
        cur = None
        if s.get("current"):
            p = s["prog"]
            dec = p.get("declared") or 0
            cur = {"id": s["current"], "pct": min(1.0, p.get("done_s", 0) / dec) if dec else 0.0, "audio_min": round(dec / 60, 1)}
        body = {"host": socket.gethostname(), "model": s["model"], "device": s["device"], "version": VERSION, "rtf": s.get("rtf"),
                "current": cur, "done": s["done"], "failed": s["failed"], "started": s["started"]}
        try:
            call("POST", f"{self.a.url}/api/pipeline/heartbeat", json=body, headers=self.a.H, timeout=20, tries=1)
        except Exception:
            pass

    def run(self):
        while not self.stop.wait(20):
            self.send()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default=os.environ.get("DASH_URL", "http://localhost:3000"))
    ap.add_argument("--key", default=os.environ.get("ADMIN_KEY", ""))
    ap.add_argument("--model", default=os.environ.get("WHISPER_MODEL", "auto"), help="auto | tiny | base | small | medium | large-v3 | large-v3-turbo")
    ap.add_argument("--device", default="auto", help="auto | cpu | cuda")
    ap.add_argument("--language", default=os.environ.get("WHISPER_LANG", "en"), help="ISO code, or 'auto' to detect")
    ap.add_argument("--beam", type=int, default=int(os.environ.get("WHISPER_BEAM", "0")), help="beam size (default 5 on GPU, 1 on CPU)")
    ap.add_argument("--chunk", type=int, default=600, help="seconds of audio held in memory at once")
    ap.add_argument("--hotwords", default=os.environ.get("WHISPER_HOTWORDS", ""), help="optional, e.g. 'SDLG, KCCA, Nansana, trade order' (not validated: check the results)")
    ap.add_argument("--limit", type=int, default=10, help="recordings fetched per request")
    ap.add_argument("--ids", default="", help="comma-separated submission ids to (re)transcribe")
    ap.add_argument("--loop", action="store_true", help="keep polling every --every seconds instead of stopping when the queue is empty")
    ap.add_argument("--every", type=int, default=120)
    ap.add_argument("--workdir", default=os.path.join(tempfile.gettempdir(), "tradeorder_audio"))
    a = ap.parse_args()
    if not a.key:
        sys.exit("Set ADMIN_KEY (the dashboard INGEST_TOKEN) or pass --key")
    a.url = a.url.rstrip("/")
    a.H = {"x-admin-key": a.key}
    lang = None if a.language == "auto" else a.language
    os.makedirs(a.workdir, exist_ok=True)

    try:
        import ctranslate2
        gpu = ctranslate2.get_cuda_device_count() > 0
    except Exception:
        gpu = False
    device = ("cuda" if gpu else "cpu") if a.device == "auto" else a.device
    model_name = ("large-v3-turbo" if device == "cuda" else "small") if a.model == "auto" else a.model
    ctype = "float16" if device == "cuda" else "int8"
    a.beam = a.beam or (5 if device == "cuda" else 1)

    from faster_whisper import WhisperModel
    print(f"worker v{VERSION} on {platform.node()} | loading faster-whisper '{model_name}' ({ctype}, {device}), beam {a.beam} ...", flush=True)
    model = WhisperModel(model_name, device=device, compute_type=ctype)

    state = {"model": model_name, "device": device, "done": 0, "failed": 0, "current": None, "prog": {}, "rtf": None,
             "started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    beat = Beat(a, state)
    beat.start()
    beat.send()
    ids_mode = bool(a.ids.strip())
    seen = set()

    try:
        while True:
            params = {"limit": a.limit}
            if ids_mode:
                params["ids"] = a.ids
            r = call("GET", f"{a.url}/api/pipeline/pending", params=params, headers=a.H)
            if r.status_code == 401:
                sys.exit("The dashboard rejected the admin key (401). Check ADMIN_KEY.")
            r.raise_for_status()
            items = [i for i in r.json()["items"] if i["id"] not in seen]
            print(f"{len(items)} recording(s) waiting", flush=True)
            for it in items:
                sid = it["id"]
                seen.add(sid)
                path = os.path.join(a.workdir, f"{sid}.m4a")
                try:
                    c = call("POST", f"{a.url}/api/pipeline/claim", json={"id": sid, "force": ids_mode}, headers=a.H).json()
                    if not c.get("claimed"):
                        print(f"  #{sid}: taken by another worker, skipped", flush=True)
                        continue
                    state["current"], state["prog"] = sid, {}
                    t0 = time.time()
                    with requests.get(f"{a.url}/api/audio/{sid}", headers=a.H, stream=True, timeout=300) as d:
                        d.raise_for_status()
                        with open(path, "wb") as f:
                            for ch in d.iter_content(1 << 16):
                                f.write(ch)
                    segs, info, duration, audio = transcribe(model, path, a, lang, state["prog"])
                    if not segs and duration < 5:
                        raise RuntimeError("no audio could be decoded from this file")
                    flags, conf, wpm = quality(segs, duration, info.language_probability if info else 1.0, lang)
                    lost = (audio.bad_s / duration) if duration else 0
                    if lost >= 0.05:
                        flags.append("damaged_audio")
                    bad = {"repetition", "low_confidence", "little_speech"} & set(flags)
                    payload = {
                        "submission_id": sid, "text": " ".join(s["text"] for s in segs),
                        "segments": [{k: s[k] for k in ("start", "end", "text")} for s in segs],
                        "language": info.language if info else lang, "engine": "faster-whisper", "model": model_name,
                        "confidence": round(conf, 3), "duration": round(duration, 1),
                        "flags": flags, "status": "review" if bad else "done",
                    }
                    call("POST", f"{a.url}/api/pipeline/transcript", json=payload, headers=a.H, timeout=120).raise_for_status()
                    el = time.time() - t0
                    if duration > 30:
                        r_ = el / duration
                        state["rtf"] = round(r_ if state["rtf"] is None else 0.7 * state["rtf"] + 0.3 * r_, 3)
                    state["done"] += 1
                    note = f", {audio.bad} damaged packets ({lost:.0%} of the audio replaced by silence)" if audio.bad else ""
                    print(f"  #{sid}: {duration/60:.1f} min audio in {el/60:.1f} min, {len(segs)} segs, {sum(len(s['text'].split()) for s in segs)} words, "
                          f"conf {conf:.2f}, {wpm:.0f} wpm{note} -> {'REVIEW ' + ','.join(flags) if bad else 'ok ' + ','.join(flags)}", flush=True)
                except Exception as e:
                    state["failed"] += 1
                    print(f"  #{sid}: FAILED {e}", flush=True)
                    try:
                        call("POST", f"{a.url}/api/pipeline/status", json={"id": sid, "status": "failed", "error": str(e)[:300]}, headers=a.H, timeout=30)
                    except Exception:
                        pass
                finally:
                    state["current"] = None
                    beat.send()
                    if os.path.exists(path):
                        os.remove(path)     # never keep interview audio on the worker machine
            if ids_mode or (not items and not a.loop):
                break
            if not items:
                time.sleep(a.every)
        print(f"finished: {state['done']} transcribed, {state['failed']} failed", flush=True)
    finally:
        beat.stop.set()
        state["current"] = None
        beat.send()


if __name__ == "__main__":
    main()
