/* Transcription tab: worker status, priority queue, how much the audio adds over typed notes, transcript search */
const TR_ST = { pending: ['Waiting', 'info'], processing: ['Transcribing', 'warn'], done: ['Transcribed', 'good'], review: ['Needs review', 'warn'], failed: ['Failed', 'bad'], rejected: ['Rejected', 'bad'], missing: ['No file', 'bad'] }
const trPill = s => `<span class="pill ${(TR_ST[s] || ['', ''])[1]}">${(TR_ST[s] || [s])[0]}</span>`
const ago = s => s == null ? '-' : s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`

function workerCmds() {
  const url = location.origin
  return {
    win: `:: 1) install Python 3.9+ from python.org (tick "Add to PATH"), then in Command Prompt:
pip install faster-whisper numpy requests av
curl -O ${url}/worker.py
set DASH_URL=${url}
set ADMIN_KEY=<INGEST_TOKEN>
python worker.py --loop`,
    mac: `pip3 install faster-whisper numpy requests av
curl -O ${url}/worker.py
export DASH_URL=${url}
export ADMIN_KEY=<INGEST_TOKEN>
python3 worker.py --loop`,
    colab: `# Google Colab (free GPU): Runtime > Change runtime type > T4 GPU, then run this in one cell
!pip -q install faster-whisper numpy requests av
!curl -sO ${url}/worker.py
import os; os.environ["DASH_URL"]="${url}"; os.environ["ADMIN_KEY"]="<INGEST_TOKEN>"
!python worker.py --loop`,
  }
}

VIEWS.transcription = async (v) => {
  const d = await (await fetch('/api/transcription')).json()
  if (d.error) { v.innerHTML = empty('Could not load', esc(d.error)); return }
  const t = d.totals, w = d.workers[0], on = d.online
  const todo = t.pending + t.failed + t.processing
  const cmds = workerCmds()
  const cur = on && w.current
  const gap = d.items.filter(i => i.spoken_words != null)
  const thinWaiting = d.thin_waiting

  v.innerHTML = `
  <div class="kpis">
    ${kpi(`${t.done + t.review}/${t.uploaded}`, 'Recordings transcribed', `${t.uploaded ? pct((t.done + t.review) / t.uploaded) : '-'} of uploaded`, t.done + t.review === t.uploaded && t.uploaded ? 'good' : '')}
    ${kpi(todo, 'Waiting for transcription', d.eta_min != null ? `about ${d.eta_min < 90 ? d.eta_min + ' min' : (d.eta_min / 60).toFixed(1) + ' h'} on this worker` : 'start the worker to get an estimate', todo ? 'warn' : '')}
    ${kpi(t.review, 'Need your review', 'held back from the report until accepted', t.review ? 'warn' : '')}
    ${kpi(t.gain_x != null ? t.gain_x + '×' : '-', 'Spoken words vs typed words', t.gain_x != null ? `${fmt(t.spoken_words_done)} spoken vs ${fmt(t.typed_words_done)} typed` : 'appears after the first transcript', t.gain_x > 3 ? 'good' : '')}
    ${kpi(t.missing, 'Consent given, no file', 'audio never uploaded: follow up', t.missing ? 'bad' : '')}
  </div>

  <div class="grid g2" style="margin-top:14px">
    <div class="card">
      <h3><i class="fa-solid fa-microchip"></i> Transcription worker</h3>
      <div class="sub">Speech-to-text runs on a computer (not on Cloudflare). It picks recordings from the queue below, thinnest typed notes first.</div>
      ${on ? `<p><span class="pill good"><i class="fa-solid fa-circle"></i> Online</span> <b>${esc(w.host)}</b> &middot; model <b>${esc(w.model)}</b> on <b>${esc(w.device)}</b> &middot; seen ${ago(w.age_s)}</p>
        <p class="mu">Done this session: <b>${w.done || 0}</b> &middot; failed: <b>${w.failed || 0}</b>${w.rtf ? ` &middot; speed: ${(1 / w.rtf).toFixed(1)}× real time` : ''}</p>
        ${cur ? `<div class="tr-now"><b>Now: submission ${cur.id}</b> (${fmt(cur.audio_min)} min of audio)<div class="bar"><i style="width:${Math.round(cur.pct || 0)}%"></i></div><span class="mu">${Math.round(cur.pct || 0)}%</span></div>` : '<p class="mu">Idle: waiting for new recordings.</p>'}`
        : `<p><span class="pill bad"><i class="fa-solid fa-circle"></i> Offline</span> ${w ? `last seen ${ago(w.age_s)} on ${esc(w.host)}` : 'no worker has connected yet'}</p>
        <p class="mu" style="font-size:12.5px">Nothing is being transcribed right now. Start the worker on any computer using one of the options below.</p>`}
      ${d.recovered ? `<p class="mu">${d.recovered} recording(s) were stuck "processing" and have been put back in the queue.</p>` : ''}
      <details ${on ? '' : 'open'} style="margin-top:8px"><summary><b>How to start the worker</b></summary>
        <div class="tabs-mini" id="cmd-tabs"><button data-c="win" class="on">Windows</button><button data-c="mac">Mac / Linux</button><button data-c="colab">Google Colab (GPU)</button></div>
        <pre id="cmd-box">${esc(cmds.win)}</pre>
        <p class="mu" style="font-size:12px">Replace <code>&lt;INGEST_TOKEN&gt;</code> with the admin key. Needs about 4 GB of free RAM (or a GPU, which is 10 to 20 times faster). ffmpeg is not required. Add <code>--model medium</code> for better accuracy on accented English, or <code>--language lg</code> if interviews are in Luganda.</p>
        <p><a href="/worker.py" download><button class="ghost" type="button"><i class="fa-solid fa-download"></i> Download worker.py</button></a></p>
      </details>
    </div>

    <div class="card">
      <h3><i class="fa-solid fa-comments"></i> Why the audio matters for the report</h3>
      <div class="sub">Interviewers are typing only a few words per open question. The recording holds the full answer.</div>
      ${gap.length ? `<p>Across <b>${gap.length}</b> transcribed interviews, typed notes total <b>${fmt(t.typed_words_done)}</b> words; the recordings add <b>${fmt(t.spoken_words_done)}</b> spoken words (<b>${t.gain_x}×</b> more material to code and quote).</p>`
        : `<p>No recording has been transcribed yet, so the report currently rests on typed notes alone.</p>`}
      <p class="${thinWaiting ? '' : 'mu'}">${thinWaiting ? `<span class="pill warn">${thinWaiting}</span> queued recording(s) have typed notes below the minimum for their form. They are transcribed first.` : 'No queued recording has thin typed notes.'}</p>
      <ul class="mu" style="font-size:12.5px;margin:6px 0 0 18px">
        <li>Accepted transcripts feed themes, quotes and the report.</li>
        <li>Transcripts that look unreliable (loops, silence, low confidence) wait in <b>Needs review</b>.</li>
        <li>Damaged recordings are transcribed as far as possible and marked, so you know speech is missing.</li>
        <li>Everything transcribed is searchable below.</li>
      </ul>
    </div>
  </div>

  <div class="card" style="margin-top:14px">
    <h3><i class="fa-solid fa-magnifying-glass"></i> Search what people said</h3>
    <div class="sub">Searches typed answers and transcripts (spoken words) together. Names and phone numbers are masked.</div>
    <input id="tr-q" placeholder="e.g. relocation, market fees, enforcement, KCCA…" style="width:100%;max-width:520px"> <span class="mu" id="tr-qn"></span>
    <div id="tr-hits"></div>
  </div>

  <div class="card" style="margin-top:14px">
    <h3><i class="fa-solid fa-list-ol"></i> Recordings</h3>
    <div class="sub">Priority order for the queue; click a row to open the interview, listen and read the transcript.</div>
    <div class="filters"><select id="tr-f"><option value="">All statuses</option>${Object.keys(TR_ST).map(k => `<option value="${k}">${TR_ST[k][0]}</option>`).join('')}</select>
      <button class="ghost" id="tr-reqall" title="Put every failed recording back in the queue">Retry failed</button></div>
    <div class="tablewrap"><table class="tbl"><thead><tr><th>#</th><th>Form</th><th>Where</th><th>Enumerator</th><th>Status</th><th>Session</th><th>Typed</th><th>Spoken</th><th>Gain</th><th>Notes</th><th></th></tr></thead><tbody id="tr-body"></tbody></table></div>
  </div>`

  // command tabs
  v.querySelectorAll('#cmd-tabs button').forEach(b => b.onclick = () => {
    v.querySelectorAll('#cmd-tabs button').forEach(x => x.classList.toggle('on', x === b)); $('#cmd-box').textContent = cmds[b.dataset.c]
  })

  // table: queue order first, then others by id desc
  const order = new Map(d.queue_ids.map((id, i) => [id, i + 1]))
  const rank = i => order.has(i.id) ? order.get(i.id) : 1e6 - i.id
  const draw = () => {
    const f = $('#tr-f').value
    const rows = d.items.filter(i => !f || i.status === f).sort((a, b) => rank(a) - rank(b))
    $('#tr-body').innerHTML = rows.map(i => {
      const q = order.get(i.id)
      const gain = i.spoken_words != null && i.typed_words ? (i.spoken_words / i.typed_words).toFixed(1) + '×' : i.spoken_words != null ? 'new' : ''
      const notes = [...(i.flags || []).map(k => FI(k).label || k), i.error ? 'error: ' + i.error : '', i.gap > 0 && q ? `typed ${i.typed_words} < ${i.thin_at}` : ''].filter(Boolean).join(' · ')
      const act = i.status === 'review' ? `<button class="ghost sm" data-a="accept" data-i="${i.id}">Accept</button> <button class="ghost sm" data-a="reject" data-i="${i.id}">Reject</button>`
        : ['failed', 'done', 'rejected'].includes(i.status) ? `<button class="ghost sm" data-a="requeue" data-i="${i.id}">Re-run</button>` : ''
      return `<tr data-i="${i.id}"><td>${q || ''}</td><td>${esc(i.form || '')}</td><td>${esc(i.label || '')}</td><td>${esc(i.enumerator || '')}</td><td>${trPill(i.status)}${i.claimed ? ' <i class="fa-solid fa-spinner fa-spin"></i>' : ''}</td>
        <td>${i.session_min != null ? i.session_min + ' min' : '-'}</td><td class="${i.gap > 0 ? 'bad-t' : ''}">${i.typed_words}</td><td>${i.spoken_words != null ? fmt(i.spoken_words) : ''}</td><td>${gain}</td><td class="mu" style="font-size:12px">${esc(notes)}</td><td>${act}</td></tr>`
    }).join('') || `<tr><td colspan="11">${empty('No recordings', 'Nothing matches this filter.')}</td></tr>`
    $('#tr-body').querySelectorAll('tr[data-i]').forEach(tr => tr.onclick = e => { if (e.target.closest('button')) return; showInterview(+tr.dataset.i) })
    $('#tr-body').querySelectorAll('button[data-a]').forEach(b => b.onclick = async () => {
      try { const r = await adminCall(`transcript/${b.dataset.i}/${b.dataset.a}`); toast(r.ok ? 'Saved' : (r.error || 'Failed')); if (r.ok) VIEWS.transcription(v) } catch (e) { toast(e.message) }
    })
  }
  $('#tr-f').onchange = draw; draw()
  $('#tr-reqall').onclick = async () => {
    try { const ids = d.items.filter(i => i.status === 'failed').map(i => i.id); for (const id of ids) await adminCall(`transcript/${id}/requeue`); toast(ids.length ? `${ids.length} re-queued` : 'Nothing failed'); VIEWS.transcription(v) } catch (e) { toast(e.message) }
  }

  // search
  let tm
  $('#tr-q').oninput = e => {
    clearTimeout(tm); const q = e.target.value.trim()
    if (q.length < 3) { $('#tr-hits').innerHTML = ''; $('#tr-qn').textContent = ''; return }
    tm = setTimeout(async () => {
      const r = await (await fetch('/api/search?q=' + encodeURIComponent(q))).json()
      $('#tr-qn').textContent = `${r.n} match${r.n === 1 ? '' : 'es'}${r.n > 120 ? ' (showing 120)' : ''}`
      const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig')
      $('#tr-hits').innerHTML = r.hits.map(h => `<div class="hit" data-i="${h.id}"><span class="pill ${h.source.startsWith('spoken') ? 'teal' : 'info'}">${esc(h.source)}</span> <b>${esc(h.form || '')}</b> ${esc(h.label || '')} <span class="mu">${esc(h.where)}</span><div>${esc(h.text).replace(re, '<mark>$1</mark>')}</div></div>`).join('')
      $('#tr-hits').querySelectorAll('.hit').forEach(x => x.onclick = () => showInterview(+x.dataset.i))
    }, 300)
  }

  // live refresh while the worker is running
  clearInterval(VIEWS.transcription.t)
  if (on || todo) VIEWS.transcription.t = setInterval(() => {
    if (S.tab !== 'transcription' || !v.isConnected || document.hidden || document.activeElement?.id === 'tr-q') return
    VIEWS.transcription(v).catch(() => {})
  }, 15000)
}
