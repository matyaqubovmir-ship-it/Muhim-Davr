/**
 * What each number box on the midwife's form may hold, checked before a save.
 *
 * THE DATABASE ALREADY REFUSES ALL OF THIS. The ranges below are the CHECK
 * constraints of assessments in 001_schema.sql, and "whole number" is the
 * column type (smallint / integer — only bmi is numeric). Checking here too
 * turns a failed save with a Postgres message into a sentence under the box
 * that is wrong, before anything is sent.
 *
 * ONE RULE IS CLINICAL AS WELL AS TECHNICAL: haemoglobin. The column is g/L.
 * "10,5" typed by someone thinking in g/dL would otherwise score as 10.5 g/L —
 * far below 70, so severe anaemia, a qizil result and an escalation for a
 * woman whose haemoglobin is normal. Nothing below 30 g/L is a survivable
 * reading, so a number that small is taken to be g/dL and refused with the
 * conversion, never converted silently.
 *
 * None of these are scoring thresholds. Those live only in risk.ts.
 */

import { parseDecimal, type NumericFormValues } from './assessment-row.ts'
import type { FormFieldName } from './form-fields.ts'

export interface NumberRule {
  min: number
  max: number
  /** False only where the column is numeric rather than an integer. */
  whole: boolean
}

/** Mirrors the CHECK constraints on assessments (001_schema.sql). */
export const NUMBER_RULES: Partial<Record<FormFieldName, NumberRule>> = {
  bp_systolic: { min: 50, max: 300, whole: true },
  bp_diastolic: { min: 20, max: 200, whole: true },
  hemoglobin: { min: 10, max: 250, whole: true },
  gestational_age_weeks: { min: 1, max: 45, whole: true },
  age: { min: 10, max: 60, whole: true },
  gravida: { min: 1, max: 20, whole: true },
  para: { min: 0, max: 20, whole: true },
  bmi: { min: 10, max: 100, whole: false },
  birth_interval_months: { min: 0, max: 600, whole: true },
  travel_minutes_to_facility: { min: 0, max: 1440, whole: true },
  missed_visits: { min: 0, max: 50, whole: true },
}

/** Below this a haemoglobin was written in g/dL. */
export const HB_GDL_BELOW = 30

export type NumberProblem =
  | { kind: 'not_number' }
  | { kind: 'not_whole' }
  | { kind: 'out_of_range'; min: number; max: number }
  | { kind: 'hb_units'; gL: number }
  /** One half of a blood pressure without the other (assessments_bp_paired). */
  | { kind: 'bp_half' }

export function numberProblem(field: FormFieldName, raw: string | undefined): NumberProblem | null {
  const value = parseDecimal(raw)
  if (value === null) return null
  if (value === 'invalid') return { kind: 'not_number' }
  if (field === 'hemoglobin' && value > 0 && value < HB_GDL_BELOW) {
    return { kind: 'hb_units', gL: Math.round(value * 10) }
  }
  const rule = NUMBER_RULES[field]
  if (rule === undefined) return null
  if (rule.whole && !Number.isInteger(value)) return { kind: 'not_whole' }
  if (value < rule.min || value > rule.max) return { kind: 'out_of_range', min: rule.min, max: rule.max }
  return null
}

/** Every box with a problem. An empty object means the numbers can be saved. */
export function numberProblems(numbers: NumericFormValues): Partial<Record<FormFieldName, NumberProblem>> {
  const problems: Partial<Record<FormFieldName, NumberProblem>> = {}
  for (const [field, raw] of Object.entries(numbers) as [FormFieldName, string | undefined][]) {
    const problem = numberProblem(field, raw)
    if (problem !== null) problems[field] = problem
  }
  // Half a blood pressure is a data-entry error, not a measurement.
  const sys = parseDecimal(numbers.bp_systolic)
  const dia = parseDecimal(numbers.bp_diastolic)
  if (problems.bp_systolic === undefined && problems.bp_diastolic === undefined) {
    if (sys === null && typeof dia === 'number') problems.bp_systolic = { kind: 'bp_half' }
    if (dia === null && typeof sys === 'number') problems.bp_diastolic = { kind: 'bp_half' }
  }
  return problems
}
