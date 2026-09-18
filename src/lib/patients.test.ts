import { readFileSync } from 'node:fs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { NEW_PATIENT_UI } from './labels'
import {
  containsPattern,
  registerPatient,
  searchPregnancies,
  validateNewPatient,
  type NewPatientForm,
} from './patients'

const TODAY = new Date(2026, 8, 18)

const form = (overrides: Partial<NewPatientForm> = {}): NewPatientForm => ({
  fullName: 'Test Bemor Qizi',
  birthDate: '1998-05-01',
  district: 'Tuman',
  village: '',
  phone: '',
  lmpMode: 'lmp',
  lmpDate: '2026-04-03',
  gaWeeks: '',
  ...overrides,
})

describe('validateNewPatient', () => {
  it('turns a valid form into the register_patient arguments, tidied', () => {
    const { errors, args } = validateNewPatient(
      form({ fullName: '  Test   Bemor  ', district: ' Tuman ', village: '  ', phone: ' +998 90 123 45 67 ' }),
      TODAY,
    )
    expect(errors).toEqual({})
    expect(args).toEqual({
      p_full_name: 'Test Bemor',
      p_birth_date: '1998-05-01',
      p_district: 'Tuman',
      p_village: null,
      p_phone: '+998 90 123 45 67',
      p_lmp_date: '2026-04-03',
      p_lmp_estimated: false,
    })
  })

  it('works an LMP back from a gestational age, and marks it as estimated', () => {
    const { args } = validateNewPatient(form({ lmpMode: 'ga', gaWeeks: '24', lmpDate: '' }), TODAY)
    expect(args?.p_lmp_date).toBe('2026-04-03')
    expect(args?.p_lmp_estimated).toBe(true)
  })

  it('stores no LMP, and claims nothing about one, when it is not known', () => {
    const { args } = validateNewPatient(form({ lmpMode: 'unknown', lmpDate: '2026-04-03' }), TODAY)
    expect(args?.p_lmp_date).toBe(null)
    expect(args?.p_lmp_estimated).toBe(null)
  })

  it.each([
    ['a missing name', { fullName: ' A ' }, 'fullName', NEW_PATIENT_UI.errName],
    ['a birth date in the future', { birthDate: '2027-01-01' }, 'birthDate', NEW_PATIENT_UI.errBirthDate],
    ['an implausible age', { birthDate: '2020-01-01' }, 'birthDate', NEW_PATIENT_UI.errBirthDate],
    ['no birth date', { birthDate: '' }, 'birthDate', NEW_PATIENT_UI.errBirthDate],
    ['no district', { district: '  ' }, 'district', NEW_PATIENT_UI.errDistrict],
    ['letters in the phone', { phone: '+998 abc' }, 'phone', NEW_PATIENT_UI.errPhone],
    ['too short a phone', { phone: '1234' }, 'phone', NEW_PATIENT_UI.errPhone],
    ['an LMP in the future', { lmpDate: '2026-10-01' }, 'lmpDate', NEW_PATIENT_UI.errLmp],
    ['an LMP over 45 weeks ago', { lmpDate: '2025-10-01' }, 'lmpDate', NEW_PATIENT_UI.errLmp],
    ['a missing LMP', { lmpDate: '' }, 'lmpDate', NEW_PATIENT_UI.errLmp],
    ['a fractional week', { lmpMode: 'ga' as const, gaWeeks: '24.5' }, 'gaWeeks', NEW_PATIENT_UI.errGa],
    ['week zero', { lmpMode: 'ga' as const, gaWeeks: '0' }, 'gaWeeks', NEW_PATIENT_UI.errGa],
    ['no week', { lmpMode: 'ga' as const, gaWeeks: '' }, 'gaWeeks', NEW_PATIENT_UI.errGa],
  ])('refuses %s', (_name, overrides, field, message) => {
    const { errors, args } = validateNewPatient(form(overrides), TODAY)
    expect(args).toBe(null)
    expect(errors[field as keyof typeof errors]).toBe(message)
  })
})

describe('containsPattern', () => {
  it('matches the text literally: % and _ are not wildcards', () => {
    expect(containsPattern('Gul')).toBe('%Gul%')
    expect(containsPattern('50%_x\\')).toBe('%50\\%\\_x\\\\%')
  })
})

/** Records what was asked of it; answers every read with the given rows. */
function fakeClient(rows: unknown[] = []) {
  const calls: { method: string; args: unknown[] }[] = []
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'ilike', 'order', 'limit']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args })
      return builder
    }
  }
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null })
  const client = {
    from: (table: string) => {
      calls.push({ method: 'from', args: [table] })
      return builder
    },
    rpc: async (name: string, args: unknown) => {
      calls.push({ method: 'rpc', args: [name, args] })
      return { data: 'new-pregnancy-id', error: null }
    },
  }
  return { client: client as unknown as SupabaseClient, calls }
}

describe('searchPregnancies', () => {
  it('searches active pregnancies by name, literally, a few at a time', async () => {
    const { client, calls } = fakeClient([{ pregnancy_id: 'p', full_name: 'Gul', district: 'T', village: null }])
    const found = await searchPregnancies(client, ' Gul% ')
    expect(found).toEqual([{ pregnancyId: 'p', fullName: 'Gul', district: 'T', village: null }])
    expect(calls).toContainEqual({ method: 'from', args: ['registry_pregnancies'] })
    expect(calls).toContainEqual({ method: 'ilike', args: ['full_name', '%Gul\\%%'] })
    expect(calls).toContainEqual({ method: 'limit', args: [8] })
  })

  it('resolves a pasted pregnancy id directly', async () => {
    const { client, calls } = fakeClient([])
    await searchPregnancies(client, 'D8668940-1587-40B2-83A4-294B26D450AA')
    expect(calls).toContainEqual({ method: 'eq', args: ['pregnancy_id', 'd8668940-1587-40b2-83a4-294b26d450aa'] })
    expect(calls.some((c) => c.method === 'ilike')).toBe(false)
  })

  it('does not query for one letter', async () => {
    const { client, calls } = fakeClient([])
    expect(await searchPregnancies(client, 'G')).toEqual([])
    expect(calls).toEqual([])
  })
})

describe('registerPatient — the client and migration 006 agree', () => {
  it('calls register_patient with exactly the parameters 006 declares', async () => {
    const sql = readFileSync(new URL('../../supabase/migrations/006_register_patient.sql', import.meta.url), 'utf8')
    const signature = /create or replace function register_patient\(([\s\S]*?)\)\s*returns/.exec(sql)
    expect(signature, 'register_patient not found in 006').not.toBeNull()
    const declared = [...signature![1].matchAll(/\b(p_\w+)\s+\w+/g)].map((m) => m[1])

    const { args } = validateNewPatient(form(), TODAY)
    const { client, calls } = fakeClient()
    expect(await registerPatient(client, args!)).toBe('new-pregnancy-id')
    const [name, sent] = calls.find((c) => c.method === 'rpc')!.args as [string, Record<string, unknown>]
    expect(name).toBe('register_patient')
    expect(Object.keys(sent).sort()).toEqual([...declared].sort())
  })
})
