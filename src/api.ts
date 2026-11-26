import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { Env, forms, fetchAsset, fetchAllData, normalise, buildSchema, koboHeaders } from './kobo'
import { THEMES, THEME_BY_CODE, DIMENSIONS, OBJECTIVES, codeItems, emergentTerms, SKIP_TEXT, anonymise } from './codebook'
import SCHEMA from './schema.json'
import LGS from './lgs.json'
import LIT from './literature.json'
import { THEME_LIT } from './report'
import { ensureSchema } from './schema'
import { FORM_TARGETS, TARGET_BY_CODE, targetTotal, enumKey, enumLooksValid, FLAG_INFO, crossFlags, Flag } from './field'

const S: any = SCHEMA
export const app = new Hono<{ Bindings: Env }>()
app.use('/api/*', cors())
app.use('/api/*', async (c, next) => { await ensureSchema(c.env.DB); await next() })
app.onError((e, c) => { console.error(e); return c.json({ error: String((e as any)?.message || e).slice(0, 300) }, 500) })

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
const TRADER_GRP = new Set(['street_vendor_not_relocated', 'trader_association', 'fgd_informal_traders', 'fgd_formal_traders', 'trader'])
const side = (g: string) => (TRADER_GRP.has(g) || String(g || '').startsWith('fgd') ? 'trader' : 'official')
const THIN: Record<string, number> = { lg_official: 80, lg_political_enforcement: 80, national: 80, market_administrator: 60, street_vendor_not_relocated: 15, trader_association: 15, fgd_informal_traders: 100, fgd_formal_traders: 100 }

// ---------- auth for write endpoints ----------
const admin = async (c: any, next: any) => {
  const key = c.req.header('x-admin-key') || ''
  if (!c.env.INGEST_TOKEN || key !== c.env.INGEST_TOKEN) return c.json({ error: 'Admin key required (x-admin-key)' }, 401)
  await next()
}

