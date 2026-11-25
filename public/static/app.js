/* Trade Order Study dashboard (vanilla JS + Chart.js) */
const $ = (s, r = document) => r.querySelector(s)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const pct = (x, d = 0) => x == null ? '-' : (x * 100).toFixed(d) + '%'
const fmt = n => n == null ? '-' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 })
const mins = s => s == null ? '-' : (s / 60).toFixed(1) + ' min'
const mmss = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
const S = { cfg: null, tab: 'overview', f: { region: '', lg: '', grp: '' }, charts: [], key: localStorage.getItem('adminKey') || '' }
const COL = { teal: '#1f877d', navy: '#142a46', gold: '#edb14b', blue: '#2f6fb5', red: '#b94d4d', green: '#3f8f55', purple: '#7a5bb5', grey: '#9aa8b8' }
const POLCOL = { positive: COL.green, negative: COL.red, mixed: COL.gold, neutral: COL.grey }
const DIMCOL = () => Object.fromEntries(S.cfg.dimensions.map(d => [d.id, d.color]))
const lgName = c => S.cfg.lgs.find(l => l.code === c)?.label || c
const regName = c => S.cfg.regions[c] || c
const TABS = [
  ['overview', 'fa-gauge-high', 'Overview'], ['coverage', 'fa-map-location-dot', 'Field coverage'], ['themes', 'fa-tags', 'Themes'],
  ['map', 'fa-location-dot', 'Map'], ['heatmap', 'fa-table-cells', 'LG comparison'], ['evidence', 'fa-quote-left', 'Evidence & quotes'], ['quant', 'fa-chart-simple', 'Closed questions'],
  ['triang', 'fa-scale-balanced', 'Triangulation'], ['interviews', 'fa-microphone-lines', 'Interviews & audio'], ['quality', 'fa-shield-halved', 'Data quality'], ['report', 'fa-file-lines', 'Report'], ['pipeline', 'fa-gears', 'Pipeline'],
]

