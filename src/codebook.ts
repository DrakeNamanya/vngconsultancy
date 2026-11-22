// Qualitative codebook, aligned to the Inception Report:
//  - Table 2 "Comparative analysis framework" (7 dimensions)
//  - ToR objectives 1-4 (as printed in the Kobo form)
//  - Evidence labels: documented | observed | reported | inferred
export const OBJECTIVES = [
  { id: 'O1', label: 'Success / failure of trade-order implementation' },
  { id: 'O2', label: 'Variations in approaches and strategies' },
  { id: 'O3', label: 'Adequacy of legal & policy frameworks and mechanisms' },
  { id: 'O4', label: 'Lessons learnt, good practice, national framework' },
]

export const DIMENSIONS = [
  { id: 'IMP', label: 'Implementation & enforcement', obj: 'O2', color: '#1f877d' },
  { id: 'URB', label: 'Urban order & public space', obj: 'O1', color: '#2f6fb5' },
  { id: 'MKT', label: 'Business formalisation & market access', obj: 'O1', color: '#7a5bb5' },
  { id: 'OSR', label: 'Own-source revenue', obj: 'O1', color: '#c98a1b' },
  { id: 'INC', label: 'Inclusion & livelihoods', obj: 'O1', color: '#c0504d' },
  { id: 'GOV', label: 'Governance & legal framework', obj: 'O3', color: '#142a46' },
  { id: 'LRN', label: 'Learning & sustainability', obj: 'O4', color: '#4f8f3a' },
]