// ---------- shared loaders ----------
type Sub = any
async function loadSubs(c: any, opts: { consented?: boolean; all?: boolean; raw?: boolean } = {}): Promise<Sub[]> {
  const { results } = await c.env.DB.prepare(`SELECT s.*, json_extract(f.schema,'$.meta.code') AS code FROM submissions s LEFT JOIN forms f ON f.uid=s.form_uid ORDER BY s.id`).all()
  const region = opts.raw ? '' : c.req.query('region'), lg = opts.raw ? '' : c.req.query('lg'), grp = opts.raw ? '' : c.req.query('grp')
  return results.filter((s: any) => (!region || s.region === region) && (!lg || s.lg === lg) && (!grp || s.grp === grp)
    && (opts.all || s.field_status !== 'test')
    && (!opts.consented || s.consent_interview !== 'no'))
    .map((s: any) => ({ ...s, code: s.code || '', answers: J(s.answers, {}), texts: J(s.texts, {}) }))
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
// Recordings stuck in "processing" (worker crashed / machine switched off) go back to the queue after 30 min
async function recoverStale(c: any) {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  const { results } = await c.env.DB.prepare(`SELECT s.id FROM submissions s LEFT JOIN meta m ON m.key='claim:'||s.id WHERE s.audio_status='processing' AND (m.value IS NULL OR m.value < ?)`).bind(cutoff).all()
  if (!results.length) return 0
  await c.env.DB.batch((results as any[]).flatMap(r => [c.env.DB.prepare("UPDATE submissions SET audio_status='pending' WHERE id=?").bind(r.id), c.env.DB.prepare('DELETE FROM meta WHERE key=?').bind('claim:' + r.id)]))
  return results.length
}
// Queue order: recordings whose typed notes are thinnest come first (the audio adds the most there), then oldest
const queueRows = async (c: any, statuses: string[], ids: number[] = []) => {
  const ph = statuses.map(() => '?').join(',')
  const rows = (await c.env.DB.prepare(`SELECT id,audio_url,audio_name,lg,grp,text_words,duration_sec,audio_status,consent_audio FROM submissions WHERE is_demo=0 AND field_status!='test' AND consent_interview!='no' AND audio_url IS NOT NULL AND audio_status IN (${ph})`).bind(...statuses).all()).results as any[]
  const list = ids.length ? rows.filter(r => ids.includes(r.id)) : rows
  return list.map(r => ({ ...r, gap: Math.max(0, (THIN[r.grp] ?? 60) - (r.text_words || 0)) })).sort((a, b) => b.gap - a.gap || a.id - b.id)
}
app.get('/api/pipeline/pending', admin, async (c) => {
  await recoverStale(c)
  const lim = Math.min(Number(c.req.query('limit') || 20), 100)
  const ids = (c.req.query('ids') || '').split(',').map(Number).filter(Boolean)
  const rows = await queueRows(c, ids.length ? ['pending', 'failed', 'review', 'done', 'rejected'] : ['pending', 'failed'], ids)
  return c.json({ items: rows.slice(0, lim).map(r => ({ id: r.id, audio_url: r.audio_url, audio_name: r.audio_name, lg: r.lg, grp: r.grp, text_words: r.text_words, duration_sec: r.duration_sec })) })
})
// Atomic claim so two workers (or two runs) never transcribe the same recording
app.post('/api/pipeline/claim', admin, async (c) => {
  const b = await c.req.json(); const id = Number(b.id)
  const r = await c.env.DB.prepare(`UPDATE submissions SET audio_status='processing' WHERE id=? AND (audio_status IN ('pending','failed') OR ?=1)`).bind(id, b.force ? 1 : 0).run()
  const ok = (r.meta?.changes || 0) > 0
  if (ok) await c.env.DB.prepare(`INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind('claim:' + id, new Date().toISOString()).run()
  return c.json({ claimed: ok })
})
app.post('/api/pipeline/heartbeat', admin, async (c) => {
  const b = await c.req.json(); const host = String(b.host || 'worker').slice(0, 60)
  await c.env.DB.prepare(`INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind('worker:' + host, JSON.stringify({ ...b, host, seen: new Date().toISOString() })).run()
  if (b.current?.id) await c.env.DB.prepare(`INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind('claim:' + b.current.id, new Date().toISOString()).run()
  return c.json({ ok: true })
})
app.post('/api/pipeline/status', admin, async (c) => {
  const b = await c.req.json()
  await c.env.DB.prepare('DELETE FROM meta WHERE key=?').bind('claim:' + b.id).run()
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
  st.push(c.env.DB.prepare('DELETE FROM meta WHERE key=?').bind('claim:' + s.id))
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
    await c.env.DB.batch([c.env.DB.prepare("UPDATE submissions SET audio_status='pending' WHERE id=?").bind(id), c.env.DB.prepare("UPDATE transcripts SET status='pending' WHERE submission_id=?").bind(id), c.env.DB.prepare("DELETE FROM codes WHERE submission_id=? AND source='audio'").bind(id)])
  } else return c.json({ error: 'bad action' }, 400)
  return c.json({ ok: true })
})

// ---------- Transcription view: worker status, priority queue, how much the audio adds ----------
const wc = (t: string) => (String(t || '').trim().match(/\S+/g) || []).length
app.get('/api/transcription', async (c) => {
  const recovered = await recoverStale(c)
  const subs = (await loadSubs(c, { consented: true, raw: true })).filter((s: any) => s.audio_url || s.consent_audio === 'yes')
  const fsm = await formSchemas(c)
  const trs: any = {}; (await c.env.DB.prepare(`SELECT submission_id,status,model,confidence,duration,flags,language,created_at,error,LENGTH(TRIM(COALESCE(text,'')))-LENGTH(REPLACE(TRIM(COALESCE(text,'')),' ',''))+1 AS words FROM transcripts`).all()).results.forEach((t: any) => trs[t.submission_id] = t)
  const claims: any = {}; (await c.env.DB.prepare("SELECT key,value FROM meta WHERE key LIKE 'claim:%'").all()).results.forEach((r: any) => claims[r.key.slice(6)] = r.value)
  const wk = (await c.env.DB.prepare("SELECT value FROM meta WHERE key LIKE 'worker:%'").all()).results.map((r: any) => J(r.value, null)).filter(Boolean)
    .map((w: any) => ({ ...w, age_s: Math.round((Date.now() - Date.parse(w.seen)) / 1000) })).sort((a: any, b: any) => a.age_s - b.age_s)
  const items = subs.map((s: any) => {
    const t = trs[s.id]; const gap = Math.max(0, (THIN[s.grp] ?? 60) - (s.text_words || 0))
    const spoken = t && (t.status === 'done' || t.status === 'review') ? t.words || 0 : null
    return { id: s.id, form: s.code, form_name: shortName(fsm[s.form_uid]?.name || ''), lg: s.lg, label: whereLabel(s, fsm[s.form_uid]), enumerator: s.enumerator_id, ekey: enumKey(s.enumerator_id), date: s.interview_date, grp: s.grp,
      status: s.audio_url ? s.audio_status : 'missing', session_min: s.duration_sec ? Math.round(s.duration_sec / 6) / 10 : null, typed_words: s.text_words || 0, thin_at: THIN[s.grp] ?? 60, gap, spoken_words: spoken,
      audio_min: t?.duration ? Math.round(t.duration / 6) / 10 : null, conf: t?.confidence ?? null, model: t?.model || null, language: t?.language || null, flags: J(t?.flags, []), error: t?.status === 'failed' ? t.error : null, done_at: t?.created_at || null,
      claimed: s.audio_status === 'processing' ? claims[s.id] || null : null }
  })
  const tot: any = { expected: items.length, uploaded: 0, missing: 0, pending: 0, processing: 0, done: 0, review: 0, rejected: 0, failed: 0, typed_words_done: 0, spoken_words_done: 0, audio_min_total: 0, audio_min_left: 0 }
  for (const i of items) {
    if (i.status === 'missing') { tot.missing++; continue }
    tot.uploaded++; if (tot[i.status] != null) tot[i.status]++
    if (i.spoken_words != null) { tot.typed_words_done += i.typed_words; tot.spoken_words_done += i.spoken_words }
    const m = i.audio_min ?? i.session_min ?? 0; tot.audio_min_total += m; if (['pending', 'failed', 'processing'].includes(i.status)) tot.audio_min_left += i.session_min ?? 30
  }
  tot.gain_x = tot.typed_words_done ? +(tot.spoken_words_done / tot.typed_words_done).toFixed(1) : null
  const online = wk.find((w: any) => w.age_s < 90) || null
  const rtf = online?.rtf || wk[0]?.rtf || null
  const queue = items.filter((i: any) => ['pending', 'failed'].includes(i.status)).sort((a: any, b: any) => b.gap - a.gap || a.id - b.id)
  return c.json({ workers: wk, online: !!online, recovered, totals: tot, eta_min: rtf && tot.audio_min_left ? Math.round(tot.audio_min_left * rtf) : null, rtf, items, queue_ids: queue.map((i: any) => i.id),
    thin_waiting: queue.filter((i: any) => i.gap > 0).length })
})
// Full-text search across spoken (accepted or in-review) transcripts and typed answers
app.get('/api/search', async (c) => {
  const q = (c.req.query('q') || '').trim().toLowerCase(); if (q.length < 3) return c.json({ q, hits: [] })
  const subs = await loadSubs(c, { consented: true }); const fsm = await formSchemas(c)
  const trs: any = {}; (await c.env.DB.prepare("SELECT submission_id,segments,status FROM transcripts WHERE status IN ('done','review')").all()).results.forEach((t: any) => trs[t.submission_id] = t)
  const hits: any[] = []
  const snip = (t: string) => { const i = t.toLowerCase().indexOf(q); return (i > 60 ? '…' : '') + t.slice(Math.max(0, i - 60), i + q.length + 140) + (t.length > i + q.length + 140 ? '…' : '') }
  for (const s of subs) {
    const base = { id: s.id, form: s.code, label: whereLabel(s, fsm[s.form_uid]), enumerator: s.enumerator_id }
    for (const [k, v] of Object.entries<string>(s.texts)) if (!SKIP_TEXT.has(k) && v.toLowerCase().includes(q)) hits.push({ ...base, source: 'typed', where: qlabel(fsm[s.form_uid], k), text: snip(anonymise(v)) })
    const t = trs[s.id]; if (t) for (const g of J(t.segments, []) as any[]) if (String(g.text).toLowerCase().includes(q)) hits.push({ ...base, source: 'spoken' + (t.status === 'review' ? ' (unreviewed)' : ''), where: 'at ' + Math.floor(g.start / 60) + ':' + String(Math.floor(g.start % 60)).padStart(2, '0'), text: snip(anonymise(String(g.text))) })
    if (hits.length > 200) break
  }
  return c.json({ q, n: hits.length, hits: hits.slice(0, 120) })
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
const GROUP_LABELS: Record<string, string> = { lg_official: 'LG officials', lg_political_enforcement: 'Political & enforcement', street_vendor_not_relocated: 'Vendors not relocated', trader_association: 'Vendors not relocated', national: 'National stakeholders', market_administrator: 'Market administrators', fgd_informal_traders: 'FGD: informal vendors', fgd_formal_traders: 'FGD: formal traders' }
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
    targets: FORM_TARGETS, target_total: targetTotal(LGS.length),
    groups: GROUP_LABELS, flag_info: FLAG_INFO,
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
  const f: Flag[] = []
  const cons = s.consent_interview !== 'no'
  if (!cons) return f
  const lg = LG_BY[s.lg]
  const minMin = TARGET_BY_CODE[s.code]?.min_min ?? 10
  if (s.duration_sec != null && s.duration_sec < minMin * 60) f.push({ k: 'short_duration', sev: 'high', msg: `Session lasted ${Math.round(s.duration_sec / 60 * 10) / 10} min (expected at least ${minMin} min for this form)` })
  if (!s.lg && s.grp !== 'national') f.push({ k: 'no_lg', sev: 'high', msg: 'No local government recorded: cannot be counted toward any LG target' })
  if (!enumLooksValid(s.enumerator_id)) f.push({ k: 'bad_enumerator_id', sev: 'med', msg: `Enumerator ID "${s.enumerator_id || ''}" is not in a usable format (expected e.g. 042 or TAB-042)` })
  if (s.interview_date && s.started_at) { const d = Math.abs((Date.parse(s.interview_date) - Date.parse(s.started_at.slice(0, 10))) / 864e5); if (d >= 2) f.push({ k: 'date_mismatch', sev: 'low', msg: `Interview date ${s.interview_date} but the form was started on ${s.started_at.slice(0, 10)}` }) }
  if (s.duration_sec != null && s.duration_sec > 4 * 3600) f.push({ k: 'long_duration', sev: 'low', msg: 'Form open > 4 hours (draft left open?)' })
  const texts = Object.entries<string>(s.texts).filter(([k]) => !SKIP_TEXT.has(k) && k !== 'photo_caption').map(([, v]) => v)
  const thin = THIN[s.grp] ?? 60
  if (s.text_words < thin) {
    if (tr?.status === 'done' && (tr.words || 0) >= Math.max(150, thin * 3)) f.push({ k: 'thin_text', sev: 'low', msg: `Typed notes are thin (${s.text_words} words) but the accepted transcript adds ${tr.words} spoken words` })
    else f.push({ k: 'thin_text', sev: 'high', msg: `Only ${s.text_words} words across all open-ended answers${s.audio_url ? ' (recording not yet transcribed: transcribing it will recover the detail)' : ''}` })
  }
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
    if (tr.duration && s.duration_sec && s.duration_sec >= 900 && s.duration_sec <= 7200 && tr.duration < 0.3 * s.duration_sec) f.push({ k: 'audio_short', sev: 'low', msg: `Recording is ${Math.round(tr.duration / 60)} min but the session lasted ${Math.round(s.duration_sec / 60)} min` })
    if (fl.includes('damaged_audio')) f.push({ k: 'damaged_audio', sev: 'med', msg: 'Part of the recording was corrupted on the phone; some speech is missing from the transcript' })
    if (tr.status === 'review') f.push({ k: 'transcript_review', sev: 'high', msg: 'Transcript flagged (' + (fl.join(', ') || 'low quality') + '): needs human review before coding' })
    else if (fl.filter(x => x !== 'damaged_audio').length) f.push({ k: 'transcript_note', sev: 'low', msg: 'Transcript notes: ' + fl.filter(x => x !== 'damaged_audio').join(', ') })
  }
  return f
}
// Flags for every live record (single-record checks + cross-record checks). Records marked "valid" keep their flags but as acknowledged.
async function flagMap(c: any) {
  const subs = await loadSubs(c, { raw: true })
  const trs: any = {}; (await c.env.DB.prepare(`SELECT submission_id,status,flags,confidence,duration,LENGTH(TRIM(COALESCE(text,'')))-LENGTH(REPLACE(TRIM(COALESCE(text,'')),' ',''))+1 AS words FROM transcripts`).all()).results.forEach((t: any) => trs[t.submission_id] = t)
  const cross = crossFlags(subs, { code: (s: any) => s.code, lg: (l: string) => LG_BY[l] })
  const m = new Map<number, Flag[]>()
  for (const s of subs) {
    let f: Flag[] = [...qualityFlags(s, trs[s.id]), ...(cross.get(s.id) || [])]
    if (s.consent_interview === 'no') f = []
    if (s.field_status === 'valid') f = f.map(x => ({ ...x, ack: true }))
    m.set(s.id, f)
  }
  return { m, trs, subs }
}
const openHigh = (f: Flag[] = []) => f.filter(x => x.sev === 'high' && !x.ack).length

app.get('/api/quality', async (c) => {
  const fsm = await formSchemas(c)
  const { m, subs: all } = await flagMap(c)
  const region = c.req.query('region'), lg = c.req.query('lg'), grp = c.req.query('grp')
  const subs = all.filter((s: any) => (!region || s.region === region) && (!lg || s.lg === lg) && (!grp || s.grp === grp))
  const counts: any = {}, byGroup: any = { data: 0, audio: 0, enumerator: 0, location: 0 }, flagged: any[] = []
  for (const s of subs) {
    const f = m.get(s.id) || []
    const open = f.filter(x => !x.ack)
    open.forEach(x => { inc(counts, x.k); inc(byGroup, FLAG_INFO[x.k]?.group || 'data') })
    if (f.length || s.field_status === 'recheck') flagged.push({ id: s.id, lg: s.lg, label: whereLabel(s, fsm[s.form_uid]), form: s.code, grp: s.grp, enumerator: s.enumerator_id, ekey: enumKey(s.enumerator_id), date: s.interview_date, status: s.field_status || 'auto', note: s.field_note || '', flags: f, high: openHigh(f), open: open.length })
  }
  flagged.sort((a, b) => b.high - a.high || b.open - a.open || b.id - a.id)
  const live = subs.filter((s: any) => s.consent_interview !== 'no')
  const clean = live.filter((s: any) => !openHigh(m.get(s.id))).length
  const tests = (await loadSubs(c, { all: true, raw: true })).filter((s: any) => s.field_status === 'test').map((s: any) => ({ id: s.id, form: s.code, lg: s.lg, label: whereLabel(s, fsm[s.form_uid]), enumerator: s.enumerator_id, note: s.field_note || '', date: s.interview_date }))
  return c.json({ counts, by_group: byGroup, info: FLAG_INFO, flagged, tests, total: live.length, clean, clean_pct: live.length ? clean / live.length : null })
})

// Mark a submission: valid (flags acknowledged), recheck (send back to enumerator), test (excluded everywhere), auto (reset)
app.post('/api/submission/:id/status', admin, async (c) => {
  const id = Number(c.req.param('id')); const b = await c.req.json()
  if (!['auto', 'valid', 'recheck', 'test'].includes(b.status)) return c.json({ error: 'bad status' }, 400)
  const s: any = await c.env.DB.prepare('SELECT * FROM submissions WHERE id=?').bind(id).first()
  if (!s) return c.json({ error: 'not found' }, 404)
  const st: any[] = [c.env.DB.prepare('UPDATE submissions SET field_status=?, field_note=? WHERE id=?').bind(b.status, String(b.note || '').slice(0, 300) || null, id)]
  if (b.status === 'test') st.push(c.env.DB.prepare('DELETE FROM codes WHERE submission_id=?').bind(id))
  else if (s.field_status === 'test') {
    const sub = { ...s, texts: J(s.texts, {}) }
    st.push(...codingStatements(c.env, sub))
    const t: any = await c.env.DB.prepare("SELECT segments FROM transcripts WHERE submission_id=? AND status='done'").bind(id).first()
    if (t) st.push(...audioCodes(c.env, sub, J(t.segments, [])))
  }
  await c.env.DB.batch(st)
  return c.json({ ok: true })
})

// ---------- field monitoring ----------
const isoDay = (s: any) => (s.interview_date || (s.submitted_at || '').slice(0, 10) || '').slice(0, 10)
const countable = (s: any) => s.consent_interview !== 'no'

app.get('/api/coverage', async (c) => {
  const { m, subs } = await flagMap(c)
  const region = c.req.query('region')
  const nLg = (LGS as any[]).length
  const cols = FORM_TARGETS.map(t => ({ code: t.code, label: t.label, short: t.short, per_lg: t.per_lg || null, total: t.total || null }))
  const live = subs.filter(countable)
  const cell = (code: string, lgc?: string) => {
    const ss = live.filter(s => s.code === code && (lgc ? s.lg === lgc : true))
    return { n: ss.length, clean: ss.filter(s => !openHigh(m.get(s.id))).length }
  }
  const rows = (LGS as any[]).filter(l => !region || l.region === region).map(l => {
    const cells: any = {}; let got = 0, need = 0
    for (const t of FORM_TARGETS) if (t.per_lg) { const x = cell(t.code, l.code); cells[t.code] = { ...x, target: t.per_lg }; got += Math.min(x.n, t.per_lg); need += t.per_lg }
    const declined = subs.filter(s => s.lg === l.code && s.consent_interview === 'no').length
    const last = live.filter(s => s.lg === l.code).map(isoDay).sort().pop() || null
    return { code: l.code, label: l.label, region: l.region, cat: l.cat, cells, got, need, pct: need ? got / need : 0, declined, last }
  })
  const perForm = FORM_TARGETS.map(t => {
    if (t.per_lg) {
      const ss = live.filter(s => s.code === t.code)
      const capped = (LGS as any[]).reduce((a, l) => a + Math.min(ss.filter(s => s.lg === l.code).length, t.per_lg!), 0)
      return { code: t.code, label: t.label, short: t.short, target: t.per_lg * nLg, got: capped, submitted: ss.length, clean: ss.filter(s => !openHigh(m.get(s.id))).length, no_lg: ss.filter(s => !s.lg).length, lgs_done: (LGS as any[]).filter(l => ss.filter(s => s.lg === l.code).length >= t.per_lg!).length, per_lg: t.per_lg }
    }
    const x = cell(t.code)
    return { code: t.code, label: t.label, short: t.short, target: t.total!, got: Math.min(x.n, t.total!), submitted: x.n, clean: x.clean, no_lg: 0, lgs_done: null, per_lg: null }
  })
  const achieved = perForm.reduce((a, p) => a + p.got, 0), target = targetTotal(nLg)
  const regions: any = {}
  for (const r of rows) { const g = (regions[r.region] ||= { region: r.region, got: 0, need: 0, lgs: 0 }); g.got += r.got; g.need += r.need; g.lgs++ }
  return c.json({ cols, rows, per_form: perForm, achieved, target_total: target, pct: achieved / target, regions: Object.values(regions), unassigned: live.filter(s => !s.lg && s.grp !== 'national').length })
})

// Overview for field coordinators: progress, daily trend, processing funnel per form
app.get('/api/field', async (c) => {
  const fsm = await formSchemas(c)
  const { m, trs, subs } = await flagMap(c)
  const live = subs.filter(countable)
  const cc: any = {}; (await c.env.DB.prepare('SELECT submission_id sid,COUNT(*) n FROM codes GROUP BY submission_id').all()).results.forEach((r: any) => cc[r.sid] = r.n)
  const funnel = (ss: any[]) => {
    const f: any = { submitted: ss.length, declined: 0, audio_expected: 0, audio_uploaded: 0, audio_missing: 0, pending: 0, processing: 0, transcribed: 0, review: 0, rejected: 0, failed: 0, coded: 0, text_coded: 0, flagged: 0 }
    for (const s of ss) {
      if (!countable(s)) { f.declined++; continue }
      if (s.consent_audio === 'yes' || s.audio_url) f.audio_expected++
      if (s.audio_url) f.audio_uploaded++; else if (s.consent_audio === 'yes') f.audio_missing++
      const a = s.audio_status; if (a === 'pending') f.pending++; else if (a === 'processing') f.processing++; else if (a === 'done') f.transcribed++; else if (a === 'review') f.review++; else if (a === 'rejected') f.rejected++; else if (a === 'failed') f.failed++
      if (cc[s.id]) f.coded++
      if (s.text_words > 0) f.text_coded++
      if (openHigh(m.get(s.id))) f.flagged++
    }
    return f
  }
  const byForm = Object.values(fsm).map(fs => ({ code: fs.meta.code || '', name: shortName(fs.name), group: fs.meta.group, ...funnel(subs.filter(s => s.form_uid === fs.uid)) })).sort((a, b) => a.code.localeCompare(b.code))
  const days: any = {}
  for (const s of live) { const d = isoDay(s) || 'unknown'; const r = (days[d] ||= { d, n: 0 }); r.n++; r[s.code] = (r[s.code] || 0) + 1 }
  const byRegion: any = {}; live.forEach(s => inc(byRegion, s.region || 'unknown'))
  const dates = live.map(isoDay).filter(Boolean).sort()
  const enumSet = new Set(live.map(s => enumKey(s.enumerator_id)))
  const lastSub = live.map(s => s.submitted_at).filter(Boolean).sort().pop() || null
  const fl: any = {}; for (const s of live) for (const x of m.get(s.id) || []) if (!x.ack) inc(fl, FLAG_INFO[x.k]?.group || 'data')
  const lastSync = await c.env.DB.prepare("SELECT value FROM meta WHERE key='last_sync'").first<any>()
  return c.json({
    funnel: funnel(subs), by_form: byForm, daily: Object.values(days).sort((a: any, b: any) => a.d.localeCompare(b.d)), by_region: byRegion,
    first_date: dates[0] || null, last_date: dates[dates.length - 1] || null, last_submission: lastSub, last_sync: lastSync?.value || null,
    enumerators: enumSet.size, lgs_active: new Set(live.map(s => s.lg).filter(Boolean)).size, lgs_total: (LGS as any[]).length,
    flags_open: fl, records_with_open_high: live.filter(s => openHigh(m.get(s.id))).length, live: live.length, tests: (await loadSubs(c, { all: true, raw: true })).filter((s: any) => s.field_status === 'test').length,
  })
})

// Per-enumerator tracker: who submits what, where, when, and how clean it is
app.get('/api/enumerators', async (c) => {
  const { m, trs, subs } = await flagMap(c)
  const e: Record<string, any> = {}
  for (const s of subs) {
    const k = enumKey(s.enumerator_id)
    const r = (e[k] ||= { key: k, raw: new Set<string>(), n: 0, declined: 0, forms: {}, lgs: new Set<string>(), regions: new Set<string>(), days: new Set<string>(), dur: [] as number[], words: [] as number[], aExp: 0, aUp: 0, aDone: 0, aReview: 0, gps: 0, high: 0, open: 0, first: null, last: null, lastId: 0, rechecks: 0, flags: {} })
    r.raw.add(String(s.enumerator_id || '').trim() || '(blank)')
    if (!countable(s)) { r.declined++; continue }
    r.n++; inc(r.forms, s.code || '?'); if (s.lg) r.lgs.add(s.lg); if (s.region) r.regions.add(s.region)
    const d = isoDay(s); if (d) { r.days.add(d); if (!r.first || d < r.first) r.first = d; if (!r.last || d > r.last) r.last = d }
    if (s.duration_sec) r.dur.push(s.duration_sec); r.words.push(s.text_words || 0)
    if (s.consent_audio === 'yes' || s.audio_url) r.aExp++; if (s.audio_url) r.aUp++
    if (s.audio_status === 'done') r.aDone++; if (s.audio_status === 'review') r.aReview++
    if (s.lat != null) r.gps++
    const f = (m.get(s.id) || []).filter(x => !x.ack); if (f.some(x => x.sev === 'high')) r.high++; if (f.length) r.open++
    f.forEach(x => inc(r.flags, x.k)); if (s.field_status === 'recheck') r.rechecks++
    if (s.id > r.lastId) r.lastId = s.id
  }
  const rows = Object.values(e).filter(r => r.n || r.declined).map(r => ({
    key: r.key, raw: [...r.raw], valid_id: enumLooksValid(r.key), n: r.n, declined: r.declined, forms: r.forms, lgs: [...r.lgs], regions: [...r.regions], days: r.days.size, first: r.first, last: r.last,
    median_min: r.dur.length ? +(median(r.dur)! / 60).toFixed(1) : null, avg_words: Math.round(mean(r.words) || 0), audio_expected: r.aExp, audio_uploaded: r.aUp, transcribed: r.aDone, in_review: r.aReview,
    gps_pct: r.n ? r.gps / r.n : null, high: r.high, open: r.open, rechecks: r.rechecks, flags: r.flags, clean_pct: r.n ? (r.n - r.high) / r.n : null,
  })).sort((a, b) => b.n - a.n)
  return c.json({ rows, total: rows.length, valid_ids: rows.filter(r => r.valid_id).length })
})

app.get('/api/interviews', async (c) => {
  const subs = await loadSubs(c)
  const fsm = await formSchemas(c)
  const { m, trs } = await flagMap(c)
  const cc: any = {}; (await c.env.DB.prepare('SELECT submission_id sid,COUNT(*) n FROM codes GROUP BY submission_id').all()).results.forEach((r: any) => cc[r.sid] = r.n)
  return c.json({ items: subs.slice().reverse().map(s => { const f = (m.get(s.id) || []); return { id: s.id, lg: s.lg, label: whereLabel(s, fsm[s.form_uid]), form: s.code, form_name: shortName(fsm[s.form_uid]?.name || ''), region: s.region, grp: s.grp, affiliation: s.affiliation, date: s.interview_date, submitted: s.submitted_at, duration_sec: s.duration_sec, enumerator: s.enumerator_id, ekey: enumKey(s.enumerator_id),
    consent: s.consent_interview, audio: s.audio_status, has_audio: !!s.audio_url, words: s.text_words, codes: cc[s.id] || 0, demo: !!s.is_demo, status: s.field_status || 'auto', flags: openHigh(f), flag_list: f.filter(x => !x.ack).map(x => x.k), tr_conf: trs[s.id]?.confidence ?? null } }) })
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
    flags: (await flagMap(c)).m.get(id) || [], status: s.field_status || 'auto', note: s.field_note || '', ekey: enumKey(s.enumerator_id), info: FLAG_INFO,
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
  const trs: any = {}; (await c.env.DB.prepare(`SELECT submission_id,status,flags,confidence,duration,LENGTH(TRIM(COALESCE(text,'')))-LENGTH(REPLACE(TRIM(COALESCE(text,'')),' ',''))+1 AS words FROM transcripts`).all()).results.forEach((t: any) => trs[t.submission_id] = t)
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
  const trAll: any = {}; (await c.env.DB.prepare(`SELECT submission_id,status,flags,confidence,duration,model,LENGTH(TRIM(COALESCE(text,'')))-LENGTH(REPLACE(TRIM(COALESCE(text,'')),' ',''))+1 AS words FROM transcripts`).all()).results.forEach((t: any) => trAll[t.submission_id] = t)
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
    return { code: f.meta.code || '', name: shortName(f.name), group: GROUP_LABELS[f.meta.group] || f.meta.group || '', kind: f.kind, submissions: fsubs.length, consented: fc.length, declined: fsubs.length - fc.length, audio: a, words: fc.reduce((x, s) => x + (s.text_words || 0), 0), spoken_words: fc.reduce((x, s) => x + (trAll[s.id]?.status === 'done' ? trAll[s.id].words || 0 : 0), 0), awaiting: fc.filter(s => s.audio_url && ['pending', 'processing', 'failed'].includes(s.audio_status)).length }
  }).filter(f => f.submissions || true)
  const trList = Object.values<any>(trAll).filter(t => byId.has(t.submission_id))
  const lgSet = new Set(subs.map(s => s.lg).filter(Boolean))
  const caveats: string[] = []
  const nReview = trList.filter(t => t.status === 'review').length
  if (nReview) caveats.push(`${nReview} audio transcript${nReview === 1 ? ' is' : 's are'} held in "Needs review" (low confidence, repetition or almost no speech) and ${nReview === 1 ? 'is' : 'are'} NOT coded into the themes until accepted by a person. They are still reproduced in Appendix B for transparency.`)
  const awaiting = subs.filter((s: any) => s.audio_url && ['pending', 'processing', 'failed'].includes(s.audio_status)).length
  if (awaiting) caveats.push(`${awaiting} recording${awaiting === 1 ? ' has' : 's have'} not yet been transcribed. Interviewers typed only short notes for open-ended questions, so the findings below rest on those short notes and will deepen once the recordings are transcribed.`)
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
  const sources = [...subs].sort((a, b) => a.id - b.id).map(s => ({ ref: refOf(fsm, s), id: s.id, form: fsm[s.form_uid]?.meta?.code || '', where: whereLabel(s, fsm[s.form_uid]), group: GROUP_LABELS[s.grp] || s.grp, date: s.interview_date, audio: trAll[s.id]?.status || s.audio_status, words: s.text_words, spoken: trAll[s.id]?.status === 'done' ? trAll[s.id].words || 0 : null }))
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