function qs(extra = {}) {
  const p = new URLSearchParams()
  const f = { ...S.f, ...extra }
  for (const [k, v] of Object.entries(f)) { if (v) p.set(k, v) }
  return p.toString()
}
async function api(path, extra) {
  const q = qs(extra)
  const r = await fetch('/api/' + path + (q ? (path.includes('?') ? '&' : '?') + q : ''))
  if (!r.ok) throw new Error(path + ' → ' + r.status)
  return r.json()
}
async function adminCall(path, method = 'POST', body) {
  if (!S.key) { const k = prompt('Enter the admin key (INGEST_TOKEN) to run this action:'); if (!k) throw new Error('cancelled'); S.key = k; localStorage.setItem('adminKey', k) }
  const r = await fetch('/api/' + path, { method, headers: { 'x-admin-key': S.key, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  if (r.status === 401) { localStorage.removeItem('adminKey'); S.key = ''; throw new Error('Wrong admin key') }
  return r.json()
}
function toast(m, ms = 3200) { const t = $('#toast'); t.textContent = m; t.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), ms) }
function kill() { S.charts.forEach(c => c.destroy()); S.charts = [] }
function chart(id, cfg) { const el = document.getElementById(id); if (!el) return; const c = new Chart(el, cfg); S.charts.push(c); return c }
const empty = (t, d) => `<div class="empty"><b>${t}</b>${d || ''}</div>`
const opt = (arr, sel) => arr.map(([v, l]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`).join('')
const GRP = { lg_official: 'LG official', lg_political_enforcement: 'Political / enforcement', trader_association: "Traders' assoc.", national: 'National', fgd_informal_traders: 'FGD informal vendors', official: 'Official', trader: 'Trader' }
const isTrader = g => g === 'trader' || g === 'trader_association' || (g || '').startsWith('fgd')
const EVID = { documented: 'info', observed: 'teal', reported: '', inferred: 'warn' }

async function init() {
  S.cfg = await (await fetch('/api/config')).json()
  $('#f-region').innerHTML += Object.entries(S.cfg.regions).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')
  fillLg()
  $('#f-region').onchange = e => { S.f.region = e.target.value; S.f.lg = ''; fillLg(); render() }
  $('#f-lg').onchange = e => { S.f.lg = e.target.value; render() }
  $('#f-grp').onchange = e => { S.f.grp = e.target.value; render() }
  $('#btn-reset').onclick = () => { S.f = { region: '', lg: '', grp: '' }; ['f-region', 'f-lg', 'f-grp'].forEach(i => $('#' + i).value = ''); fillLg(); render() }
  $('#drawer-close').onclick = closeDrawer
  $('#drawer').onclick = e => { if (e.target.id === 'drawer') closeDrawer() }
  $('#tabs').innerHTML = TABS.map(([k, i, l]) => `<button data-t="${k}" class="${k === S.tab ? 'on' : ''}"><i class="fa-solid ${i}"></i>${l}</button>`).join('')
  $('#tabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.tab = b.dataset.t; location.hash = S.tab; document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b)); render() }
  if (location.hash.slice(1) && TABS.some(t => t[0] === location.hash.slice(1))) { S.tab = location.hash.slice(1); document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x.dataset.t === S.tab)) }
  render()
}
function fillLg() {
  const list = S.cfg.lgs.filter(l => !S.f.region || l.region === S.f.region)
  $('#f-lg').innerHTML = '<option value="">All</option>' + list.map(l => `<option value="${l.code}">${l.label}</option>`).join('')
}
function syncInfo() {
  const c = S.cfg
  $('#sync-info').innerHTML = `${c.real_rows} live submission${c.real_rows === 1 ? '' : 's'} &middot; last sync ${c.last_sync ? new Date(c.last_sync).toLocaleString() : 'never'}`
}
async function render() {
  kill(); syncInfo()
  const v = $('#view'); v.innerHTML = '<div class="loading">Loading&hellip;</div>'
  try { await VIEWS[S.tab](v) } catch (e) { console.error(e); v.innerHTML = empty('Something went wrong', esc(e.message)) }
}
function openDrawer(html) { $('#drawer-body').innerHTML = html; $('#drawer').classList.remove('hidden') }
function closeDrawer() { const a = $('#drawer audio'); if (a) a.pause(); $('#drawer').classList.add('hidden') }
const kpi = (v, l, s, cls = '') => `<div class="kpi ${cls}"><div class="v">${v}</div><div class="l">${l}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`
const bars = (items, max, cls = '') => items.map(([l, n, extra]) => `<div class="row"><span>${esc(l)}</span><div class="bar ${cls}"><i style="width:${max ? Math.round(100 * n / max) : 0}%"></i></div><span class="n">${n}${extra || ''}</span></div>`).join('')
const polStack = p => { const t = Object.values(p || {}).reduce((a, b) => a + b, 0) || 1; return `<div class="stack" title="${Object.entries(p || {}).map(([k, v]) => k + ': ' + v).join(', ')}">${['positive', 'mixed', 'neutral', 'negative'].map(k => `<i style="width:${100 * (p?.[k] || 0) / t}%;background:${POLCOL[k]}"></i>`).join('')}</div>` }

const VIEWS = {}
VIEWS.overview = async (v) => {
  const [o, th] = await Promise.all([api('overview'), api('themes')])
  if (!o.total) { v.innerHTML = empty('No submissions in this view yet', 'Run a sync from the <b>Pipeline</b> tab.'); return }
  const a = o.audio, audioN = (a.done || 0)
  const eligible = (o.consented) - (a.declined || 0)
  v.innerHTML = `
  <div class="kpis">
    ${kpi(o.consented, 'Interviews (consented)', `${o.declined} declined &middot; ${Object.entries(o.by_group).map(([g, n]) => n + ' ' + (GRP[g] || g)).join(' &middot; ') || 'none yet'}`)}
    ${kpi(`${o.lgs_covered}/${o.lgs_total}`, 'Local governments reached', `${S.cfg.targets.officials_per_lg + S.cfg.targets.traders_per_lg} KIIs + ${S.cfg.targets.fgd_per_lg} FGDs targeted per LG`, 'navy')}
    ${kpi(`${audioN}`, 'Audio transcribed', `${a.pending || 0} pending &middot; ${a.review || 0} in review &middot; ${a.failed || 0} failed`, 'gold')}
    ${kpi(fmt(o.codes.total), 'Coded evidence segments', `${o.codes.themes}/${o.codes.themes_total} themes seen &middot; ${o.codes.submissions} interviews coded`)}
    ${kpi(fmt(o.words), 'Words of open-ended text', o.median_duration_min ? `median interview ${o.median_duration_min} min` : '')}
    ${kpi(o.transcripts.hours + ' h', 'Audio hours transcribed', o.transcripts.confidence ? `mean ASR confidence ${pct(o.transcripts.confidence)}` : 'no transcripts yet', 'red')}
  </div>
  <div class="dimgrid">${th.dimensions.map(d => `<div class="dim" style="border-left-color:${d.color}"><b>${d.label}</b><span>${d.interviews}</span><small>interviews &middot; ${d.mentions} segments &middot; ${S.cfg.objectives.find(x => x.id === d.obj)?.id}</small></div>`).join('')}</div>
  <div class="grid g2">
    <div class="card"><h3>Interviews over time</h3><div class="sub">By interview date</div><canvas id="c-time"></canvas></div>
    <div class="card"><h3>Top themes</h3><div class="sub">Share of interviews mentioning each theme (all sources)</div>${th.themes.length ? bars(th.themes.slice(0, 9).map(t => [t.label, t.interviews, ` <span class="mu">${pct(t.pct)}</span>`]), th.themes[0].interviews) : '<div class="mu">No coded text yet.</div>'}</div>
    <div class="card"><h3>Audio pipeline status</h3><div class="sub">Interviews with consent</div>${audioBar(a)}<div class="legend">${audioLegend(a)}</div></div>
    <div class="card"><h3>Sentiment of coded evidence</h3><div class="sub">Rule-based polarity per coded segment: treat as a screening aid, not a finding</div><canvas id="c-pol"></canvas></div>
  </div>`
  chart('c-time', { type: 'bar', data: { labels: o.timeline.map(x => x.d), datasets: [{ data: o.timeline.map(x => x.n), backgroundColor: COL.teal }] }, options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } } })
  const pk = ['positive', 'mixed', 'neutral', 'negative']
  chart('c-pol', { type: 'doughnut', data: { labels: pk, datasets: [{ data: pk.map(k => th.polarity[k] || 0), backgroundColor: pk.map(k => POLCOL[k]) }] }, options: { plugins: { legend: { position: 'right' } } } })
}
const AUD = { done: ['Transcribed', COL.teal], pending: ['Pending', COL.grey], processing: ['Processing', COL.blue], review: ['Needs review', COL.gold], failed: ['Failed', COL.red], missing: ['Missing audio', '#8b5e3c'], declined: ['No audio consent', '#cbd5e1'], rejected: ['Rejected', '#6b4c4c'], none: ['No audio', '#e2e8f0'] }
const audioBar = a => { const t = Object.values(a).reduce((x, y) => x + y, 0) || 1; return `<div class="audio-status">${Object.keys(AUD).filter(k => a[k]).map(k => `<div style="width:${100 * a[k] / t}%;background:${AUD[k][1]}">${a[k]}</div>`).join('')}</div>` }
const audioLegend = a => Object.keys(AUD).filter(k => a[k]).map(k => `<span><i style="background:${AUD[k][1]}"></i>${AUD[k][0]}</span>`).join('')

VIEWS.coverage = async (v) => {
  const c = await api('coverage')
  if (!c.rows.some(r => r.officials + r.traders + r.fgds) && !c.national) { v.innerHTML = empty('No coverage data yet', 'Targets per LG: ' + c.targets.officials + ' official KIIs + ' + c.targets.traders + ' trader KIIs + ' + c.targets.fgds + ' FGDs.'); return }
  const rows = c.rows.filter(r => (!S.f.region || r.region === S.f.region) && (!S.f.lg || r.code === S.f.lg))
  const cell = (n, t) => `${n}/${t} ${n >= t ? '<span class="pill good">&check;</span>' : ''}`
  v.innerHTML = `<div class="hint">Targets from the inception report, per local government: <b>${c.targets.officials} official KIIs</b> (forms A1 + A2), <b>${c.targets.traders} trader KIIs</b> (A3) and <b>${c.targets.fgds} FGDs</b> (B1). Overall progress: <b>${c.achieved}/${c.target_total}</b> (${pct(c.achieved / c.target_total)}). National-level stakeholder interviews (A4, not tied to an LG): <b>${c.national}</b>.</div>
  <div class="card"><div class="tw"><table><thead><tr><th>Local government</th><th>Region</th><th>Officials (A1+A2)</th><th>Traders (A3)</th><th>FGDs (B1)</th><th style="min-width:150px">Progress</th><th>Audio done</th><th>Declined</th></tr></thead><tbody>
  ${rows.map(r => `<tr class="click" data-lg="${r.code}"><td><b>${esc(r.label)}</b></td><td>${esc(regName(r.region))}</td>
   <td>${cell(r.officials, c.targets.officials)} <span class="mu">(${r.a1}+${r.a2})</span></td><td>${cell(r.traders, c.targets.traders)}</td><td>${cell(r.fgds, c.targets.fgds)}</td>
   <td><div class="row" style="grid-template-columns:1fr 40px;margin:0"><div class="bar ${r.pct >= 100 ? '' : 'gold'}"><i style="width:${r.pct}%"></i></div><span class="n">${r.pct}%</span></div></td><td>${r.audio_done}/${r.audio_total}</td><td>${r.declined || ''}</td></tr>`).join('')}
  </tbody></table></div></div>`
  v.querySelectorAll('tr.click').forEach(tr => tr.onclick = () => { S.f.lg = tr.dataset.lg; $('#f-lg').value = tr.dataset.lg; S.tab = 'interviews'; location.hash = 'interviews'; document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x.dataset.t === 'interviews')); render() })
}

VIEWS.themes = async (v) => {
  const t = await api('themes')
  if (!t.themes.length) { v.innerHTML = empty('No coded evidence in this view', 'Themes appear once open-ended answers or transcripts are synced.'); return }
  const dc = DIMCOL()
  const ev = t.evidence, evT = Object.values(ev).reduce((a, b) => a + b, 0) || 1
  v.innerHTML = `<div class="hint"><b>How coding works.</b> Each open-ended answer and each transcript is split into passages and matched to a codebook built from the report's Table 2 (7 analytical dimensions, ${S.cfg.themes.length} themes), then mapped to ToR Objectives 1-4. Every passage carries an evidence label (documented / observed / reported / inferred) as required by the methodology. The codebook is a first-pass screen: read the excerpts under <i>Evidence &amp; quotes</i> before citing any theme. Divergence = share of officials mentioning a theme minus share of traders.</div>
  <div class="grid g2">
    <div class="card"><h3>Evidence labels</h3><div class="sub">Basis of each coded passage</div>${['documented', 'observed', 'reported', 'inferred'].map(k => `<div class="row"><span><span class="pill ${EVID[k]}">${k}</span></span><div class="bar ${k === 'documented' ? 'blue' : k === 'inferred' ? 'gold' : ''}"><i style="width:${100 * (ev[k] || 0) / evT}%"></i></div><span class="n">${ev[k] || 0}</span></div>`).join('')}<p class="mu" style="font-size:12px">Most interview material is "reported". Only evidence answers that cite a register, report or log are marked "documented".</p></div>
    <div class="card"><h3>Official vs trader emphasis</h3><div class="sub">Themes with the largest gap in who raises them (${t.n_off} officials, ${t.n_trd} traders)</div><canvas id="c-div"></canvas></div>
  </div>
  <div class="card"><h3>Theme frequency</h3><div class="sub">Click a row to read the supporting excerpts</div><div class="tw"><table><thead><tr><th>Theme</th><th>Dimension</th><th>Interviews</th><th>%</th><th>Officials</th><th>Traders</th><th>LGs</th><th>Tone</th><th>Source</th></tr></thead><tbody>
  ${t.themes.map(r => `<tr class="click" data-th="${r.theme}"><td><b>${esc(r.label)}</b></td><td><span class="pill" style="background:${dc[r.dimension]}22;color:${dc[r.dimension]}">${r.dimension}</span></td><td>${r.interviews}</td><td>${pct(r.pct)}</td><td>${r.officials}</td><td>${r.traders}</td><td>${r.lgs}</td><td>${polStack(r.polarity)}</td><td class="mu">${r.from_text} text &middot; ${r.from_audio} audio</td></tr>`).join('')}
  </tbody></table></div></div>
  <div class="card"><h3>Emergent terms</h3><div class="sub">Frequent words/phrases the codebook does not yet cover: candidates for new themes</div><div id="emerg" class="mu">Loading&hellip;</div></div>`
  const div = [...t.themes].filter(x => x.interviews >= 2).sort((a, b) => Math.abs(b.divergence) - Math.abs(a.divergence)).slice(0, 8)
  chart('c-div', { type: 'bar', data: { labels: div.map(x => x.label), datasets: [{ label: 'Officials', data: div.map(x => +(x.pct_off * 100).toFixed(0)), backgroundColor: COL.blue }, { label: 'Traders', data: div.map(x => +(x.pct_trd * 100).toFixed(0)), backgroundColor: COL.gold }] }, options: { indexAxis: 'y', scales: { x: { ticks: { callback: v => v + '%' }, max: 100 } } } })
  v.querySelectorAll('tr.click').forEach(tr => tr.onclick = () => { goEvidence({ theme: tr.dataset.th }) })
  api('emergent').then(e => { const el = $('#emerg'); if (!el) return; el.innerHTML = e.terms.length ? `<div class="chips">${e.terms.slice(0, 40).map(x => `<span class="chip ${x.officials >= x.traders ? 'off' : 'trd'}" title="officials ${x.officials} / traders ${x.traders}">${esc(x.term)}<b>${x.docs}</b></span>`).join('')}</div><p style="font-size:12px">Blue = mostly raised by officials, orange = mostly by traders. Number = interviews.</p>` : 'Not enough text yet (needs terms appearing in 2+ interviews).' })
}
function goEvidence(extra) {
  S.evf = { ...extra }; S.tab = 'evidence'; location.hash = 'evidence'
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x.dataset.t === 'evidence')); render()
}

VIEWS.heatmap = async (v) => {
  const h = await api('heatmap')
  if (!h.cells.length) { v.innerHTML = empty('No coded evidence yet', 'The LG comparison matrix fills in as text and transcripts are coded.'); return }
  const dc = DIMCOL()
  const lgs = h.lgs.filter(l => (!S.f.region || l.region === S.f.region) && (!S.f.lg || l.code === S.f.lg) && h.per_lg[l.code])
  const cell = {}; h.cells.forEach(c => cell[c.theme + '|' + c.lg] = c.n)
  const mix = (n, tot) => { const a = Math.min(1, n / Math.max(tot, 1)); return `rgba(31,135,125,${(0.18 + 0.82 * a).toFixed(2)})` }
  let html = `<div class="hint">Each cell = number of interviews in that local government that raised the theme (colour = share of that LG's interviews). Use it to see where a theme is concentrated, and where it is absent. With only a few interviews per LG, treat gaps as <i>not raised</i>, not <i>not present</i>. Click a cell to read the excerpts.</div>
  <div class="card" style="overflow:auto"><table class="hm"><tr><th></th>${lgs.map(l => `<th class="lg">${esc(l.label)} (${h.per_lg[l.code]})</th>`).join('')}</tr>`
  let lastDim = ''
  for (const t of h.themes) {
    if (t.dim !== lastDim) { lastDim = t.dim; html += `<tr class="dimrow"><td colspan="${lgs.length + 1}" style="color:${dc[t.dim]}">${S.cfg.dimensions.find(d => d.id === t.dim).label}</td></tr>` }
    html += `<tr><th class="th">${esc(t.label)}</th>${lgs.map(l => { const n = cell[t.code + '|' + l.code] || 0; return n ? `<td class="c" style="background:${mix(n, h.per_lg[l.code])}" data-t="${t.code}" data-l="${l.code}">${n}</td>` : '<td class="c" style="background:#f0f3f7"></td>' }).join('')}</tr>`
  }
  v.innerHTML = html + '</table></div>'
  v.querySelectorAll('td.c[data-t]').forEach(td => td.onclick = () => { S.f.lg = td.dataset.l; $('#f-lg').value = td.dataset.l; goEvidence({ theme: td.dataset.t }) })
}

VIEWS.evidence = async (v) => {
  const ef = S.evf || (S.evf = {})
  const cfg = S.cfg
  v.innerHTML = `<div class="toolbar">
    <label>Dimension<select id="e-dim"><option value="">All</option>${opt(cfg.dimensions.map(d => [d.id, d.label]), ef.dimension)}</select></label>
    <label>Theme<select id="e-theme"><option value="">All</option>${opt(cfg.themes.map(t => [t.code, t.label]), ef.theme)}</select></label>
    <label>Objective<select id="e-obj"><option value="">All</option>${opt(cfg.objectives.map(o => [o.id, o.id + ': ' + o.label]), ef.objective)}</select></label>
    <label>Tone<select id="e-pol"><option value="">All</option>${opt(['positive', 'negative', 'mixed', 'neutral'].map(x => [x, x]), ef.polarity)}</select></label>
    <label>Evidence<select id="e-ev"><option value="">All</option>${opt(['documented', 'observed', 'reported', 'inferred'].map(x => [x, x]), ef.evidence)}</select></label>
    <label>Source<select id="e-src"><option value="">All</option>${opt([['text', 'Form text'], ['audio', 'Audio transcript']], ef.source)}</select></label>
    <label>Search<input type="search" id="e-q" placeholder="keyword" value="${esc(ef.q || '')}"></label>
    <a href="/api/export/codes.csv?${qs(ef)}" download><button class="ghost" type="button"><i class="fa-solid fa-download"></i> Evidence matrix CSV</button></a>
  </div><div id="e-list"><div class="loading">Loading&hellip;</div></div>`
  const go = async () => {
    const e = { dimension: $('#e-dim').value, theme: $('#e-theme').value, objective: $('#e-obj').value, polarity: $('#e-pol').value, evidence: $('#e-ev').value, source: $('#e-src').value, q: $('#e-q').value.trim() }
    Object.assign(ef, e)
    const r = await api('excerpts?limit=60', e)
    const list = $('#e-list')
    if (!r.items.length) { list.innerHTML = empty('No excerpts match', 'Change filters or sync more data.'); return }
    list.innerHTML = `<div class="mu" style="margin-bottom:8px">Showing ${r.items.length} excerpts (longest first). Respondent names are never stored; phone numbers and emails are masked.</div>` + r.items.map(x => `<div class="quote ${x.polarity}">
      <p>&ldquo;${esc(x.excerpt)}&rdquo;</p><div class="meta"><span class="pill teal">${esc(x.theme_label)}</span><span class="pill ${EVID[x.evidence]}">${x.evidence}</span><span class="pill">${x.polarity}</span>
      <span>${esc(x.lg_label)} &middot; ${GRP[x.grp] || x.grp || ''}</span><span>&middot; ${esc(x.q)}${x.source === 'audio' && x.seg_start != null ? ' @ ' + mmss(x.seg_start) : ''}</span>
      <a href="#" data-i="${x.sid}" data-t="${x.source === 'audio' ? x.seg_start : ''}" class="open">open interview <i class="fa-solid fa-arrow-up-right-from-square"></i></a></div></div>`).join('')
    list.querySelectorAll('a.open').forEach(a => a.onclick = ev => { ev.preventDefault(); showInterview(+a.dataset.i, a.dataset.t) })
  }
  ;['e-dim', 'e-theme', 'e-obj', 'e-pol', 'e-ev', 'e-src'].forEach(i => $('#' + i).onchange = go)
  let tm; $('#e-q').oninput = () => { clearTimeout(tm); tm = setTimeout(go, 350) }
  go()
}

VIEWS.quant = async (v) => {
  const d = await api('quant', S.qform ? { form: S.qform } : {})
  S.qform = d.form || ''
  if (!d.form || !d.n) {
    v.innerHTML = qpick(d) + empty('No closed-question data for this form yet', 'Charts appear once consented interviews on this form are synced. Pick another form above.')
    qbind(v); return
  }
  const secs = [...new Set(d.questions.map(q => q.section))]
  v.innerHTML = qpick(d) + `<div class="hint">Closed questions for the selected form, split by respondent group. Likert items (1-5) show the mean. Multi-select questions can add up to more than 100%. n = ${d.n} consented interview${d.n === 1 ? '' : 's'} on this form.</div>` +
    (d.questions.length ? secs.map(sec => `<h3 style="color:var(--navy);margin:18px 0 8px">${esc(sec || 'Other')}</h3><div class="grid g2">${d.questions.filter(q => q.section === sec).map(q => qcard(q)).join('')}</div>`).join('') : empty('This form has no closed (choice) questions', 'Its answers are open-ended: see Themes and Evidence & quotes.'))
  d.questions.forEach(q => qchart(q))
  qbind(v)
}
const qpick = d => `<div class="toolbar"><label>Form<select id="q-form">${(d.forms || []).map(f => `<option value="${f.uid}" ${f.uid === d.form ? 'selected' : ''}>${esc(f.code)} &middot; ${esc(f.name)} (${f.n})</option>`).join('')}</select></label></div>`
const qbind = v => { const el = $('#q-form'); if (el) el.onchange = e => { S.qform = e.target.value; render() } }
function qcard(q) {
  const lik = q.likert
  return `<div class="card"><h3 style="font-size:14px">${esc(q.label)}</h3><div class="sub">n = ${q.n}${lik && lik.mean != null ? ` &middot; mean <b>${lik.mean.toFixed(2)}</b>` : ''}</div>${q.n ? `<canvas id="q-${q.key}" style="max-height:${Math.max(120, q.options.length * 30 + 40)}px"></canvas>` : '<div class="mu">No answers yet</div>'}</div>`
}
function qchart(q) {
  if (!q.n) return
  const short = l => l.length > 46 ? l.slice(0, 44) + '…' : l
  const share = (o, tot) => q.options.map(x => tot ? +(100 * (o[x.v] || 0) / tot).toFixed(0) : 0)
  const cols = [COL.blue, COL.gold, COL.teal, COL.red, COL.grey]
  const groups = Object.keys(q.byGrp)
  chart('q-' + q.key, {
    type: 'bar', data: { labels: q.options.map(x => short(x.label)), datasets: groups.map((g, i) => ({ label: `${GRP[g] || g} (n=${q.nGrp[g] || 0})`, data: share(q.byGrp[g], q.nGrp[g]), backgroundColor: cols[i % cols.length] })) },
    options: { indexAxis: 'y', plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } }, scales: { x: { max: 100, ticks: { callback: v => v + '%' } }, y: { ticks: { font: { size: 10.5 } } } } }
  })
}

VIEWS.triang = async (v) => {
  const t = await api('triangulation')
  if (!t.rows.length && !t.lg.length) { v.innerHTML = empty('No official interviews with before/after figures yet', 'This view compares officials\' ratings (Section D) against the before/after figures they reported (Section E).'); return }
  const vc = { consistent: 'good', 'perception better than figures': 'bad', 'perception worse than figures': 'warn', 'reported no change; figures moved': 'warn', 'not comparable': '' }
  const tot = t.rows.length || 1
  const money = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : fmt(n)
  v.innerHTML = `<div class="hint"><b>Perception vs. documented figures.</b> The methodology requires interview claims to be triangulated with administrative records. For each official, the rating given in Section D (stalls, licences, OSR) is compared with the before/after figure from Section E. A mismatch is a prompt to ask for the source document, not a conclusion that the respondent is wrong. ${t.with_figures} figure pairs from ${t.officials} officials.</div>
  <div class="grid g2"><div class="card"><h3>Consistency of ratings with figures</h3><div class="sub">${t.rows.length} comparable rating-vs-figure pairs</div>
    ${Object.entries(t.verdicts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<div class="row"><span><span class="pill ${vc[k] || ''}">${k}</span></span><div class="bar ${k === 'consistent' ? '' : 'gold'}"><i style="width:${100 * n / tot}%"></i></div><span class="n">${n}</span></div>`).join('')}</div>
   <div class="card"><h3>Reported change by local government</h3><div class="sub">Summed before/after figures reported by officials: % change</div><canvas id="c-tri"></canvas></div></div>
  <div class="card"><h3>Pairs needing document verification</h3><div class="sub">Where the rating and the numbers disagree (click to open the interview)</div><div class="tw"><table><thead><tr><th>LG</th><th>Metric</th><th>Rating</th><th>Before</th><th>After</th><th>Change</th><th>Assessment</th><th>Docs cited</th></tr></thead><tbody>
  ${t.rows.filter(r => r.verdict !== 'consistent' && r.verdict !== 'not comparable').slice(0, 80).map(r => `<tr class="click" data-i="${r.sid}"><td>${esc(r.label)}</td><td>${r.metric}</td><td>${r.rating.replace('_', ' ')}</td><td>${money(r.before)}</td><td>${money(r.after)}</td><td class="${r.change < 0 ? 'neg' : 'pos'}">${(r.change * 100).toFixed(0)}%</td><td><span class="pill ${vc[r.verdict]}">${r.verdict}</span></td><td>${r.docs ? '<i class="fa-solid fa-check pos"></i>' : '<span class="mu">none</span>'}</td></tr>`).join('') || '<tr><td colspan="8" class="mu">Nothing flagged</td></tr>'}
  </tbody></table></div></div>`
  const mets = ['Trade licences', 'Market stalls', 'Own-source revenue'], cols = [COL.teal, COL.blue, COL.gold]
  const lgs = t.lg.filter(l => Object.values(l.change).some(x => x != null)).sort((a, b) => a.label.localeCompare(b.label))
  chart('c-tri', { type: 'bar', data: { labels: lgs.map(l => l.label), datasets: mets.map((m, i) => ({ label: m, data: lgs.map(l => l.change[m] == null ? null : +(l.change[m] * 100).toFixed(0)), backgroundColor: cols[i] })) }, options: { scales: { y: { ticks: { callback: v => v + '%' } } }, plugins: { legend: { position: 'bottom' } } } })
  v.querySelectorAll('tr.click').forEach(tr => tr.onclick = () => showInterview(+tr.dataset.i))
}

VIEWS.interviews = async (v) => {
  const r = await api('interviews')
  if (!r.items.length) { v.innerHTML = empty('No interviews in this view', 'Sync from KoboToolbox in the Pipeline tab.'); return }
  v.innerHTML = `<div class="toolbar"><label>Audio status<select id="i-aud"><option value="">All</option>${opt(Object.entries(AUD).map(([k, x]) => [k, x[0]]), '')}</select></label><label>Search<input type="search" id="i-q" placeholder="LG, enumerator, id"></label><span class="mu" id="i-n"></span></div>
  <div class="card"><div class="tw"><table><thead><tr><th>ID</th><th>Form</th><th>Where / who</th><th>Group</th><th>Date</th><th>Duration</th><th>Enumerator</th><th>Words</th><th>Codes</th><th>Audio</th><th>Flags</th></tr></thead><tbody id="i-body"></tbody></table></div></div>`
  const draw = () => {
    const a = $('#i-aud').value, q = $('#i-q').value.toLowerCase()
    const rows = r.items.filter(x => (!a || x.audio === a) && (!q || (x.label + ' ' + (x.enumerator || '') + ' ' + x.id).toLowerCase().includes(q)))
    $('#i-n').textContent = rows.length + ' interviews'
    $('#i-body').innerHTML = rows.map(x => `<tr class="click" data-i="${x.id}"><td>${x.id}</td><td><span class="pill" title="${esc(x.form_name || '')}">${esc(x.form || '')}</span></td><td><b>${esc(x.label)}</b></td><td>${GRP[x.grp] || '-'}</td><td>${x.date || '-'}</td><td>${mins(x.duration_sec)}</td><td>${esc(x.enumerator || '-')}</td><td>${x.words}</td><td>${x.codes}</td>
      <td><span class="pill" style="background:${AUD[x.audio]?.[1] || '#eee'}22;color:${AUD[x.audio]?.[1] || '#555'}">${x.consent === 'no' ? 'declined interview' : (AUD[x.audio]?.[0] || x.audio)}</span></td><td>${x.flags ? `<span class="pill bad">${x.flags}</span>` : ''}</td></tr>`).join('')
    $('#i-body').querySelectorAll('tr').forEach(tr => tr.onclick = () => showInterview(+tr.dataset.i))
  }
  $('#i-aud').onchange = draw; $('#i-q').oninput = draw; draw()
}

async function showInterview(id, seek) {
  openDrawer('<div class="loading">Loading&hellip;</div>')
  const d = await (await fetch('/api/interview/' + id)).json()
  if (d.error) { openDrawer(empty('Not found')); return }
  const t = d.transcript
  const tcodes = (d.codes || []).filter(c => c.source === 'audio')
  const secs = {}; d.texts.forEach(x => (secs[x.section] ||= []).push(x))
  const csecs = {}; d.closed.forEach(x => (csecs[x.section] ||= []).push(x))
  const canTrans = t && ['review', 'done', 'rejected'].includes(t.status)
  openDrawer(`<h2 style="margin:0 0 4px;color:var(--navy)">${esc(d.label)} <span class="pill ${isTrader(d.grp) ? 'warn' : 'info'}">${GRP[d.grp] || ''}</span></h2>
  <div class="mu">${esc(d.form_name || '')} &middot; #${d.id}${d.affiliation && d.affiliation !== d.label ? ' &middot; ' + esc(d.affiliation) : ''}</div>
  <div class="kv"><div>Date<b>${d.date || '-'}</b></div><div>Duration<b>${mins(d.duration_sec)}</b></div><div>Enumerator<b>${esc(d.enumerator || '-')}</b></div><div>Audio consent<b>${d.consent_audio || '-'}</b></div><div>Photos<b>${d.photos}</b></div><div>GPS<b>${d.lat != null ? d.lat.toFixed(3) + ', ' + d.lon.toFixed(3) : 'none'}</b></div></div>
  ${d.flags.length ? `<h4>Quality flags</h4>${d.flags.map(f => `<div class="flag ${f.sev}"><i class="fa-solid fa-triangle-exclamation"></i><span>${esc(f.msg)}</span></div>`).join('')}` : ''}
  <h4>Audio &amp; transcript</h4>
  ${d.has_audio ? `<audio id="player" controls preload="none" style="width:100%" ${S.key ? `src="/api/audio/${d.id}?key=${encodeURIComponent(S.key)}"` : ''}></audio>${S.key ? '' : '<button class="sm ghost" id="unlock-audio"><i class="fa-solid fa-lock"></i> Enter admin key to play audio</button>'}` : `<div class="mu">${d.consent_audio === 'no' ? 'Respondent did not consent to audio recording.' : 'No audio attached.'}</div>`}
  ${t ? (t.text ? `<div class="mu" style="margin:6px 0">${esc(t.engine || '')} ${esc(t.model || '')} &middot; language: ${esc(t.language || '?')} &middot; confidence ${t.confidence != null ? pct(t.confidence) : '-'} &middot; status <span class="pill ${t.status === 'done' ? 'good' : t.status === 'review' ? 'warn' : 'bad'}">${t.status}</span>
    ${(t.flags || []).map(f => `<span class="pill warn">${esc(f)}</span>`).join(' ')}</div>
    ${canTrans ? `<div style="margin:6px 0;display:flex;gap:8px">${t.status !== 'done' ? '<button class="sm" data-act="accept">Accept transcript</button>' : ''}${t.status !== 'rejected' ? '<button class="sm warn" data-act="reject">Reject</button>' : ''}<button class="sm ghost" data-act="requeue">Re-transcribe</button></div>` : ''}
    <div style="max-height:300px;overflow:auto;border:1px solid var(--bd);border-radius:8px;padding:6px">${(t.segments || []).map(s => `<div class="seg" data-s="${s.start}"><span class="t">${mmss(s.start)}</span><span>${esc(s.text)}</span></div>`).join('')}</div>` : `<div class="mu">Transcript ${t.status}${t.error ? ': ' + esc(t.error) : ''}</div>`) : `<div class="mu">Status: ${AUD[d.audio_status]?.[0] || d.audio_status}</div>`}
  ${tcodes.length ? `<h4>Themes coded from audio</h4><div class="chips">${[...new Set(tcodes.map(c => c.theme_label))].map(x => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : ''}
  <h4>Open-ended answers</h4>${Object.entries(secs).map(([s, items]) => `<div style="margin-top:10px"><b style="color:var(--teal);font-size:12px;text-transform:uppercase">${esc(s)}</b>${items.map(x => `<div class="qa"><div class="q">${esc(x.q)}</div><div class="a">${esc(x.v)}</div></div>`).join('')}</div>`).join('') || '<div class="mu">None</div>'}
  <h4>Closed answers</h4>${Object.entries(csecs).map(([s, items]) => `<div style="margin-top:10px"><b style="color:var(--teal);font-size:12px;text-transform:uppercase">${esc(s)}</b>${items.map(x => `<div class="qa"><div class="q">${esc(x.q)}</div><div class="a">${esc(x.v)}</div></div>`).join('')}</div>`).join('')}`)
  const ul = $('#unlock-audio')
  if (ul) ul.onclick = () => { const k = prompt('Admin key (INGEST_TOKEN) to play interview audio:'); if (!k) return; S.key = k; localStorage.setItem('adminKey', k); showInterview(d.id, seek) }
  const p = $('#player')
  $('#drawer-body').querySelectorAll('.seg').forEach(s => s.onclick = () => { if (p) { p.currentTime = +s.dataset.s; p.play().catch(() => { }) } })
  if (p) p.ontimeupdate = () => { let on = null; document.querySelectorAll('.seg').forEach(s => { if (+s.dataset.s <= p.currentTime) on = s; s.classList.remove('on') }); on?.classList.add('on') }
  if (seek && p) p.addEventListener('loadedmetadata', () => { p.currentTime = +seek }, { once: true })
  $('#drawer-body').querySelectorAll('button[data-act]').forEach(b => b.onclick = async () => {
    try { const r = await adminCall(`transcript/${d.id}/${b.dataset.act}`); toast(r.ok ? 'Done' : (r.error || 'Failed')); showInterview(d.id); S.cfg = await (await fetch('/api/config')).json(); if (S.tab !== 'interviews') render() } catch (e) { toast(e.message) }
  })
}

VIEWS.quality = async (v) => {
  const q = await api('quality')
  if (!q.total) { v.innerHTML = empty('No data yet', ''); return }
  const KN = { short_duration: 'Interview < 10 min', thin_text: 'Very little open-ended text', test_like: 'Looks like test input', copy_paste: 'Copy-pasted answers', category_mismatch: 'LG category mismatch', region_mismatch: 'Region mismatch', no_audio: 'Audio consent but no recording', no_gps: 'No GPS', gps_outside_uganda: 'GPS outside Uganda', gps_far_from_lg: 'GPS far from declared LG', future_date: 'Date after submission', identical_figures: 'Identical before/after figures', transcript_review: 'Transcript needs review', transcript_note: 'Transcript notes', long_duration: 'Form open > 4h' }
  const mx = Math.max(1, ...Object.values(q.counts))
  v.innerHTML = `<div class="kpis">${kpi(pct(q.clean_pct), 'Clean submissions', 'no high-severity flag', 'navy')}${kpi(q.flagged.filter(f => f.high).length, 'Interviews with high-severity flags', 'review or back-check before analysis', 'red')}${kpi(q.enumerators.length, 'Enumerators', '')}</div>
  <div class="grid g2"><div class="card"><h3>Flag counts</h3><div class="sub">Rule-based checks run on every submission, mirroring the daily completeness/consistency checks in the inception report</div>${Object.entries(q.counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<div class="row"><span>${KN[k] || k}</span><div class="bar gold"><i style="width:${100 * n / mx}%"></i></div><span class="n">${n}</span></div>`).join('') || '<div class="mu">No flags raised</div>'}</div>
  <div class="card"><h3>By enumerator</h3><div class="sub">Short interviews + thin text + missing audio are the usual signs of fabricated or rushed entries</div><div class="tw" style="max-height:300px"><table><thead><tr><th>Enumerator</th><th>n</th><th>Median min</th><th>Avg words</th><th>Audio</th><th>Flagged</th></tr></thead><tbody>${q.enumerators.sort((a, b) => b.flagged - a.flagged).map(e => `<tr><td>${esc(e.enumerator)}</td><td>${e.n}</td><td>${e.median_min ?? '-'}</td><td>${e.avg_words}</td><td>${pct(e.audio_pct)}</td><td>${e.flagged ? `<span class="pill bad">${e.flagged}</span>` : ''}</td></tr>`).join('')}</tbody></table></div></div></div>
  <div class="card"><h3>Flagged interviews</h3><div class="sub">Click to open</div><div class="tw"><table><thead><tr><th>ID</th><th>LG</th><th>Enumerator</th><th>Date</th><th>Flags</th></tr></thead><tbody>${q.flagged.slice(0, 120).map(f => `<tr class="click" data-i="${f.id}"><td>${f.id}</td><td>${esc(f.label)}</td><td>${esc(f.enumerator || '-')}</td><td>${f.date || '-'}</td><td>${f.flags.map(x => `<span class="pill ${x.sev === 'high' ? 'bad' : x.sev === 'med' ? 'warn' : ''}" title="${esc(x.msg)}">${KN[x.k] || x.k}</span>`).join(' ')}</td></tr>`).join('') || '<tr><td colspan="5" class="mu">None</td></tr>'}</tbody></table></div></div>`
  v.querySelectorAll('tr.click').forEach(tr => tr.onclick = () => showInterview(+tr.dataset.i))
}

VIEWS.pipeline = async (v) => {
  const o = await api('overview', { region: '', lg: '', grp: '' })
  const fm = (await (await fetch('/api/forms')).json()).forms
  const c = S.cfg
  v.innerHTML = `<div class="grid g2">
  <div class="card"><h3><i class="fa-solid fa-cloud-arrow-down"></i> 1 &middot; Sync KoboToolbox</h3><div class="sub">Pulls new submissions from every connected form (data + audio links) and codes the open-ended text. Safe to re-run: existing records are skipped, and records deleted on Kobo are removed here.</div>
    <p class="mu">Connection: ${c.kobo_configured ? '<span class="pill good">token configured</span>' : '<span class="pill bad">KOBO_TOKEN missing</span>'} &middot; admin key ${c.admin_configured ? '<span class="pill good">set</span>' : '<span class="pill bad">INGEST_TOKEN missing</span>'}<br>Last sync: ${c.last_sync ? new Date(c.last_sync).toLocaleString() : 'never'} &middot; ${c.real_rows} live records</p>
    <button id="b-sync"><i class="fa-solid fa-rotate"></i> Sync now</button> <button id="b-force" class="ghost">Re-import everything</button> <button id="b-recode" class="ghost">Re-run coding</button><div id="sync-out" class="mu" style="margin-top:8px"></div></div>
  <div class="card" style="grid-column:1/-1"><h3><i class="fa-solid fa-list-check"></i> Connected KoboToolbox forms</h3><div class="sub">Each form is fetched with its own question set. Kobo count = submissions on the server; in dashboard = imported.</div><div class="tw"><table><thead><tr><th>Code</th><th>Form</th><th>Type</th><th>Kobo</th><th>In dashboard</th><th>With audio</th><th>Status</th></tr></thead><tbody>${fm.map(f => `<tr><td><span class="pill">${esc(f.code || '?')}</span></td><td>${esc(f.name)}<div class="mu" style="font-size:11px">${f.uid}</div></td><td>${f.kind.toUpperCase()}</td><td>${f.kobo_count ?? '-'}</td><td>${f.in_dashboard}</td><td>${f.with_audio}</td><td>${!f.synced ? '<span class="pill warn">not synced yet</span>' : f.kobo_count === 0 ? '<span class="pill">empty on Kobo</span>' : f.in_dashboard >= f.kobo_count ? '<span class="pill good">up to date</span>' : '<span class="pill warn">' + (f.kobo_count - f.in_dashboard) + ' to import</span>'}</td></tr>`).join('')}</tbody></table></div></div>
  <div class="card"><h3><i class="fa-solid fa-waveform-lines"></i> 2 &middot; Audio transcription</h3><div class="sub">Runs outside the dashboard: audio is too heavy for the edge runtime.</div>${audioBar(o.audio)}<div class="legend">${audioLegend(o.audio)}</div>
    <p style="font-size:12.5px">Run on any machine with Python 3.9+ and ffmpeg:</p><pre>pip install faster-whisper numpy requests
export DASH_URL=${location.origin}
export ADMIN_KEY=&lt;INGEST_TOKEN&gt;
python pipeline/run.py --model small --loop</pre>
    <p class="mu" style="font-size:12px">Transcripts that look unreliable (repetition loops, very low confidence, almost no speech) are held in <b>Needs review</b> and do <u>not</u> feed the themes until a person accepts them.</p></div>
  <div class="card"><h3><i class="fa-solid fa-download"></i> Exports</h3><div class="sub">For the evidence matrix and further analysis in Excel / NVivo / R</div>
    <p><a href="/api/export/codes.csv?${qs()}" download><button class="ghost" type="button">Coded evidence (CSV)</button></a> <a href="/api/export/submissions.csv?${qs()}" download><button class="ghost" type="button">Closed answers (CSV)</button></a></p>
    <p class="mu" style="font-size:12px">Codebook: <a href="/api/codebook" target="_blank">/api/codebook</a></p></div></div>`
  const run = async (b, fn) => { b.disabled = true; try { await fn() } catch (e) { toast(e.message) } b.disabled = false }
  $('#b-sync').onclick = e => run(e.target, () => doSync(false))
  $('#b-force').onclick = e => run(e.target, () => doSync(true))
  $('#b-recode').onclick = e => run(e.target, async () => { let after = -1e12, n = 0; while (after !== null) { const r = await adminCall(`recode?after=${after}&limit=25`); n += r.processed; after = r.next; $('#sync-out').textContent = `Re-coded ${n} records…` } toast('Coding refreshed'); render() })
}
async function doSync(force) {
  const out = $('#sync-out'); let total = 0
  for (let i = 0; i < 80; i++) {
    const r = await adminCall(`sync?limit=15${force ? '&force=1&offset=' + total : ''}`)
    if (r.error) { out.textContent = r.error; return }
    total += r.processed
    out.textContent = `Imported ${total} of ${r.kobo_total}${r.removed ? ', removed ' + r.removed + ' deleted on Kobo' : ''}${r.remaining ? ', ' + r.remaining + ' remaining' : ''}${r.errors?.length ? ' · ' + r.errors.join('; ') : ''}`
    if (!r.remaining || !r.processed) break
  }
  toast(`Sync complete: ${total} records`); S.cfg = await (await fetch('/api/config')).json(); syncInfo(); render()
}
init()

// ---------------- Map: where interviews were recorded (GPS from the Kobo forms) ----------------
const MAPCOL = { lg_official: '#1f877d', lg_political_enforcement: '#2f6fb5', trader_association: '#edb14b', national: '#7a5bb5', fgd_informal_traders: '#c0504d' }
VIEWS.map = async (v) => {
  const m = await api('map')
  const sm = m.summary
  if (!sm.total) { v.innerHTML = empty('No submissions in this view yet', 'Run a sync from the <b>Pipeline</b> tab.'); return }
  const inUg = m.points.filter(p => !p.outside)
  const out = m.points.filter(p => p.outside)
  v.innerHTML = `
  <div class="kpis">
    ${kpi(sm.with_gps + '/' + sm.total, 'Submissions with GPS', `${sm.without_gps} without a fix (declined, or GPS not captured)`)}
    ${kpi(inUg.length, 'Inside Uganda', `${inUg.filter(p => p.far).length} more than ${m.far_km} km from the declared LG`, 'navy')}
    ${kpi(out.length, 'Outside Uganda', 'likely test records or a wrong device location', out.length ? 'red' : 'navy')}
    ${kpi(m.lgs.filter(l => l.n).length + '/' + m.lgs.length, 'LGs with interviews', 'grey rings = LGs not reached yet', 'gold')}
  </div>
  ${out.length ? `<div class="hint warn"><b>${out.length} point${out.length === 1 ? '' : 's'} fall outside Uganda</b> (${out.map(p => '#' + p.id).join(', ')}). They are kept off the map view and listed on the right: usually a tester recording from another place, or a phone that reported a stale location.</div>` : ''}
  <div class="maplay">
    <div><div id="map"></div>
      <div class="legend2">${Object.entries(MAPCOL).map(([g, c]) => `<span><i style="background:${c}"></i>${GRP[g] || g}</span>`).join('')}
        <span><i style="background:#fff;box-shadow:0 0 0 2px #b94d4d"></i>GPS far from declared LG</span><span><i style="background:#dfe6ee;box-shadow:0 0 0 1px #9aa8b8"></i>Local government (reference)</span></div>
      <div class="mu" style="font-size:12px">Each dot is the phone position when the interview form was opened (Kobo <code>interview_gps</code>). Accuracy is the phone's own estimate. This is respondent-location data: keep this page restricted to the study team.</div></div>
    <div class="card" style="margin:0"><h3>Recorded locations</h3><div class="sub">Click a row to zoom to the point</div>
      <div class="plist">${[...inUg, ...out].map(p => `<div class="pt" data-i="${p.id}"><b>${esc(p.label)} <span class="pill" style="background:${MAPCOL[p.grp] || '#9aa8b8'};color:#fff">${esc(p.form)}</span>${p.outside ? ' <span class="pill bad">outside Uganda</span>' : p.far ? ' <span class="pill warn">' + p.km_from_lg + ' km from LG</span>' : ''}</b>
        <span class="mu">#${p.id} &middot; ${p.date || '-'} &middot; ${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}${p.accuracy != null ? ' &middot; &plusmn;' + Math.round(p.accuracy) + ' m' : ''}</span></div>`).join('') || '<div class="mu">No GPS recorded</div>'}
      ${m.missing.length ? `<h4 style="margin:12px 0 4px">No GPS (${m.missing.length})</h4>${m.missing.map(p => `<div class="pt" data-i="${p.id}"><b>${esc(p.label)} <span class="pill">${esc(p.form)}</span></b><span class="mu">#${p.id} &middot; ${p.consent === 'no' ? 'declined consent' : 'GPS not captured'}</span></div>`).join('')}` : ''}</div></div>
  </div>`
  if (typeof L === 'undefined') { $('#map').innerHTML = empty('Map library could not load', 'Check the internet connection (Leaflet / OpenStreetMap tiles).'); return }
  const map = L.map('map', { scrollWheelZoom: true })
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(map)
  const b = m.bounds
  const ug = L.latLngBounds([b.minLat, b.minLon], [b.maxLat, b.maxLon])
  L.rectangle(ug, { color: '#9aa8b8', weight: 1, fill: false, dashArray: '4' }).addTo(map)
  m.lgs.forEach(l => L.circleMarker([l.lat, l.lon], { radius: l.n ? 9 : 5, color: l.n ? '#1f877d' : '#9aa8b8', weight: 1.5, fillColor: '#dfe6ee', fillOpacity: .8 }).bindTooltip(`${l.label}${l.n ? ' · ' + l.n + ' interview' + (l.n === 1 ? '' : 's') : ' · none yet'}`).addTo(map))
  const marks = {}
  const pop = p => `<b>${esc(p.label)}</b><br>${esc(p.form_name)}<br>${GRP[p.grp] || ''} &middot; ${p.date || '-'}<br>Enumerator: ${esc(p.enumerator || '-')}<br>GPS ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}${p.accuracy != null ? ' (&plusmn;' + Math.round(p.accuracy) + ' m)' : ''}${p.outside ? '<br><span class="neg">Outside Uganda</span>' : p.far ? `<br><span class="neg">${p.km_from_lg} km from ${esc(p.label)}</span>` : ''}<br><a href="#" class="mk-open" data-i="${p.id}">Open interview</a>`
  m.points.forEach(p => {
    const mk = L.circleMarker([p.lat, p.lon], { radius: 9, color: p.far || p.outside ? '#b94d4d' : '#fff', weight: p.far || p.outside ? 3 : 2, fillColor: MAPCOL[p.grp] || '#9aa8b8', fillOpacity: .95 }).bindPopup(pop(p))
    if (!p.outside) mk.addTo(map)
    marks[p.id] = mk
  })
  map.fitBounds(inUg.length ? L.latLngBounds(inUg.map(p => [p.lat, p.lon]).concat(inUg.length < 3 ? [[0.35, 32.58]] : [])).pad(.3) : ug)
  if (inUg.length === 1) map.setZoom(Math.min(map.getZoom(), 9))
  map.on('popupopen', e => { const a = e.popup.getElement().querySelector('.mk-open'); if (a) a.onclick = ev => { ev.preventDefault(); showInterview(+a.dataset.i) } })
  v.querySelectorAll('.pt').forEach(el => el.onclick = () => {
    const id = +el.dataset.i, p = m.points.find(x => x.id === id), mk = marks[id]
    if (!p) { showInterview(id); return }
    if (!map.hasLayer(mk)) mk.addTo(map)
    map.setView([p.lat, p.lon], p.outside ? 8 : 12); mk.openPopup()
  })
  S.charts.push({ destroy: () => map.remove() })
}
