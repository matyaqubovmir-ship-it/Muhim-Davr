import { describe, expect, it } from 'vitest'
import { RULES_VERSION, scoreAssessment } from './risk'

describe('absolute flags', () => {
  it('BP 160/100 fires severe_hypertension and forces qizil', () => {
    const r = scoreAssessment({ bp_systolic: 160, bp_diastolic: 100 })
    expect(r.zone).toBe('qizil')
    expect(r.score).toBeGreaterThanOrEqual(8)
    expect(r.firedFactors).toContain('severe_hypertension')
  })

  it('diastolic alone at 110 is enough for severe_hypertension', () => {
    const r = scoreAssessment({ bp_systolic: 130, bp_diastolic: 110 })
    expect(r.zone).toBe('qizil')
    expect(r.score).toBeGreaterThanOrEqual(8)
    expect(r.firedFactors).toContain('severe_hypertension')
  })

  it('proteinuria with BP 145/95 fires preeclampsia_suspected and forces qizil', () => {
    const r = scoreAssessment({
      proteinuria: true,
      bp_systolic: 145,
      bp_diastolic: 95,
      gestational_age_weeks: 30,
    })
    expect(r.zone).toBe('qizil')
    expect(r.score).toBeGreaterThanOrEqual(8)
    expect(r.firedFactors).toContain('preeclampsia_suspected')
  })

  it('Hb 65 fires severe_anemia and forces qizil', () => {
    const r = scoreAssessment({ hemoglobin: 65 })
    expect(r.zone).toBe('qizil')
    expect(r.score).toBeGreaterThanOrEqual(8)
    expect(r.firedFactors).toContain('severe_anemia')
  })

  it('antepartum bleeding alone fires and forces qizil', () => {
    const r = scoreAssessment({ antepartum_bleeding: true })
    expect(r.zone).toBe('qizil')
    expect(r.score).toBeGreaterThanOrEqual(8)
    expect(r.firedFactors).toContain('antepartum_bleeding')
  })
})

describe('banded factors — only the highest band fires', () => {
  it('BP 165/115 scores 8, not 12: the moderate band must not stack', () => {
    const r = scoreAssessment({ bp_systolic: 165, bp_diastolic: 115 })
    expect(r.score).toBe(8)
    expect(r.firedFactors).toContain('severe_hypertension')
    expect(r.firedFactors).not.toContain('hypertension_moderate')
  })

  it('Hb 65 scores 8, not 10: the 70-109 band must not stack', () => {
    const r = scoreAssessment({ hemoglobin: 65 })
    expect(r.score).toBe(8)
    expect(r.firedFactors).toContain('severe_anemia')
    expect(r.firedFactors).not.toContain('anemia')
  })

  it('BP 145/95 alone fires the moderate band for 4', () => {
    const r = scoreAssessment({ bp_systolic: 145, bp_diastolic: 95 })
    expect(r.score).toBe(4)
    expect(r.firedFactors).toEqual(['hypertension_moderate'])
    expect(r.zone).toBe('sariq')
  })

  it('Hb 95 alone fires anemia for 2', () => {
    const r = scoreAssessment({ hemoglobin: 95 })
    expect(r.score).toBe(2)
    expect(r.firedFactors).toEqual(['anemia'])
    expect(r.zone).toBe('yashil')
  })
})

describe('zone boundaries', () => {
  it('exactly 7 is qizil', () => {
    // prior_preeclampsia 4 + prior_loss 3 = 7, no absolute flag
    const r = scoreAssessment({
      prior_preeclampsia: true,
      prior_stillbirth_or_neonatal_death: true,
    })
    expect(r.score).toBe(7)
    expect(r.zone).toBe('qizil')
  })

  it('exactly 6 is sariq — the top of the yellow band', () => {
    // prior_preeclampsia 4 + maternal_age 2 = 6
    const r = scoreAssessment({ prior_preeclampsia: true, age: 39 })
    expect(r.score).toBe(6)
    expect(r.zone).toBe('sariq')
  })

  it('exactly 3 is sariq', () => {
    const r = scoreAssessment({ multiple_gestation: true })
    expect(r.score).toBe(3)
    expect(r.zone).toBe('sariq')
  })

  it('exactly 2 is yashil', () => {
    const r = scoreAssessment({ age: 16 })
    expect(r.score).toBe(2)
    expect(r.zone).toBe('yashil')
  })
})

