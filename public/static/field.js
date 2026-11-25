/* Field-monitoring views: overview vs target, coverage matrix, enumerator tracker, error queue, submissions list */
const FI = k => S.cfg.flag_info?.[k] || { label: k, hint: '', group: 'data' }
const FGROUP = { data: 'Data', audio: 'Audio', enumerator: 'Enumerator ID', location: 'Location' }
const FCOL = { data: COL.blue, audio: COL.gold, enumerator: COL.purple, location: COL.red }
const ST = { auto: ['Not reviewed', ''], valid: ['Valid', 'good'], recheck: ['Re-check', 'warn'], test: ['Test', 'bad'] }
const progBar = (got, target, cls) => { const p = target ? Math.min(100, Math.round(100 * got / target)) : 0; return `<div class="bar ${cls || (p >= 100 ? '' : p >= 50 ? 'gold' : 'red')}"><i style="width:${p}%"></i></div>` }
const goTab = (tab, f) => { if (f) { Object.assign(S.f, f); ['region', 'lg', 'grp'].forEach(k => { const el = $('#f-' + k); if (el) el.value = S.f[k] || '' }) } S.tab = tab; location.hash = tab; document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x.dataset.t === tab)); render() }
const flagPills = (list, max = 4) => (list || []).slice(0, max).map(k => `<span class="pill fl-${FI(k).group}" title="${esc(FI(k).hint)}">${esc(FI(k).label)}</span>`).join(' ') + ((list || []).length > max ? ` <span class="mu">+${list.length - max}</span>` : '')
async function setStatus(id, status, then) {
  try {
    let note = ''
    if (status !== 'auto') { note = prompt({ valid: 'Confirm this record is valid. Note (optional):', recheck: 'Send back to the enumerator for re-check. What needs to be checked?', test: 'Mark as test record: it will be excluded from all counts and analysis. Reason (optional):' }[status], ''); if (note === null) return }
    const r = await adminCall(`submission/${id}/status`, 'POST', { status, note })
    toast(r.ok ? 'Saved' : (r.error || 'Failed')); if (r.ok && then) then()
  } catch (e) { toast(e.message) }
}
const fmtDay = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '-'

