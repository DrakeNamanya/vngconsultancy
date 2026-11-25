#!/usr/bin/env python3
"""
Audio transcription worker for the Trade Order dashboard.

  pip install faster-whisper numpy requests      (ffmpeg must be on PATH)
  export DASH_URL=https://<your-dashboard>       ADMIN_KEY=<INGEST_TOKEN>
  python pipeline/run.py --model small --loop

What it does
  1. asks the dashboard for interviews whose audio is 'pending' (or 'failed')
  2. downloads the recording through the dashboard's audio proxy (no Kobo token needed here)
  3. decodes with ffmpeg -> 16 kHz mono, transcribes locally with faster-whisper (nothing leaves your machine)
  4. runs quality gates. Unreliable transcripts are sent with status 'review' and are NOT coded
     until a person accepts them on the dashboard
  5. posts transcript + segments + confidence + flags back; the dashboard codes the transcript

Flags raised: repetition (hallucination loops), low_confidence, little_speech, uncertain_language, very_short_audio
"""
import argparse, math, os, re, subprocess, sys, time, collections, zlib
import numpy as np
import requests


def decode(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", "16000", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def quality(segs, duration, lang_prob, wanted_lang):
    flags = []
    texts = [s["text"].strip().lower() for s in segs if s["text"].strip()]
    words = sum(len(t.split()) for t in texts)
    if duration < 20:
        flags.append("very_short_audio")
    # hallucination loops: same phrase repeated
    if len(texts) >= 6:
        counts = collections.Counter(texts)
        top, n = counts.most_common(1)[0]
        if n >= 4 and n / len(texts) >= 0.25:
            flags.append("repetition")
        elif len(counts) / len(texts) < 0.5:
            flags.append("repetition")
    # same short phrase repeated back to back
    # (one-word fillers such as "Okay." are normal speech: they need a much longer run to count as a loop)
    run = best = 1
    best_text = texts[0] if texts else ""
    for a, b in zip(texts, texts[1:]):
        run = run + 1 if a == b else 1
        if run > best:
            best, best_text = run, a
    short = len(best_text.split()) < 3
    if ((best >= 3 and not short) or best >= 8) and "repetition" not in flags:
        flags.append("repetition")
    # looping INSIDE segments (whisper often emits one long segment of the same phrase)
    full = " ".join(texts)
    toks = re.findall(r"[a-z']+", full)
    if len(toks) >= 30:
        # compression ratio is measured on 600-character windows: a whole long transcript of ordinary speech
        # compresses ~2.4x, whereas a genuine hallucination loop spikes a local window well above 3
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


def transcribe(model, path, language):
    audio = decode(path)
    duration = len(audio) / 16000
    segs_iter, info = model.transcribe(audio, beam_size=int(os.environ.get("WHISPER_BEAM", "2")), language=language, vad_filter=True,
                                       condition_on_previous_text=False, temperature=0.0,
                                       compression_ratio_threshold=2.2, no_speech_threshold=0.6)
    segs = []
    for s in segs_iter:
        t = s.text.strip()
        if not t:
            continue
        segs.append({"start": round(s.start, 2), "end": round(s.end, 2), "text": t,
                     "conf": math.exp(s.avg_logprob) if s.avg_logprob is not None else 0.0})
    return segs, info, duration


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=os.environ.get("DASH_URL", "http://localhost:3000"))
    ap.add_argument("--key", default=os.environ.get("ADMIN_KEY", ""))
    ap.add_argument("--model", default=os.environ.get("WHISPER_MODEL", "small"), help="tiny|base|small|medium|large-v3")
    ap.add_argument("--language", default=os.environ.get("WHISPER_LANG", "en"), help="ISO code, or 'auto'")
    ap.add_argument("--limit", type=int, default=10)
    ap.add_argument("--loop", action="store_true", help="keep polling every --every seconds")
    ap.add_argument("--every", type=int, default=120)
    ap.add_argument("--workdir", default="/tmp/tradeorder_audio")
    a = ap.parse_args()
    if not a.key:
        sys.exit("Set ADMIN_KEY (the dashboard INGEST_TOKEN) or pass --key")
    lang = None if a.language == "auto" else a.language
    H = {"x-admin-key": a.key}
    os.makedirs(a.workdir, exist_ok=True)

    from faster_whisper import WhisperModel
    print(f"loading faster-whisper '{a.model}' (int8, cpu) ...", flush=True)
    model = WhisperModel(a.model, device="cpu", compute_type="int8")

    while True:
        r = requests.get(f"{a.url}/api/pipeline/pending", params={"limit": a.limit}, headers=H, timeout=60)
        r.raise_for_status()
        items = r.json()["items"]
        print(f"{len(items)} recording(s) pending", flush=True)
        for it in items:
            sid = it["id"]
            path = os.path.join(a.workdir, f"{sid}.m4a")
            try:
                requests.post(f"{a.url}/api/pipeline/status", json={"id": sid, "status": "processing"}, headers=H, timeout=30)
                with requests.get(f"{a.url}/api/audio/{sid}", headers=H, stream=True, timeout=300) as d:
                    d.raise_for_status()
                    with open(path, "wb") as f:
                        for ch in d.iter_content(1 << 16):
                            f.write(ch)
                t0 = time.time()
                segs, info, duration = transcribe(model, path, lang)
                flags, conf, wpm = quality(segs, duration, info.language_probability, lang)
                bad = {"repetition", "low_confidence", "little_speech"} & set(flags)
                payload = {
                    "submission_id": sid, "text": " ".join(s["text"] for s in segs),
                    "segments": [{k: s[k] for k in ("start", "end", "text")} for s in segs],
                    "language": info.language, "engine": "faster-whisper", "model": a.model,
                    "confidence": round(conf, 3), "duration": round(duration, 1),
                    "flags": flags, "status": "review" if bad else "done",
                }
                requests.post(f"{a.url}/api/pipeline/transcript", json=payload, headers=H, timeout=120).raise_for_status()
                print(f"  #{sid}: {duration:.0f}s audio in {time.time()-t0:.0f}s, {len(segs)} segs, conf {conf:.2f}, {wpm:.0f} wpm, "
                      f"{'REVIEW ' + ','.join(flags) if bad else 'ok ' + ','.join(flags)}", flush=True)
            except Exception as e:
                print(f"  #{sid}: FAILED {e}", flush=True)
                try:
                    requests.post(f"{a.url}/api/pipeline/status", json={"id": sid, "status": "failed", "error": str(e)[:300]}, headers=H, timeout=30)
                except Exception:
                    pass
            finally:
                if os.path.exists(path):
                    os.remove(path)   # do not keep interview audio on the worker machine
        if not a.loop:
            break
        time.sleep(a.every)


if __name__ == "__main__":
    main()
