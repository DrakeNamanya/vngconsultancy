// Field-monitoring rules: collection targets, enumerator IDs, cross-record error checks.
// All thresholds below are working assumptions: adjust them here, nothing else depends on the numbers.
import { SKIP_TEXT } from './codebook'

export type Flag = { k: string; sev: 'high' | 'med' | 'low'; msg: string; ack?: boolean }

// Collection targets (from the study design). per_lg = forms required in EACH local government; total = forms required overall.
// min_min = shortest plausible session in minutes (shorter => flagged).
export const FORM_TARGETS: { code: string; label: string; short: string; per_lg?: number; total?: number; min_min: number }[] = [
  { code: 'A1', label: 'Local Authorities KII', short: 'LG officials', per_lg: 11, min_min: 20 },
  { code: 'A2', label: 'KII: Town Clerk, Mayor, Police Commandant', short: 'Political & enforcement', per_lg: 3, min_min: 20 },
  { code: 'A3', label: 'KII: Street vendors not relocated', short: 'Vendors not relocated', per_lg: 2, min_min: 5 },
  { code: 'A5', label: 'KII: Market administrators', short: 'Market administrators', per_lg: 1, min_min: 15 },
  { code: 'B1', label: 'FGD 1: Informal vendors & relocated traders', short: 'FGD informal', per_lg: 1, min_min: 30 },
  { code: 'B2', label: 'FGD 2: Formal & licensed traders', short: 'FGD formal', per_lg: 1, min_min: 30 },
  { code: 'A4', label: 'KII: National-level stakeholders', short: 'National', total: 5, min_min: 20 },
]
export const TARGET_BY_CODE = Object.fromEntries(FORM_TARGETS.map(t => [t.code, t]))
export const targetTotal = (nLg: number) => FORM_TARGETS.reduce((a, t) => a + (t.per_lg ? t.per_lg * nLg : t.total || 0), 0)

// ---- enumerator IDs ----
// Canonical form so "Tab017", "TAB-017" and "tab 17" are one person; "011" and "RDM-011" stay different (they may be different teams).
export function enumKey(raw: any): string {
  const s = String(raw ?? '').trim()
  if (!s) return '(blank)'
  const parts = s.toUpperCase().match(/[A-Z]+|\d+/g) || []
  if (!parts.length) return s.toUpperCase()
  return parts.map(p => /^\d+$/.test(p) ? (p.length > 3 ? p : p.padStart(3, '0')) : p).join('-')
}
// A usable ID looks like 042, TAB-042, RDM-TAB-042. Names, 5+ digit numbers and keyboard mash do not.
export const enumLooksValid = (raw: any) => /^(?:[A-Z]{2,10}-){0,2}\d{3}$/.test(enumKey(raw))

export const distKm = (a: number, b: number, c: number, d: number) => {
  const r = Math.PI / 180, dl = (c - a) * r, dn = (d - b) * r
  const x = Math.sin(dl / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dn / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(x))
}

// What each flag means and what the field coordinator should do about it
export const FLAG_INFO: Record<string, { label: string; hint: string; group: 'data' | 'audio' | 'enumerator' | 'location' }> = {
  short_duration: { label: 'Session too short', hint: 'Back-check with the enumerator: interview may be incomplete or fabricated.', group: 'data' },
  long_duration: { label: 'Form open > 4 h', hint: 'Form probably left open; check the interview date and time.', group: 'data' },
  thin_text: { label: 'Very little typed text', hint: 'Open-ended answers are almost empty. Ask for fuller notes or rely on the audio.', group: 'data' },
  test_like: { label: 'Looks like test input', hint: 'Answers look like dummy text. Mark as test if confirmed.', group: 'data' },
  copy_paste: { label: 'Same text pasted in several answers', hint: 'One answer copied into several questions.', group: 'data' },
  copied_between_interviews: { label: 'Answer copied from another interview', hint: 'Long answer is word-for-word identical to another record: likely copy/paste or duplicate entry.', group: 'data' },
  duplicate_role_lg: { label: 'Duplicate role in same LG', hint: 'More A2 forms than distinct roles (Town Clerk / Mayor / Police). Check for test or duplicate entries.', group: 'data' },
  no_lg: { label: 'Local government missing', hint: 'Cannot be counted toward any LG target until the LG is set.', group: 'data' },
  category_mismatch: { label: 'LG category mismatch', hint: 'Category chosen does not match the LG chosen.', group: 'data' },
  region_mismatch: { label: 'Region mismatch', hint: 'Region chosen does not match the LG chosen.', group: 'data' },
  future_date: { label: 'Interview date in the future', hint: 'Interview date is after the submission date. Date was typed wrongly.', group: 'data' },
  date_mismatch: { label: 'Interview date differs from form start', hint: 'Date was edited by hand or the tablet clock is wrong.', group: 'data' },
  identical_figures: { label: 'Identical before/after figures', hint: 'Section E figures are the same for all indicators.', group: 'data' },
  bad_enumerator_id: { label: 'Enumerator ID not usable', hint: 'ID is a name, mash or too long. Ask the team to use their assigned code (e.g. TAB-042).', group: 'enumerator' },
  enumerator_travel: { label: 'Same ID in far-apart LGs on one day', hint: 'Shared ID/tablet or wrong LG selected.', group: 'enumerator' },
  no_audio: { label: 'Audio consent but no recording', hint: 'Recording is missing from the submission. Ask the team to re-upload or re-record.', group: 'audio' },
  audio_short: { label: 'Recording much shorter than session', hint: 'Recording may have stopped early.', group: 'audio' },
  transcript_review: { label: 'Transcript needs review', hint: 'Automatic text failed quality checks (silence, noise, loops). Listen and accept/reject.', group: 'audio' },
  damaged_audio: { label: 'Recording partly damaged', hint: 'The phone saved a corrupted recording, so some speech cannot be recovered. Re-record key answers or follow up with the respondent.', group: 'audio' },
  transcript_note: { label: 'Transcript notes', hint: 'Minor transcript warnings.', group: 'audio' },
  no_gps: { label: 'No GPS captured', hint: 'Location not recorded: cannot verify where the interview took place.', group: 'location' },
  gps_outside_uganda: { label: 'GPS outside Uganda', hint: 'Location is not in Uganda: test record or wrong device location.', group: 'location' },
  gps_far_from_lg: { label: 'GPS far from declared LG', hint: 'Phone was far from the LG named in the form.', group: 'location' },
  gps_shared: { label: 'Identical GPS in two records', hint: 'Exactly the same point (to 1 m): copied location or cached position.', group: 'location' },
}

