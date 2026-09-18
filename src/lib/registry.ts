/**
 * The district registry: which districts, how many women in each zone, and
 * who they are.
 *
 * The current zone is NOT decided here. It comes from the
 * latest_assessment_per_pregnancy view (005_latest_assessment_view.sql), read
 * through registry_pregnancies and registry_district_counts. This file only
 * shapes those rows for the screen and works out what depends on today's date,
 * which the database does not know in Tashkent time.
 *
 * No district is listed anywhere in code. The registry shows the districts
 * that have patients, so it covers exactly what is real, and a new viloyat
 * appears the day its first patient is registered.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { RiskZone } from './risk'
import { addDays, parseISODate, startOfDay } from './schedule'

/** Most urgent first, everywhere the zones are laid out. */
export const ZONE_ORDER: readonly RiskZone[] = ['qizil', 'sariq', 'yashil']

export interface DistrictSummary {
  district: string
  qizil: number
  sariq: number
  yashil: number
  /** Active pregnancies with no assessment yet: unknown risk, not low risk. */
  unassessed: number
  total: number
}

/**
 * The district needing the most attention leads: most qizil, then most
 * sariq, then the largest caseload, then by name so the order never jitters.
 */
export function sortDistricts(districts: readonly DistrictSummary[]): DistrictSummary[] {
  return [...districts].sort(
    (a, b) =>
      b.qizil - a.qizil ||
      b.sariq - a.sariq ||
      b.total - a.total ||
      a.district.localeCompare(b.district, 'uz'),
  )
}

export type Staleness =
  /** A planned contact's date has passed and no midwife has seen her since. */
  | { kind: 'overdue'; since: Date }
  /** No midwife assessment on record at all — only her own readings, or nothing. */
  | { kind: 'never_seen' }
  /** No planned contact on record, and a long time since she was seen. */
  | { kind: 'not_seen'; days: number }

/**
 * With no stored schedule to go by, how long is too long unseen. Six weeks is
 * the longest WHO interval after the first trimester (20 to 26 weeks).
 */
export const NOT_SEEN_AFTER_DAYS = 42

export interface RegistryPatient {
  pregnancyId: string
  fullName: string
  village: string | null
  /** Null when she has never been assessed. */
  zone: RiskZone | null
  gestationalWeek: number | null
  dueDate: { date: Date; computed: boolean } | null
  /** The last time a midwife saw her. Her own readings do not count as a visit. */
  lastVisit: Date | null
  staleness: Staleness | null
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000)
}

/**
 * Weeks pregnant today: from the recorded LMP, or else from the most recent
 * gestational age a midwife wrote down, counted forward from that visit.
 */
export function currentGestationalWeek(
  lmp: Date | null,
  latestGaWeeks: number | null,
  latestGaOn: Date | null,
  today: Date,
): number | null {
  let weeks: number | null = null
  if (lmp !== null) {
    weeks = Math.floor(daysBetween(lmp, today) / 7)
  } else if (latestGaWeeks !== null && latestGaOn !== null) {
    weeks = latestGaWeeks + Math.floor(daysBetween(latestGaOn, today) / 7)
  }
  return weeks !== null && weeks >= 0 ? weeks : null
}

/**
 * pregnancies.edd_date when recorded. Otherwise computed — 280 days from the
 * LMP, or from the latest recorded gestational age — and marked as computed,
 * so an estimate is never shown as if someone had written it down.
 */
export function dueDate(
  edd: Date | null,
  lmp: Date | null,
  latestGaWeeks: number | null,
  latestGaOn: Date | null,
): { date: Date; computed: boolean } | null {
  if (edd !== null) return { date: edd, computed: false }
  if (lmp !== null) return { date: addDays(lmp, 280), computed: true }
  if (latestGaWeeks !== null && latestGaOn !== null) {
    return { date: addDays(latestGaOn, 280 - latestGaWeeks * 7), computed: true }
  }
  return null
}

/** Whether she needs chasing, and why. Null when she is not overdue. */
export function staleness(
  lastVisit: Date | null,
  earliestPlannedVisit: Date | null,
  today: Date,
): Staleness | null {
  if (earliestPlannedVisit !== null && daysBetween(earliestPlannedVisit, today) > 0) {
    return { kind: 'overdue', since: earliestPlannedVisit }
  }
  if (lastVisit === null) return { kind: 'never_seen' }
  if (earliestPlannedVisit === null) {
    const days = daysBetween(lastVisit, today)
    if (days > NOT_SEEN_AFTER_DAYS) return { kind: 'not_seen', days }
  }
  return null
}

