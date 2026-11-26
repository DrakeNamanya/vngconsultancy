/* Report view: synthesises typed answers + audio transcripts into a themed report (charts, quotes, references) */
const rq = t => `<blockquote>&ldquo;${esc(t.text)}&rdquo;<span class="src"><a class="ref" data-i="${t.sid}">[${esc(t.ref)}]</a> &middot; ${esc(t.where)} &middot; ${esc(t.group)} &middot; ${t.source === 'audio' ? `<i class="fa-solid fa-microphone"></i> audio${t.t != null ? ' @' + mmss(t.t) : ''}` : '<i class="fa-solid fa-keyboard"></i> typed'} &middot; <i>${esc(t.q)}</i> &middot; ${esc(t.evidence)}, ${esc(t.polarity)}</span></blockquote>`
const litRefs = (nums, refs) => nums.length ? `<div class="lit">Related literature (Inception Report refs.): ${nums.map(n => `<a class="ref lit-ref" href="#ref-${n}">[${n}]</a>`).join(' ')}</div>` : ''

function reportHTML(r, ap, opt) {
  const sec = []
  const chartNote = '<div class="figcap">Chart data are counts of interviews/FGDs in which a theme was coded; one interview counts once per theme.</div>'
  const dt = new Date(r.generated).toLocaleString()
  const scope = [r.scope.region && regName(r.scope.region), r.scope.lg && lgName(r.scope.lg), r.scope.grp && (GRP[r.scope.grp] || r.scope.grp)].filter(Boolean).join(' &middot; ') || 'All data'
  sec.push(`<h1>Trade Order Implementation Study: Qualitative Findings Report</h1>
    <div class="meta">Comparative analysis of trade order implementation in selected local governments in Uganda &middot; SDLG / VNG International<br>Auto-generated draft &middot; ${esc(dt)} &middot; Scope: ${scope}<br><b>Status: DRAFT for analyst review</b>. Themes, tone and evidence labels are rule-based candidate codings.</div>`)

  sec.push(`<h2>Executive summary</h2>${r.executive.map(p => `<p>${esc(p)}</p>`).join('')}
    <div class="callout"><b>Read with care.</b> ${r.caveats.slice(0, 3).map(esc).join(' ')} See section 2 for all limitations.</div>`)

  // 1 evidence base
  sec.push(`<h2>1. Evidence base</h2>
    <p>The report draws on every submission synced from the connected KoboToolbox forms: <b>typed answers</b> to open-ended questions and the <b>audio recordings converted to text</b> (speech-to-text). Respondent names, enumerator IDs, contacts and venues are never quoted. Source references such as <a class="ref" data-i="${(r.sources[0] || {}).id}">[${esc((r.sources[0] || {}).ref || 'A1-0000')}]</a> are clickable and open the full interview.</p>
    <div class="tw"><table><thead><tr><th>Form</th><th>Respondent group</th><th>Submissions</th><th>Consented</th><th>Declined</th><th>Audio status</th><th>Typed words</th><th>Spoken words</th></tr></thead><tbody>
    ${r.forms.map(f => `<tr><td>${esc(f.code)}</td><td>${esc(f.group)}<div class="mu" style="font-size:11px">${esc(f.name)}</div></td><td>${f.submissions}</td><td>${f.consented}</td><td>${f.declined}</td><td>${Object.entries(f.audio).map(([k, n]) => `${n} ${(AUD[k] || [k])[0].toLowerCase()}`).join(', ') || '-'}</td><td>${fmt(f.words)}</td><td>${f.spoken_words ? fmt(f.spoken_words) : '<span class="mu">-</span>'}</td></tr>`).join('')}</tbody></table></div>
    <p>Coverage: <b>${r.coverage.lgs_covered}</b> of ${r.coverage.lgs_total} local governments${r.coverage.by_lg.length ? ' (' + r.coverage.by_lg.map(x => `${esc(x.label)} ${x.n}`).join(', ') + ')' : ''}. Interviews analysed: <b>${r.n}</b> (${Object.entries(r.group_counts).map(([g, n]) => `${n} ${esc(g)}`).join(', ') || 'none'}).</p>
    <div class="chartbox"><canvas id="rc-forms" height="110"></canvas><div class="figcap">Figure 1. Consented interviews by form (A1-A4 key informants, B1 focus group).</div></div>`)

  // 2 method + limitations
  sec.push(`<h2>2. Method and limitations</h2>
    <p>Typed answers and transcripts are split into passages and matched against a 26-theme codebook in seven dimensions taken from the Inception Report (Table 2), each mapped to ToR objectives O1&ndash;O4. Every passage gets an <b>evidence label</b> (documented, observed, reported, inferred) and a rule-based tone. Interviewer summaries are labelled <i>inferred</i> and are not used as quotes. Transcripts that fail automatic quality checks stay out of the themes until a person accepts them.</p>
    <ul>${r.caveats.map(c => `<li>${esc(c)}</li>`).join('')}</ul>`)

  // 3 overall findings
  sec.push(`<h2>3. Overall pattern of themes</h2>
    ${r.charts.themes.length ? `<div class="chartbox"><canvas id="rc-themes" height="${60 + 26 * r.charts.themes.length}"></canvas><div class="figcap">Figure 2. Share of interviews raising each theme (top ${r.charts.themes.length}).</div></div>
    <div class="grid g2"><div class="chartbox sm"><canvas id="rc-dims"></canvas><div class="figcap">Figure 3. Interviews by dimension.</div></div>
    <div class="chartbox sm"><canvas id="rc-pol"></canvas><div class="figcap">Figure 4. Tone of coded passages (screening aid only).</div></div></div>
    ${r.n_officials && r.n_traders ? `<div class="chartbox"><canvas id="rc-div" height="${60 + 30 * Math.min(8, r.charts.themes.length)}"></canvas><div class="figcap">Figure 5. Official-side vs trader-side respondents raising each theme (% of each side).</div></div>` : '<p class="thin">Official-vs-trader comparison needs interviews from both sides; not yet available.</p>'}
    ${chartNote}` : '<p class="thin">No coded evidence yet. Sync data and run the audio worker.</p>'}`)

  // 4 findings by objective
  let figN = 5
  const objHtml = r.objectives.map(o => {
    const dims = o.dimensions.filter(d => d.themes.length)
    return `<h3>${o.id}: ${esc(o.label)}</h3>` + dims.map(d => {
      const raised = d.themes.filter(t => t.interviews)
      const quiet = d.themes.filter(t => !t.interviews)
      return `<h4 style="border-left:4px solid ${d.color};padding-left:8px">${esc(d.label)} <span class="mu" style="font-weight:400">&middot; ${d.interviews} interview${d.interviews === 1 ? '' : 's'}, ${d.mentions} coded passages</span></h4>` +
        (raised.length ? raised.map(t => `<div class="rpt-sec"><b>${esc(t.label)}</b><p style="margin:3px 0">${esc(t.narrative)}</p>${t.quotes.map(rq).join('') || '<p class="thin">No quotable passage (coded from structured fields only).</p>'}${litRefs(t.lit, r.references)}</div>`).join('') : '<p class="thin">No theme in this dimension has been raised yet.</p>') +
        (quiet.length ? `<p class="thin">Not yet raised: ${quiet.map(t => esc(t.label)).join('; ')}.</p>` : '')
    }).join('')
  }).join('')
  sec.push(`<h2>4. Findings by study objective and theme</h2><p>Each theme shows how many interviews raised it, the official/trader split, tone, evidence basis, representative quotes with source references, and the related literature from the Inception Report. Literature links are by topic and indicate where to look; confirm before citing.</p>${objHtml}`)

  // 5 emergent
  sec.push(`<h2>5. Emerging terms not yet in the codebook</h2>${r.emergent.length ? `<p>Frequent words in the responses that no codebook theme captures. They may point to new themes to add.</p><p>${r.emergent.map(t => `<span class="chip">${esc(t.term)} <b>${t.n}</b></span>`).join(' ')}</p>` : '<p class="thin">Not enough text yet.</p>'}`)

  // 6 references
  const cats = [...new Set(r.references.map(x => x.cat))]
  sec.push(`<h2>6. References</h2><h4>6.1 Literature and policy documents (from the Inception Report, section 11)</h4>
    ${cats.map(c => `<b style="font-size:12.5px">${esc(c)}</b><ol class="refs" style="margin-top:2px">${r.references.filter(x => x.cat === c).map(x => `<li value="${x.n}" id="ref-${x.n}">${esc(x.text)}</li>`).join('')}</ol>`).join('')}
    <h4>6.2 Primary sources: interviews and FGDs analysed</h4>
    <div class="tw"><table><thead><tr><th>Ref.</th><th>Where / who</th><th>Group</th><th>Date</th><th>Audio</th><th>Typed words</th><th>Spoken words</th></tr></thead><tbody>${r.sources.map(s => `<tr><td><a class="ref" data-i="${s.id}">${esc(s.ref)}</a></td><td>${esc(s.where)}</td><td>${esc(s.group)}</td><td>${s.date || '-'}</td><td>${esc((AUD[s.audio] || [s.audio])[0])}</td><td>${s.words}</td><td>${s.spoken != null ? fmt(s.spoken) : '-'}</td></tr>`).join('') || '<tr><td colspan="7" class="mu">None</td></tr>'}</tbody></table></div>`)

  // appendices
  if (opt.appendix && ap) {
    sec.push(`<h2>Appendix A. All typed answers</h2><p>${ap.totals.typed_answers} open-ended answers from ${ap.items.length} consented submissions, in questionnaire order. Contact details are masked.</p>
    ${ap.items.map(it => { const secs = {}; it.texts.forEach(x => (secs[x.section || 'Other'] ||= []).push(x)); return `<details><summary>${esc(it.ref)} &middot; ${esc(it.where)} &middot; ${esc(it.group)} &middot; ${it.date || '-'} &middot; ${it.words} words</summary>${Object.entries(secs).map(([s, xs]) => `<h4>${esc(s)}</h4>${xs.map(x => `<p><i class="mu">${esc(x.q)}</i><br>${esc(x.v)}</p>`).join('')}`).join('') || '<p class="thin">No typed open-ended answers.</p>'}</details>` }).join('')}
    <h2>Appendix B. Audio converted to text</h2><p>${ap.totals.transcripts} transcript${ap.totals.transcripts === 1 ? '' : 's'} (speech-to-text). Machine-generated: expect errors with accents, local languages and background noise. Transcripts marked <i>needs review</i> are NOT used in the themes.</p>
    ${ap.items.filter(i => i.transcript).map(it => { const t = it.transcript; return `<details><summary>${esc(it.ref)} &middot; ${esc(it.where)} &middot; ${esc(t.status === 'done' ? 'accepted' : t.status)} &middot; ${t.duration ? mins(t.duration) : ''} &middot; confidence ${t.confidence != null ? pct(t.confidence) : '-'}</summary>
      <div class="mu" style="font-size:12px">${esc(t.model || '')} &middot; language ${esc(t.language || '?')}${t.flags.length ? ' &middot; flags: ' + t.flags.map(esc).join(', ') : ''}</div>
      <div class="tr">${t.segments.length ? t.segments.map(s => `<p><span class="t">${mmss(s.start)}</span>${esc(s.text)}</p>`).join('') : '<p class="thin">No speech detected.</p>'}</div></details>` }).join('') || '<p class="thin">No transcripts yet.</p>'}
    <h2>Appendix C. Closed (structured) answers</h2><p>Selected answers per submission, with labels as in the form.</p>
    ${ap.items.map(it => `<details><summary>${esc(it.ref)} &middot; ${esc(it.where)} &middot; ${it.closed.length} answers</summary><div class="tw"><table><tbody>${it.closed.map(x => `<tr><td style="width:55%">${esc(x.q)}</td><td>${esc(x.v)}</td></tr>`).join('')}</tbody></table></div></details>`).join('')}`)
  }
  return sec.join('\n')
}

