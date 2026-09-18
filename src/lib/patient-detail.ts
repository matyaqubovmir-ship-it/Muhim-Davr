/**
 * Everything the patient page shows, read in one go, and the small pure
 * helpers that shape it.
 *
 * Every figure on that page comes from a row read here. The current zone is
 * read from latest_assessment_per_pregnancy (005) and never re-derived; the
 * due date and gestational week reuse the registry's rules in registry.ts, so
 * the two screens can never disagree about the same woman.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { currentGestationalWeek, dueDate } from './registry'
import type { RiskZone } from './risk'
import { parseISODate, startOfDay } from './schedule'

export interface PatientHeader {
  pregnancyId: string
  fullName: string
  district: string
  village: string | null
  birthDate: Date | null
  gravida: number | null
  para: number | null
  lmpDate: Date | null
  /** From 006: true when worked back from a gestational age, null when not known. */
  lmpEstimated: boolean | null
  eddDate: Date | null
  isActive: boolean
  outcome: string | null
}

export interface AssessmentPoint {
  id: string
  visitDate: Date
  createdAt: Date
  bpSystolic: number | null
  bpDiastolic: number | null
  hemoglobin: number | null
  zone: RiskZone
  score: number
  /** Point-table factors, and for a patient's own report, WHO danger-sign codes. */
  firedFactors: string[]
  recordedBy: 'midwife' | 'patient'
  gestationalAgeWeeks: number | null
}

export interface EscalationEntry {
  id: string
  status: string
  source: 'clinic' | 'telegram'
  reason: string
  firedFactors: string[]
  createdAt: Date
  acknowledgedAt: Date | null
  closedAt: Date | null
  referredTo: string | null
  resolutionNote: string | null
}

export interface PatientReportEntry {
  id: string
  createdAt: Date
  messageText: string
  triageLevel: 'immediate' | 'prompt' | 'none'
  /**
   * False when extraction failed and nobody — no model, no rule — read it for
   * danger signs. Its triage_level is 'none' then, which must not be shown as
   * "no sign found".
   */
  processed: boolean
  matchedSigns: string[]
  escalationId: string | null
}

export interface PatientDetail {
  header: PatientHeader
  /** From latest_assessment_per_pregnancy. Null when she has never been assessed. */
  currentZone: RiskZone | null
  /** Oldest first, the order they happened in. */
  assessments: AssessmentPoint[]
  /** Newest first. */
  escalations: EscalationEntry[]
  hasTelegram: boolean
  /** Newest first. */
  reports: PatientReportEntry[]
}

// --- pure helpers -----------------------------------------------------------

/** Whole years between a birth date and a day. */
export function ageOn(birthDate: Date, today: Date): number {
  let age = today.getFullYear() - birthDate.getFullYear()
  const hadBirthday =
    today.getMonth() > birthDate.getMonth() ||
    (today.getMonth() === birthDate.getMonth() && today.getDate() >= birthDate.getDate())
  if (!hadBirthday) age -= 1
  return age
}

/**
 * The most recent gestational age a midwife wrote down, and the day she wrote
 * it: the fallback for gestational week and due date when no LMP is recorded.
 */
export function latestRecordedGa(
  assessments: readonly AssessmentPoint[],
): { weeks: number; on: Date } | null {
  for (let i = assessments.length - 1; i >= 0; i--) {
    const weeks = assessments[i].gestationalAgeWeeks
    if (weeks !== null) return { weeks, on: assessments[i].visitDate }
  }
  return null
}

export function headerFigures(detail: PatientDetail, today: Date) {
  const ga = latestRecordedGa(detail.assessments)
  const { header } = detail
  return {
    age: header.birthDate === null ? null : ageOn(header.birthDate, today),
    gestationalWeek: currentGestationalWeek(header.lmpDate, ga?.weeks ?? null, ga?.on ?? null, today),
    dueDate: dueDate(header.eddDate, header.lmpDate, ga?.weeks ?? null, ga?.on ?? null),
  }
}

/**
 * A y-axis domain in clean steps around the values, with a step of margin so
 * no point sits on the frame. One value gets a band either side of it.
 */
export function niceDomain(values: readonly number[], step: number): [number, number] {
  if (values.length === 0) return [0, step * 4]
  const low = Math.min(...values)
  const high = Math.max(...values)
  // Clamp first, then widen: widening before the clamp let a small lone value
  // end up on a one-step axis.
  let min = Math.max(0, Math.floor((low - step / 2) / step) * step)
  let max = Math.ceil((high + step / 2) / step) * step
  while (max - min < step * 2) {
    if (min - step >= 0) min -= step
    if (max - min < step * 2) max += step
  }
  return [min, max]
}

export function ticks([min, max]: [number, number], step: number): number[] {
  const out: number[] = []
  for (let v = min; v <= max; v += step) out.push(v)
  return out
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * The x-axis label for each assessment: its date, plus its time when another
 * assessment shares that date — otherwise two visits on one day would carry
 * the same label and be indistinguishable.
 */
export function slotLabels(
  assessments: readonly AssessmentPoint[],
): { date: string; time: string | null }[] {
  const perDay = new Map<number, number>()
  for (const a of assessments) {
    const key = startOfDay(a.visitDate).getTime()
    perDay.set(key, (perDay.get(key) ?? 0) + 1)
  }
  return assessments.map((a) => ({
    date: `${pad(a.visitDate.getDate())}.${pad(a.visitDate.getMonth() + 1)}`,
    time:
      (perDay.get(startOfDay(a.visitDate).getTime()) ?? 0) > 1
        ? `${pad(a.createdAt.getHours())}:${pad(a.createdAt.getMinutes())}`
        : null,
  }))
}

/**
 * An assessment's date as the visit date, with the time it was saved: the
 * visit date is the clinical fact, the time only tells same-day visits apart.
 */
export function formatVisit(a: Pick<AssessmentPoint, 'visitDate' | 'createdAt'>): string {
  const day = `${pad(a.visitDate.getDate())}.${pad(a.visitDate.getMonth() + 1)}.${a.visitDate.getFullYear()}`
  return `${day} ${pad(a.createdAt.getHours())}:${pad(a.createdAt.getMinutes())}`
}

/** DD.MM.YYYY HH:MM, local time. */
export function formatMoment(value: Date): string {
  return `${pad(value.getDate())}.${pad(value.getMonth() + 1)}.${value.getFullYear()} ${pad(value.getHours())}:${pad(value.getMinutes())}`
}

// --- the read ---------------------------------------------------------------

const toDate = (value: unknown): Date | null =>
  typeof value === 'string' ? (value.length === 10 ? parseISODate(value) : new Date(value)) : null

/** A number, or null for anything absent or unreadable — never NaN on the page. */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : [])