// ------------------------------------------------------------------ Field overview
VIEWS.overview = async (v) => {
  const [f, c, q] = await Promise.all([api('field', { region: '', lg: '', grp: '' }), api('coverage', { lg: '', grp: '' }), api('quality', { region: '', lg: '', grp: '' })])
  const fu = f.funnel
  if (!f.live && !fu.declined) { v.innerHTML = empty('No submissions yet', 'Run a sync from the <b>Pipeline</b> tab.'); return }
  const audioPct = fu.audio_expected ? fu.transcribed / fu.audio_expected : 0
  const days = f.daily.filter(d => d.d !== 'unknown')
  const codes = [...new Set(f.daily.flatMap(d => Object.keys(d).filter(k => !['d', 'n'].includes(k))))].sort()
  const FC = { A1: COL.teal, A2: COL.blue, A3: COL.gold, A4: COL.purple, A5: '#6b8e23', B1: COL.red, B2: '#d9822b' }
  v.innerHTML = `
  <div class="kpis">
    ${kpi(`${c.achieved}<small>/${c.target_total}</small>`, 'Forms toward target', `${pct(c.pct, 1)} complete &middot; ${f.live} live submissions received${f.tests ? ' &middot; ' + f.tests + ' test excluded' : ''}`)}
    ${kpi(`${f.lgs_active}/${f.lgs_total}`, 'Local governments with data', c.unassigned ? `${c.unassigned} submission${c.unassigned === 1 ? '' : 's'} with no LG set` : 'every submission has an LG', 'navy')}
    ${kpi(f.enumerators, 'Enumerator IDs seen', `${f.first_date ? fmtDay(f.first_date) + ' – ' + fmtDay(f.last_date) : ''}${f.last_submission ? ' &middot; last submission ' + new Date(f.last_submission + 'Z').toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}`, 'navy')}
    ${kpi(`${fu.transcribed}<small>/${fu.audio_expected}</small>`, 'Recordings transcribed', `${fu.pending} waiting &middot; ${fu.review} need review &middot; ${fu.audio_missing} missing`, 'gold')}
    ${kpi(f.records_with_open_high, 'Records with a serious error', `${pct(q.clean_pct)} of live records are clean`, f.records_with_open_high ? 'red' : 'navy')}
  </div>
  <div class="grid g2">
    <div class="card"><h3>Progress against target, by form</h3><div class="sub">Counts are capped at the per-LG target so surplus forms in one LG do not hide gaps elsewhere. Click a form to see it by LG.</div>
      ${c.per_form.map(p => `<div class="prow click" data-g="${p.code}"><div class="ph"><b>${p.code}</b> ${esc(p.short)}<span class="mu"> ${p.per_lg ? p.per_lg + ' per LG' : 'at least ' + p.target + ' in total'}</span></div>${progBar(p.got, p.target)}<div class="pn">${p.got}/${p.target}${p.submitted > p.got ? `<span class="mu"> (${p.submitted} submitted)</span>` : ''}</div></div>`).join('')}
    </div>
    <div class="card"><h3>Submissions per day</h3><div class="sub">By interview date, stacked by form</div><canvas id="c-day"></canvas></div>
    <div class="card"><h3>Processing: from submission to evidence</h3><div class="sub">What happens to each form after it reaches KoboToolbox</div>
      <div class="tw"><table class="tight"><thead><tr><th>Form</th><th>Received</th><th>Audio uploaded</th><th>Transcribed</th><th>In review</th><th>Waiting</th><th>Coded</th><th>Serious errors</th></tr></thead><tbody>
      ${f.by_form.map(r => `<tr><td><b>${r.code}</b></td><td>${r.submitted}${r.declined ? `<span class="mu"> (${r.declined} declined)</span>` : ''}</td><td>${r.audio_uploaded}/${r.audio_expected}${r.audio_missing ? ` <span class="pill bad" title="Audio consent but no recording">${r.audio_missing} missing</span>` : ''}</td><td>${r.transcribed}</td><td>${r.review ? `<span class="pill warn">${r.review}</span>` : 0}</td><td>${r.pending + r.processing}</td><td>${r.coded}</td><td>${r.flagged ? `<span class="pill bad">${r.flagged}</span>` : 0}</td></tr>`).join('')}
      <tr class="tot"><td>All</td><td>${fu.submitted}</td><td>${fu.audio_uploaded}/${fu.audio_expected}</td><td>${fu.transcribed}</td><td>${fu.review}</td><td>${fu.pending + fu.processing}</td><td>${fu.coded}</td><td>${fu.flagged}</td></tr></tbody></table></div>
      <div class="legend" style="margin-top:8px">Audio transcription is ${pct(audioPct)} complete. Waiting recordings are transcribed by the worker described in the <a href="#pipeline" data-go="pipeline">Pipeline</a> tab.</div></div>
    <div class="card"><h3>Open problems</h3><div class="sub">Checks that need a person to look. Click a type to open the review queue.</div>
      ${Object.entries(FGROUP).map(([g, l]) => `<div class="prow click" data-err="${g}"><div class="ph"><i class="fa-solid fa-circle" style="color:${FCOL[g]};font-size:9px"></i> ${l}</div>${progBar(q.by_group[g] || 0, Math.max(1, ...Object.values(q.by_group)), 'blue')}<div class="pn">${q.by_group[g] || 0}</div></div>`).join('')}
      <div class="mu" style="margin-top:8px">${q.tests.length ? q.tests.length + ' record(s) marked as test are excluded. ' : ''}Records you confirm as valid keep their flags but no longer count as problems.</div></div>
    <div class="card" style="grid-column:1/-1"><h3>Progress by region</h3><div class="sub">Sum over the LGs in each region of forms collected vs forms required</div>
      <div class="rgrid">${c.regions.map(r => `<div class="rcard click" data-reg="${r.region}"><b>${esc(regName(r.region))}</b><span>${r.got}<small>/${r.need}</small></span>${progBar(r.got, r.need)}<small class="mu">${r.lgs} LGs</small></div>`).join('')}</div></div>
  </div>`
  chart('c-day', { type: 'bar', data: { labels: days.map(d => fmtDay(d.d)), datasets: codes.map(k => ({ label: k, data: days.map(d => d[k] || 0), backgroundColor: FC[k] || COL.grey })) }, options: { scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { position: 'bottom' } } } })
  v.querySelectorAll('[data-g]').forEach(e => e.onclick = () => goTab('coverage'))
  v.querySelectorAll('[data-err]').forEach(e => e.onclick = () => { VIEWS.errors.group = e.dataset.err; goTab('errors') })
  v.querySelectorAll('[data-reg]').forEach(e => e.onclick = () => goTab('coverage', { region: e.dataset.reg }))
  v.querySelectorAll('[data-go]').forEach(e => e.onclick = ev => { ev.preventDefault(); goTab(e.dataset.go) })
}

