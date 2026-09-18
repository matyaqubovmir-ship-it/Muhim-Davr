import { describe, expect, it } from 'vitest'
import { clinicEscalationReason, clinicEscalationRow, escalates } from './escalation'
import { CLINIC_ESCALATION_REASON, FACTOR_SENTENCES, clinicEscalationPointsSentence } from './labels'
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

describe('clinicEscalationReason', () => {
  it('names only the absolute flags, while fired_factors keeps them all', () => {
    const result = scoreAssessment({ bp_systolic: 165, bp_diastolic: 100, gravida: 1, prior_caesarean: true })
    const row = clinicEscalationRow('a', 'p', result)
    expect(row.reason).toBe(`${CLINIC_ESCALATION_REASON} ${FACTOR_SENTENCES.severe_hypertension}`)
    expect(row.reason).not.toContain(FACTOR_SENTENCES.primigravida)
    expect(row.fired_factors).toEqual(['severe_hypertension', 'prior_caesarean', 'primigravida'])
  })

  it('names every absolute flag when several fire, in the scorer’s order', () => {
    const reason = clinicEscalationReason(
      scoreAssessment({ bp_systolic: 150, bp_diastolic: 95, proteinuria: true, antepartum_bleeding: true }),
    )
    expect(reason).toBe(
      [
        CLINIC_ESCALATION_REASON,
        FACTOR_SENTENCES.preeclampsia_suspected,
        FACTOR_SENTENCES.antepartum_bleeding,
      ].join(' '),
    )
  })

  it('explains a red reached on points alone by its total and what added up to it', () => {
    const result = scoreAssessment({ prior_preeclampsia: true, chronic_hypertension: true, age: 40 })
    expect(result.zone).toBe('qizil')
    const reason = clinicEscalationReason(result)
    expect(reason).toContain(clinicEscalationPointsSentence(result.score))
    expect(reason).toContain(FACTOR_SENTENCES.prior_preeclampsia)
    expect(reason).toContain(FACTOR_SENTENCES.chronic_condition)
    expect(reason).toContain(FACTOR_SENTENCES.maternal_age)
  })
})
