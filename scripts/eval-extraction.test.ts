/** The eval's own scoring, so a perfect score means what it says. */

import { describe, expect, it } from 'vitest'
import { CASES, compare, type EvalCase } from './eval-extraction.ts'

const CASE: EvalCase = { name: 't', mode: 'assessment', text: '', expect: { bp_systolic: 140, proteinuria: true } }

describe('compare', () => {
  it('passes only the stated values, with every other field empty', () => {
    expect(compare(CASE, { bp_systolic: 140, proteinuria: true })).toEqual([])
  })

  it('names each kind of mistake, the dangerous one separately', () => {
    const misses = compare(CASE, { bp_systolic: 145, proteinuria: null, hemoglobin: 120, edema: false })
    expect(misses).toEqual(
      expect.arrayContaining([
        { field: 'bp_systolic', expected: 140, got: 145, kind: 'wrong' },
        { field: 'proteinuria', expected: true, got: null, kind: 'missed' },
        { field: 'hemoglobin', expected: null, got: 120, kind: 'invented' },
        { field: 'edema', expected: null, got: false, kind: 'not_mentioned_as_false' },
      ]),
    )
  })
})

describe('the cases', () => {
  it('cover both modes and the traps that matter', () => {
    expect(CASES.filter((c) => c.mode === 'danger_signs').length).toBeGreaterThan(5)
    expect(CASES.some((c) => Object.keys(c.expect).length === 0)).toBe(true)
    expect(CASES.some((c) => Object.values(c.expect).includes(false))).toBe(true)
  })
})