// ------------------------------------------------------------------ Coverage vs target
VIEWS.coverage = async (v) => {
  const c = await api('coverage', { grp: '' })
  const rows = c.rows.filter(r => !S.f.lg || r.code === S.f.lg)
  const per = c.cols.filter(x => x.per_lg)
  const a4 = c.per_form.find(p => p.code === 'A4')
  const cell = (x, t) => { const n = x?.n || 0; const cls = n >= t ? 'ok' : n > 0 ? 'part' : 'none'; return `<td class="mx ${cls}" title="${n} submitted, ${x?.clean || 0} without serious errors">${n}<small>/${t}</small></td>` }
  v.innerHTML = `<div class="hint"><b>Targets.</b> ${per.map(x => `<b>${x.code}</b> ${esc(x.label)}: ${x.per_lg} per LG`).join(' &middot; ')} &middot; <b>A4</b> National stakeholders: at least ${a4.target} in total. <b>Grand total ${c.target_total}</b> forms across ${c.rows.length} local governments. Declined interviews are not counted.</div>
  <div class="kpis">
    ${kpi(`${c.achieved}<small>/${c.target_total}</small>`, 'Forms toward target', pct(c.pct, 1) + ' complete')}
    ${c.per_form.filter(p => p.code !== 'A4').map(p => kpi(`${p.got}<small>/${p.target}</small>`, `${p.code} ${p.short}`, `${p.lgs_done}/${c.rows.length} LGs at target${p.no_lg ? ' &middot; ' + p.no_lg + ' without LG' : ''}`, p.got >= p.target ? 'navy' : 'gold')).join('')}
    ${kpi(`${a4.got}<small>/${a4.target}</small>`, 'A4 National stakeholders', 'total, not per LG', a4.got >= a4.target ? 'navy' : 'gold')}
  </div>
  <div class="card"><div class="tw"><table class="matrix"><thead><tr><th>Local government</th><th>Region</th>${per.map(x => `<th title="${esc(x.label)}">${x.code}<small>${esc(x.short)}</small></th>`).join('')}<th style="min-width:140px">Progress</th><th>Last data</th></tr></thead><tbody>
  ${rows.map(r => `<tr class="click" data-lg="${r.code}"><td><b>${esc(r.label)}</b></td><td>${esc(regName(r.region))}</td>${per.map(x => cell(r.cells[x.code], x.per_lg)).join('')}
   <td><div class="row" style="grid-template-columns:1fr 40px;margin:0"><div class="bar ${r.pct >= 1 ? '' : 'gold'}"><i style="width:${Math.round(r.pct * 100)}%"></i></div><span class="n">${Math.round(r.pct * 100)}%</span></div></td><td>${fmtDay(r.last)}${r.declined ? ` <span class="pill warn" title="Interviews where consent was refused">${r.declined} declined</span>` : ''}</td></tr>`).join('')}
  <tr class="tot"><td>Total</td><td></td>${per.map(x => { const p = c.per_form.find(z => z.code === x.code); return `<td class="mx ${p.got >= p.target ? 'ok' : p.got ? 'part' : 'none'}">${p.got}<small>/${p.target}</small></td>` }).join('')}<td>${c.achieved - a4.got}/${c.target_total - a4.target}</td><td></td></tr>
  </tbody></table></div><div class="legend" style="margin-top:8px"><span><i style="background:#cfe8d6"></i>target met</span><span><i style="background:#fff1d6"></i>some collected</span><span><i style="background:#f8e3e3"></i>nothing yet</span> &nbsp; Click a row to list that LG's submissions.</div></div>`
  v.querySelectorAll('tr.click').forEach(tr => tr.onclick = () => goTab('interviews', { lg: tr.dataset.lg }))
}

