import { describe, expect, it } from 'vitest'
import { clinicEscalationRow, escalates } from './escalation'
import { CLINIC_ESCALATION_REASON } from './labels'
import { scoreAssessment } from './risk'

describe('escalates', () => {
  it('is true for qizil and only qizil', () => {
    expect(escalates('qizil')).toBe(true)
    expect(escalates('sariq')).toBe(false)
    expect(escalates('yashil')).toBe(false)
  })

  it.each([
    ['severe hypertension', { bp_systolic: 165, bp_diastolic: 100 }],
    ['suspected preeclampsia', { bp_systolic: 142, bp_diastolic: 92, proteinuria: true }],
    ['severe anaemia', { hemoglobin: 65 }],
    ['antepartum bleeding', { antepartum_bleeding: true }],
  ])('catches every absolute flag — %s', (_name, input) => {
    expect(escalates(scoreAssessment(input).zone)).toBe(true)
  })

  it('catches a red zone reached on points alone, with no absolute flag', () => {
    const result = scoreAssessment({
      prior_preeclampsia: true,
      chronic_hypertension: true,
      age: 40,
    })
    expect(result.zone).toBe('qizil')
    expect(escalates(result.zone)).toBe(true)
  })
})

describe('clinicEscalationRow', () => {
  const result = scoreAssessment({ bp_systolic: 170, bp_diastolic: 112, hemoglobin: 65 })
  const row = clinicEscalationRow('assessment-1', 'pregnancy-1', result)

  it('is marked as coming from the clinic', () => {
    expect(row.source).toBe('clinic')
  })

  it('points at the assessment and its pregnancy, for the composite key', () => {
    expect(row.assessment_id).toBe('assessment-1')
    expect(row.pregnancy_id).toBe('pregnancy-1')
  })

  it('carries the fired factors and names each one in the reason', () => {
    expect(row.fired_factors).toEqual(['severe_hypertension', 'severe_anemia'])
    expect(row.reason.startsWith(CLINIC_ESCALATION_REASON)).toBe(true)
    expect(row.reason).toContain('160/110')
    expect(row.reason).toContain('70 g/L')
  })

  it('copies the factor list rather than sharing it', () => {
    expect(row.fired_factors).not.toBe(result.firedFactors)
  })
})
