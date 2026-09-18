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
  EXTRACTION_BOOLEAN_FIELDS,
  EXTRACTION_NUMBER_FIELDS,
  buildSchema,
} from '../../api/extract'
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

describe('extraction schema shape', () => {
  const schema = buildSchema() as {
    type: string
    properties: Record<string, { type: string[] }>
    required: string[]
    additionalProperties: boolean
  }

  it('makes every field required, so the model must state one value each', () => {
    // Required plus nullable is what forces an explicit answer for every field
    // instead of letting the model quietly omit the ones it is unsure about.
    expect(schema.required.sort()).toEqual(Object.keys(schema.properties).sort())
    expect(schema.additionalProperties).toBe(false)
  })

  it('makes every field nullable, so "not mentioned" is expressible', () => {
    for (const [name, property] of Object.entries(schema.properties)) {
      expect(property.type, `${name} must allow null`).toContain('null')
    }
  })

  it('types booleans as boolean|null, never as a two-state boolean', () => {
    for (const name of EXTRACTION_BOOLEAN_FIELDS) {
      expect(schema.properties[name].type.sort()).toEqual(['boolean', 'null'])
    }
  })

  it('types numbers as number|null', () => {
    for (const name of EXTRACTION_NUMBER_FIELDS) {
      expect(schema.properties[name].type.sort()).toEqual(['null', 'number'])
    }
  })
})
