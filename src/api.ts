import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { Env, forms, fetchAsset, fetchAllData, normalise, buildSchema, koboHeaders } from './kobo'
import { THEMES, THEME_BY_CODE, DIMENSIONS, OBJECTIVES, codeItems, emergentTerms, SKIP_TEXT, anonymise } from './codebook'
import SCHEMA from './schema.json'
import LGS from './lgs.json'
import LIT from './literature.json'
import { THEME_LIT } from './report'

const S: any = SCHEMA
export const app = new Hono<{ Bindings: Env }>()
app.use('/api/*', cors())

const J = (s: any, d: any = null) => { try { return s ? JSON.parse(s) : d } catch { return d } }
const LG_BY: Record<string, any> = Object.fromEntries((LGS as any[]).map(l => [l.code, l]))
const lgLabel = (c: string) => LG_BY[c]?.label || c
const qlabel = (fs: any, k: string) => (fs?.q?.[k]?.l || k).replace(/^[A-H]\d+(?:\.\d+)?[a-z]?\.\s*/, '').replace(/\s*\(.*$/, '').slice(0, 140)
type FS = { uid: string; kind: string; name: string; q: any; ch: any; meta: any; order: string[] }
async function formSchemas(c: any): Promise<Record<string, FS>> {
  const rows = (await c.env.DB.prepare('SELECT uid,kind,name,schema FROM forms').all()).results as any[]
  const m: Record<string, FS> = {}
  for (const r of rows) { const sc = J(r.schema, {}); m[r.uid] = { uid: r.uid, kind: r.kind, name: r.name || r.uid, q: sc.q || {}, ch: sc.ch || {}, meta: sc.meta || {}, order: sc.order || Object.keys(sc.q || {}) } }
  return m
}
const shortName = (n: string) => (n || '').replace(/\s*\(Trade Order Study\)\s*$/, '')
const whereLabel = (s: any, fs?: FS) => s.lg ? lgLabel(s.lg) : (s.affiliation || (s.grp === 'national' ? 'National stakeholder' : s.consent_interview === 'no' ? 'LG not recorded (declined)' : 'LG not recorded'))
// Respondent groups (set by the form): which side of the official-vs-trader comparison they belong to
const TRADER_GRP = new Set(['trader_association', 'fgd_informal_traders', 'trader'])
const side = (g: string) => (TRADER_GRP.has(g) || String(g || '').startsWith('fgd') ? 'trader' : 'official')
const THIN: Record<string, number> = { lg_official: 80, lg_political_enforcement: 80, national: 80, trader_association: 15, fgd_informal_traders: 100 }

// ---------- auth for write endpoints ----------
const admin = async (c: any, next: any) => {
  const key = c.req.header('x-admin-key') || ''
  if (!c.env.INGEST_TOKEN || key !== c.env.INGEST_TOKEN) return c.json({ error: 'Admin key required (x-admin-key)' }, 401)
  await next()
}

// ---------- shared loaders ----------
type Sub = any
async function loadSubs(c: any, opts: { consented?: boolean } = {}): Promise<Sub[]> {
    const { results } = await c.env.DB.prepare(`SELECT * FROM submissions  ORDER BY id`).all()
  const region = c.req.query('region'), lg = c.req.query('lg'), grp = c.req.query('grp')
  return results.filter((s: any) => (!region || s.region === region) && (!lg || s.lg === lg) && (!grp || s.grp === grp)
    && (!opts.consented || s.consent_interview !== 'no'))
    .map((s: any) => ({ ...s, answers: J(s.answers, {}), texts: J(s.texts, {}) }))
}
const codeFilter = (c: any) => {
  const w: string[] = [], b: any[] = []
  for (const k of ['region', 'lg', 'grp', 'dimension', 'objective', 'theme', 'polarity', 'evidence']) {
    const v = c.req.query(k); if (v) { w.push(`${k}=?`); b.push(v) }
  }
  const src = c.req.query('source'); if (src === 'audio') w.push("source='audio'"); else if (src === 'text') w.push("source LIKE 'field:%'")
  return { where: w.length ? 'WHERE ' + w.join(' AND ') : '', b }
}
const inc = (o: any, k: any, n = 1) => { if (k !== undefined && k !== null && k !== '') o[k] = (o[k] || 0) + n }
const split = (v: any) => (typeof v === 'string' ? v.split(/\s+/).filter(Boolean) : [])
const median = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null

// ---------- sync from KoboToolbox ----------
function codingStatements(env: Env, s: any, replaceSource = 'field:%') {
  const st: any[] = [env.DB.prepare(`DELETE FROM codes WHERE submission_id=? AND source LIKE ?`).bind(s.id, replaceSource)]
  if (s.consent_interview === 'no') return st
  for (const [f, t] of Object.entries<string>(s.texts)) {
    if (SKIP_TEXT.has(f) || f === 'photo_caption') continue
    for (const k of codeItems(f, [{ text: t }])) st.push(insCode(env, s, 'field:' + f, k))
  }
  return st
}
const insCode = (env: Env, s: any, source: string, k: any) => env.DB.prepare(
  `INSERT INTO codes (submission_id,source,seg_start,theme,dimension,objective,polarity,evidence,method,excerpt,lg,region,grp,kind,is_demo) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
).bind(s.id, source, k.start ?? null, k.theme, k.dimension, k.objective, k.polarity, k.evidence, k.method, k.excerpt, s.lg, s.region, s.grp, s.kind, s.is_demo ? 1 : 0)

app.post('/api/sync', admin, async (c) => {
  const env = c.env
  if (!env.KOBO_TOKEN) return c.json({ error: 'KOBO_TOKEN secret not configured' }, 400)
  const limit = Math.min(Number(c.req.query('limit') || 15), 40)
  const force = c.req.query('force') === '1'
  const fl = forms(env)
  if (!fl.length) return c.json({ error: 'KOBO_FORMS not configured' }, 400)
  const have = new Set<number>((await env.DB.prepare('SELECT id FROM submissions WHERE is_demo=0').all()).results.map((r: any) => r.id))
  let processed = 0, remaining = 0, total = 0, removed = 0
  const errors: string[] = []
  for (const f of fl) {
    try {
      const asset = await fetchAsset(env, f.uid)
      const schema = buildSchema(asset)
      await env.DB.prepare(`INSERT INTO forms (uid,kind,name,schema,last_sync,submission_count) VALUES (?,?,?,?,?,?)
        ON CONFLICT(uid) DO UPDATE SET kind=excluded.kind,name=excluded.name,schema=excluded.schema,last_sync=excluded.last_sync,submission_count=excluded.submission_count`)
        .bind(f.uid, f.kind, asset.name, JSON.stringify({ q: schema.q, ch: schema.ch, meta: schema.meta, order: schema.order }), new Date().toISOString(), asset.deployment__submission_count ?? 0).run()
      const data = await fetchAllData(env, f.uid)
      total += data.length
      const live = new Set<number>(data.map((r: any) => r._id))
      const gone = ((await env.DB.prepare('SELECT id FROM submissions WHERE form_uid=?').bind(f.uid).all()).results as any[]).map(r => r.id).filter((id: number) => !live.has(id))
      for (const id of gone) { await env.DB.batch([env.DB.prepare('DELETE FROM codes WHERE submission_id=?').bind(id), env.DB.prepare('DELETE FROM transcripts WHERE submission_id=?').bind(id), env.DB.prepare('DELETE FROM submissions WHERE id=?').bind(id)]); removed++ }
      const off = Math.max(0, Number(c.req.query('offset') || 0))
      const todo = force ? data.slice(off) : data.filter(r => !have.has(r._id))
      const batch = todo.slice(0, Math.max(0, limit - processed))
      remaining += todo.length - batch.length
      for (const raw of batch) {
        const n: any = normalise(f, raw, schema)
        const st: any[] = [env.DB.prepare(`INSERT INTO submissions
          (id,form_uid,uuid,kind,submitted_at,started_at,ended_at,duration_sec,interview_date,region,lg,lg_category,affiliation,grp,enumerator_id,consent_interview,consent_audio,lat,lon,answers,texts,text_words,photo_count,audio_url,audio_name,audio_status,validation,is_demo,synced_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)
          ON CONFLICT(id) DO UPDATE SET submitted_at=excluded.submitted_at,duration_sec=excluded.duration_sec,interview_date=excluded.interview_date,region=excluded.region,lg=excluded.lg,lg_category=excluded.lg_category,
            affiliation=excluded.affiliation,grp=excluded.grp,enumerator_id=excluded.enumerator_id,consent_interview=excluded.consent_interview,consent_audio=excluded.consent_audio,lat=excluded.lat,lon=excluded.lon,
            answers=excluded.answers,texts=excluded.texts,text_words=excluded.text_words,photo_count=excluded.photo_count,audio_url=excluded.audio_url,audio_name=excluded.audio_name,validation=excluded.validation,synced_at=excluded.synced_at,
            audio_status=CASE WHEN submissions.audio_status IN ('done','review','rejected','processing','failed') AND submissions.audio_name=excluded.audio_name THEN submissions.audio_status ELSE excluded.audio_status END`)
          .bind(n.id, n.form_uid, n.uuid, n.kind, n.submitted_at, n.started_at, n.ended_at, n.duration_sec, n.interview_date, n.region, n.lg, n.lg_category, n.affiliation, n.grp, n.enumerator_id,
            n.consent_interview, n.consent_audio, n.lat, n.lon, JSON.stringify(n.answers), JSON.stringify(n.texts), n.text_words, n.photo_count, n.audio_url, n.audio_name, n.audio_status, n.validation, new Date().toISOString())]
        st.push(...codingStatements(env, { ...n, is_demo: 0 }))
        await env.DB.batch(st)
        processed++
      }
    } catch (e: any) { errors.push(String(e.message || e)) }
  }
  await env.DB.prepare(`INSERT INTO meta (key,value) VALUES ('last_sync',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(new Date().toISOString()).run()
  return c.json({ ok: !errors.length, processed, remaining, removed, kobo_total: total, errors })
})

// Re-run the coding engine over stored text + accepted transcripts (after a codebook change)
app.post('/api/recode', admin, async (c) => {
  const after = Number(c.req.query('after') || -1e12), limit = Math.min(Number(c.req.query('limit') || 25), 60)
  const rows = (await c.env.DB.prepare('SELECT * FROM submissions WHERE id>? ORDER BY id LIMIT ?').bind(after, limit).all()).results
  for (const r of rows as any[]) {
    const s = { ...r, texts: J(r.texts, {}) }
    const st = codingStatements(c.env, s)
    const t: any = await c.env.DB.prepare("SELECT segments FROM transcripts WHERE submission_id=? AND status='done'").bind(s.id).first()
    if (t) { st.push(c.env.DB.prepare("DELETE FROM codes WHERE submission_id=? AND source='audio'").bind(s.id)); st.push(...audioCodes(c.env, s, J(t.segments, []))) }
    await c.env.DB.batch(st)
  }
  const next = rows.length ? (rows[rows.length - 1] as any).id : null
  return c.json({ processed: rows.length, next: rows.length === limit ? next : null })
})

export function transcriptProblems(text: string, duration: number): string[] {
  const out: string[] = []
  const toks = text.toLowerCase().match(/[a-z']+/g) || []
  if (toks.length >= 30) {
    const g = new Map<string, number>()
    for (let i = 0; i < toks.length - 2; i++) { const k = toks[i] + ' ' + toks[i + 1] + ' ' + toks[i + 2]; g.set(k, (g.get(k) || 0) + 1) }
    const top = Math.max(...g.values()) / (toks.length - 2)
    if (top > 0.2 || new Set(toks).size / toks.length < 0.12) out.push('repetition')
  }
  if (duration >= 60 && toks.length / (duration / 60) < 25) out.push('little_speech')
  return out
}
function audioCodes(env: Env, s: any, segs: { start: number; text: string }[]) {
  return codeItems('audio', segs.map(x => ({ text: x.text, start: x.start }))).map(k => insCode(env, s, 'audio', k))
}

// ---------- pipeline endpoints (used by pipeline/run.py) ----------
app.get('/api/pipeline/pending', admin, async (c) => {
  const lim = Number(c.req.query('limit') || 20)
  const { results } = await c.env.DB.prepare(`SELECT id,audio_url,audio_name,lg,grp FROM submissions WHERE is_demo=0 AND audio_status IN ('pending','failed') AND audio_url IS NOT NULL ORDER BY id LIMIT ?`).bind(lim).all()
  return c.json({ items: results })
})
app.post('/api/pipeline/status', admin, async (c) => {
  const b = await c.req.json()
  await c.env.DB.prepare('UPDATE submissions SET audio_status=? WHERE id=?').bind(b.status, b.id).run()
  if (b.status === 'failed' && b.error) await c.env.DB.prepare(`INSERT INTO transcripts (submission_id,status,error,created_at) VALUES (?,?,?,?) ON CONFLICT(submission_id) DO UPDATE SET status=excluded.status,error=excluded.error`).bind(b.id, 'failed', String(b.error).slice(0, 500), new Date().toISOString()).run()
  return c.json({ ok: true })
})
app.post('/api/pipeline/transcript', admin, async (c) => {
  const b = await c.req.json()
  const s: any = await c.env.DB.prepare('SELECT * FROM submissions WHERE id=?').bind(b.submission_id).first()
  if (!s) return c.json({ error: 'unknown submission' }, 404)
  const segs = (b.segments || []).map((x: any) => ({ start: +x.start, end: +x.end, text: String(x.text || '').trim() }))
  // Do not trust the worker's verdict: re-check the text server-side so a loop/hallucination can never be auto-coded
  const flags: string[] = [...(b.flags || [])]
  const bad = transcriptProblems(segs.map((x: any) => x.text).join(' '), Number(b.duration) || 0)
  for (const f of bad) if (!flags.includes(f)) flags.push(f)
  const status = (b.status === 'review' || bad.length) ? 'review' : 'done'
  b.flags = flags
  const st: any[] = [
    c.env.DB.prepare(`INSERT INTO transcripts (submission_id,text,segments,language,engine,model,confidence,duration,status,error,flags,created_at) VALUES (?,?,?,?,?,?,?,?,?,NULL,?,?)
      ON CONFLICT(submission_id) DO UPDATE SET text=excluded.text,segments=excluded.segments,language=excluded.language,engine=excluded.engine,model=excluded.model,confidence=excluded.confidence,duration=excluded.duration,status=excluded.status,error=NULL,flags=excluded.flags,created_at=excluded.created_at`)
      .bind(s.id, b.text || '', JSON.stringify(segs), b.language || null, b.engine || 'faster-whisper', b.model || null, b.confidence ?? null, b.duration ?? null, status, JSON.stringify(b.flags || []), new Date().toISOString()),
    c.env.DB.prepare('UPDATE submissions SET audio_status=? WHERE id=?').bind(status, s.id),
    c.env.DB.prepare("DELETE FROM codes WHERE submission_id=? AND source='audio'").bind(s.id),
  ]
  if (status === 'done') st.push(...audioCodes(c.env, s, segs))
  await c.env.DB.batch(st)
  return c.json({ ok: true, status })
})
app.post('/api/transcript/:id/:action', admin, async (c) => {
  const id = Number(c.req.param('id')), act = c.req.param('action')
  const s: any = await c.env.DB.prepare('SELECT * FROM submissions WHERE id=?').bind(id).first()
  const t: any = await c.env.DB.prepare('SELECT * FROM transcripts WHERE submission_id=?').bind(id).first()
  if (!s || !t) return c.json({ error: 'not found' }, 404)
  if (act === 'accept') {
    await c.env.DB.batch([c.env.DB.prepare("UPDATE transcripts SET status='done' WHERE submission_id=?").bind(id), c.env.DB.prepare("UPDATE submissions SET audio_status='done' WHERE id=?").bind(id),
      c.env.DB.prepare("DELETE FROM codes WHERE submission_id=? AND source='audio'").bind(id), ...audioCodes(c.env, s, J(t.segments, []))])
  } else if (act === 'reject') {
    await c.env.DB.batch([c.env.DB.prepare("UPDATE transcripts SET status='rejected' WHERE submission_id=?").bind(id), c.env.DB.prepare("UPDATE submissions SET audio_status='rejected' WHERE id=?").bind(id),
      c.env.DB.prepare("DELETE FROM codes WHERE submission_id=? AND source='audio'").bind(id)])
  } else if (act === 'requeue') {
    await c.env.DB.batch([c.env.DB.prepare("UPDATE submissions SET audio_status='pending' WHERE id=?").bind(id), c.env.DB.prepare("DELETE FROM codes WHERE submission_id=? AND source='audio'").bind(id)])
  } else return c.json({ error: 'bad action' }, 400)
  return c.json({ ok: true })
})

// ---------- audio proxy (keeps the Kobo token server-side) ----------
app.get('/api/audio/:id', async (c) => {
  // Interview recordings are sensitive: require the admin key (header for the worker, ?key= for the browser <audio> tag)
  const k = c.req.header('x-admin-key') || c.req.query('key') || ''
  if (!c.env.INGEST_TOKEN || k !== c.env.INGEST_TOKEN) return c.json({ error: 'Admin key required to play audio' }, 401)
  const s: any = await c.env.DB.prepare('SELECT audio_url,is_demo FROM submissions WHERE id=?').bind(Number(c.req.param('id'))).first()
  if (!s?.audio_url) return c.json({ error: 'no audio' }, 404)
  const h: any = { ...koboHeaders(c.env) }
  const rng = c.req.header('range'); if (rng) h.Range = rng
  const r = await fetch(s.audio_url, { headers: h })
  const out = new Headers()
  for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges']) { const v = r.headers.get(k); if (v) out.set(k, v) }
  if (!out.get('content-type') || out.get('content-type') === 'application/octet-stream') out.set('content-type', 'audio/mp4')
  out.set('cache-control', 'private, max-age=3600')
  return new Response(r.body, { status: r.status, headers: out })
})


// ---------- read APIs ----------
const GROUP_LABELS: Record<string, string> = { lg_official: 'LG officials', lg_political_enforcement: 'Political & enforcement', trader_association: "Traders' association", national: 'National stakeholders', fgd_informal_traders: 'FGD: informal vendors' }
app.get('/api/forms', async (c) => {
  const fs = await formSchemas(c)
  const cnt: any = {}; (await c.env.DB.prepare('SELECT form_uid, COUNT(*) n, SUM(CASE WHEN audio_url IS NOT NULL THEN 1 ELSE 0 END) a FROM submissions GROUP BY form_uid').all()).results.forEach((r: any) => cnt[r.form_uid] = r)
  const kobo: any = {}; (await c.env.DB.prepare('SELECT uid,last_sync,submission_count FROM forms').all()).results.forEach((r: any) => kobo[r.uid] = r)
  const list = forms(c.env).map(f => ({ uid: f.uid, kind: f.kind, code: fs[f.uid]?.meta?.code || '', group: fs[f.uid]?.meta?.group || '', name: shortName(fs[f.uid]?.name || f.uid), synced: !!fs[f.uid], kobo_count: kobo[f.uid]?.submission_count ?? null, in_dashboard: cnt[f.uid]?.n || 0, with_audio: cnt[f.uid]?.a || 0, last_sync: kobo[f.uid]?.last_sync || null }))
  return c.json({ forms: list })
})
app.get('/api/config', async (c) => {
  const lastSync = await c.env.DB.prepare("SELECT value FROM meta WHERE key='last_sync'").first<any>()
  const realN = await c.env.DB.prepare('SELECT COUNT(*) n FROM submissions WHERE is_demo=0').first<any>()
  return c.json({
    lgs: LGS, regions: S.ch.region, last_sync: lastSync?.value || null, real_rows: realN?.n || 0,
    dimensions: DIMENSIONS, objectives: OBJECTIVES, themes: THEMES.map(t => ({ code: t.code, label: t.label, dim: t.dim })),
    kobo_configured: !!c.env.KOBO_TOKEN, admin_configured: !!c.env.INGEST_TOKEN,
    targets: { officials_per_lg: 4, traders_per_lg: 2, fgd_per_lg: 2 },
    groups: GROUP_LABELS,
  })
})

app.get('/api/overview', async (c) => {
  const subs = await loadSubs(c)
  const cons = subs.filter(s => s.consent_interview !== 'no')
  const tr: any = (await c.env.DB.prepare(`SELECT COUNT(*) n, COALESCE(SUM(duration),0) d, COALESCE(AVG(confidence),0) conf FROM transcripts t JOIN submissions s ON s.id=t.submission_id WHERE t.status='done' `).first()) || {}
  const cf = codeFilter(c)
  const cd: any = await c.env.DB.prepare(`SELECT COUNT(*) n, COUNT(DISTINCT submission_id) subs, COUNT(DISTINCT theme) themes FROM codes ${cf.where}`).bind(...cf.b).first()
  const audio: any = {}; subs.forEach(s => inc(audio, s.audio_status))
  const byDay: any = {}; subs.forEach(s => inc(byDay, (s.interview_date || (s.submitted_at || '').slice(0, 10)) || 'unknown'))
  const byGrp: any = {}, byRegion: any = {}, byLg: any = {}
  cons.forEach(s => { inc(byGrp, s.grp || 'unknown'); inc(byRegion, s.region); inc(byLg, s.lg) })
  const lgsCovered = Object.keys(byLg).length
  const words = cons.reduce((a, s) => a + (s.text_words || 0), 0)
  const dur = cons.map(s => s.duration_sec).filter((x: any) => x)
  return c.json({
    total: subs.length, consented: cons.length, declined: subs.length - cons.length, audio,
    transcripts: { n: tr.n || 0, hours: +((tr.d || 0) / 3600).toFixed(2), confidence: tr.conf ? +tr.conf.toFixed(2) : null },
    codes: { total: cd?.n || 0, submissions: cd?.subs || 0, themes: cd?.themes || 0, themes_total: THEMES.length },
    words, lgs_covered: lgsCovered, lgs_total: LGS.length, median_duration_min: dur.length ? +(median(dur)! / 60).toFixed(1) : null,
    by_group: byGrp, by_region: byRegion, by_lg: Object.entries(byLg).map(([k, v]) => ({ lg: k, label: lgLabel(k), n: v })), timeline: Object.entries(byDay).sort().map(([d, n]) => ({ d, n })),
  })
})

app.get('/api/coverage', async (c) => {
  const subs = await loadSubs(c)
  const T = { officials: 4, traders: 2, fgds: 2 }
  const rows = (LGS as any[]).map(l => {
    const ss = subs.filter(s => s.lg === l.code && s.consent_interview !== 'no')
    const a1 = ss.filter(s => s.grp === 'lg_official').length, a2 = ss.filter(s => s.grp === 'lg_political_enforcement').length
    const off = a1 + a2, trd = ss.filter(s => s.grp === 'trader_association').length, fgd = ss.filter(s => String(s.grp).startsWith('fgd')).length
    const done = ss.filter(s => s.audio_status === 'done').length
    const declined = subs.filter(s => s.lg === l.code && s.consent_interview === 'no').length
    const aff: any = {}; ss.forEach(s => inc(aff, s.affiliation))
    return { code: l.code, label: l.label, region: l.region, cat: l.cat, officials: off, a1, a2, traders: trd, fgds: fgd, audio_done: done, audio_total: ss.length, declined, affiliations: aff,
      pct: Math.round(100 * (Math.min(off, T.officials) + Math.min(trd, T.traders) + Math.min(fgd, T.fgds)) / (T.officials + T.traders + T.fgds)) }
  })
  const total = rows.reduce((a, r) => a + Math.min(r.officials, T.officials) + Math.min(r.traders, T.traders) + Math.min(r.fgds, T.fgds), 0)
  const national = subs.filter(s => s.grp === 'national' && s.consent_interview !== 'no').length
  return c.json({ targets: T, rows, achieved: total, target_total: rows.length * (T.officials + T.traders + T.fgds), national })
})

const QEXCL = new Set(['consent_interview', 'consent_audio', 'consent_fgd', 'region', 'lg_name', 'lg_category'])
app.get('/api/quant', async (c) => {
  const fsm = await formSchemas(c)
  const all = await loadSubs(c, { consented: true })
  const count: any = {}; all.forEach(s => inc(count, s.form_uid))
  const flist = Object.values(fsm).map(f => ({ uid: f.uid, code: f.meta.code || '', name: shortName(f.name), group: f.meta.group || '', n: count[f.uid] || 0 }))
  const uid = c.req.query('form') || [...flist].sort((a, b) => b.n - a.n)[0]?.uid
  const fs = fsm[uid]
  if (!fs) return c.json({ forms: flist, form: null, questions: [], n: 0 })
  const subs = all.filter(s => s.form_uid === uid)
  const out: any[] = []
  const secName = (k: string) => (fs.q[k]?.sec || '').replace(/^Section\s+/, '').replace(/:.*$/, '').replace(/^Module\s+/, 'Module ').trim()
  for (const k of fs.order) {
    const q = fs.q[k]; if (!q || QEXCL.has(k) || !q.list || !/^select_(one|multiple)$/.test(q.t)) continue
    const ch = fs.ch[q.list] || {}
    const likert = Object.keys(ch).length >= 3 && Object.keys(ch).every(x => /^[1-5]$/.test(x))
    const type = likert ? 'likert' : q.t === 'select_multiple' ? 'multi' : 'cat'
    const opts = Object.entries(ch).map(([v, l]) => ({ v, label: l as string }))
    const overall: any = {}, byGrp: any = {}, byLg: any = {}, byRegion: any = {}, nGrp: any = {}
    let n = 0
    for (const s of subs) {
      const v = s.answers[k]; if (v === undefined || v === null || v === '') continue
      n++; inc(nGrp, s.grp)
      for (const x of (type === 'multi' ? split(v) : [String(v)])) { inc(overall, x); inc((byGrp[s.grp] ||= {}), x); if (s.lg) inc((byLg[s.lg] ||= {}), x); if (s.region) inc((byRegion[s.region] ||= {}), x) }
    }
    const lik = type === 'likert' ? (() => {
      const m = (f: (s: any) => boolean) => mean(subs.filter(f).map(s => Number(s.answers[k])).filter(x => Number.isFinite(x)))
      return { mean: m(() => true), byLg: Object.fromEntries(Object.keys(byLg).map(l => [l, m(s => s.lg === l)])), byRegion: Object.fromEntries(Object.keys(byRegion).map(r => [r, m(s => s.region === r)])) }
    })() : null
    out.push({ key: k, label: qlabel(fs, k), section: secName(k), type, n, nGrp, options: opts, overall, byGrp, byRegion, likert: lik, byLg })
  }
  return c.json({ forms: flist, form: uid, questions: out, n: subs.length })
})

async function themeStats(c: any) {
  const cf = codeFilter(c)
  const { results } = await c.env.DB.prepare(`SELECT theme,dimension,polarity,grp,evidence,lg,region,submission_id sid,source FROM codes ${cf.where}`).bind(...cf.b).all()
  const subs = await loadSubs(c, { consented: true })
  const nOff = subs.filter(s => side(s.grp) === 'official').length, nTrd = subs.filter(s => side(s.grp) === 'trader').length
  const m: any = {}
  for (const r of results as any[]) {
    const t = (m[r.theme] ||= { theme: r.theme, subs: new Set(), off: new Set(), trd: new Set(), pol: {}, ev: {}, lgs: new Set(), audio: 0, text: 0, n: 0 })
    t.n++; t.subs.add(r.sid); (side(r.grp) === 'trader' ? t.trd : t.off).add(r.sid); inc(t.pol, r.polarity); inc(t.ev, r.evidence); t.lgs.add(r.lg)
    r.source === 'audio' ? t.audio++ : t.text++
  }
  const rows = Object.values<any>(m).map(t => {
    const meta = THEME_BY_CODE[t.theme]
    const pOff = nOff ? t.off.size / nOff : 0, pTrd = nTrd ? t.trd.size / nTrd : 0
    return { theme: t.theme, label: meta.label, dimension: meta.dim, interviews: t.subs.size, pct: subs.length ? t.subs.size / subs.length : 0, officials: t.off.size, traders: t.trd.size,
      pct_off: pOff, pct_trd: pTrd, divergence: pOff - pTrd, polarity: t.pol, evidence: t.ev, lgs: t.lgs.size, mentions: t.n, from_audio: t.audio, from_text: t.text }
  }).sort((a, b) => b.interviews - a.interviews)
  const dims = DIMENSIONS.map(d => ({ ...d, interviews: new Set((results as any[]).filter(r => r.dimension === d.id).map(r => r.sid)).size, mentions: (results as any[]).filter(r => r.dimension === d.id).length }))
  const ev: any = {}, pol: any = {}; (results as any[]).forEach(r => { inc(ev, r.evidence); inc(pol, r.polarity) })
  return { themes: rows, dimensions: dims, evidence: ev, polarity: pol, n_off: nOff, n_trd: nTrd }
}
app.get('/api/themes', async (c) => c.json(await themeStats(c)))

app.get('/api/heatmap', async (c) => {
  const cf = codeFilter(c)
  const { results } = await c.env.DB.prepare(`SELECT theme,lg,COUNT(DISTINCT submission_id) n FROM codes ${cf.where} GROUP BY theme,lg`).bind(...cf.b).all()
  const subs = await loadSubs(c, { consented: true })
  const per: any = {}; subs.forEach(s => inc(per, s.lg))
  return c.json({ cells: results, per_lg: per, lgs: (LGS as any[]).map(l => ({ code: l.code, label: l.label, region: l.region })), themes: THEMES.map(t => ({ code: t.code, label: t.label, dim: t.dim })) })
})

app.get('/api/excerpts', async (c) => {
  const cf = codeFilter(c)
  const lim = Math.min(Number(c.req.query('limit') || 40), 200)
  const q = (c.req.query('q') || '').trim().toLowerCase()
  const where = cf.where + (q ? (cf.where ? ' AND' : 'WHERE') + ' LOWER(excerpt) LIKE ?' : '')
  const b = q ? [...cf.b, `%${q}%`] : cf.b
  const { results } = await c.env.DB.prepare(`SELECT id,submission_id sid,source,seg_start,theme,dimension,polarity,evidence,excerpt,lg,region,grp,is_demo FROM codes ${where} ORDER BY LENGTH(excerpt) DESC, id DESC LIMIT ?`).bind(...b, lim).all()
  return c.json({ items: (results as any[]).map(r => ({ ...r, lg_label: lgLabel(r.lg), theme_label: THEME_BY_CODE[r.theme]?.label, field: r.source.replace('field:', ''), q: r.source.startsWith('field:') ? qlabel(null, r.source.slice(6)) : 'Audio transcript' })) })
})

// Perception (rating) vs. documented figures (before/after)
const PAIRS = [
  { rating: 'd3_rating', b: 'e1_stalls_before', a: 'e1_stalls_after', label: 'Market stalls', note: 'D3 gazetted-market use vs E1.3 registered stalls' },
  { rating: 'd4_rating', b: 'e1_licenses_before', a: 'e1_licenses_after', label: 'Trade licences', note: 'D4 licensing vs E1.1 licences issued' },
  { rating: 'd5_rating', b: 'e1_osr_before', a: 'e1_osr_after', label: 'Own-source revenue', note: 'D5 OSR vs E1.2 OSR (UGX)' },
]
app.get('/api/triangulation', async (c) => {
  const subs = (await loadSubs(c, { consented: true })).filter(s => s.grp === 'lg_official')
  const rows: any[] = [], lg: any = {}
  let figs = 0
  for (const s of subs) {
    for (const p of PAIRS) {
      const b = s.answers[p.b], a = s.answers[p.a]; const rating = s.answers[p.rating]
      const L = (lg[s.lg] ||= { lg: s.lg, label: lgLabel(s.lg), region: s.region, n: 0, b: {}, a: {} })
      if (typeof b === 'number' && typeof a === 'number') { L.b[p.label] = (L.b[p.label] || 0) + b; L.a[p.label] = (L.a[p.label] || 0) + a; figs++ }
      if (typeof b !== 'number' || typeof a !== 'number' || b <= 0 || !rating) continue
      const d = (a - b) / b
      let verdict = 'consistent'
      if (rating === 'improved' && d < -0.05) verdict = 'perception better than figures'
      else if (rating === 'worsened' && d > 0.05) verdict = 'perception worse than figures'
      else if (rating === 'no_change' && Math.abs(d) >= 0.2) verdict = 'reported no change; figures moved'
      else if (rating === 'mixed' || rating === 'not_known') verdict = 'not comparable'
      rows.push({ sid: s.id, lg: s.lg, label: lgLabel(s.lg), metric: p.label, note: p.note, rating, before: b, after: a, change: d, verdict, demo: !!s.is_demo, docs: !!(s.texts.e3_documents && s.texts.e3_documents.length > 8) })
    }
  }
  const LGROWS = Object.values<any>(lg).map(L => ({ ...L, change: Object.fromEntries(Object.keys(L.b).map(k => [k, L.b[k] > 0 ? (L.a[k] - L.b[k]) / L.b[k] : null])) }))
  const verd: any = {}; rows.forEach(r => inc(verd, r.verdict))
  return c.json({ rows, lg: LGROWS, verdicts: verd, officials: subs.length, with_figures: figs })
})

// ---------- geography helpers ----------
const UG = { minLat: -1.5, maxLat: 4.3, minLon: 29.5, maxLon: 35.1 }
const inUganda = (lat: number, lon: number) => lat >= UG.minLat && lat <= UG.maxLat && lon >= UG.minLon && lon <= UG.maxLon
function km(a: number, b: number, c2: number, d: number) {
  const r = Math.PI / 180, dl = (c2 - a) * r, dn = (d - b) * r
  const x = Math.sin(dl / 2) ** 2 + Math.cos(a * r) * Math.cos(c2 * r) * Math.sin(dn / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(x))
}
const FAR_KM = 50
function gpsCheck(s: any) {
  if (s.lat == null || s.lon == null) return { has: false, outside: false, far: false, km: null as number | null }
  const outside = !inUganda(s.lat, s.lon)
  const lg = LG_BY[s.lg]
  const d = lg?.lat != null ? Math.round(km(s.lat, s.lon, lg.lat, lg.lon)) : null
  return { has: true, outside, far: !outside && d != null && d > FAR_KM, km: d }
}

// ---------- data quality ----------
export function qualityFlags(s: any, tr: any) {
  const f: { k: string; sev: 'high' | 'med' | 'low'; msg: string }[] = []
  const cons = s.consent_interview !== 'no'
  if (!cons) return f
  const lg = LG_BY[s.lg]
  if (s.duration_sec != null && s.duration_sec < 600) f.push({ k: 'short_duration', sev: 'high', msg: `Interview lasted ${Math.round(s.duration_sec / 60 * 10) / 10} min (<10 min)` })
  if (s.duration_sec != null && s.duration_sec > 4 * 3600) f.push({ k: 'long_duration', sev: 'low', msg: 'Form open > 4 hours (draft left open?)' })
  const texts = Object.entries<string>(s.texts).filter(([k]) => !SKIP_TEXT.has(k) && k !== 'photo_caption').map(([, v]) => v)
  const thin = THIN[s.grp] ?? 60
  if (s.text_words < thin) f.push({ k: 'thin_text', sev: 'high', msg: `Only ${s.text_words} words across all open-ended answers` })
  const junk = texts.filter(t => /(.)\1{2,}/i.test(t) || (t.split(/\s+/).length <= 1 && t.length < 6))
  if (texts.length >= 4 && junk.length / texts.length > 0.5) f.push({ k: 'test_like', sev: 'high', msg: 'Open-ended answers look like test/gibberish input' })
  const dup = texts.filter((t, i) => t.length > 12 && texts.indexOf(t) !== i)
  if (dup.length >= 2) f.push({ k: 'copy_paste', sev: 'med', msg: 'Identical text pasted into several questions' })
  if (lg && s.lg_category && lg.cat !== s.lg_category) f.push({ k: 'category_mismatch', sev: 'med', msg: `Category recorded as "${s.lg_category}" but ${lg.label} is a ${lg.cat.replace('_', ' ')}` })
  if (lg && s.region && lg.region !== s.region) f.push({ k: 'region_mismatch', sev: 'high', msg: `Region "${s.region}" does not match ${lg.label} (${lg.region})` })
  if (s.consent_audio === 'yes' && !s.audio_url) f.push({ k: 'no_audio', sev: 'high', msg: 'Audio consent given but no recording attached' })
  if (s.lat == null) f.push({ k: 'no_gps', sev: 'low', msg: 'No GPS captured' })
  else {
    const g = gpsCheck(s)
    if (g.outside) f.push({ k: 'gps_outside_uganda', sev: 'high', msg: `GPS (${s.lat.toFixed(3)}, ${s.lon.toFixed(3)}) is outside Uganda` })
    else if (g.far) f.push({ k: 'gps_far_from_lg', sev: 'med', msg: `GPS is ${g.km} km from ${lg?.label} (declared local government)` })
  }
  if (s.interview_date && s.submitted_at && s.interview_date > s.submitted_at.slice(0, 10)) f.push({ k: 'future_date', sev: 'med', msg: 'Interview date is after submission date' })
  if (s.grp === 'lg_official') {
    const nb = ['e1_licenses', 'e1_osr', 'e1_stalls'].filter(p => s.answers[p + '_before'] != null && s.answers[p + '_before'] === s.answers[p + '_after']).length
    if (nb === 3) f.push({ k: 'identical_figures', sev: 'low', msg: 'Before/after figures identical for all three indicators' })
  }
  if (tr) {
    const fl = J(tr.flags, []) as string[]
    if (tr.status === 'review') f.push({ k: 'transcript_review', sev: 'high', msg: 'Transcript flagged (' + (fl.join(', ') || 'low quality') + '): needs human review before coding' })
    else if (fl.length) f.push({ k: 'transcript_note', sev: 'low', msg: 'Transcript notes: ' + fl.join(', ') })
  }
  return f
}
app.get('/api/quality', async (c) => {
  const subs = await loadSubs(c)
  const fsm = await formSchemas(c)
  const trs: any = {}; (await c.env.DB.prepare('SELECT submission_id,status,flags,confidence,duration FROM transcripts').all()).results.forEach((t: any) => trs[t.submission_id] = t)
  const enums: any = {}, flagged: any[] = [], counts: any = {}
  for (const s of subs) {
    const f = qualityFlags(s, trs[s.id])
    f.forEach(x => inc(counts, x.k))
    const e = (enums[(s.enumerator_id || '(blank)')] ||= { enumerator: s.enumerator_id || '(blank)', n: 0, dur: [], words: [], audio: 0, flagged: 0, lgs: new Set() })
    if (s.consent_interview === 'no') continue
    e.n++; if (s.duration_sec) e.dur.push(s.duration_sec); e.words.push(s.text_words || 0); if (s.audio_url) e.audio++; if (f.some(x => x.sev === 'high')) e.flagged++; e.lgs.add(s.lg)
    if (f.length) flagged.push({ id: s.id, lg: s.lg, label: whereLabel(s, fsm[s.form_uid]), form: fsm[s.form_uid]?.meta?.code || '', grp: s.grp, enumerator: s.enumerator_id, date: s.interview_date, demo: !!s.is_demo, flags: f, high: f.filter(x => x.sev === 'high').length })
  }
  const enumRows = Object.values<any>(enums).filter(e => e.n).map(e => ({ enumerator: e.enumerator, n: e.n, median_min: e.dur.length ? +(median(e.dur)! / 60).toFixed(1) : null, avg_words: Math.round(mean(e.words) || 0), audio_pct: e.audio / e.n, flagged: e.flagged, lgs: e.lgs.size }))
  flagged.sort((a, b) => b.high - a.high || b.flags.length - a.flags.length)
  const clean = subs.filter(s => s.consent_interview !== 'no').length - flagged.filter(f => f.high > 0).length
  return c.json({ counts, flagged, enumerators: enumRows, total: subs.length, clean_pct: subs.length ? clean / subs.length : null })
})

app.get('/api/interviews', async (c) => {
  const subs = await loadSubs(c)
  const fsm = await formSchemas(c)
  const trs: any = {}; (await c.env.DB.prepare('SELECT submission_id,status,confidence,duration,flags FROM transcripts').all()).results.forEach((t: any) => trs[t.submission_id] = t)
  const cc: any = {}; (await c.env.DB.prepare('SELECT submission_id sid,COUNT(*) n FROM codes GROUP BY submission_id').all()).results.forEach((r: any) => cc[r.sid] = r.n)
  return c.json({ items: subs.slice().reverse().map(s => ({ id: s.id, lg: s.lg, label: whereLabel(s, fsm[s.form_uid]), form: fsm[s.form_uid]?.meta?.code || '', form_name: shortName(fsm[s.form_uid]?.name || ''), region: s.region, grp: s.grp, affiliation: s.affiliation, date: s.interview_date, duration_sec: s.duration_sec, enumerator: s.enumerator_id,
    consent: s.consent_interview, audio: s.audio_status, has_audio: !!s.audio_url, words: s.text_words, codes: cc[s.id] || 0, demo: !!s.is_demo, flags: qualityFlags(s, trs[s.id]).filter(f => f.sev === 'high').length, tr_conf: trs[s.id]?.confidence ?? null })) })
})
app.get('/api/interview/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const r: any = await c.env.DB.prepare('SELECT * FROM submissions WHERE id=?').bind(id).first()
  if (!r) return c.json({ error: 'not found' }, 404)
  const s = { ...r, answers: J(r.answers, {}), texts: J(r.texts, {}) }
  const t: any = await c.env.DB.prepare('SELECT * FROM transcripts WHERE submission_id=?').bind(id).first()
  const codes = (await c.env.DB.prepare('SELECT source,seg_start,theme,polarity,evidence,excerpt FROM codes WHERE submission_id=? ORDER BY source,id').bind(id).all()).results
  const fs = (await formSchemas(c))[s.form_uid]
  const order = fs?.order || []
  const closed = Object.entries<any>(s.answers).filter(([k]) => fs?.q[k] && !SKIP_TEXT.has(k) && fs.q[k].t !== 'geopoint').sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([k, v]) => ({ k, q: qlabel(fs, k), section: fs!.q[k].sec, v: fs!.q[k].list ? split(String(v)).map((x: string) => fs!.ch[fs!.q[k].list]?.[x] || x).join('; ') : v }))
  const texts = Object.entries<string>(s.texts).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([k, v]) => ({ k, q: fs?.q[k]?.l || k, section: fs?.q[k]?.sec || '', v }))
  return c.json({
    id, lg: s.lg, label: whereLabel(s, fs), form: fs?.meta?.code || '', form_name: shortName(fs?.name || ''), region: s.region, grp: s.grp, affiliation: s.affiliation, date: s.interview_date, duration_sec: s.duration_sec, enumerator: s.enumerator_id,
    consent: s.consent_interview, consent_audio: s.consent_audio, audio_status: s.audio_status, has_audio: !!s.audio_url, demo: !!s.is_demo, photos: s.photo_count, lat: s.lat, lon: s.lon,
    closed, texts, codes: codes.map((x: any) => ({ ...x, theme_label: THEME_BY_CODE[x.theme]?.label })),
    transcript: t ? { text: t.text, segments: J(t.segments, []), language: t.language, model: t.model, engine: t.engine, confidence: t.confidence, status: t.status, flags: J(t.flags, []), duration: t.duration, error: t.error } : null,
    flags: qualityFlags(s, t),
  })
})

