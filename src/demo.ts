// Synthetic demo data so the dashboard can be reviewed before fieldwork produces volume.
// Every row is flagged is_demo=1, excluded from all views unless ?demo=1, and removable via DELETE /api/demo.
import { codeItems, SKIP_TEXT, wordCount } from './codebook'
import LGS from './lgs.json'
import SCHEMA from './schema.json'

const S: any = SCHEMA
let seed = 20260519
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)]
const pickw = <T,>(a: [T, number][]): T => { const t = a.reduce((x, y) => x + y[1], 0); let r = rnd() * t; for (const [v, w] of a) { if ((r -= w) <= 0) return v } return a[0][0] }
const some = <T,>(a: T[], n: number): T[] => [...a].sort(() => rnd() - 0.5).slice(0, n)

const OFF_AFF = ['technical_officer', 'law_enforcement', 'commercial_led', 'political_leader', 'other_informant']
const TRD_AFF = ['trader_rep', 'organized_business']

const P: Record<string, string[]> = {
  b6_resources_text: [
    'We needed a tow truck, two pick-up lorries, fuel and protective gear for the enforcement team. The council budget did not provide for these so we borrowed a vehicle from the works department and the police.',
    'Logistics were thin. We had no dedicated vehicle for impounded goods and only six municipal enforcement staff for the whole town. Facilitation allowances were delayed for weeks.',
    'Enforcement required vehicles, fuel, protective gear and a temporary holding yard. Funds were drawn from the OSR but this was not budgeted and affected other services.',
  ],
  b7_consultation: [
    'We held meetings with the market vendor associations and the division chairpersons for about two weeks before the operation, then issued written notices through the market masters.',
    'Consultation was limited. Notices were pinned on the council noticeboard and announced on local radio, but many hawkers say they were never informed directly.',
    'There was a sensitisation campaign with the traders association, boda boda leaders and local councillors, followed by a one-week grace period before enforcement began.',
  ],
  c1_methods: [
    'Daily patrols by the municipal law enforcement unit, verbal warnings first, then confiscation of goods and release after payment of a fine, with periodic joint operations with the police.',
    'We used phased enforcement starting with the main streets and the taxi park. Hawkers were issued notices, shown the designated vending zone and followed up weekly.',
  ],
  c2_operations: [
    'Joint operations with police and LDUs at dawn, and continuous monitoring by trade inspectors. They worked in the CBD but vendors came back at night when patrols stopped.',
    'Impounding of goods, relocation to the gazetted market and sensitisation barazas. Effectiveness was high in the first month then declined because of inconsistent political support.',
  ],
  d1_evidence: [
    'Visual observation by the traffic police and our own count showed walkways free of vendors in the CBD; average transit time on the main road reduced noticeably.',
    'Traffic police report indicates reduced jams around the taxi park but vendors have started returning to the pavements, so the gain is not durable.',
    'No clear data available. It is our observation that congestion is the same as before.',
  ],
  d2_evidence: [
    'Garbage tonnage collection reports show a rise in collected waste at the market and drains were desilted, so the town is cleaner than before enforcement.',
    'Public health inspection logs show fewer complaints about blocked drainage, though the waste skips at the market remain full.',
  ],
  d3_evidence: [
    'The market master register shows that stall occupancy in the gazetted market rose after relocation, although many stalls remain vacant because they are far from customers.',
    'Daily vendor attendance counts show fewer vendors in the new market than were relocated; some returned to the streets.',
  ],
  d4_evidence: [
    'The trade licence register shows a rise in new applications since the circular, mainly small shops and kiosks registering with the council.',
    'Licensing portal data show a modest increase in registration but many traders say the licence fees are expensive.',
  ],
  d5_evidence: [
    'Quarterly financial statements and IFMS reports show market dues and parking fees increased, mostly from the gazetted market.',
    'The revenue register shows a drop in daily market dues after enforcement because street vendors who paid daily tickets disappeared.',
  ],
  d6_evidence: [
    'Physical planning compliance notices and demolition logs show kiosks on road reserves removed and building plan approvals enforced.',
    'Building inspection reports show limited progress; illegal structures remain because of political interference.',
  ],
  e3_documents: ['Trade licence register, OSR quarterly reports, market allocation register', 'IFMS reports and council minutes', 'Revenue register and enforcement incident log'],
  e4_data_access: ['All available at the commercial office', 'Licensing registers and market registers are at the office, enforcement logs are with the municipal police unit'],
  g1_success_stories: [
    'A private-sector partnership on solid waste management, similar to the Jinja model with the polluter pays principle, helped keep markets clean while traders were involved in market committees.',
    'We used a peer-learning visit and a digital licensing system to reduce friction; traders were involved in choosing the relocation site, which worked well.',
    'Elected market leaders and market administrators accountable to the Town Clerk resolved disputes quickly, which reduced conflicts during relocation.',
  ],
  g2_unforeseen: [
    'Vendors moved to night trading and there was a rise in theft and insecurity around the old vending areas; some families lost their only source of income.',
    'Backlash from traders, a court injunction filed by an association, and displacement of women who sell vegetables to residential areas.',
  ],
  g4_recommendations: [
    'The national framework should harmonise the Trade (Licensing) Act with local by-laws, fund enforcement units, provide affordable alternative sites before relocation and set up grievance committees.',
    'We recommend a costed implementation plan, a clear circular from the Ministry, consultation with traders before enforcement and training enforcement officers on human rights.',
  ],
  g5_remarks: ['Enforcement must be consistent and fair to everyone.', 'Please follow up with action; many studies end with nothing changing.'],
  h1_1: [
    'After the March circular the council formed a task force with the police, issued notices, cleared the main streets and relocated vendors to the designated market. The responsible offices were the commercial office and the law enforcement unit.',
    'Measures included clearing walkways, impounding goods and licensing. The legal basis was the Trade (Licensing) Act and our local ordinance, led by the Town Clerk.',
  ],
  h1_2: ['Sensitisation through radio, meetings with the traders association and written notices a week before enforcement.', 'Planning was done at the technical planning committee but consultation with traders was minimal.'],
  h1_3: ['Alternative sites were identified in the gazetted market but the stalls are expensive for hawkers and far from customers.', 'We assessed capacity through a survey and prepared a vending zone, although affordability was not formally assessed.'],
  h1_4: ['Enforcement used joint operations with the police; complaints go through the market master and the town clerk office.', 'There is a complaint desk at the commercial office but few traders know about it.'],
  h1_5: ['Licensing, OSR and market occupancy registers are available but there are no baseline data on congestion.', 'We hold revenue and licensing data; traffic and sanitation data are with other departments.'],
  h1_6: ['Challenges included political interference, inadequate funding, resistance from vendors and return of vendors after operations.', 'The main challenge was inconsistent political support and corruption among a few enforcement officers.'],
  h1_7: ['Early consultation with associations and a clear relocation plan worked well for formal traders.', 'Phased enforcement and a digital registration system worked well in the CBD.'],
  h1_8: ['We need clear central guidance, funding for logistics, harmonised by-laws and approval of ordinances by the Solicitor General without delay.', 'Accountability systems and a national framework are needed so enforcement is consistent across towns.'],
  h2_1: ['We were told to leave the streets by a notice but nobody told us exactly where to go. The market allocation was announced late.', 'We heard through radio and the market chairperson; the information was not enough.'],
  h2_2: ['My sales dropped by more than half because the new location is far from customers. I now pay rent and dues I could not afford before, and my family struggles to pay school fees.', 'Enforcement confiscated my goods and I lost capital; it became hard to get a licence because of the fees.'],
  h2_3: ['The stalls were available but expensive and not safe at night. Many of us went back to hawking because customers do not come to the market.', 'Alternative space was provided and some traders are doing well, but it is too small for everyone.'],
  h2_4: ['We were called to one meeting, but our concerns were not taken seriously. Complaints go to the chairperson and nothing happens.', 'Traders were consulted through the association and we could raise complaints at the market office.'],
  h2_5: ['Allow us to trade in designated zones at affordable fees and give women and the youth priority for stalls. Enforcement should be gradual.', 'Reduce the stall rent and improve security, and then we can comply with licensing.'],
  h2_6: ['Women who sell food and vegetables were hit hardest because they could not afford stalls; young people lost jobs as hawkers. Persons with disabilities cannot reach the upper floors.', 'The impact is the same for everyone but single mothers suffer more.'],
  enumerator_summary: ['The respondent stressed the lack of alternative sites and political interference, and was frank about revenue loss.', 'Key themes were consultation gaps, affordability of stalls and the return of vendors.'],
}
const CHOICES = (list: string) => Object.keys(S.ch[list])