// ------------------------------------------------------------------ Enumerators
VIEWS.enumerators = async (v) => {
  const r = await api('enumerators')
  if (!r.rows.length) { v.innerHTML = empty('No submissions in this view', ''); return }
  const FORMS = ['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2']
  v.innerHTML = `<div class="hint"><b>Enumerator tracker.</b> IDs are normalised so <code>2</code>, <code>002</code> and <code>TAB-002</code> are grouped sensibly (<code>TAB 17</code> and <code>tab-017</code> are the same person). An ID that is a name, a long number or random keys is flagged because it cannot be traced back to a person. <b>${r.valid_ids}/${r.total}</b> IDs are in a usable format.</div>
  <div class="toolbar"><label>Search<input type="search" id="e-q" placeholder="ID or local government"></label><label><input type="checkbox" id="e-bad"> only IDs with problems</label><span class="mu" id="e-n"></span></div>
  <div class="card"><div class="tw"><table class="tight"><thead><tr><th>Enumerator ID</th><th>Forms submitted</th><th>What</th><th>Where</th><th>Active</th><th>Median session</th><th>Avg words</th><th>Audio</th><th>GPS</th><th>Serious errors</th><th>Main issues</th></tr></thead><tbody id="e-body"></tbody></table></div></div>`
  const draw = () => {
    const q = $('#e-q').value.toLowerCase(), bad = $('#e-bad').checked
    const rows = r.rows.filter(x => (!q || (x.key + ' ' + x.raw.join(' ') + ' ' + x.lgs.map(lgName).join(' ')).toLowerCase().includes(q)) && (!bad || !x.valid_id || x.high))
    $('#e-n').textContent = rows.length + ' IDs'
    $('#e-body').innerHTML = rows.map(x => `<tr class="click" data-k="${esc(x.key)}"><td><b>${esc(x.key)}</b>${x.raw.length > 1 || x.raw[0] !== x.key ? `<div class="mu" style="font-size:11px">typed as ${x.raw.map(esc).join(', ')}</div>` : ''}${x.valid_id ? '' : ' <span class="pill warn">ID not usable</span>'}</td>
      <td><b>${x.n}</b>${x.declined ? `<span class="mu"> +${x.declined} declined</span>` : ''}</td>
      <td>${FORMS.filter(f => x.forms[f]).map(f => `<span class="pill">${f}&times;${x.forms[f]}</span>`).join(' ')}</td>
      <td>${x.lgs.slice(0, 3).map(lgName).join(', ')}${x.lgs.length > 3 ? ' +' + (x.lgs.length - 3) : ''}${x.lgs.length ? '' : '<span class="mu">no LG</span>'}</td>
      <td>${fmtDay(x.first)}${x.last !== x.first ? ' – ' + fmtDay(x.last) : ''}<div class="mu" style="font-size:11px">${x.days} day${x.days === 1 ? '' : 's'}</div></td>
      <td>${x.median_min != null ? x.median_min + ' min' : '-'}</td><td>${x.avg_words}</td>
      <td>${x.audio_uploaded}/${x.audio_expected}${x.audio_expected > x.audio_uploaded ? ' <span class="pill bad">missing</span>' : ''}<div class="mu" style="font-size:11px">${x.transcribed} transcribed${x.in_review ? ', ' + x.in_review + ' review' : ''}</div></td>
      <td>${x.gps_pct != null ? pct(x.gps_pct) : '-'}</td><td>${x.high ? `<span class="pill bad">${x.high}</span>` : '<span class="pill good">0</span>'}${x.rechecks ? ` <span class="pill warn">${x.rechecks} re-check</span>` : ''}</td>
      <td>${flagPills(Object.entries(x.flags).sort((a, b) => b[1] - a[1]).map(e => e[0]), 3)}</td></tr>`).join('')
    $('#e-body').querySelectorAll('tr').forEach(tr => tr.onclick = () => showEnumerator(tr.dataset.k))
  }
  $('#e-q').oninput = draw; $('#e-bad').onchange = draw; draw()
}
async function showEnumerator(key) {
  openDrawer('<div class="loading">Loading&hellip;</div>')
  const r = await (await fetch('/api/interviews')).json()
  const items = r.items.filter(x => x.ekey === key)
  openDrawer(`<h2 style="margin:0 0 4px;color:var(--navy)">Enumerator ${esc(key)}</h2><div class="mu">${items.length} submission${items.length === 1 ? '' : 's'}: click one to open it</div>
  <div class="tw" style="margin-top:10px"><table class="tight"><thead><tr><th>ID</th><th>Form</th><th>Where</th><th>Date</th><th>Min</th><th>Audio</th><th>Errors</th></tr></thead><tbody>${items.map(x => `<tr class="click" data-i="${x.id}"><td>${x.id}</td><td>${esc(x.form)}</td><td>${esc(x.label)}</td><td>${fmtDay(x.date)}</td><td>${x.duration_sec ? Math.round(x.duration_sec / 60) : '-'}</td><td>${x.consent === 'no' ? 'declined' : (AUD[x.audio]?.[0] || x.audio)}</td><td>${flagPills(x.flag_list, 2)}</td></tr>`).join('')}</tbody></table></div>`)
  $('#drawer-body').querySelectorAll('tr.click').forEach(tr => tr.onclick = () => showInterview(+tr.dataset.i))
}