function reportCharts(r) {
  const base = { animation: false, responsive: true }
  const f = r.forms.filter(x => x.consented)
  if ($('#rc-forms')) chart('rc-forms', { type: 'bar', data: { labels: f.map(x => x.code + ' ' + x.group), datasets: [{ data: f.map(x => x.consented), backgroundColor: COL.teal }] }, options: { ...base, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } } })
  const dc = DIMCOL()
  if ($('#rc-themes')) chart('rc-themes', { type: 'bar', data: { labels: r.charts.themes.map(t => t.label), datasets: [{ data: r.charts.themes.map(t => Math.round(t.pct * 100)), backgroundColor: r.charts.themes.map(t => dc[t.dim] || COL.teal) }] }, options: { ...base, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, max: 100, title: { display: true, text: '% of interviews' } } } } })
  if ($('#rc-dims')) chart('rc-dims', { type: 'doughnut', data: { labels: r.charts.dimensions.map(d => d.label), datasets: [{ data: r.charts.dimensions.map(d => d.interviews), backgroundColor: r.charts.dimensions.map(d => d.color) }] }, options: { ...base, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } } } })
  const pk = ['positive', 'mixed', 'neutral', 'negative']
  if ($('#rc-pol')) chart('rc-pol', { type: 'doughnut', data: { labels: pk, datasets: [{ data: pk.map(k => r.charts.polarity[k] || 0), backgroundColor: pk.map(k => POLCOL[k]) }] }, options: { ...base, plugins: { legend: { position: 'bottom' } } } })
  if ($('#rc-div')) { const t = r.charts.themes.slice(0, 8); chart('rc-div', { type: 'bar', data: { labels: t.map(x => x.label), datasets: [{ label: 'Official side', data: t.map(x => Math.round(x.off * 100)), backgroundColor: COL.navy }, { label: 'Trader side', data: t.map(x => Math.round(x.trd * 100)), backgroundColor: COL.gold }] }, options: { ...base, indexAxis: 'y', scales: { x: { beginAtZero: true, max: 100, title: { display: true, text: '% of respondents on that side' } } } } }) }
}