async function emergentData(c: any) {
  const subs = await loadSubs(c, { consented: true })
  const docs: { text: string; grp: string }[] = subs.map(s => ({ text: Object.entries<string>(s.texts).filter(([k]) => !SKIP_TEXT.has(k) && k !== 'photo_caption').map(([, v]) => v).join(' '), grp: side(s.grp) }))
  const ids = new Map(subs.map((s, i) => [s.id, i]))
  const tr = (await c.env.DB.prepare("SELECT submission_id,text FROM transcripts WHERE status='done'").all()).results as any[]
  tr.forEach(t => { const i = ids.get(t.submission_id); if (i !== undefined) docs[i].text += ' ' + t.text })
  return { terms: emergentTerms(docs.filter(d => d.text.length > 20), 70), n: docs.length }
}
app.get('/api/emergent', async (c) => c.json(await emergentData(c)))
app.get('/api/codebook', (c) => c.json({ dimensions: DIMENSIONS, objectives: OBJECTIVES, themes: THEMES.map(t => ({ code: t.code, label: t.label, dim: t.dim, keywords: t.kw })) }))

const csv = (rows: any[][]) => rows.map(r => r.map(x => { const s = x == null ? '' : String(x); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }).join(',')).join('\n')
app.get('/api/export/codes.csv', async (c) => {
  const cf = codeFilter(c)
  const { results } = await c.env.DB.prepare(`SELECT submission_id,source,seg_start,theme,dimension,objective,polarity,evidence,excerpt,lg,region,grp,is_demo FROM codes ${cf.where} ORDER BY submission_id,id`).bind(...cf.b).all()
  const rows: any[][] = [['submission_id', 'source', 'audio_start_sec', 'theme_code', 'theme', 'dimension', 'tor_objective', 'polarity', 'evidence_label', 'excerpt', 'local_government', 'region', 'respondent_group', 'is_demo']]
  ;(results as any[]).forEach(r => rows.push([r.submission_id, r.source, r.seg_start, r.theme, THEME_BY_CODE[r.theme]?.label, r.dimension, r.objective, r.polarity, r.evidence, r.excerpt, lgLabel(r.lg), r.region, r.grp, r.is_demo]))
  return new Response(csv(rows), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="evidence_matrix_codes.csv"' } })
})
app.get('/api/export/submissions.csv', async (c) => {
  const fsm = await formSchemas(c)
  const all = await loadSubs(c)
  const count: any = {}; all.forEach(x => inc(count, x.form_uid))
  const uid = c.req.query('form') || Object.keys(count).sort((a, b) => count[b] - count[a])[0]
  const fs = fsm[uid]; const subs = all.filter(x => x.form_uid === uid)
  const keys = (fs?.order || []).filter(k => fs.q[k] && ['select_one', 'select_multiple', 'integer', 'decimal', 'date'].includes(fs.q[k].t) && !QEXCL.has(k) && k !== 'interview_date')
  const rows: any[][] = [['id', 'form', 'local_government', 'region', 'group', 'affiliation', 'interview_date', 'duration_min', 'enumerator', 'consent', 'audio_status', 'text_words', ...keys]]
  subs.forEach(s => rows.push([s.id, fs?.meta?.code, s.lg ? lgLabel(s.lg) : '', s.region, s.grp, s.affiliation, s.interview_date, s.duration_sec ? Math.round(s.duration_sec / 6) / 10 : '', s.enumerator_id, s.consent_interview, s.audio_status, s.text_words,
    ...keys.map(k => { const v = s.answers[k]; if (v == null) return ''; const l = fs.q[k].list; return l ? split(String(v)).map((x: string) => fs.ch[l]?.[x] || x).join('; ') : v })]))
  return new Response(csv(rows), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="submissions_${fs?.meta?.code || 'form'}.csv"` } })
})

// ---------- map (GPS of interviews) ----------
app.get('/api/map', async (c) => {
  const subs = await loadSubs(c)
  const fsm = await formSchemas(c)
  const trs: any = {}; (await c.env.DB.prepare('SELECT submission_id,status,flags,confidence,duration FROM transcripts').all()).results.forEach((t: any) => trs[t.submission_id] = t)
  const points: any[] = [], missing: any[] = []
  const per: any = {}
  for (const s of subs) {
    const g = gpsCheck(s)
    const base = { id: s.id, form: fsm[s.form_uid]?.meta?.code || '', form_name: shortName(fsm[s.form_uid]?.name || ''), grp: s.grp, lg: s.lg, label: whereLabel(s, fsm[s.form_uid]), date: s.interview_date, enumerator: s.enumerator_id, consent: s.consent_interview, audio: s.audio_status }
    if (!g.has) { missing.push(base); continue }
    const acc = Number(String(s.answers?.interview_gps || '').split(/\s+/)[3])
    points.push({ ...base, lat: s.lat, lon: s.lon, accuracy: Number.isFinite(acc) ? acc : null, outside: g.outside, far: g.far, km_from_lg: g.km })
    if (s.lg) inc(per, s.lg)
  }
  const nAll = subs.filter(s => s.lg).length
  const lgs = (LGS as any[]).map(l => ({ code: l.code, label: l.label, region: l.region, cat: l.cat, lat: l.lat, lon: l.lon, n: subs.filter(s => s.lg === l.code && s.consent_interview !== 'no').length, with_gps: per[l.code] || 0 }))
  return c.json({
    points, missing, lgs,
    summary: { total: subs.length, with_gps: points.length, without_gps: missing.length, outside_uganda: points.filter(p => p.outside).length, far_from_lg: points.filter(p => p.far).length, lg_declared: nAll },
    bounds: UG, far_km: FAR_KM,
  })
})

// ---------- report ----------
const refOf = (fsm: Record<string, FS>, s: any) => `${fsm[s.form_uid]?.meta?.code || 'X'}-${s.id}`
const P = (n: number, d: number) => d ? Math.round(100 * n / d) + '%' : '0%'

function pickQuotes(list: any[], byId: Map<number, any>, n = 4) {
  const key = (r: any) => r.excerpt.slice(0, 60).toLowerCase()
  const score = (r: any) => { const L = r.excerpt.length; return (L >= 120 && L <= 420 ? 2 : L >= 70 ? 1 : 0) }
  const sorted = list.filter(r => r.excerpt.length >= 50).sort((a, b) => score(b) - score(a) || b.excerpt.length - a.excerpt.length)
  const out: any[] = [], subs = new Set<number>(), seen = new Set<string>()
  const take = (r: any) => { out.push(r); subs.add(r.sid); seen.add(key(r)) }
  for (const r of sorted) { if (out.length >= n) break; if (!subs.has(r.sid) && !seen.has(key(r))) take(r) }
  // make sure the trader-side voice is present when it exists
  if (out.length && !out.some(r => side(byId.get(r.sid)?.grp) === 'trader')) {
    const t = sorted.find(r => side(byId.get(r.sid)?.grp) === 'trader' && !seen.has(key(r)))
    if (t) out[out.length - 1] = t
  }
  return out
}

function themeNarrative(t: any, nAll: number, nOff: number, nTrd: number) {
  const pol = Object.entries<number>(t.polarity || {}).sort((a, b) => b[1] - a[1])
  const totPol = pol.reduce((a, [, v]) => a + v, 0)
  const parts: string[] = []
  parts.push(`${t.label} was raised in ${t.interviews} of ${nAll} interview${nAll === 1 ? '' : 's'} (${P(t.interviews, nAll)}) across ${t.lgs} local government${t.lgs === 1 ? '' : 's'}.`)
  if (nOff && nTrd) {
    parts.push(`Official-side respondents: ${t.officials}/${nOff} (${P(t.officials, nOff)}); trader-side respondents: ${t.traders}/${nTrd} (${P(t.traders, nTrd)}).`)
    if (Math.abs(t.divergence) >= 0.25) parts.push(`This theme is raised notably more often by ${t.divergence > 0 ? 'officials' : 'traders'}, a perception gap worth probing.`)
  }
  if (totPol) parts.push(`Tone of coded passages: ${pol.map(([k, v]) => `${v} ${k}`).join(', ')}.`)
  const ev = Object.entries<number>(t.evidence || {}).map(([k, v]) => `${v} ${k}`).join(', ')
  if (ev) parts.push(`Evidence basis: ${ev}.`)
  if (t.interviews < 5) parts.push(`Based on fewer than five interviews, so treat as indicative only.`)
  return parts.join(' ')
}

app.get('/api/report', async (c) => {
  const fsm = await formSchemas(c)
  const allSubs = await loadSubs(c)
  const subs = allSubs.filter(s => s.consent_interview !== 'no')
  const byId = new Map(subs.map(s => [s.id, s]))
  const th = await themeStats(c)
  const em = await emergentData(c)
  const cf = codeFilter(c)
  const codes = (await c.env.DB.prepare(`SELECT submission_id sid,source,seg_start,theme,polarity,evidence,excerpt FROM codes ${cf.where} ORDER BY id`).bind(...cf.b).all()).results as any[]
  const per: Record<string, any[]> = {}; codes.forEach(r => { if (r.evidence !== 'inferred') (per[r.theme] ||= []).push(r) })
  const trAll: any = {}; (await c.env.DB.prepare('SELECT submission_id,status,flags,confidence,duration,model FROM transcripts').all()).results.forEach((t: any) => trAll[t.submission_id] = t)
  const nAll = subs.length, nOff = th.n_off, nTrd = th.n_trd

  const quote = (r: any) => {
    const s = byId.get(r.sid)
    return { text: r.excerpt, ref: s ? refOf(fsm, s) : String(r.sid), sid: r.sid, source: r.source === 'audio' ? 'audio' : 'typed', q: r.source.startsWith('field:') ? qlabel(fsm[s?.form_uid], r.source.slice(6)) : 'Audio transcript', t: r.seg_start, group: GROUP_LABELS[s?.grp] || s?.grp || '', where: s ? whereLabel(s, fsm[s.form_uid]) : '', evidence: r.evidence, polarity: r.polarity }
  }
  const themeBy: Record<string, any> = Object.fromEntries(th.themes.map((t: any) => [t.theme, t]))
  const objectives = OBJECTIVES.map(o => ({
    id: o.id, label: o.label,
    dimensions: DIMENSIONS.filter(d => d.obj === o.id).map(d => {
      const ts = THEMES.filter(t => t.dim === d.id).map(t => {
        const st = themeBy[t.code]
        if (!st) return { code: t.code, label: t.label, interviews: 0, quotes: [], lit: (THEME_LIT[t.code] || []) }
        return { ...st, code: t.code, narrative: themeNarrative(st, nAll, nOff, nTrd), quotes: pickQuotes(per[t.code] || [], byId).map(quote), lit: THEME_LIT[t.code] || [] }
      }).sort((a: any, b: any) => b.interviews - a.interviews)
      const dd = th.dimensions.find((x: any) => x.id === d.id)
      return { id: d.id, label: d.label, color: d.color, interviews: dd?.interviews || 0, mentions: dd?.mentions || 0, themes: ts }
    }),
  }))

  // evidence base
  const formsOut = Object.values(fsm).map(f => {
    const fsubs = allSubs.filter(s => s.form_uid === f.uid), fc = fsubs.filter(s => s.consent_interview !== 'no')
    const a: any = {}; fsubs.forEach(s => inc(a, s.audio_status))
    return { code: f.meta.code || '', name: shortName(f.name), group: GROUP_LABELS[f.meta.group] || f.meta.group || '', kind: f.kind, submissions: fsubs.length, consented: fc.length, declined: fsubs.length - fc.length, audio: a, words: fc.reduce((x, s) => x + (s.text_words || 0), 0) }
  }).filter(f => f.submissions || true)
  const trList = Object.values<any>(trAll).filter(t => byId.has(t.submission_id))
  const lgSet = new Set(subs.map(s => s.lg).filter(Boolean))
  const caveats: string[] = []
  const nReview = trList.filter(t => t.status === 'review').length
  if (nReview) caveats.push(`${nReview} audio transcript${nReview === 1 ? ' is' : 's are'} held in "Needs review" (low confidence, repetition or almost no speech) and ${nReview === 1 ? 'is' : 'are'} NOT coded into the themes until accepted by a person. They are still reproduced in Appendix B for transparency.`)
  const silent = trList.filter(t => (JSON.parse(t.flags || '[]') as string[]).includes('little_speech')).length
  if (silent) caveats.push(`${silent} recording${silent === 1 ? '' : 's'} contained little or no speech (possible microphone or consent-to-record problem).`)
  const noAudio = subs.filter(s => s.consent_audio === 'yes' && !s.audio_url).length
  if (noAudio) caveats.push(`${noAudio} interview${noAudio === 1 ? '' : 's'} with audio consent have no usable recording attached.`)
  const gOut = subs.filter(s => gpsCheck(s).outside).length
  if (gOut) caveats.push(`${gOut} submission${gOut === 1 ? ' has' : 's have'} GPS coordinates outside Uganda (likely test records or a wrong device location).`)
  const declined = allSubs.length - subs.length
  if (declined) caveats.push(`${declined} submission${declined === 1 ? ' was' : 's were'} excluded because the respondent declined consent.`)
  const noLg = subs.filter(s => !s.lg && s.grp !== 'national').length
  if (noLg) caveats.push(`${noLg} consented submission${noLg === 1 ? ' has' : 's have'} no local government recorded.`)
  caveats.push('Coding is keyword- and field-based (rule-driven), not human-coded: every theme and tone label is a candidate coding to be verified by the analyst. Speech-to-text accuracy on accented English and local languages has not yet been validated.')
  if (nAll < 20) caveats.push(`Only ${nAll} interview${nAll === 1 ? '' : 's'} so far: percentages are indicative and cannot support comparisons between local governments.`)

  const ranked = [...th.themes]
  const top = ranked.slice(0, 5)
  const split = [...ranked].filter(t => nOff && nTrd && (t.officials || t.traders)).sort((a, b) => Math.abs(b.divergence) - Math.abs(a.divergence)).filter(t => Math.abs(t.divergence) >= 0.25).slice(0, 4)
  const neg = [...ranked].filter(t => (t.polarity.negative || 0) > (t.polarity.positive || 0) && t.interviews >= 1).sort((a, b) => (b.polarity.negative || 0) - (a.polarity.negative || 0)).slice(0, 4)
  const exec: string[] = []
  exec.push(`This draft synthesises ${nAll} consented interview${nAll === 1 ? '' : 's'}/FGD${nAll === 1 ? '' : 's'} from ${lgSet.size} of ${LGS.length} local governments (${formsOut.filter(f => f.consented).map(f => `${f.consented} ${f.code}`).join(', ')}), covering ${th.themes.length} of ${THEMES.length} codebook themes.`)
  if (top.length) exec.push(`Most frequently raised: ${top.map(t => `${t.label} (${P(t.interviews, nAll)})`).join('; ')}.`)
  if (neg.length) exec.push(`Predominantly negative or critical tone: ${neg.map(t => t.label).join('; ')}.`)
  if (split.length) exec.push(`Largest official-vs-trader perception gaps: ${split.map(t => `${t.label} (${t.divergence > 0 ? 'officials' : 'traders'} ${P(Math.max(t.pct_off, t.pct_trd), 1)} vs ${P(Math.min(t.pct_off, t.pct_trd), 1)})`).join('; ')}.`)

  const coverage = { lgs_covered: lgSet.size, lgs_total: LGS.length, by_lg: Object.entries(subs.reduce((a: any, s) => (s.lg && (a[s.lg] = (a[s.lg] || 0) + 1), a), {})).map(([k, v]) => ({ lg: k, label: lgLabel(k), n: v })).sort((a: any, b: any) => b.n - a.n) }
  const refs = (LIT as any[]).map(r => ({ n: r.n, cat: r.cat, text: r.text }))
  const sources = [...subs].sort((a, b) => a.id - b.id).map(s => ({ ref: refOf(fsm, s), id: s.id, form: fsm[s.form_uid]?.meta?.code || '', where: whereLabel(s, fsm[s.form_uid]), group: GROUP_LABELS[s.grp] || s.grp, date: s.interview_date, audio: trAll[s.id]?.status || s.audio_status, words: s.text_words }))
  const grpCount: any = {}; subs.forEach(s => inc(grpCount, GROUP_LABELS[s.grp] || s.grp))
  return c.json({
    generated: new Date().toISOString(), scope: { region: c.req.query('region') || '', lg: c.req.query('lg') || '', grp: c.req.query('grp') || '' },
    n: nAll, n_officials: nOff, n_traders: nTrd, group_counts: grpCount, executive: exec, caveats, forms: formsOut, coverage,
    charts: { themes: ranked.slice(0, 12).map(t => ({ label: t.label, interviews: t.interviews, pct: t.pct, off: t.pct_off, trd: t.pct_trd, dim: t.dimension })), dimensions: th.dimensions.map((d: any) => ({ label: d.label, color: d.color, interviews: d.interviews, mentions: d.mentions })), polarity: th.polarity, evidence: th.evidence },
    objectives, emergent: em.terms.slice(0, 20), references: refs, sources, objectives_labels: OBJECTIVES,
  })
})

app.get('/api/report/appendix', async (c) => {
  const fsm = await formSchemas(c)
  const subs = (await loadSubs(c, { consented: true })).sort((a, b) => a.id - b.id)
  const trs: any = {}; (await c.env.DB.prepare('SELECT * FROM transcripts').all()).results.forEach((t: any) => trs[t.submission_id] = t)
  const items = subs.map(s => {
    const fs = fsm[s.form_uid]; const order = fs?.order || []
    const texts = Object.entries<string>(s.texts).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([k, v]) => ({ section: (fs?.q[k]?.sec || '').replace(/^Section\s+/, ''), q: (fs?.q[k]?.l || k).replace(/\s*\(.*$/, ''), v: anonymise(v) }))
    const closed = Object.entries<any>(s.answers).filter(([k]) => fs?.q[k] && !SKIP_TEXT.has(k) && fs.q[k].t !== 'geopoint').sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
      .map(([k, v]) => ({ section: (fs!.q[k].sec || '').replace(/^Section\s+/, ''), q: qlabel(fs, k), v: fs!.q[k].list ? split(String(v)).map((x: string) => fs!.ch[fs!.q[k].list]?.[x] || x).join('; ') : String(v) }))
    const t = trs[s.id]
    return {
      ref: refOf(fsm, s), id: s.id, form: fs?.meta?.code || '', form_name: shortName(fs?.name || ''), where: whereLabel(s, fs), group: GROUP_LABELS[s.grp] || s.grp, date: s.interview_date, duration_min: s.duration_sec ? Math.round(s.duration_sec / 6) / 10 : null,
      words: s.text_words, texts, closed,
      transcript: t && t.status !== 'rejected' ? { status: t.status, model: t.model, language: t.language, confidence: t.confidence, flags: J(t.flags, []), duration: t.duration, segments: (J(t.segments, []) as any[]).map(x => ({ start: x.start, text: anonymise(x.text) })) } : null,
    }
  })
  return c.json({ items, totals: { typed_answers: items.reduce((a, x) => a + x.texts.length, 0), transcripts: items.filter(x => x.transcript?.segments.length).length, words: items.reduce((a, x) => a + x.words, 0) } })
})
