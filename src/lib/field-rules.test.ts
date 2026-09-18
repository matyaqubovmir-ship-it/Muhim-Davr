import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NUMBER_RULES, numberProblem, numberProblems } from './field-rules'
import { scoreAssessment } from './risk'
import { toScoringInput } from './assessment-row'

describe('numberProblem', () => {
  it('lets a blank box through: not recorded is allowed', () => {
    expect(numberProblem('hemoglobin', '')).toBeNull()
    expect(numberProblem('bp_systolic', undefined)).toBeNull()
  })

  it('refuses text that is not a number', () => {
    expect(numberProblem('bp_systolic', '140/90')).toEqual({ kind: 'not_number' })
  })

  it('refuses a fraction in a whole-number column, which Postgres would reject', () => {
    expect(numberProblem('gestational_age_weeks', '32,5')).toEqual({ kind: 'not_whole' })
    expect(numberProblem('bp_systolic', '120.5')).toEqual({ kind: 'not_whole' })
    expect(numberProblem('bmi', '27,4')).toBeNull()
  })

  it('refuses values outside the database range, naming it', () => {
    expect(numberProblem('bp_systolic', '1400')).toEqual({ kind: 'out_of_range', min: 50, max: 300 })
    expect(numberProblem('age', '9')).toEqual({ kind: 'out_of_range', min: 10, max: 60 })
    expect(numberProblem('para', '0')).toBeNull()
  })

  it('catches haemoglobin written in g/dL instead of scoring it as severe anaemia', () => {
    expect(numberProblem('hemoglobin', '10,5')).toEqual({ kind: 'hb_units', gL: 105 })
    expect(numberProblem('hemoglobin', '9')).toEqual({ kind: 'hb_units', gL: 90 })
    expect(numberProblem('hemoglobin', '105')).toBeNull()
    // Without the check, 10.5 would be scored as g/L — a false qizil.
    expect(scoreAssessment(toScoringInput({ hemoglobin: '10,5' }, {})).zone).toBe('qizil')
  })

  it('still accepts a real severe anaemia in g/L', () => {
    expect(numberProblem('hemoglobin', '64')).toBeNull()
  })
})

describe('numberProblems', () => {
  it('flags the missing half of a blood pressure', () => {
    expect(numberProblems({ bp_systolic: '140', bp_diastolic: '' })).toEqual({ bp_diastolic: { kind: 'bp_half' } })
    expect(numberProblems({ bp_diastolic: '90' })).toEqual({ bp_systolic: { kind: 'bp_half' } })
    expect(numberProblems({ bp_systolic: '140', bp_diastolic: '90' })).toEqual({})
  })

  it('is empty for a clean visit', () => {
    expect(numberProblems({ age: '24', hemoglobin: '112', gestational_age_weeks: '30', bmi: '24,5' })).toEqual({})
  })
})

describe('NUMBER_RULES agree with the schema', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/001_schema.sql', import.meta.url), 'utf8')
  const column: Record<string, string> = { age: 'age_at_assessment', gestational_age_weeks: 'gestational_age_weeks' }

  for (const [field, rule] of Object.entries(NUMBER_RULES)) {
    it(`${field}: ${rule!.min}–${rule!.max}`, () => {
      const name = column[field] ?? field
      expect(sql).toMatch(new RegExp(`${name}\\s+between\\s+${rule!.min}\\s+and\\s+${rule!.max}`))
    })
  }
})
