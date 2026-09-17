/**
 * ONA — perinatal risk scoring.
 *
 * Pure function, no I/O, no clock, no randomness. Same input always yields the
 * same output, which is what makes it testable and what makes a stored score
 * reproducible.
 *
 * The result is frozen into the assessments row at write time together with
 * RULES_VERSION. Never recompute a historical score with a newer table — if the
 * weights change, bump the version and leave old rows alone.
 */

export const RULES_VERSION = '1.0.0'

export type RiskZone = 'qizil' | 'sariq' | 'yashil'

export type RiskFactor =
  // absolute flags — each forces qizil and adds 8
  | 'severe_hypertension'
  | 'preeclampsia_suspected'
  | 'severe_anemia'
  | 'antepartum_bleeding'
  // marker, carries no points
  | 'gestational_age_unknown'
  // banded
  | 'hypertension_moderate'
  | 'anemia'
  // additive
  | 'prior_preeclampsia'
  | 'chronic_condition'
  | 'prior_loss'
  | 'multiple_gestation'
  | 'maternal_age'
  | 'prior_caesarean'
  | 'grand_multipara'
  | 'distance_from_care'
  | 'missed_visits'
  | 'primigravida'
  | 'obesity'
  | 'family_history'
  | 'short_interval'

/**
 * Fields whose absence we surface explicitly. Missing data is not low risk, it
 * is unknown risk, and the UI is expected to say so rather than render a
 * reassuring green.
 */
export const CRITICAL_FIELDS = ['bp_systolic', 'bp_diastolic', 'hemoglobin', 'age'] as const

export type CriticalField = (typeof CRITICAL_FIELDS)[number]

/** Every field is optional: a partially filled visit must still score. */
export interface AssessmentInput {
  bp_systolic?: number | null
  bp_diastolic?: number | null
  proteinuria?: boolean | null
  hemoglobin?: number | null // g/L
  antepartum_bleeding?: boolean | null
  gestational_age_weeks?: number | null

  prior_preeclampsia?: boolean | null
  chronic_hypertension?: boolean | null
  diabetes?: boolean | null
  kidney_disease?: boolean | null
  prior_stillbirth_or_neonatal_death?: boolean | null
  multiple_gestation?: boolean | null
  age?: number | null
  prior_caesarean?: boolean | null
  para?: number | null
  travel_minutes_to_facility?: number | null
  missed_visits?: number | null
  gravida?: number | null
  bmi?: number | null
  family_history_preeclampsia?: boolean | null
  birth_interval_months?: number | null
}

export interface RiskResult {
  score: number
  zone: RiskZone
  firedFactors: RiskFactor[]
  rulesVersion: string
  missingCriticalFields: CriticalField[]
}

// --- null-safe comparisons -------------------------------------------------
// A null, undefined or non-finite value never fires its factor and never
// throws. These helpers are the only place that rule is implemented.

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function gte(value: unknown, threshold: number): boolean {
  return isNumber(value) && value >= threshold
}

function gt(value: unknown, threshold: number): boolean {
  return isNumber(value) && value > threshold
}

function lt(value: unknown, threshold: number): boolean {
  return isNumber(value) && value < threshold
}

function inRange(value: unknown, low: number, high: number): boolean {
  return isNumber(value) && value >= low && value <= high
}

/** Booleans must be exactly true; a null checkbox is not a "no", it is unknown. */
function isTrue(value: unknown): boolean {
  return value === true
}

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'number') return Number.isFinite(value)
  return true
}

export function scoreAssessment(input: AssessmentInput): RiskResult {
  // Defensive: a null input scores as fully unknown rather than throwing.
  const a: AssessmentInput = input ?? {}

  const firedFactors: RiskFactor[] = []
  let score = 0
  let hasAbsoluteFlag = false

  const fire = (factor: RiskFactor, points: number) => {
    firedFactors.push(factor)
    score += points
  }

  // --- absolute flags: force qizil, 8 points each ---------------------------

  const severeHypertension = gte(a.bp_systolic, 160) || gte(a.bp_diastolic, 110)
  if (severeHypertension) {
    hasAbsoluteFlag = true
    fire('severe_hypertension', 8)
  }

  // Deliberately NOT gated on gestational age: an unknown week count must not
  // silence this flag. When the week count is missing we fire anyway and mark
  // the gap so the reviewer can see why the finding is less certain.
  const preeclampsiaSuspected =
    isTrue(a.proteinuria) && (gte(a.bp_systolic, 140) || gte(a.bp_diastolic, 90))
  if (preeclampsiaSuspected) {
    hasAbsoluteFlag = true
    fire('preeclampsia_suspected', 8)
    if (!isPresent(a.gestational_age_weeks)) {
      firedFactors.push('gestational_age_unknown') // marker only, 0 points
    }
  }

  const severeAnemia = lt(a.hemoglobin, 70)
  if (severeAnemia) {
    hasAbsoluteFlag = true
    fire('severe_anemia', 8)
  }

  if (isTrue(a.antepartum_bleeding)) {
    hasAbsoluteFlag = true
    fire('antepartum_bleeding', 8)
  }

  // --- banded factors: only the highest band in a group may fire ------------

  if (!severeHypertension && (gte(a.bp_systolic, 140) || gte(a.bp_diastolic, 90))) {
    fire('hypertension_moderate', 4)
  }

  if (!severeAnemia && inRange(a.hemoglobin, 70, 109)) {
    fire('anemia', 2)
  }

  // --- additive points: each fires at most once -----------------------------

  if (isTrue(a.prior_preeclampsia)) fire('prior_preeclampsia', 4)

  // 4 points total for any one or more of these, not 4 each.
  if (isTrue(a.chronic_hypertension) || isTrue(a.diabetes) || isTrue(a.kidney_disease)) {
    fire('chronic_condition', 4)
  }

  if (isTrue(a.prior_stillbirth_or_neonatal_death)) fire('prior_loss', 3)
  if (isTrue(a.multiple_gestation)) fire('multiple_gestation', 3)
  if (lt(a.age, 18) || gt(a.age, 35)) fire('maternal_age', 2)
  if (isTrue(a.prior_caesarean)) fire('prior_caesarean', 2)
  if (gte(a.para, 5)) fire('grand_multipara', 2)
  if (gt(a.travel_minutes_to_facility, 60)) fire('distance_from_care', 2)
  if (gte(a.missed_visits, 2)) fire('missed_visits', 2)
  if (a.gravida === 1) fire('primigravida', 1)
  if (gte(a.bmi, 30)) fire('obesity', 1)
  if (isTrue(a.family_history_preeclampsia)) fire('family_history', 1)
  if (lt(a.birth_interval_months, 24)) fire('short_interval', 1)

  // --- zone -----------------------------------------------------------------

  let zone: RiskZone
  if (hasAbsoluteFlag) zone = 'qizil'
  else if (score >= 7) zone = 'qizil'
  else if (score >= 3) zone = 'sariq'
  else zone = 'yashil'

  const missingCriticalFields = CRITICAL_FIELDS.filter((field) => !isPresent(a[field]))

  return {
    score,
    zone,
    firedFactors,
    rulesVersion: RULES_VERSION,
    missingCriticalFields,
  }
}
