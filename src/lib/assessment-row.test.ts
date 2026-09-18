import { describe, expect, it } from 'vitest'
import { differsFromExtraction, toAssessmentRow, toFieldValues } from './assessment-row'
import type { FormFieldName } from './form-fields'
import type { RiskResult } from './risk'

const FIELDS: FormFieldName[] = [
  'bp_systolic',
  'bp_diastolic',
  'hemoglobin',
  'proteinuria',
  'edema',
  'age',
]

const RESULT: RiskResult = {
  score: 0,
  zone: 'yashil',
  firedFactors: [],
  rulesVersion: '1.0.0',
  missingCriticalFields: [],
}

describe('toFieldValues', () => {
  it('turns blank number inputs into null, never 0', () => {
    const values = toFieldValues({ bp_systolic: '', hemoglobin: '95' }, {}, {})
    expect(values.bp_systolic).toBeNull()
    expect(values.hemoglobin).toBe(95)
  })

  it('keeps false and null apart for booleans', () => {
    const values = toFieldValues({}, { proteinuria: false }, { edema: null })
    expect(values.proteinuria).toBe(false)
    expect(values.edema).toBeNull()
  })
})

describe('differsFromExtraction', () => {
  it('is false when the midwife saved exactly what the model returned', () => {
    const extracted = { bp_systolic: 145, proteinuria: true }
    const saved = toFieldValues({ bp_systolic: '145' }, { proteinuria: true }, {})
    expect(differsFromExtraction(extracted, saved, FIELDS)).toBe(false)
  })

  it('is true when she changed a number', () => {
    const extracted = { bp_systolic: 145 }
    const saved = toFieldValues({ bp_systolic: '150' }, {}, {})
    expect(differsFromExtraction(extracted, saved, FIELDS)).toBe(true)
  })

  it('is true when she corrected a boolean the model got wrong', () => {
    const extracted = { proteinuria: true }
    const saved = toFieldValues({}, { proteinuria: false }, {})
    expect(differsFromExtraction(extracted, saved, FIELDS)).toBe(true)
  })

  it('is true when she filled in a field the model left null', () => {
    // She supplied something the model did not — that is a correction.
    const extracted = { hemoglobin: null }
    const saved = toFieldValues({ hemoglobin: '85' }, {}, {})
    expect(differsFromExtraction(extracted, saved, FIELDS)).toBe(true)
  })

  it('is true when she cleared a value the model filled', () => {
    const extracted = { bp_systolic: 145 }
    const saved = toFieldValues({ bp_systolic: '' }, {}, {})
    expect(differsFromExtraction(extracted, saved, FIELDS)).toBe(true)
  })

  it('treats a false from the model as different from an untouched null', () => {
    // The distinction the whole schema exists to preserve must survive here too.
    const extracted = { edema: false }
    const saved = toFieldValues({}, {}, { edema: null })
    expect(differsFromExtraction(extracted, saved, FIELDS)).toBe(true)
  })

  it('does not report a difference merely because the objects are not identical', () => {
    // Field-by-field, not object identity: the midwife always edits the form,
    // so the two are never the same object and identity would flag every save.
    const extracted = { bp_systolic: 145, bp_diastolic: 95, proteinuria: true }
    const saved = toFieldValues(
      { bp_systolic: '145', bp_diastolic: '95' },
      { proteinuria: true },
      {},
    )
    expect(extracted).not.toBe(saved)
    expect(differsFromExtraction(extracted, saved, FIELDS)).toBe(false)
  })
})

describe('toAssessmentRow provenance', () => {
  it('records a typed visit as having no extraction and no correction', () => {
    const row = toAssessmentRow('preg-1', {}, {}, {}, RESULT, {
      extractedJson: null,
      correctedByHuman: false,
    })
    expect(row.extracted_json).toBeNull()
    expect(row.corrected_by_human).toBe(false)
  })

  it('stores the model response verbatim and the correction flag', () => {
    const raw = { id: 'msg_1', content: [{ type: 'text', text: '{}' }] }
    const row = toAssessmentRow('preg-1', {}, {}, {}, RESULT, {
      extractedJson: raw,
      correctedByHuman: true,
    })
    expect(row.extracted_json).toBe(raw)
    expect(row.corrected_by_human).toBe(true)
  })

  it('writes age to the age_at_assessment column', () => {
    const row = toAssessmentRow('preg-1', { age: '24' }, {}, {}, RESULT, {
      extractedJson: null,
      correctedByHuman: false,
    })
    expect(row.age_at_assessment).toBe(24)
    expect(row.age).toBeUndefined()
  })
})