type Theme = { code: string; label: string; dim: string; kw: string[] }
export const THEMES: Theme[] = [
  { code: 'IMP_CONSULT', label: 'Consultation & sensitisation', dim: 'IMP', kw: ['consult', 'sensiti[sz]', 'awareness', 'notice', 'notif', 'dialogue', 'engage', 'informed', 'meeting with', 'barazas?'] },
  { code: 'IMP_COORD', label: 'Inter-agency coordination', dim: 'IMP', kw: ['coordinat', 'police', 'ldus?\\b', 'security organ', 'joint operation', 'inter-?agency', 'multi-?agency', 'task ?force', 'rdc\\b'] },
  { code: 'IMP_RESOURCES', label: 'Resources & logistics', dim: 'IMP', kw: ['fund', 'budget', 'vehicle', 'truck', 'fuel', 'logistic', 'equipment', 'understaff', 'staff shortage', 'protective gear', 'facilitation', 'allowance'] },
  { code: 'IMP_CONSISTENCY', label: 'Consistency & continuity of enforcement', dim: 'IMP', kw: ['inconsistent', 'intermittent', 'relax', 'suspend', 'sweep', 'campaign', 'revert', 'came back', 'come back', 'return(?:ed)? to', 'sustain', 'routine', 'daily patrol', 'on and off', 'stop-?start'] },
  { code: 'IMP_FORCE', label: 'Use of force & conduct of enforcers', dim: 'IMP', kw: ['force\\b', 'forced', 'brutal', 'beat', 'confiscat', 'seiz', 'impound', 'harass', 'violen', 'tear ?gas', 'human rights?', 'arrest'] },
  { code: 'IMP_PLAN', label: 'Planning & work plans', dim: 'IMP', kw: ['work ?plan', 'costed', 'strateg', 'timeline', 'schedule', 'action plan', 'standard operating'] },
  { code: 'URB_CONGESTION', label: 'Congestion & pedestrian mobility', dim: 'URB', kw: ['congest', 'traffic', 'walkway', 'pedestrian', 'pavement', 'road reserve', 'jam\\b', 'boda', 'verandah', 'sidewalk'] },
  { code: 'URB_SANITATION', label: 'Cleanliness, drainage & waste', dim: 'URB', kw: ['drain', 'garbage', 'waste', 'clean', 'sanitation', 'litter', 'sewage', 'hygiene', 'dirt', 'skip', 'refuse'] },
  { code: 'URB_BUILDING', label: 'Building control & encroachment', dim: 'URB', kw: ['building', 'structure', 'encroach', 'physical planning', 'demolit', 'kiosk', 'zoning', 'plan approval', 'illegal construction', 'setback'] },
  { code: 'MKT_ALTERNATIVES', label: 'Alternative trading spaces', dim: 'MKT', kw: ['alternative', 'relocat', 'designated', 'gazett', 'stalls?\\b', 'market space', 'vending zone', 'trading space', 'market yard', 'occupan', 'vacant'] },
  { code: 'MKT_AFFORD', label: 'Affordability of dues & rent', dim: 'MKT', kw: ['afford', 'rent\\b', 'dues', 'fees?\\b', 'expensive', 'charges', 'too costly', 'high cost', 'pay\\b'] },
  { code: 'MKT_LOCATION', label: 'Location & customer access', dim: 'MKT', kw: ['too far', 'distance', 'customers?', 'footfall', 'out of reach', 'remote', 'visibility', 'location', 'inaccessible', 'accessib'] },
  { code: 'MKT_LICENSING', label: 'Licensing & formalisation', dim: 'MKT', kw: ['licen[cs]', 'registr', 'formali[sz]', 'tin\\b', 'trading permit', 'compliance', 'comply', 'ursb', 'ura\\b'] },
  { code: 'OSR_COLLECTION', label: 'Revenue collection & performance', dim: 'OSR', kw: ['revenue', 'osr\\b', 'collection', 'receipts', 'taxes', 'parking fee', 'own[- ]source', 'ifms', 'ugx', 'shillings'] },
  { code: 'OSR_LEAKAGE', label: 'Revenue loss & leakage', dim: 'OSR', kw: ['leakage', 'revenue loss', 'lost revenue', 'drop in revenue', 'declin\\w+ (?:in )?revenue', 'reduced revenue', 'revenue (?:fell|dropped|declined)', 'arrears', 'shortfall'] },
  { code: 'INC_LIVELIHOOD', label: 'Livelihoods & incomes', dim: 'INC', kw: ['income', 'livelihood', 'sales\\b', 'poverty', 'survival', 'hunger', 'lost (?:their )?business', 'school fees', 'family', 'families', 'capital', 'customers lost', 'unemploy', 'jobs?\\b'] },
  { code: 'INC_WOMEN_YOUTH', label: 'Women & youth', dim: 'INC', kw: ['women', 'woman', 'youth', 'young people', 'girls', 'mothers', 'single mothers', 'gender'] },
  { code: 'INC_VULNERABLE', label: 'Persons with disabilities & vulnerable groups', dim: 'INC', kw: ['disab', 'pwds?\\b', 'elderly', 'vulnerable', 'widow', 'orphan', 'marginali[sz]'] },
  { code: 'INC_GRIEVANCE', label: 'Grievance redress & disputes', dim: 'INC', kw: ['grievance', 'complain', 'redress', 'appeal', 'court', 'injunction', 'petition', 'compensat', 'dispute', 'sued\\b', 'lawsuit'] },
  { code: 'GOV_LAW', label: 'By-laws, ordinances & legal gaps', dim: 'GOV', kw: ['by-?laws?', 'ordinance', 'act\\b', 'law\\b', 'laws\\b', 'legal', 'legislation', 'statute', 'cap\\.? ?101', 'solicitor general', 'regulation', 'loophole', 'gazette'] },
  { code: 'GOV_POLITICAL', label: 'Political interference & support', dim: 'GOV', kw: ['politic', 'interfer', 'councillors?', 'mps?\\b', 'election', 'campaign promise', 'politicians?', 'mayor', 'lc ?[1-5]\\b', 'vote'] },
  { code: 'GOV_CENTRAL', label: 'Central guidance & policy harmonisation', dim: 'GOV', kw: ['ministry', 'molg', 'circular', 'directive', 'guideline', 'central government', 'harmoni[sz]', 'national policy', 'presidential', 'cabinet', 'mismatch', 'mixed signals', 'contradict'] },
  { code: 'GOV_CORRUPTION', label: 'Corruption & bribery', dim: 'GOV', kw: ['corrupt', 'brib', 'extort', 'kickback', 'under the table', 'favouritism', 'favoritism'] },
  { code: 'LRN_PRACTICE', label: 'Good practice & innovation', dim: 'LRN', kw: ['good practice', 'best practice', 'innovat', 'partnership', 'ppp\\b', 'peer[- ]learning', 'digital', 'model\\b', 'worked well', 'success stor', 'jinja', 'takataka', 'polluter'] },
  { code: 'LRN_RECOMMEND', label: 'Recommendations & proposals', dim: 'LRN', kw: ['recommend', 'should\\b', 'need(?:s|ed)? to', 'must\\b', 'propose', 'suggest', 'ought', 'it would be better', 'we want', 'framework'] },
  { code: 'LRN_UNINTENDED', label: 'Unintended effects', dim: 'LRN', kw: ['unintended', 'unforeseen', 'side effect', 'backlash', 'displac', 'crime', 'insecurity', 'night (?:vending|trading)', 'moved to', 'shifted to', 'theft', 'riot', 'unrest', 'tension'] },
]
export const THEME_BY_CODE: Record<string, Theme> = Object.fromEntries(THEMES.map(t => [t.code, t]))
const DIM_BY_ID: Record<string, any> = Object.fromEntries(DIMENSIONS.map(d => [d.id, d]))
const THEME_RE = THEMES.map(t => ({ t, re: new RegExp('\\b(?:' + t.kw.join('|') + ')', 'i') }))

