/**
 * ONA — WHO obstetric danger signs, and the triage rule over them.
 *
 * THE MODEL DOES NOT DECIDE URGENCY.
 *
 * The same division as risk.ts and schedule.ts: a model may read a woman's own
 * words and say which signs she named, and that is all it does. Which of those
 * signs is an emergency is this file's fixed list, and it is a copy of published
 * guidance, not a judgement made at runtime. A language model has no path to
 * changing a sign's level, because the level is not an input anywhere — it is a
 * constant here.
 *
 * Pure: no I/O, no clock, no randomness.
 *
 * Source: WHO recommendations on antenatal care for a positive pregnancy
 * experience (2016), danger signs requiring immediate care.
 * https://www.who.int/publications/i/item/9789241549912
 */

/**
 * Go now. Any one of these is an emergency on its own.
 *
 * Note that severe headache and blurred vision are ONE sign, not two. A headache
 * alone is not on this list and neither is blurred vision alone; together they
 * are the classic presentation of severe preeclampsia. Splitting them would
 * raise an emergency for every headache in the district, which is the fastest
 * way to teach a doctor to ignore the queue.
 */
export const IMMEDIATE_SIGNS = [
  'vaginal_bleeding',
  'convulsions',
  'severe_headache_with_blurred_vision',
  'fever_unable_to_rise',
  'severe_abdominal_pain',
  'fast_or_difficult_breathing',
] as const

/** Be seen soon, but not an emergency tonight. */
export const PROMPT_SIGNS = [
  'fever',
  'abdominal_pain',
  'feeling_unwell',
  'swelling_face_hands_legs',
] as const

export type ImmediateSign = (typeof IMMEDIATE_SIGNS)[number]
export type PromptSign = (typeof PROMPT_SIGNS)[number]
export type DangerSign = ImmediateSign | PromptSign

export const ALL_DANGER_SIGNS: readonly DangerSign[] = [
  ...IMMEDIATE_SIGNS,
  ...PROMPT_SIGNS,
]

/**
 * What she said about each sign. Three states, exactly as everywhere else in
 * this system: true is present, false is asked and absent, null is not
 * mentioned. See the null convention in supabase/migrations/001_schema.sql.
 */
export type DangerSignReport = Partial<Record<DangerSign, boolean | null>>

export type TriageLevel = 'immediate' | 'prompt' | 'none'

export interface TriageResult {
  level: TriageLevel
  /** Immediate-list signs she reported, in the fixed order above. */
  immediate: ImmediateSign[]
  /** Prompt-list signs she reported, in the fixed order above. */
  prompt: PromptSign[]
}

/** Exactly true. A null is not a no, and a false is not a finding. */
function isTrue(value: unknown): boolean {
  return value === true
}

/**
 * The triage rule, entire.
 *
 * One immediate sign is enough. There is no scoring, no threshold and no
 * combination logic, because none of those appear in the guidance: the list is
 * a list, and anything on it means go now.
 */
export function triageDangerSigns(report: DangerSignReport): TriageResult {
  const signs: DangerSignReport = report ?? {}

  const immediate = IMMEDIATE_SIGNS.filter((sign) => isTrue(signs[sign]))
  const prompt = PROMPT_SIGNS.filter((sign) => isTrue(signs[sign]))

  let level: TriageLevel = 'none'
  if (immediate.length > 0) level = 'immediate'
  else if (prompt.length > 0) level = 'prompt'

  return { level, immediate: [...immediate], prompt: [...prompt] }
}

/**
 * Danger sign -> the assessments column that records the same observation.
 *
 * Only three of the ten have one. That is not an oversight to be fixed by adding
 * columns: assessments carries the inputs the risk score reads, and convulsions,
 * breathing difficulty and abdominal pain are not scoring inputs. They travel on
 * the escalation instead, where they are the reason it was raised.
 *
 * A sign with no column is not lost. It is in the assessment's fired_factors
 * and extracted_json, in escalations.fired_factors and in the escalation
 * reason — see src/lib/patient-report.ts.
 */
export const DANGER_SIGN_COLUMNS: Partial<Record<DangerSign, string>> = {
  vaginal_bleeding: 'antepartum_bleeding',
  severe_headache_with_blurred_vision: 'headache_or_visual',
  swelling_face_hands_legs: 'edema',
}

/**
 * The subset of a report that can be written onto an assessments row.
 *
 * Carries false through as false: "qon ketmayapti" is a finding that was checked
 * and found absent, and flattening it to null would throw away the one thing she
 * actually answered. Only a sign she never mentioned stays null.
 */
export function dangerSignsToAssessmentValues(
  report: DangerSignReport,
): Record<string, boolean | null> {
  const values: Record<string, boolean | null> = {}
  for (const [sign, column] of Object.entries(DANGER_SIGN_COLUMNS)) {
    const reported = report[sign as DangerSign]
    if (reported === undefined) continue
    // A combined sign's "no" is not a "no" for its column. "Headache, but my
    // eyes are fine" makes severe_headache_with_blurred_vision false while she
    // plainly has a headache, so headache_or_visual must not be written false.
    values[column] = COMBINED_SIGNS.has(sign as DangerSign) && reported === false ? null : reported
  }
  return values
}

/**
 * Signs that are two findings at once. Only "present" carries over to the
 * single-finding column they share; "absent" means only that the pair was not
 * both there.
 */
const COMBINED_SIGNS: ReadonlySet<DangerSign> = new Set(['severe_headache_with_blurred_vision'])