/** One registry_pregnancies row, as PostgREST returns it. */
export interface RegistryRow {
  pregnancy_id: string
  full_name: string
  village: string | null
  lmp_date: string | null
  edd_date: string | null
  risk_zone: RiskZone | null
  last_clinic_visit_date: string | null
  latest_ga_weeks: number | null
  latest_ga_on: string | null
  earliest_planned_visit: string | null
}

const date = (value: string | null): Date | null => (value === null ? null : parseISODate(value))

export function toRegistryPatient(row: RegistryRow, today: Date): RegistryPatient {
  const lmp = date(row.lmp_date)
  const gaOn = date(row.latest_ga_on)
  const lastVisit = date(row.last_clinic_visit_date)
  return {
    pregnancyId: row.pregnancy_id,
    fullName: row.full_name,
    village: row.village,
    zone: row.risk_zone,
    gestationalWeek: currentGestationalWeek(lmp, row.latest_ga_weeks, gaOn, today),
    dueDate: dueDate(date(row.edd_date), lmp, row.latest_ga_weeks, gaOn),
    lastVisit,
    staleness: staleness(lastVisit, date(row.earliest_planned_visit), today),
  }
}

export type ZoneGroups = Record<RiskZone, RegistryPatient[]> & { unassessed: RegistryPatient[] }

/**
 * Splits a district's patients by zone. Within a zone, whoever needs chasing
 * comes first, then whoever has gone longest unseen, then by name.
 */
export function groupByZone(patients: readonly RegistryPatient[]): ZoneGroups {
  const groups: ZoneGroups = { qizil: [], sariq: [], yashil: [], unassessed: [] }
  for (const patient of patients) groups[patient.zone ?? 'unassessed'].push(patient)

  const lastSeen = (p: RegistryPatient) => p.lastVisit?.getTime() ?? Number.NEGATIVE_INFINITY
  for (const list of Object.values(groups)) {
    list.sort(
      (a, b) =>
        Number(b.staleness !== null) - Number(a.staleness !== null) ||
        lastSeen(a) - lastSeen(b) ||
        a.fullName.localeCompare(b.fullName, 'uz'),
    )
  }
  return groups
}

/** Districts whose counts differ from the previous read, or that are new. */
export function changedDistricts(
  previous: readonly DistrictSummary[],
  next: readonly DistrictSummary[],
): string[] {
  const before = new Map(previous.map((d) => [d.district, d]))
  return next
    .filter((d) => {
      const old = before.get(d.district)
      return (
        old === undefined ||
        old.qizil !== d.qizil ||
        old.sariq !== d.sariq ||
        old.yashil !== d.yashil ||
        old.unassessed !== d.unassessed
      )
    })
    .map((d) => d.district)
}

/** Pregnancies whose zone differs from the previous read, or that are new. */
export function changedPatients(
  previous: readonly RegistryPatient[],
  next: readonly RegistryPatient[],
): string[] {
  const before = new Map(previous.map((p) => [p.pregnancyId, p.zone]))
  return next
    .filter((p) => !before.has(p.pregnancyId) || before.get(p.pregnancyId) !== p.zone)
    .map((p) => p.pregnancyId)
}

/** DD.MM.YYYY, as dates are written in Uzbekistan. */
export function formatDay(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(value.getDate())}.${pad(value.getMonth() + 1)}.${value.getFullYear()}`
}

// --- queries ----------------------------------------------------------------

export async function loadDistricts(client: SupabaseClient): Promise<DistrictSummary[]> {
  const { data, error } = await client
    .from('registry_district_counts')
    .select('district, qizil, sariq, yashil, unassessed, total')
  if (error) throw new Error(error.message)
  return sortDistricts(
    (data ?? []).map((row) => ({
      district: String(row.district),
      qizil: Number(row.qizil),
      sariq: Number(row.sariq),
      yashil: Number(row.yashil),
      unassessed: Number(row.unassessed),
      total: Number(row.total),
    })),
  )
}

export async function loadDistrictPatients(
  client: SupabaseClient,
  district: string,
  today: Date = new Date(),
): Promise<RegistryPatient[]> {
  const { data, error } = await client
    .from('registry_pregnancies')
    .select(
      'pregnancy_id, full_name, village, lmp_date, edd_date, risk_zone, ' +
        'last_clinic_visit_date, latest_ga_weeks, latest_ga_on, earliest_planned_visit',
    )
    .eq('district', district)
  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as RegistryRow[]).map((row) => toRegistryPatient(row, today))
}
