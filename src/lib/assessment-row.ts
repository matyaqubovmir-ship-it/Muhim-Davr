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

/** Every form field flattened to the value that will be stored. */
export function toFieldValues(
  numbers: NumericFormValues,
  booleans: BooleanFormValues,
  unscored: Partial<Record<UnscoredField, boolean | null>>,
): Partial<Record<FormFieldName, number | boolean | null>> {
  const values: Partial<Record<FormFieldName, number | boolean | null>> = {}
  for (const [field, raw] of Object.entries(numbers)) {
    values[field as FormFieldName] = toNumberOrNull(raw)
  }
  for (const [field, value] of Object.entries(booleans)) {
    values[field as FormFieldName] = value ?? null
  }
  for (const [field, value] of Object.entries(unscored)) {
    values[field as FormFieldName] = value ?? null
  }
  return values
}

/**
 * True if what is being saved differs from what the model returned, in any
 * field. Compared value by value across every form field, not by object
 * identity — the midwife edits the form, not the extraction result, so the two
 * are always different objects and an identity check would report every
 * AI-assisted save as corrected.
 *
 * A field the model left null that she then filled in counts as a correction:
 * she supplied something the model did not.
 */
export function differsFromExtraction(
  extracted: Partial<Record<FormFieldName, number | boolean | null>>,
  saved: Partial<Record<FormFieldName, number | boolean | null>>,
  fields: readonly FormFieldName[],
): boolean {
  for (const field of fields) {
    const before = extracted[field] ?? null
    const after = saved[field] ?? null
    if (before !== after) return true
  }
  return false
}

export interface AssessmentRow {
  [column: string]: string | number | boolean | null | string[]
}

/**
 * Builds the row to insert. Every scoring input is written to its own column so
 * the row reproduces its own score without joining to anything mutable — see
 * the snapshot rule in supabase/migrations/001_schema.sql.
 */
export interface Provenance {
  /** The model's response verbatim, or null when no extraction was run. */
  extractedJson: unknown
  /** True when any saved field differs from what the model returned. */
  correctedByHuman: boolean
}

export function toAssessmentRow(
  pregnancyId: string,
  numbers: NumericFormValues,
  booleans: BooleanFormValues,
  unscored: Partial<Record<UnscoredField, boolean | null>>,
  result: RiskResult,
  provenance: Provenance,
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

  // extracted_json is the model's response stored verbatim, or null when the
  // midwife typed the visit without running extraction. corrected_by_human says
  // whether she changed any of what the model produced before saving.
  row.extracted_json = (provenance.extractedJson ?? null) as AssessmentRow[string]
  row.corrected_by_human = provenance.correctedByHuman

  return row
}