// A question that is "about" a theme always carries that theme when the answer is substantive.
export const FIELD_THEME: Record<string, string[]> = {
  b6_resources_text: ['IMP_RESOURCES'], b7_consultation: ['IMP_CONSULT'], b8_grievance_list: ['INC_GRIEVANCE'],
  d1_evidence: ['URB_CONGESTION'], d2_evidence: ['URB_SANITATION'], d3_evidence: ['MKT_ALTERNATIVES'],
  d4_evidence: ['MKT_LICENSING'], d5_evidence: ['OSR_COLLECTION'], d6_evidence: ['URB_BUILDING'],
  g1_success_stories: ['LRN_PRACTICE'], g2_unforeseen: ['LRN_UNINTENDED'], g4_recommendations: ['LRN_RECOMMEND'],
  h1_2: ['IMP_CONSULT'], h1_3: ['MKT_ALTERNATIVES'], h1_7: ['LRN_PRACTICE'], h1_8: ['LRN_RECOMMEND'],
  h2_1: ['IMP_CONSULT'], h2_2: ['INC_LIVELIHOOD'], h2_3: ['MKT_ALTERNATIVES'], h2_4: ['IMP_CONSULT', 'INC_GRIEVANCE'],
  h2_5: ['LRN_RECOMMEND'], h2_6: ['INC_WOMEN_YOUTH'],
  // A2: political leaders & enforcement team
  b3_innovation: ['LRN_PRACTICE'], b4_market_infra: ['MKT_ALTERNATIVES'], b5_allocation: ['MKT_ALTERNATIVES'],
  c1_resources: ['IMP_RESOURCES'], c3_digital_effect: ['OSR_COLLECTION'], c4_coordination: ['IMP_COORD'],
  d1_osr: ['OSR_COLLECTION'], d3_ppp_waste: ['URB_SANITATION'], e1_informal_impact: ['INC_LIVELIHOOD'],
  e2_engagement: ['IMP_CONSULT', 'INC_GRIEVANCE'], f1_political: ['GOV_POLITICAL'], f2_legal: ['GOV_LAW'], f3_recommendations: ['LRN_RECOMMEND'],
  // A3: traders' association (open text)
  f3_comments: ['LRN_RECOMMEND'],
  // A4: national stakeholders
  b1_policy_alignment: ['GOV_CENTRAL'], b3_decentralization: ['GOV_CENTRAL'], c1_coordination: ['IMP_COORD'], c2_bottlenecks: ['GOV_LAW'],
  c3_support: ['IMP_RESOURCES'], d1_digital: ['OSR_COLLECTION'], d2_market_infra: ['MKT_ALTERNATIVES'], d3_osr: ['OSR_COLLECTION'],
  e1_political: ['GOV_POLITICAL'], e2_judicial: ['GOV_LAW'], e3_recommendations: ['LRN_RECOMMEND'],
  // B1: FGD with informal vendors / relocated traders
  m1_prior_notice: ['IMP_CONSULT'], m1_consultation: ['IMP_CONSULT'], m1_understanding: ['IMP_CONSULT'], m2_income: ['INC_LIVELIHOOD'],
  m2_fees: ['MKT_AFFORD'], m2_vulnerable: ['INC_WOMEN_YOUTH'], m3_stalls: ['MKT_ALTERNATIVES'], m3_allocation: ['MKT_ALTERNATIVES'],
  m3_amenities: ['MKT_ALTERNATIVES'], m4_conduct: ['IMP_FORCE'], m4_fairness: ['IMP_CONSISTENCY'], m4_events: ['INC_LIVELIHOOD'],
  m5_barriers: ['MKT_LICENSING'], m5_waste_grievance: ['INC_GRIEVANCE', 'URB_SANITATION'], m5_recommendations: ['LRN_RECOMMEND'],
}
// Free-text fields that are never coded or shown (identifiers)
export const SKIP_TEXT = new Set(['respondent_name', 'enumerator_id', 'interviewee_name', 'interviewer_names', 'facilitator', 'note_taker',
  'designation', 'interviewee_designation', 'interviewee_role_other', 'institution_other', 'activity_other', 'respondent_affiliation_other',
  'trading_location', 'venue'])

