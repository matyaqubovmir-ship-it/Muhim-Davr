/**
 * Guards the one duplication in the project.
 *
 * api/extract.ts lists the fields it asks the model for, rather than importing
 * them from form-fields.ts, so the serverless function bundles without reaching
 * into the client source tree. That duplication is only safe if it cannot
 * drift: a field added to the form but missing from the extraction schema would
 * silently never be extracted, and a field in the schema but not in the form
 * would come back with nowhere to put it.
 */

import { describe, expect, it } from 'vitest'
import {
  BOOLEAN_ENUM,
  EXTRACTION_BOOLEAN_FIELDS,
  EXTRACTION_DANGER_SIGNS,
  EXTRACTION_NUMBER_FIELDS,
  buildDangerSignSchema,
  buildSchema,
  coerceBooleanFields,
  coerceDangerSigns,
} from '../../api/extract'
import { ALL_DANGER_SIGNS } from './danger-signs'
import { ALL_FORM_FIELDS, FORM_GROUPS } from './form-fields'

const formNumbers = ALL_FORM_FIELDS.filter((f) => f.kind === 'number').map((f) => f.name)
const formBooleans = ALL_FORM_FIELDS.filter((f) => f.kind === 'boolean').map((f) => f.name)

describe('extraction schema matches the form', () => {
  it('asks for exactly the form’s number fields', () => {
    expect([...EXTRACTION_NUMBER_FIELDS].sort()).toEqual([...formNumbers].sort())
  })

  it('asks for exactly the form’s boolean fields', () => {
    expect([...EXTRACTION_BOOLEAN_FIELDS].sort()).toEqual([...formBooleans].sort())
  })

  it('covers every field the form can hold', () => {
    const asked = new Set<string>([
      ...EXTRACTION_NUMBER_FIELDS,
      ...EXTRACTION_BOOLEAN_FIELDS,
    ])
    for (const group of FORM_GROUPS) {
      for (const field of group.fields) {
        expect(
          asked.has(field.name),
          `The form has "${field.name}" but api/extract.ts never asks the model for it, ` +
            'so it could never be extracted.',
        ).toBe(true)
      }
    }
    expect(asked.size).toBe(ALL_FORM_FIELDS.length)
  })
})

describe('boolean coercion', () => {
  it('maps the three answers onto true, false and null', () => {
    const coerced = coerceBooleanFields({
      proteinuria: 'true',
      edema: 'false',
      headache_or_visual: 'not_mentioned',
    })
    expect(coerced.proteinuria).toBe(true)
    expect(coerced.edema).toBe(false)
    expect(coerced.headache_or_visual).toBe(null)
  })

  it('fails to null, never to false, on anything unrecognised', () => {
    // A finding nobody recorded must not arrive in the form as one that was
    // ruled out, so an unexpected answer becomes "not mentioned".
    const coerced = coerceBooleanFields({ diabetes: 'maybe', kidney_disease: undefined })
    expect(coerced.diabetes).toBe(null)
    expect(coerced.kidney_disease).toBe(null)
  })

  it('leaves number fields untouched', () => {
    const coerced = coerceBooleanFields({ age: 24, hemoglobin: null })
    expect(coerced.age).toBe(24)
    expect(coerced.hemoglobin).toBe(null)
  })
})

describe('extraction schema shape', () => {
  const schema = buildSchema() as {
    type: string
    properties: Record<string, { type: string | string[]; enum?: string[] }>
    required: string[]
    additionalProperties: boolean
  }

  it('makes every field required, so the model must state one value each', () => {
    // Required plus nullable is what forces an explicit answer for every field
    // instead of letting the model quietly omit the ones it is unsure about.
    expect(schema.required.sort()).toEqual(Object.keys(schema.properties).sort())
    expect(schema.additionalProperties).toBe(false)
  })

  it('gives every field a way to say "not mentioned"', () => {
    for (const name of EXTRACTION_NUMBER_FIELDS) {
      expect(schema.properties[name].type, `${name} must allow null`).toContain('null')
    }
    for (const name of EXTRACTION_BOOLEAN_FIELDS) {
      expect(schema.properties[name].enum, `${name} must allow not_mentioned`).toContain(
        'not_mentioned',
      )
    }
  })

  it('types booleans as a three-state enum, never as a two-state boolean', () => {
    for (const name of EXTRACTION_BOOLEAN_FIELDS) {
      expect(schema.properties[name].type).toBe('string')
      expect(schema.properties[name].enum).toEqual([...BOOLEAN_ENUM])
    }
  })

  it('types numbers as number|null', () => {
    for (const name of EXTRACTION_NUMBER_FIELDS) {
      expect((schema.properties[name].type as string[]).sort()).toEqual(['null', 'number'])
    }
  })

  it('stays under the 16 union-typed parameter limit that 400d the request', () => {
    // 23 nullable unions is what made every extraction fail upstream. Numbers
    // are the only unions left; if booleans ever go back to ['boolean', 'null']
    // this count goes to 23 and the API rejects the schema again.
    const unions = Object.values(schema.properties).filter((p) => Array.isArray(p.type))
    expect(unions.length).toBeLessThanOrEqual(16)
  })
})

describe('danger-sign schema matches the triage rule', () => {
  // api/extract.ts keeps its own copy of the sign list, for the same bundling
  // reason as the form fields. A sign the rule knows but the model is never
  // asked about could never be reported — including an immediate one.
  it('asks for exactly the signs danger-signs.ts triages, in the same order', () => {
    expect([...EXTRACTION_DANGER_SIGNS]).toEqual([...ALL_DANGER_SIGNS])
  })

  const schema = buildDangerSignSchema() as {
    properties: Record<string, { type: string | string[]; enum?: string[] }>
    required: string[]
    additionalProperties: boolean
  }

  it('gives every sign the three answers, never a two-state boolean', () => {
    for (const sign of EXTRACTION_DANGER_SIGNS) {
      expect(schema.properties[sign].type).toBe('string')
      expect(schema.properties[sign].enum).toEqual([...BOOLEAN_ENUM])
    }
  })

  it('requires every field and allows nothing else', () => {
    expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort())
    expect(schema.additionalProperties).toBe(false)
  })

  it('asks for a reading as two nullable numbers', () => {
    expect(schema.properties.bp_systolic.type).toEqual(['number', 'null'])
    expect(schema.properties.bp_diastolic.type).toEqual(['number', 'null'])
  })

  it('stays under the 16 union-typed parameter limit', () => {
    const unions = Object.values(schema.properties).filter((p) => Array.isArray(p.type))
    expect(unions.length).toBeLessThanOrEqual(16)
  })

  it('coerces "not_mentioned", and anything unrecognised, to null — never to false', () => {
    const coerced = coerceDangerSigns({
      vaginal_bleeding: 'true',
      convulsions: 'false',
      fever: 'not_mentioned',
      feeling_unwell: 'yes',
      bp_systolic: 140,
    })
    expect(coerced.vaginal_bleeding).toBe(true)
    expect(coerced.convulsions).toBe(false)
    expect(coerced.fever).toBe(null)
    expect(coerced.feeling_unwell).toBe(null)
    expect(coerced.severe_abdominal_pain).toBe(null)
    expect(coerced.bp_systolic).toBe(140)
  })
})
