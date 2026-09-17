/**
 * Maps form values onto an assessments row.
 *
 * This is the only place that knows how a scoring field name becomes a column
 * name. src/lib/schema-sync.test.ts imports COLUMN_OVERRIDES from here rather
 * than keeping its own copy, so the test and the insert can never disagree
 * about where a value is stored.
 */

import type { FormFieldName, UnscoredField } from './form-fields'
import type { AssessmentInput, RiskResult, ScoringInputField } from './risk'

/**
 * Scoring field -> column name, where the two deliberately differ.
 * Anything not listed here uses its field name as the column name.
 */
export const COLUMN_OVERRIDES: Partial<Record<ScoringInputField, string>> = {
  // Stored as a number, never derived from patients.birth_date: age changes,
  // and a frozen score has to stay reproducible from its own row.
  age: 'age_at_assessment',
}

export function columnForField(field: FormFieldName): string {
  return COLUMN_OVERRIDES[field as ScoringInputField] ?? field
}

export type NumericFormValues = Partial<Record<FormFieldName, string>>
export type BooleanFormValues = Partial<Record<FormFieldName, boolean | null>>

/**
 * Empty input means not recorded, which is null — never 0 and never false.
 * A blank box and a zero are different clinical facts.
 */
function toNumberOrNull(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

/** Builds the AssessmentInput that scoreAssessment reads. */
export function toScoringInput(
  numbers: NumericFormValues,
  booleans: BooleanFormValues,
): AssessmentInput {
  const input: Record<string, number | boolean | null> = {}
  for (const [field, raw] of Object.entries(numbers)) {
    input[field] = toNumberOrNull(raw)
  }
  for (const [field, value] of Object.entries(booleans)) {
    input[field] = value ?? null
  }
  return input as AssessmentInput
}

export interface AssessmentRow {
  [column: string]: string | number | boolean | null | string[]
}

/**
 * Builds the row to insert. Every scoring input is written to its own column so
 * the row reproduces its own score without joining to anything mutable — see
 * the snapshot rule in supabase/migrations/001_schema.sql.
 */
export function toAssessmentRow(
  pregnancyId: string,
  numbers: NumericFormValues,
  booleans: BooleanFormValues,
  unscored: Partial<Record<UnscoredField, boolean | null>>,
  result: RiskResult,
): AssessmentRow {
  const row: AssessmentRow = { pregnancy_id: pregnancyId.trim() }

  for (const [field, raw] of Object.entries(numbers)) {
    row[columnForField(field as FormFieldName)] = toNumberOrNull(raw)
  }
  for (const [field, value] of Object.entries(booleans)) {
    row[columnForField(field as FormFieldName)] = value ?? null
  }
  for (const [field, value] of Object.entries(unscored)) {
    row[field] = value ?? null
  }

  row.risk_score = result.score
  row.risk_zone = result.zone
  row.fired_factors = result.firedFactors as unknown as string[]
  row.rules_version = result.rulesVersion

  // Typed entry by a person, with no extraction step in front of it. Once the
  // AI path exists, extracted_json carries the raw output and this flag records
  // whether the midwife changed it before saving.
  row.extracted_json = null
  row.corrected_by_human = false

  return row
}