const POS = /\b(improv|better|success|effective|clean(?:er|ed)?|reduc\w* (?:congestion|jam)|increas|cooperat|co-operat|support|good|helpful|organi[sz]ed|adequate|complian|orderly|worked well|benefit|progress|positive|gain|appreciat|accept)/gi
const NEG = /\b(fail|poor|worse|resist|lack|insufficient|inadequate|corrupt|harass|brutal|loss|lost|declin|drop|conflict|interfer|expensive|unaffordable|too far|hunger|suffer|complain|weak|delay|shortage|confiscat|violen|unrest|tension|struggl|difficult|problem|reluctan|refus|unclear|injunction)/gi

export function polarity(text: string): string {
  const p = (text.match(POS) || []).length, n = (text.match(NEG) || []).length
  if (p === 0 && n === 0) return 'neutral'
  if (p > 0 && n > 0 && Math.abs(p - n) <= 1) return 'mixed'
  return p > n ? 'positive' : 'negative'
}

export function anonymise(s: string): string {
  return s
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/(?:\+?\d{1,3}[\s-]?)?\(?0?\d{2,3}\)?[\s-]?\d{3}[\s-]?\d{3,4}\b/g, (m) => (m.replace(/\D/g, '').length >= 9 ? '[phone]' : m))
    .trim()
}

export function wordCount(s: string) { return (s.trim().match(/\S+/g) || []).length }
export function isSubstantive(s: string) { return wordCount(s) >= 3 && s.trim().length >= 10 }

export function evidenceFor(field: string, text: string): string {
  if (field === 'audio') return 'reported'
  if (field === 'enumerator_summary' || field === 'interviewer_summary' || field === 'fgd_summary') return 'inferred'
  if (/_evidence$/.test(field)) {
    if (/\b(report|register|records?|statements?|logs?|ifms|minutes|files?|returns|data\b|receipts?|inventory|census|portal|dashboard|ledger)/i.test(text)) return 'documented'
    if (/\b(observ|visual|saw\b|seen\b|walk(?:ed|through)|physically|site visit)/i.test(text)) return 'observed'
  }
  return 'reported'
}

