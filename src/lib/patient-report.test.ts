import { describe, expect, it } from 'vitest'
import { IMMEDIATE_SIGNS, PROMPT_SIGNS } from './danger-signs'
import {
  PATIENT_REPORT_RULES_VERSION,
  decidePatientReport,
  patientAssessmentRow,
  patientEscalationReason,
} from './patient-report'
import { RULES_VERSION } from './risk'

describe('decidePatientReport — the WHO immediate list', () => {
  it.each(IMMEDIATE_SIGNS)('%s alone makes the report qizil and escalates it', (sign) => {
    const decision = decidePatientReport({ [sign]: true }, null)
    expect(decision.zone).toBe('qizil')
    expect(decision.escalate).toBe(true)
    expect(decision.reply).toBe('immediate')
    expect(decision.writesAssessment).toBe(true)
    expect(decision.firedFactors).toContain(sign)
  })

  it('escalates convulsions even though they are not a point-table input', () => {
    const decision = decidePatientReport({ convulsions: true }, null)
    expect(decision.risk.zone).toBe('yashil') // what the point table alone says
    expect(decision.zone).toBe('qizil') // what is recorded
    expect(decision.risk.score).toBe(0) // a sign forces the zone, it adds no points
  })
})

describe('decidePatientReport — the prompt list', () => {
  it.each(PROMPT_SIGNS)('%s alone asks for a clinic visit and does not escalate', (sign) => {
    const decision = decidePatientReport({ [sign]: true }, null)
    expect(decision.reply).toBe('prompt')
    expect(decision.escalate).toBe(false)
    // Nothing measured and nothing escalated: there is no assessment to write.
    expect(decision.writesAssessment).toBe(false)
  })
})

describe('decidePatientReport — nothing matched', () => {
  it('never produces a reassuring level', () => {
    const decision = decidePatientReport({}, null)
    expect(decision.reply).toBe('none')
    expect(decision.escalate).toBe(false)
    expect(decision.writesAssessment).toBe(false)
  })

  it('treats a denied sign as no match, not as a finding', () => {
    const decision = decidePatientReport({ vaginal_bleeding: false, convulsions: null }, null)
    expect(decision.reply).toBe('none')
    expect(decision.escalate).toBe(false)
  })
})

describe('decidePatientReport — a home blood pressure reading', () => {
  it('is always written as an assessment and scored by the normal rules', () => {
    const decision = decidePatientReport({}, { systolic: 120, diastolic: 80 })
    expect(decision.writesAssessment).toBe(true)
    expect(decision.zone).toBe('yashil')
    expect(decision.escalate).toBe(false)
    expect(decision.reply).toBe('none')
  })

  it('scores 145/95 as moderate hypertension without escalating', () => {
    const decision = decidePatientReport({}, { systolic: 145, diastolic: 95 })
    expect(decision.risk.firedFactors).toEqual(['hypertension_moderate'])
    expect(decision.zone).toBe('sariq')
    expect(decision.escalate).toBe(false)
  })

  it('escalates a severe reading, because a red row escalates whatever made it red', () => {
    const decision = decidePatientReport({}, { systolic: 170, diastolic: 112 })
    expect(decision.risk.firedFactors).toContain('severe_hypertension')
    expect(decision.zone).toBe('qizil')
    expect(decision.escalate).toBe(true)
    expect(decision.reply).toBe('immediate')
  })

  it('keeps the danger-sign reply level when the reading is unremarkable', () => {
    const decision = decidePatientReport({ fever: true }, { systolic: 118, diastolic: 76 })
    expect(decision.reply).toBe('prompt')
    expect(decision.writesAssessment).toBe(true)
  })
})

describe('patientAssessmentRow', () => {
  const bp = { systolic: 150, diastolic: 100 }
  const signs = { severe_headache_with_blurred_vision: true, vaginal_bleeding: false }
  const decision = decidePatientReport(signs, bp)
  const row = patientAssessmentRow('preg-1', signs, bp, decision, { model: 'raw' })

  it('is marked as recorded by the patient', () => {
    expect(row.recorded_by).toBe('patient')
    expect(row.corrected_by_human).toBe(false)
  })

  it('names both rule sets that decided its zone', () => {
    expect(row.rules_version).toBe(PATIENT_REPORT_RULES_VERSION)
    expect(PATIENT_REPORT_RULES_VERSION.startsWith(RULES_VERSION + '+')).toBe(true)
  })

  it('carries the reading, the sign columns and the verbatim extraction', () => {
    expect(row.bp_systolic).toBe(150)
    expect(row.bp_diastolic).toBe(100)
    expect(row.headache_or_visual).toBe(true)
    // A denial she actually wrote is kept as false, not flattened to null.
    expect(row.antepartum_bleeding).toBe(false)
    expect(row.extracted_json).toEqual({ model: 'raw' })
  })

  it('stores the zone, score and factors of the decision', () => {
    expect(row.risk_zone).toBe('qizil')
    expect(row.risk_score).toBe(decision.risk.score)
    expect(row.fired_factors).toEqual(['hypertension_moderate', 'severe_headache_with_blurred_vision'])
  })

  it('leaves the reading null, as a pair, when she sent none', () => {
    const noBp = patientAssessmentRow('p', { convulsions: true }, null, decidePatientReport({ convulsions: true }, null), null)
    expect(noBp.bp_systolic).toBe(null)
    expect(noBp.bp_diastolic).toBe(null)
  })
})

describe('patientEscalationReason', () => {
  it('names the signs and says they came from Telegram', () => {
    const decision = decidePatientReport({ convulsions: true }, null)
    const reason = patientEscalationReason(decision, null)
    expect(reason).toContain('Telegram')
    expect(reason).toContain('Tutqanoq')
  })

  it('states a home reading and what the point table made of it', () => {
    const bp = { systolic: 170, diastolic: 112 }
    const reason = patientEscalationReason(decidePatientReport({}, bp), bp)
    expect(reason).toContain('170/112')
    expect(reason).toContain('uyda')
    expect(reason).toContain('160/110')
  })
})
