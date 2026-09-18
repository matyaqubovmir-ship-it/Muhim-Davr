/**
 * Registering a patient, and finding one.
 *
 * register_patient (006_register_patient.sql) writes the patient and her first
 * pregnancy in one transaction. The search reads registry_pregnancies (005), so
 * it finds exactly the active pregnancies the registry shows, with the same
 * names and districts.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { NEW_PATIENT_UI } from './labels'
import { ageOn } from './patient-detail'
import { addDays, estimateLmpFromGestationalAge, formatISODate, parseISODate, startOfDay } from './schedule'

/** Who a visit is being recorded for. */
export interface PregnancyChoice {
  pregnancyId: string
  fullName: string
  district: string
  village: string | null
}

export type LmpMode = 'lmp' | 'ga' | 'unknown'

export interface NewPatientForm {
  fullName: string
  /** YYYY-MM-DD, as a date input gives it. */
  birthDate: string
  district: string
  village: string
  phone: string
  lmpMode: LmpMode
  lmpDate: string
  gaWeeks: string
}

export type NewPatientField = keyof Omit<NewPatientForm, 'lmpMode'>

/** Exactly what register_patient is called with. */
export interface RegisterArgs {
  p_full_name: string
  p_birth_date: string
  p_district: string
  p_village: string | null
  p_phone: string | null
  p_lmp_date: string | null
  p_lmp_estimated: boolean | null
}

/** Same bounds as assessments_age_sane: a typo, not an unusual patient. */
const AGE_RANGE = [10, 60] as const
/** Same bounds as assessments_ga_sane. */
const GA_RANGE = [1, 45] as const

/**
 * Checks the form. Either errors, one per field, or the exact arguments to
 * register the patient with. A gestational age is turned into an LMP here —
 * and marked as estimated, so the date is never later shown as one she gave.
 */
export function validateNewPatient(
  form: NewPatientForm,
  today: Date,
): { errors: Partial<Record<NewPatientField, string>>; args: RegisterArgs | null } {
  const errors: Partial<Record<NewPatientField, string>> = {}
  const now = startOfDay(today)

  const fullName = form.fullName.trim().replace(/\s+/g, ' ')
  if (fullName.length < 3) errors.fullName = NEW_PATIENT_UI.errName

  const birthDate = parseISODate(form.birthDate)
  if (birthDate === null) {
    errors.birthDate = NEW_PATIENT_UI.errBirthDate
  } else {
    const age = ageOn(birthDate, now)
    if (birthDate > now || age < AGE_RANGE[0] || age > AGE_RANGE[1]) errors.birthDate = NEW_PATIENT_UI.errBirthDate
  }

  const district = form.district.trim().replace(/\s+/g, ' ')
  if (district === '') errors.district = NEW_PATIENT_UI.errDistrict

  const phone = form.phone.trim()
  if (phone !== '') {
    const digits = phone.replace(/\D/g, '').length
    if (!/^[+\d\s\-()]+$/.test(phone) || digits < 9 || digits > 15) errors.phone = NEW_PATIENT_UI.errPhone
  }

  let lmp: Date | null = null
  let estimated: boolean | null = null
  if (form.lmpMode === 'lmp') {
    lmp = parseISODate(form.lmpDate)
    if (lmp === null || lmp > now || lmp < addDays(now, -GA_RANGE[1] * 7)) {
      errors.lmpDate = NEW_PATIENT_UI.errLmp
      lmp = null
    } else {
      estimated = false
    }
  } else if (form.lmpMode === 'ga') {
    const weeks = Number(form.gaWeeks.trim())
    if (form.gaWeeks.trim() === '' || !Number.isInteger(weeks) || weeks < GA_RANGE[0] || weeks > GA_RANGE[1]) {
      errors.gaWeeks = NEW_PATIENT_UI.errGa
    } else {
      lmp = estimateLmpFromGestationalAge(now, weeks)
      estimated = true
    }
  }

  if (Object.keys(errors).length > 0) return { errors, args: null }
  return {
    errors,
    args: {
      p_full_name: fullName,
      p_birth_date: form.birthDate,
      p_district: district,
      p_village: form.village.trim() === '' ? null : form.village.trim(),
      p_phone: phone === '' ? null : phone,
      p_lmp_date: lmp === null ? null : formatISODate(lmp),
      p_lmp_estimated: estimated,
    },
  }
}

/** Registers her. Returns the new pregnancy id. */
export async function registerPatient(client: SupabaseClient, args: RegisterArgs): Promise<string> {
  const { data, error } = await client.rpc('register_patient', args)
  if (error) throw new Error(error.message)
  if (typeof data !== 'string') throw new Error('register_patient returned no id')
  return data
}

/** A LIKE pattern matching the text literally: % and _ in a name are not wildcards. */
export function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function toChoice(row: Record<string, unknown>): PregnancyChoice {
  return {
    pregnancyId: String(row.pregnancy_id),
    fullName: String(row.full_name),
    district: String(row.district),
    village: typeof row.village === 'string' ? row.village : null,
  }
}

/**
 * Active pregnancies whose patient's name contains the text. A pasted pregnancy
 * id also resolves, so an id from elsewhere still works.
 */
export async function searchPregnancies(client: SupabaseClient, text: string): Promise<PregnancyChoice[]> {
  const query = text.trim()
  if (query.length < 2) return []

  const request = client.from('registry_pregnancies').select('pregnancy_id, full_name, district, village')
  const { data, error } = UUID.test(query)
    ? await request.eq('pregnancy_id', query.toLowerCase())
    : await request.ilike('full_name', containsPattern(query)).order('full_name').limit(8)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => toChoice(row as Record<string, unknown>))
}

/** Districts already on record, as suggestions — never a fixed list. */
export async function loadKnownDistricts(client: SupabaseClient): Promise<string[]> {
  const { data, error } = await client.from('patients').select('district').limit(1000)
  if (error) throw new Error(error.message)
  return [...new Set((data ?? []).map((row) => String(row.district).trim()).filter((d) => d !== ''))].sort((a, b) =>
    a.localeCompare(b, 'uz'),
  )
}