VIEWS.report = async (v) => {
  const wantApp = S.reportAppendix !== false
  v.innerHTML = '<div class="loading">Compiling report&hellip;</div>'
  const [r, ap] = await Promise.all([api('report'), wantApp ? api('report/appendix') : Promise.resolve(null)])
  v.innerHTML = `<div class="rtool no-print"><div class="grow"><b>Report</b> <span class="mu">&middot; built live from ${r.n} interview${r.n === 1 ? '' : 's'} and respects the filters above (region, LG, group)</span></div>
    <label class="chk" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="r-app" ${wantApp ? 'checked' : ''}> include appendices (all typed answers + transcripts)</label>
    <button id="r-print" class="ghost"><i class="fa-solid fa-print"></i> Print / save as PDF</button>
    <button id="r-doc"><i class="fa-solid fa-file-word"></i> Download Word</button>
    <button id="r-md" class="ghost"><i class="fa-solid fa-file-lines"></i> Download Markdown</button></div>
    <div id="report">${reportHTML(r, ap, { appendix: wantApp })}</div>`
  reportCharts(r)
  $('#r-app').onchange = e => { S.reportAppendix = e.target.checked; render() }
  $('#r-print').onclick = () => { document.querySelectorAll('#report details').forEach(d => d.open = true); setTimeout(() => window.print(), 150) }
  $('#r-doc').onclick = () => downloadWord()
  $('#r-md').onclick = () => downloadMd(r, ap, wantApp)
  v.querySelectorAll('a.ref[data-i]').forEach(a => a.onclick = e => { e.preventDefault(); if (a.dataset.i) showInterview(+a.dataset.i) })
  v.querySelectorAll('a.lit-ref').forEach(a => a.onclick = e => { e.preventDefault(); document.querySelector(a.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth', block: 'center' }) })
}

function downloadWord() {
  const root = $('#report').cloneNode(true)
  // charts -> images (Word cannot run canvas)
  const live = [...document.querySelectorAll('#report canvas')], cl = [...root.querySelectorAll('canvas')]
  cl.forEach((c, i) => { const img = document.createElement('img'); img.src = live[i].toDataURL('image/png'); img.width = Math.min(live[i].width, 560); img.style.maxWidth = '100%'; c.replaceWith(img) })
  root.querySelectorAll('details').forEach(d => { d.setAttribute('open', ''); const s = d.querySelector('summary'); if (s) { const b = document.createElement('p'); b.innerHTML = '<b>' + s.innerHTML + '</b>'; s.replaceWith(b) } })
  root.querySelectorAll('a').forEach(a => { const s = document.createElement('span'); s.innerHTML = a.innerHTML; a.replaceWith(s) })
  const css = 'body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.4}h1{font-size:20pt;color:#142a46}h2{font-size:15pt;color:#142a46;border-bottom:1px solid #1f877d}h3{font-size:13pt;color:#1f877d}h4{font-size:11.5pt;color:#142a46}blockquote{margin:6pt 0 6pt 12pt;padding-left:8pt;border-left:3pt solid #1f877d;color:#333}.src{font-size:9pt;color:#666}table{border-collapse:collapse;width:100%;font-size:9.5pt}td,th{border:1px solid #bbb;padding:3pt}.thin,.mu,.figcap,.lit{font-size:9pt;color:#666}.callout{border:1px solid #d9b45a;padding:6pt;background:#fff4dc}.chip{border:1px solid #ccc;padding:1pt 4pt;font-size:9pt}'
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>Trade Order Study report</title><style>${css}</style></head><body>${root.innerHTML}</body></html>`
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff', html], { type: 'application/msword' })); a.download = `Trade_Order_Study_Report_${new Date().toISOString().slice(0, 10)}.doc`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000)
}

function downloadMd(r, ap, app) {
  const L = []
  L.push(`# Trade Order Implementation Study: Qualitative Findings Report`, `_Auto-generated draft, ${r.generated}. DRAFT for analyst review._`, '', '## Executive summary', ...r.executive, '', '## Limitations', ...r.caveats.map(c => '- ' + c), '', '## Findings by objective')
  r.objectives.forEach(o => { L.push('', `### ${o.id}: ${o.label}`); o.dimensions.forEach(d => { L.push('', `#### ${d.label}`); d.themes.filter(t => t.interviews).forEach(t => { L.push('', `**${t.label}**`, '', t.narrative); t.quotes.forEach(q => L.push('', `> "${q.text}"  \n> [${q.ref}] ${q.where}, ${q.group}, ${q.source}`)); if (t.lit.length) L.push('', 'Related literature: ' + t.lit.map(n => `[${n}]`).join(' ')) }) }) })
  L.push('', '## References', ...r.references.map(x => `${x.n}. ${x.text}`), '', '### Primary sources', ...r.sources.map(s => `- ${s.ref}: ${s.where}, ${s.group}, ${s.date || ''}`))
  if (app && ap) { L.push('', '## Appendix A. Typed answers'); ap.items.forEach(it => { L.push('', `### ${it.ref} ${it.where}`); it.texts.forEach(x => L.push(`- **${x.q}**: ${x.v}`)) }); L.push('', '## Appendix B. Transcripts'); ap.items.filter(i => i.transcript).forEach(it => { L.push('', `### ${it.ref} ${it.where} (${it.transcript.status})`, it.transcript.segments.map(s => `[${mmss(s.start)}] ${s.text}`).join('\n')) }) }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([L.join('\n')], { type: 'text/markdown' })); a.download = 'Trade_Order_Study_Report.md'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000)
}
