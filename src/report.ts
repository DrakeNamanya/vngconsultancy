// Indicative link between codebook themes and the reference list of the Inception Report (section 11).
// Numbers = reference numbers in src/literature.json. Shown in the report as "related literature";
// the link is by topic only and must be checked by the author before a claim is cited.
export const THEME_LIT: Record<string, number[]> = {
  IMP_CONSULT: [18], IMP_COORD: [16, 17, 19], IMP_RESOURCES: [11], IMP_CONSISTENCY: [1, 5, 16, 17, 20], IMP_FORCE: [2, 5, 6, 17], IMP_PLAN: [4, 12],
  URB_CONGESTION: [4], URB_SANITATION: [4], URB_BUILDING: [4, 13],
  MKT_ALTERNATIVES: [3, 4, 14, 19], MKT_AFFORD: [3, 14], MKT_LOCATION: [3, 4], MKT_LICENSING: [7, 9, 10, 15],
  OSR_COLLECTION: [3, 10, 12], OSR_LEAKAGE: [2, 3],
  INC_LIVELIHOOD: [1, 2, 9, 10], INC_WOMEN_YOUTH: [9], INC_VULNERABLE: [6], INC_GRIEVANCE: [3, 6],
  GOV_LAW: [8, 12, 13, 14, 15, 16], GOV_POLITICAL: [1, 5, 7], GOV_CENTRAL: [8, 12, 16, 19, 20], GOV_CORRUPTION: [2],
  LRN_PRACTICE: [4, 9], LRN_RECOMMEND: [9], LRN_UNINTENDED: [1, 5],
}
