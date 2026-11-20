import { SKIP_TEXT, wordCount } from './codebook'

export type Env = {
  DB: any
  KOBO_TOKEN: string
  KOBO_HOST?: string
  KOBO_FORMS?: string   // "uid:kii,uid2:fgd"
  INGEST_TOKEN?: string
}

export const host = (env: Env) => (env.KOBO_HOST || 'https://kf.kobotoolbox.org').replace(/\/$/, '')
export const koboHeaders = (env: Env) => ({ Authorization: 'Token ' + env.KOBO_TOKEN })
export function forms(env: Env): { uid: string; kind: string }[] {
  return (env.KOBO_FORMS || '').split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const [uid, kind] = s.split(':'); return { uid, kind: kind || 'kii' }
  })
}

const label = (l: any) => Array.isArray(l) ? (l[0] ?? '') : (l ?? '')

// Trimmed schema: question name -> {t:type, l:label, list, sec}, choices: list -> {value: label}
export function buildSchema(asset: any) {
  const q: Record<string, any> = {}, ch: Record<string, Record<string, string>> = {}, order: string[] = []
  const stack: string[] = []
  for (const r of asset.content?.survey || []) {
    const n = r.name || r.$autoname
    if (r.type === 'begin_group' || r.type === 'begin_repeat') { stack.push(label(r.label) || n); continue }
    if (r.type === 'end_group' || r.type === 'end_repeat') { stack.pop(); continue }
    if (!n) continue
    const type = String(r.type).split(' ')[0]
    q[n] = { t: type, l: label(r.label), list: r.select_from_list_name || (String(r.type).split(' ')[1] || undefined), sec: stack[0] || '' }
    order.push(n)
  }
  for (const c of asset.content?.choices || []) (ch[c.list_name] ||= {})[c.name] = label(c.label)
  return { q, ch, order }
}

export async function fetchAsset(env: Env, uid: string) {
  const r = await fetch(`${host(env)}/api/v2/assets/${uid}/?format=json`, { headers: koboHeaders(env) })
  if (!r.ok) throw new Error(`Kobo asset ${uid}: HTTP ${r.status}`)
  return r.json() as Promise<any>
}

export async function fetchAllData(env: Env, uid: string) {
  const out: any[] = []
  let url: string | null = `${host(env)}/api/v2/assets/${uid}/data/?format=json&limit=300`
  let guard = 0
  while (url && guard++ < 50) {
    const r: Response = await fetch(url, { headers: koboHeaders(env) })
    if (!r.ok) throw new Error(`Kobo data ${uid}: HTTP ${r.status}`)
    const j: any = await r.json()
    out.push(...(j.results || []))
    url = j.next || null
  }
  return out
}

const last = (k: string) => k.split('/').pop() as string
const num = (v: any) => { if (v === undefined || v === null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null }

// Raw Kobo submission -> flat normalised record used everywhere else
export function normalise(form: { uid: string; kind: string }, raw: any, schema: any) {
  const flat: Record<string, any> = {}
  let photos = 0
  const captions: string[] = []
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith('_') || k.startsWith('meta/') || k.startsWith('formhub/')) continue
    if (Array.isArray(v)) {                                   // repeat groups (photo evidence)
      for (const it of v as any[]) {
        photos++
        for (const [k2, v2] of Object.entries(it)) if (/caption/i.test(k2) && v2) captions.push(String(v2))
      }
      continue
    }
    flat[last(k)] = v
  }
  const texts: Record<string, string> = {}, answers: Record<string, any> = {}
  const META = new Set(['start', 'end', 'today', 'deviceid', 'username', 'phonenumber', 'subscriberid', 'simserial'])
  for (const [k, v] of Object.entries(flat)) {
    if (META.has(k)) continue
    const t = schema.q[k]?.t
    if (t === 'text' && !SKIP_TEXT.has(k)) { const s = String(v).trim(); if (s) texts[k] = s }
    else if (t === 'audio' || t === 'background-audio' || t === 'image' || t === 'file') continue
    else if (SKIP_TEXT.has(k)) answers[k] = v
    else answers[k] = (t === 'integer' || t === 'decimal') ? num(v) : v
  }
  if (captions.length) texts['photo_caption'] = captions.join(' | ')
  const att = (raw._attachments || []).find((a: any) => !a.is_deleted && String(a.mimetype || '').startsWith('audio'))
  const geo = Array.isArray(raw._geolocation) ? raw._geolocation : []
  const consent = flat.consent_interview ?? null
  const caud = flat.consent_audio ?? null
  const started = raw.start || null, ended = raw.end || null
  const dur = started && ended ? Math.max(0, Math.round((Date.parse(ended) - Date.parse(started)) / 1000)) : null
  let audio_status = 'none'
  if (consent === 'no' || caud === 'no') audio_status = 'declined'
  else if (att) audio_status = 'pending'
  else if (caud === 'yes') audio_status = 'missing'
  return {
    id: raw._id, form_uid: form.uid, uuid: raw._uuid || raw['meta/instanceID'] || null, kind: form.kind,
    submitted_at: raw._submission_time || null, started_at: started, ended_at: ended, duration_sec: dur,
    interview_date: flat.interview_date || raw.today || null,
    region: flat.region || null, lg: flat.lg_name || null, lg_category: flat.lg_category || null,
    affiliation: flat.respondent_affiliation || null, grp: flat.resp_group || null,
    enumerator_id: flat.enumerator_id ? String(flat.enumerator_id).trim() : null,
    consent_interview: consent, consent_audio: caud,
    lat: num(geo[0]), lon: num(geo[1]),
    answers, texts, text_words: Object.values(texts).reduce((a, s) => a + wordCount(s), 0), photo_count: photos,
    audio_url: att?.download_url || null, audio_name: att?.media_file_basename || null, audio_status,
    validation: raw._validation_status?.uid || null,
  }
}
export type NSub = ReturnType<typeof normalise>