describe('additive points', () => {
  it('chronic_condition is 4 total, not 4 per condition', () => {
    const r = scoreAssessment({
      chronic_hypertension: true,
      diabetes: true,
      kidney_disease: true,
    })
    expect(r.score).toBe(4)
    expect(r.firedFactors).toEqual(['chronic_condition'])
  })

  it('maternal_age fires below 18 and above 35 but not between', () => {
    expect(scoreAssessment({ age: 17 }).firedFactors).toContain('maternal_age')
    expect(scoreAssessment({ age: 36 }).firedFactors).toContain('maternal_age')
    expect(scoreAssessment({ age: 18 }).firedFactors).not.toContain('maternal_age')
    expect(scoreAssessment({ age: 35 }).firedFactors).not.toContain('maternal_age')
  })

  it('distance_from_care needs strictly more than 60 minutes', () => {
    expect(scoreAssessment({ travel_minutes_to_facility: 61 }).score).toBe(2)
    expect(scoreAssessment({ travel_minutes_to_facility: 60 }).score).toBe(0)
  })

  it('accumulates independent factors', () => {
    // multiple_gestation 3 + prior_caesarean 2 + grand_multipara 2
    // + primigravida 0 (gravida 6) + obesity 1 + short_interval 1 = 9
    const r = scoreAssessment({
      multiple_gestation: true,
      prior_caesarean: true,
      para: 5,
      gravida: 6,
      bmi: 31,
      birth_interval_months: 18,
    })
    expect(r.score).toBe(9)
    expect(r.zone).toBe('qizil')
    expect(r.firedFactors).not.toContain('primigravida')
  })
})

describe('missing data', () => {
  it('all-null input is yashil at 0 with four missing critical fields', () => {
    const r = scoreAssessment({
      bp_systolic: null,
      bp_diastolic: null,
      hemoglobin: null,
      age: null,
      proteinuria: null,
      antepartum_bleeding: null,
      gestational_age_weeks: null,
      gravida: null,
      para: null,
    })
    expect(r.score).toBe(0)
    expect(r.zone).toBe('yashil')
    expect(r.firedFactors).toEqual([])
    expect(r.missingCriticalFields).toEqual([
      'bp_systolic',
      'bp_diastolic',
      'hemoglobin',
      'age',
    ])
    expect(r.missingCriticalFields).toHaveLength(4)
  })

  it('an empty object behaves the same as all-null', () => {
    const r = scoreAssessment({})
    expect(r.score).toBe(0)
    expect(r.zone).toBe('yashil')
    expect(r.missingCriticalFields).toHaveLength(4)
  })

  it('reports only the critical fields that are actually absent', () => {
    const r = scoreAssessment({ bp_systolic: 120, bp_diastolic: 80, age: 28 })
    expect(r.missingCriticalFields).toEqual(['hemoglobin'])
  })

  it('preeclampsia with unknown gestational age still fires, and marks the gap', () => {
    const r = scoreAssessment({
      proteinuria: true,
      bp_systolic: 145,
      bp_diastolic: 95,
      gestational_age_weeks: null,
    })
    expect(r.zone).toBe('qizil')
    expect(r.firedFactors).toContain('preeclampsia_suspected')
    expect(r.firedFactors).toContain('gestational_age_unknown')
  })

  it('the gestational_age_unknown marker carries no points', () => {
    const withGa = scoreAssessment({
      proteinuria: true,
      bp_systolic: 145,
      bp_diastolic: 95,
      gestational_age_weeks: 30,
    })
    const withoutGa = scoreAssessment({
      proteinuria: true,
      bp_systolic: 145,
      bp_diastolic: 95,
    })
    // preeclampsia_suspected 8 + hypertension_moderate 4 = 12. The moderate
    // band is suppressed only by severe_hypertension, not by preeclampsia —
    // they are separate rules, so both fire at 145/95.
    expect(withGa.score).toBe(12)
    // Dropping the week count changes the factor list but not the arithmetic.
    expect(withoutGa.score).toBe(withGa.score)
    expect(withoutGa.firedFactors).toEqual([
      ...withGa.firedFactors.slice(0, 1),
      'gestational_age_unknown',
      ...withGa.firedFactors.slice(1),
    ])
  })

  it('never throws and never fires on undefined, null or NaN', () => {
    expect(() => scoreAssessment({})).not.toThrow()
    const r = scoreAssessment({
      bp_systolic: Number.NaN,
      hemoglobin: Number.NaN,
      age: Number.NaN,
      proteinuria: undefined,
      antepartum_bleeding: null,
    })
    expect(r.score).toBe(0)
    expect(r.firedFactors).toEqual([])
    expect(r.missingCriticalFields).toContain('bp_systolic')
    expect(r.missingCriticalFields).toContain('hemoglobin')
    expect(r.missingCriticalFields).toContain('age')
  })
})

describe('rules version', () => {
  it('is stamped on every result', () => {
    expect(scoreAssessment({}).rulesVersion).toBe('1.0.0')
    expect(RULES_VERSION).toBe('1.0.0')
  })
})