// Checks that need to compare records with each other
export function crossFlags(subs: any[], ctx: { code: (s: any) => string; lg: (c: string) => any }): Map<number, Flag[]> {
  const out = new Map<number, Flag[]>()
  const add = (id: number, f: Flag) => { const a = out.get(id) || []; if (!a.some(x => x.k === f.k)) a.push(f); out.set(id, a) }
  const live = subs.filter(s => s.consent_interview !== 'no')
  const grp = <T>(items: T[], key: (x: T) => string | null) => { const m = new Map<string, T[]>(); for (const x of items) { const k = key(x); if (k) (m.get(k) || m.set(k, []).get(k)!).push(x) } return m }

  for (const l of grp(live, s => s.lat != null && s.lon != null ? s.lat.toFixed(5) + ',' + s.lon.toFixed(5) : null).values())
    if (l.length > 1) for (const s of l) add(s.id, { k: 'gps_shared', sev: 'med', msg: `Exact same GPS point as ${l.filter(x => x.id !== s.id).map(x => '#' + x.id).join(', ')}` })

  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const tx = new Map<string, Set<number>>()
  for (const s of live) for (const [k, v] of Object.entries<string>(s.texts || {})) {
    if (SKIP_TEXT.has(k) || k === 'photo_caption') continue
    const n = norm(String(v)); if (n.length < 40) continue
    ;(tx.get(n) || tx.set(n, new Set()).get(n)!).add(s.id)
  }
  for (const ids of tx.values()) if (ids.size > 1) for (const id of ids) add(id, { k: 'copied_between_interviews', sev: 'high', msg: `A long answer is word-for-word the same as in ${[...ids].filter(x => x !== id).map(x => '#' + x).join(', ')}` })

  for (const l of grp(live.filter(s => ctx.code(s) === 'A2' && s.lg && s.affiliation), s => s.lg + '|' + s.affiliation).values())
    if (l.length > 1) for (const s of l) add(s.id, { k: 'duplicate_role_lg', sev: 'med', msg: `${l.length} A2 forms for "${s.affiliation}" in ${ctx.lg(s.lg)?.label || s.lg} (${l.map(x => '#' + x.id).join(', ')}); one per role is expected` })

  for (const [key, l] of grp(subs.filter(s => s.lg && s.enumerator_id), s => enumKey(s.enumerator_id) + '|' + (s.started_at || s.submitted_at || '').slice(0, 10)))  {
    const lgs = [...new Set(l.map(s => s.lg))]; if (lgs.length < 2) continue
    let max = 0
    for (let i = 0; i < lgs.length; i++) for (let j = i + 1; j < lgs.length; j++) {
      const a = ctx.lg(lgs[i]), b = ctx.lg(lgs[j]); if (a?.lat != null && b?.lat != null) max = Math.max(max, distKm(a.lat, a.lon, b.lat, b.lon))
    }
    if (max > 100) for (const s of l) add(s.id, { k: 'enumerator_travel', sev: 'med', msg: `ID ${key.split('|')[0]} also reports ${lgs.filter(x => x !== s.lg).map(x => ctx.lg(x)?.label || x).join(', ')} on the same day (${Math.round(max)} km apart)` })
  }
  return out
}