function makeSub(i: number, lg: any, grp: string) {
  const id = -(1000 + i)
  const aff = grp === 'trader' ? pick(TRD_AFF) : pick(OFF_AFF)
  const quality = rnd()
  const sentiment = (lg.code.charCodeAt(0) + lg.code.length) % 3
  const a: any = {
    consent_interview: 'yes', consent_audio: rnd() < 0.9 ? 'yes' : 'no', region: lg.region, lg_name: lg.code, lg_category: lg.cat, respondent_affiliation: aff,
    b1_awareness: pickw([['yes', 7], ['partly', 2], ['no', 1]]), b3_clarity: String(pickw([[1, 1], [2, 3], [3, 3], [4, 2], [5, 1]] as any)),
    b4_coordination: pickw([['high', 2], ['moderate', 4], ['fragmented', 3], ['conflicting', 1]]), b8_grievance: pickw([['yes', 4], ['no', 6]]),
    c3_status: pickw([['continuous', 2], ['periodic', 5], ['suspended', 3], ['reactive', 2]]),
    c4_success: String(pickw([[1, 1], [2, 3], [3, 4], [4, 2], [5, 0.5]] as any)),
    c5_positive: some(CHOICES('positive').filter(x => x !== 'other'), 1 + Math.floor(rnd() * 3)).join(' '),
    c6_challenges: some(CHOICES('challenges').filter(x => x !== 'other'), 1 + Math.floor(rnd() * 3)).join(' '),
    g3_barriers: some(CHOICES('barriers'), 1 + Math.floor(rnd() * 3)).join(' '),
    f1_livelihood: pickw([['severe', 4], ['short_term', 4], ['positive', 2]]), f2_alternatives: pickw([['adequate', 2], ['partial', 5], ['none', 3]]),
    f3_formalization: pickw([['significant', 2], ['marginal', 4], ['no_change', 3], ['decrease', 1]]), f4_alt_suitability: pickw([['suitable', 3], ['poor', 5], ['none', 2]]),
  }
  const rate = () => pickw(sentiment === 0 ? [['improved', 5], ['no_change', 2], ['mixed', 2], ['worsened', 1]] : sentiment === 1 ? [['improved', 2], ['no_change', 3], ['mixed', 3], ['worsened', 2]] : [['improved', 1], ['no_change', 3], ['mixed', 2], ['worsened', 4], ['not_known', 1]]) as string
  for (const k of ['d1', 'd2', 'd3', 'd4', 'd5', 'd6']) a[k + '_rating'] = rate()
  if (grp === 'official') {
    a.b2_ordinances = pickw([['full', 3], ['partial', 5], ['none', 2]]); a.b5_legal_adequacy = pickw([['adequate', 2], ['loopholes', 6], ['outdated', 2]])
    a.b6_financial = String(pickw([[1, 3], [2, 4], [3, 2], [4, 1]] as any)); a.b6_transport = String(pickw([[1, 3], [2, 4], [3, 2], [4, 1]] as any)); a.b6_protective = String(pickw([[1, 2], [2, 4], [3, 3], [4, 1]] as any))
    a.c8_meeting_freq = pickw([['weekly', 2], ['monthly', 4], ['adhoc', 4], ['never', 1]]); a.c9_plan = pickw([['costed', 2], ['uncosted', 4], ['none', 4]])
    const lic = 200 + Math.floor(rnd() * 1800), stalls = 80 + Math.floor(rnd() * 600), osr = (150 + rnd() * 900) * 1e6
    const drift = (r: string) => r === 'improved' ? 1.05 + rnd() * 0.4 : r === 'worsened' ? 0.55 + rnd() * 0.35 : r === 'no_change' ? 0.97 + rnd() * 0.06 : 0.8 + rnd() * 0.5
    const noisy = rnd() < 0.2   // ~20% inconsistent perception vs figures
    const d = (r: string) => noisy ? 0.6 + rnd() * 0.9 : drift(r)
    a.e1_licenses_before = lic; a.e1_licenses_after = Math.round(lic * d(a.d4_rating)); a.e1_stalls_before = stalls; a.e1_stalls_after = Math.round(stalls * d(a.d3_rating))
    a.e1_osr_before = Math.round(osr); a.e1_osr_after = Math.round(osr * d(a.d5_rating))
  }
  const keys = Object.keys(P).filter(k => {
    if (k.startsWith('h1_')) return grp === 'official'
    if (k.startsWith('h2_')) return grp === 'trader'
    if (['b6_resources_text', 'c1_methods', 'c2_operations', 'e3_documents', 'e4_data_access'].includes(k)) return grp === 'official'
    return true
  })
  const texts: Record<string, string> = {}
  const thin = quality < 0.08
  for (const k of keys) {
    if (thin && rnd() < 0.8) continue
    if (rnd() < 0.08) continue
    texts[k] = pick(P[k])
  }
  const words = Object.values(texts).reduce((x, s) => x + wordCount(s), 0)
  const date = `2026-0${5 + Math.floor(rnd() * 2)}-${String(1 + Math.floor(rnd() * 27)).padStart(2, '0')}`
  const dur = thin ? 240 + Math.floor(rnd() * 300) : 1500 + Math.floor(rnd() * 2400)
  const hasAudio = a.consent_audio === 'yes'
  return {
    id, form_uid: 'demo', uuid: 'demo-' + i, kind: 'kii', submitted_at: date + 'T16:00:00Z', started_at: date + 'T10:00:00Z', ended_at: date + 'T10:40:00Z', duration_sec: dur,
    interview_date: date, region: lg.region, lg: lg.code, lg_category: lg.cat, affiliation: aff, grp, enumerator_id: 'ENUM-' + String(1 + (i % 20)).padStart(2, '0'),
    consent_interview: 'yes', consent_audio: a.consent_audio, lat: 0.3 + rnd() * 2, lon: 30 + rnd() * 4, answers: a, texts, text_words: words, photo_count: Math.floor(rnd() * 4),
    audio_url: hasAudio ? 'demo' : null, audio_name: hasAudio ? 'demo.m4a' : null, audio_status: hasAudio ? 'pending' : 'declined',
  }
}