function one(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? null
  if (typeof value === 'object' && value !== null) return value as Record<string, unknown>
  return null
}

/** Null when there is no such pregnancy. */
export async function loadPatientDetail(
  client: SupabaseClient,
  pregnancyId: string,
): Promise<PatientDetail | null> {
  const [pregnancy, zone, assessments, escalations, channels, reports] = await Promise.all([
    client
      .from('pregnancies')
      .select(
        'id, lmp_date, lmp_estimated, edd_date, gravida, para, is_active, outcome, ' +
          'patients!pregnancies_patient_id_fkey(full_name, birth_date, district, village)',
      )
      .eq('id', pregnancyId)
      .maybeSingle(),
    client.from('latest_assessment_per_pregnancy').select('risk_zone').eq('pregnancy_id', pregnancyId).maybeSingle(),
    client
      .from('assessments')
      .select(
        'id, visit_date, created_at, bp_systolic, bp_diastolic, hemoglobin, risk_zone, risk_score, ' +
          'fired_factors, recorded_by, gestational_age_weeks',
      )
      .eq('pregnancy_id', pregnancyId)
      .order('visit_date', { ascending: true })
      .order('created_at', { ascending: true }),
    client
      .from('escalations')
      .select('id, status, source, reason, fired_factors, created_at, acknowledged_at, closed_at, referred_to, resolution_note')
      .eq('pregnancy_id', pregnancyId)
      .order('created_at', { ascending: false }),
    client.from('patient_channels').select('id', { count: 'exact', head: true }).eq('pregnancy_id', pregnancyId),
    client
      .from('patient_reports')
      .select('id, created_at, message_text, triage_level, matched_signs, escalation_id, extracted_json')
      .eq('pregnancy_id', pregnancyId)
      .order('created_at', { ascending: false }),
  ])

  for (const result of [pregnancy, zone, assessments, escalations, channels, reports]) {
    if (result.error) throw new Error(result.error.message)
  }
  if (!pregnancy.data) return null

  const row = pregnancy.data as unknown as Record<string, unknown>
  const patient = one(row.patients)

  return {
    header: {
      pregnancyId: String(row.id),
      fullName: String(patient?.full_name ?? ''),
      district: String(patient?.district ?? ''),
      village: typeof patient?.village === 'string' ? patient.village : null,
      birthDate: toDate(patient?.birth_date),
      gravida: toNumber(row.gravida),
      para: toNumber(row.para),
      lmpDate: toDate(row.lmp_date),
      lmpEstimated: typeof row.lmp_estimated === 'boolean' ? row.lmp_estimated : null,
      eddDate: toDate(row.edd_date),
      isActive: row.is_active === true,
      outcome: typeof row.outcome === 'string' ? row.outcome : null,
    },
    currentZone: (zone.data?.risk_zone as RiskZone | undefined) ?? null,
    assessments: ((assessments.data ?? []) as unknown as Record<string, unknown>[]).map((a) => ({
      id: String(a.id),
      visitDate: toDate(a.visit_date) ?? new Date(NaN),
      createdAt: toDate(a.created_at) ?? new Date(NaN),
      bpSystolic: toNumber(a.bp_systolic),
      bpDiastolic: toNumber(a.bp_diastolic),
      hemoglobin: toNumber(a.hemoglobin),
      zone: a.risk_zone as RiskZone,
      score: Number(a.risk_score),
      firedFactors: strings(a.fired_factors),
      recordedBy: a.recorded_by === 'patient' ? 'patient' : 'midwife',
      gestationalAgeWeeks: toNumber(a.gestational_age_weeks),
    })),
    escalations: ((escalations.data ?? []) as unknown as Record<string, unknown>[]).map((e) => ({
      id: String(e.id),
      status: String(e.status),
      source: e.source === 'telegram' ? 'telegram' : 'clinic',
      reason: String(e.reason),
      firedFactors: strings(e.fired_factors),
      createdAt: toDate(e.created_at) ?? new Date(NaN),
      acknowledgedAt: toDate(e.acknowledged_at),
      closedAt: toDate(e.closed_at),
      referredTo: typeof e.referred_to === 'string' ? e.referred_to : null,
      resolutionNote: typeof e.resolution_note === 'string' ? e.resolution_note : null,
    })),
    hasTelegram: (channels.count ?? 0) > 0,
    reports: ((reports.data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      createdAt: toDate(r.created_at) ?? new Date(NaN),
      messageText: String(r.message_text),
      triageLevel: r.triage_level === 'immediate' || r.triage_level === 'prompt' ? r.triage_level : 'none',
      processed: r.extracted_json !== null && r.extracted_json !== undefined,
      matchedSigns: strings(r.matched_signs),
      escalationId: typeof r.escalation_id === 'string' ? r.escalation_id : null,
    })),
  }
}