export type Item = { text: string; start?: number }
export type Window = { text: string; start?: number }
// Build ~120-420 char windows out of sentences (or transcript segments) so that excerpts read as quotes.
export function windowize(items: Item[], minLen = 110, maxLen = 420): Window[] {
  const sents: Item[] = []
  for (const it of items) {
    for (const s of it.text.split(/(?<=[.!?])\s+|\n+/)) { const t = s.trim(); if (t) sents.push({ text: t, start: it.start }) }
  }
  const out: Window[] = []
  let cur: Window | null = null
  for (const s of sents) {
    if (!cur) { cur = { text: s.text, start: s.start }; continue }
    if (cur.text.length < minLen && cur.text.length + s.text.length < maxLen) cur.text += ' ' + s.text
    else { out.push(cur); cur = { text: s.text, start: s.start } }
  }
  if (cur) out.push(cur)
  return out
}

export type Coded = { theme: string; dimension: string; objective: string; polarity: string; evidence: string; method: string; excerpt: string; start?: number }
export function codeItems(field: string, items: Item[]): Coded[] {
  const full = items.map(i => i.text).join(' ')
  if (!isSubstantive(full)) return []
  const out: Coded[] = []
  const forced = new Set(FIELD_THEME[field] || [])
  const seen = new Set<string>()
  for (const w of windowize(items)) {
    for (const { t, re } of THEME_RE) {
      if (re.test(w.text)) {
        seen.add(t.code)
        out.push(mk(t, field, w.text, 'keyword', w.start))
      }
    }
  }
  for (const code of forced) {
    if (!seen.has(code)) out.push(mk(THEME_BY_CODE[code], field, full.slice(0, 420), 'field', items[0]?.start))
  }
  return out
}
function mk(t: Theme, field: string, text: string, method: string, start?: number): Coded {
  const ex = anonymise(text.length > 420 ? text.slice(0, 417) + '...' : text)
  return { theme: t.code, dimension: t.dim, objective: DIM_BY_ID[t.dim].obj, polarity: polarity(text), evidence: evidenceFor(field, text), method, excerpt: ex, start }
}

// ---- emergent terms (what the codebook does NOT yet capture) ----
const STOP = new Set(('a,about,above,after,again,all,also,am,an,and,any,are,as,at,be,because,been,before,being,below,between,both,but,by,can,could,did,do,does,doing,down,during,each,few,for,from,further,had,has,have,having,he,her,here,hers,him,his,how,i,if,in,into,is,it,its,just,like,me,more,most,my,no,nor,not,of,off,on,once,only,or,other,our,ours,out,over,own,same,she,so,some,such,than,that,the,their,them,then,there,these,they,this,those,through,to,too,under,until,up,very,was,we,were,what,when,where,which,while,who,whom,why,will,with,would,you,your,yes,okay,ok,um,uh,yeah,really,many,much,often,well,one,two,get,got,make,made,said,say,going,go,done,since,still,even,those,them,want,wanted,because,already,lot,people,time,way,however,therefore,thing,things,within,without,every,upon,among,whether,may,might,shall,said').split(','))
export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []).filter(w => !STOP.has(w))
}
const COVERED = new RegExp('^(?:' + THEMES.flatMap(t => t.kw).join('|') + ')', 'i')
export function emergentTerms(docs: { text: string; grp: string }[], top = 60) {
  const m = new Map<string, { n: number; docs: Set<number>; off: number; trd: number }>()
  docs.forEach((d, i) => {
    const toks = tokens(d.text)
    const grams = new Set<string>()
    for (let k = 0; k < toks.length; k++) {
      grams.add(toks[k])
      if (k + 1 < toks.length) grams.add(toks[k] + ' ' + toks[k + 1])
    }
    for (const g of grams) {
      if (COVERED.test(g) || g.split(' ').some(x => COVERED.test(x))) continue
      let e = m.get(g); if (!e) { e = { n: 0, docs: new Set(), off: 0, trd: 0 }; m.set(g, e) }
      e.n++; if (!e.docs.has(i)) { e.docs.add(i); if (d.grp === 'trader') e.trd++; else e.off++ }
    }
  })
  return [...m.entries()].filter(([, e]) => e.docs.size >= 2)
    .map(([term, e]) => ({ term, docs: e.docs.size, officials: e.off, traders: e.trd, bi: term.includes(' ') }))
    .sort((a, b) => b.docs - a.docs || (b.bi ? 1 : 0) - (a.bi ? 1 : 0)).slice(0, top)
}