// ------------------------------------------------------------------ Errors & review queue
VIEWS.errors = async (v) => {
  const q = await api('quality')
  const G = VIEWS.errors.group || ''
  const kinds = Object.entries(q.counts).sort((a, b) => b[1] - a[1])
  const sev = { high: 3, med: 2, low: 1 }
  v.innerHTML = `<div class="kpis">
    ${kpi(q.flagged.filter(f => f.high).length, 'Records with serious errors', 'fix or confirm before analysis', 'red')}
    ${Object.entries(FGROUP).map(([g, l]) => kpi(q.by_group[g] || 0, l + ' problems', g === 'data' ? 'duration, text, dates, LG, copies' : g === 'audio' ? 'missing, short, unreadable' : g === 'enumerator' ? 'ID format, same ID in distant LGs' : 'no GPS, outside Uganda, far from LG', '')).join('')}
    ${kpi(pct(q.clean_pct), 'Clean records', `${q.clean} of ${q.total} have no open serious error`, 'navy')}
  </div>
  <div class="hint"><b>How to use this page.</b> Open a record, check the audio and answers, then mark it <b>Valid</b> (the problem is explained), <b>Re-check</b> (send back to the enumerator) or <b>Test</b> (removed from counts and analysis). Marking needs the admin key. Rules and thresholds live in <code>src/field.ts</code>.</div>
  <div class="toolbar">
    <label>Type<select id="x-g"><option value="">All</option>${Object.entries(FGROUP).map(([g, l]) => `<option value="${g}" ${g === G ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label>Check<select id="x-k"><option value="">All</option>${kinds.map(([k, n]) => `<option value="${k}">${esc(FI(k).label)} (${n})</option>`).join('')}</select></label>
    <label>Severity<select id="x-s"><option value="">Any</option><option value="high" selected>Serious only</option></select></label>
    <label>Status<select id="x-st"><option value="open" selected>Needs attention</option><option value="recheck">Re-check</option><option value="valid">Confirmed valid</option><option value="">All</option></select></label>
    <label>Search<input type="search" id="x-q" placeholder="LG, enumerator, id"></label>
    <button class="ghost sm" id="x-csv"><i class="fa-solid fa-download"></i> CSV</button><span class="mu" id="x-n"></span>
  </div>
  <div class="card"><div class="tw"><table class="tight"><thead><tr><th>ID</th><th>Form</th><th>Where</th><th>Enumerator</th><th>Date</th><th>What is wrong</th><th>Status</th><th>Action</th></tr></thead><tbody id="x-body"></tbody></table></div></div>
  ${q.tests.length ? `<div class="card"><h3>Marked as test (excluded)</h3><div class="tw"><table class="tight"><thead><tr><th>ID</th><th>Form</th><th>Where</th><th>Enumerator</th><th>Note</th><th></th></tr></thead><tbody>${q.tests.map(t => `<tr><td>${t.id}</td><td>${esc(t.form)}</td><td>${esc(t.label)}</td><td>${esc(t.enumerator || '-')}</td><td>${esc(t.note)}</td><td><button class="sm ghost" data-rs="${t.id}">Restore</button></td></tr>`).join('')}</tbody></table></div></div>` : ''}`
  let shown = []
  const draw = () => {
    const g = $('#x-g').value, k = $('#x-k').value, s = $('#x-s').value, st = $('#x-st').value, t = $('#x-q').value.toLowerCase()
    shown = q.flagged.map(f => {
      let fl = f.flags.filter(x => (!g || FI(x.k).group === g) && (!k || x.k === k) && (!s || x.sev === 'high'))
      if (st === 'open') fl = fl.filter(x => !x.ack)
      return { ...f, fl }
    }).filter(f => (f.fl.length || (st === 'recheck' && f.status === 'recheck')) && (!st || (st === 'open' ? !['valid', 'recheck'].includes(f.status) || f.fl.some(x => !x.ack) : f.status === st))
      && (!t || (f.label + ' ' + (f.enumerator || '') + ' ' + f.id + ' ' + f.form).toLowerCase().includes(t)))
    shown.sort((a, b) => (b.fl.reduce((m, x) => Math.max(m, sev[x.sev]), 0) - a.fl.reduce((m, x) => Math.max(m, sev[x.sev]), 0)) || b.id - a.id)
    $('#x-n').textContent = shown.length + ' records'
    $('#x-body').innerHTML = shown.slice(0, 300).map(f => `<tr data-i="${f.id}"><td class="click">${f.id}</td><td><span class="pill">${esc(f.form)}</span></td><td class="click"><b>${esc(f.label)}</b></td><td>${esc(f.enumerator || '-')}${f.ekey !== f.enumerator ? `<div class="mu" style="font-size:11px">${esc(f.ekey)}</div>` : ''}</td><td>${fmtDay(f.date)}</td>
      <td>${f.fl.map(x => `<div class="fline ${x.sev}"><b>${esc(FI(x.k).label)}</b> <span class="mu">${esc(x.msg)}</span></div>`).join('') || '<span class="mu">no open checks</span>'}${f.note ? `<div class="mu">Note: ${esc(f.note)}</div>` : ''}</td>
      <td><span class="pill ${ST[f.status]?.[1] || ''}">${ST[f.status]?.[0] || f.status}</span></td>
      <td class="acts"><button class="sm" data-s="valid" title="Confirm valid">&check;</button><button class="sm warn" data-s="recheck" title="Send back for re-check"><i class="fa-solid fa-rotate-left"></i></button><button class="sm ghost" data-s="test" title="Mark as test">test</button></td></tr>`).join('') || '<tr><td colspan="8" class="mu" style="padding:18px">Nothing to review with these filters.</td></tr>'
    $('#x-body').querySelectorAll('tr[data-i]').forEach(tr => {
      tr.querySelectorAll('td.click').forEach(td => td.onclick = () => showInterview(+tr.dataset.i))
      tr.querySelectorAll('button[data-s]').forEach(b => b.onclick = () => setStatus(+tr.dataset.i, b.dataset.s, render))
    })
  }
  ;['x-g', 'x-k', 'x-s', 'x-st'].forEach(i => $('#' + i).onchange = draw); $('#x-q').oninput = draw
  $('#x-csv').onclick = () => {
    const rows = [['id', 'form', 'local_government', 'enumerator', 'date', 'status', 'check', 'severity', 'detail'], ...shown.flatMap(f => f.fl.map(x => [f.id, f.form, f.label, f.enumerator, f.date, f.status, FI(x.k).label, x.sev, x.msg]))]
    const t = rows.map(r => r.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'text/csv' })); a.download = 'field_errors.csv'; a.click()
  }
  v.querySelectorAll('button[data-rs]').forEach(b => b.onclick = () => setStatus(+b.dataset.rs, 'auto', render))
  draw()
}

// ------------------------------------------------------------------ Submissions & audio
VIEWS.interviews = async (v) => {
  const r = await api('interviews')
  if (!r.items.length) { v.innerHTML = empty('No submissions in this view', 'Sync from KoboToolbox in the Pipeline tab.'); return }
  const forms = [...new Set(r.items.map(x => x.form).filter(Boolean))].sort()
  v.innerHTML = `<div class="toolbar"><label>Form<select id="i-form"><option value="">All</option>${forms.map(f => `<option>${f}</option>`).join('')}</select></label><label>Audio status<select id="i-aud"><option value="">All</option>${opt(Object.entries(AUD).map(([k, x]) => [k, x[0]]), '')}</select></label><label>Review<select id="i-st"><option value="">All</option><option value="open">With serious errors</option><option value="recheck">Re-check</option><option value="valid">Confirmed valid</option></select></label><label>Search<input type="search" id="i-q" placeholder="LG, enumerator, id"></label><span class="mu" id="i-n"></span></div>
  <div class="card"><div class="tw"><table class="tight"><thead><tr><th>ID</th><th>Form</th><th>Where / who</th><th>Date</th><th>Min</th><th>Enumerator</th><th>Words</th><th>Codes</th><th>Audio</th><th>Review</th></tr></thead><tbody id="i-body"></tbody></table></div></div>`
  const draw = () => {
    const f = $('#i-form').value, a = $('#i-aud').value, s = $('#i-st').value, q = $('#i-q').value.toLowerCase()
    const rows = r.items.filter(x => (!f || x.form === f) && (!a || x.audio === a) && (!s || (s === 'open' ? x.flags > 0 : x.status === s)) && (!q || (x.label + ' ' + (x.enumerator || '') + ' ' + x.id + ' ' + (x.affiliation || '')).toLowerCase().includes(q)))
    $('#i-n').textContent = rows.length + ' submissions'
    $('#i-body').innerHTML = rows.map(x => `<tr class="click" data-i="${x.id}"><td>${x.id}</td><td><span class="pill" title="${esc(x.form_name || '')}">${esc(x.form || '')}</span></td><td><b>${esc(x.label)}</b>${x.affiliation && x.affiliation !== x.label && x.form === 'A2' ? `<div class="mu" style="font-size:11px">${esc(x.affiliation)}</div>` : ''}</td><td>${fmtDay(x.date)}</td><td>${x.duration_sec ? Math.round(x.duration_sec / 60) : '-'}</td><td>${esc(x.enumerator || '-')}</td><td>${x.words}</td><td>${x.codes}</td>
      <td><span class="pill" style="background:${AUD[x.audio]?.[1] || '#eee'}22;color:${AUD[x.audio]?.[1] || '#555'}">${x.consent === 'no' ? 'declined interview' : (AUD[x.audio]?.[0] || x.audio)}</span></td>
      <td>${x.status !== 'auto' ? `<span class="pill ${ST[x.status][1]}">${ST[x.status][0]}</span> ` : ''}${x.flags ? `<span class="pill bad" title="${esc(x.flag_list.map(k => FI(k).label).join(', '))}">${x.flags} serious</span>` : ''}</td></tr>`).join('')
    $('#i-body').querySelectorAll('tr').forEach(tr => tr.onclick = () => showInterview(+tr.dataset.i))
  }
  ;['i-form', 'i-aud', 'i-st'].forEach(i => $('#' + i).onchange = draw); $('#i-q').oninput = draw; draw()
}