export async function seedDemo(env: any, n: number, insCode: any) {
  await clearDemo(env)
  const rows: any[] = []
  let i = 0
  for (const lg of LGS as any[]) {
    const offN = 2 + Math.floor(rnd() * 3), trdN = 1 + Math.floor(rnd() * 2)
    for (let k = 0; k < offN; k++) rows.push(makeSub(i++, lg, 'official'))
    for (let k = 0; k < trdN; k++) rows.push(makeSub(i++, lg, 'trader'))
  }
  const take = rows.slice(0, Math.max(5, Math.min(n, rows.length)))
  // a few declined consents
  take.slice(-3).forEach(s => { s.consent_interview = 'no'; s.consent_audio = null; s.audio_status = 'declined'; s.answers = { consent_interview: 'no' }; s.texts = {}; s.text_words = 0; s.audio_url = null })
  let codes = 0
  for (const s of take) {
    const st: any[] = [env.DB.prepare(`INSERT INTO submissions (id,form_uid,uuid,kind,submitted_at,started_at,ended_at,duration_sec,interview_date,region,lg,lg_category,affiliation,grp,enumerator_id,consent_interview,consent_audio,lat,lon,answers,texts,text_words,photo_count,audio_url,audio_name,audio_status,validation,is_demo,synced_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,1,?)`).bind(s.id, s.form_uid, s.uuid, s.kind, s.submitted_at, s.started_at, s.ended_at, s.duration_sec, s.interview_date, s.region, s.lg, s.lg_category, s.affiliation, s.grp, s.enumerator_id,
      s.consent_interview, s.consent_audio, s.lat, s.lon, JSON.stringify(s.answers), JSON.stringify(s.texts), s.text_words, s.photo_count, s.audio_url, s.audio_name, s.audio_status, new Date().toISOString())]
    if (s.consent_interview !== 'no') for (const [f, t] of Object.entries<string>(s.texts)) {
      if (SKIP_TEXT.has(f)) continue
      for (const k of codeItems(f, [{ text: t }])) { st.push(insCode(env, { ...s, is_demo: 1 }, 'field:' + f, k)); codes++ }
    }
    await env.DB.batch(st)
  }
  return { ok: true, submissions: take.length, codes }
}

export async function clearDemo(env: any) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM codes WHERE is_demo=1'),
    env.DB.prepare('DELETE FROM transcripts WHERE submission_id IN (SELECT id FROM submissions WHERE is_demo=1)'),
    env.DB.prepare('DELETE FROM submissions WHERE is_demo=1'),
  ])
  return { ok: true }
}
