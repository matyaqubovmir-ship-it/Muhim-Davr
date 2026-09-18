/**
 * The specialist dashboard: what is happening across every district, now.
 *
 * Every figure is read from a row. The zone of each woman is still the one
 * latest_assessment_per_pregnancy decides (005); this file only counts and
 * orders. Aggregation happens here rather than in SQL because pilot volumes
 * are small; each read is capped, and the cap is stated where it applies.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { averageAckMinutes, loadRecentAcknowledgements, minutesBetween } from './escalation-actions'
import { loadDistricts, loadRegistryPatients, sortPatients, type DistrictSummary, type RegistryPatient } from './registry'
import type { RiskZone } from './risk'
import { addDays, formatISODate, parseISODate, startOfDay } from './schedule'

/** Days shown on the activity charts, today included. */
export const ACTIVITY_DAYS = 14

export interface DailyCount {
  /** Local midnight of the day. */
  date: Date
  assessments: number
  escalations: number
}

/**
 * One entry per day for the last `days` days, oldest first, zeros included —
 * a day with nothing recorded is a real zero, not a gap to close over.
 */
export function dailyCounts(
  assessmentDates: readonly Date[],
  escalationDates: readonly Date[],
  today: Date,
  days: number = ACTIVITY_DAYS,
): DailyCount[] {
  const first = addDays(today, -(days - 1))
  const series: DailyCount[] = Array.from({ length: days }, (_, i) => ({
    date: addDays(first, i),
    assessments: 0,
    escalations: 0,
  }))
  const index = (d: Date) => Math.round((startOfDay(d).getTime() - first.getTime()) / 86_400_000)
  for (const d of assessmentDates) {
    const i = index(d)
    if (i >= 0 && i < days) series[i].assessments++
  }
  for (const d of escalationDates) {
    const i = index(d)
    if (i >= 0 && i < days) series[i].escalations++
  }
  return series
}

export interface Totals {
  active: number
  qizil: number
  sariq: number
  yashil: number
  unassessed: number
}

export function totalsOf(districts: readonly DistrictSummary[]): Totals {
  return districts.reduce(
    (sum, d) => ({
      active: sum.active + d.total,
      qizil: sum.qizil + d.qizil,
      sariq: sum.sariq + d.sariq,
      yashil: sum.yashil + d.yashil,
      unassessed: sum.unassessed + d.unassessed,
    }),
    { active: 0, qizil: 0, sariq: 0, yashil: 0, unassessed: 0 },
  )
}

/**
 * Who needs someone's attention: every qizil woman, and anyone of any zone
 * who is overdue or has never been seen by a midwife. Most urgent first.
 */
export function attentionList(patients: readonly RegistryPatient[], limit = 8): RegistryPatient[] {
  return sortPatients(
    patients.filter((p) => p.zone === 'qizil' || p.staleness !== null),
    'zone',
    'asc',
  ).slice(0, limit)
}

export type ActivityKind = 'assessment' | 'escalation' | 'telegram'

export interface ActivityItem {
  id: string
  kind: ActivityKind
  at: Date
  pregnancyId: string
  patientName: string | null
  /** For assessments: the zone that visit scored. */
  zone: RiskZone | null
  /** For assessments: who recorded it. For escalations: where it came from. */
  detail: string | null
}

/** Newest first, across kinds. */
export function mergeActivity(lists: readonly ActivityItem[][], limit = 10): ActivityItem[] {
  return lists
    .flat()
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, limit)
}

export interface DashboardData {
  districts: DistrictSummary[]
  totals: Totals
  attention: RegistryPatient[]
  overdue: number
  openEscalations: number
  /** Minutes the oldest open escalation has waited, or null with none open. */
  oldestOpenMinutes: number | null
  /** When the oldest open escalation was raised, so the screen can keep counting. */
  oldestOpenAt: Date | null
  avgAckMinutes: number | null
  linkedToTelegram: number
  daily: DailyCount[]
  activity: ActivityItem[]
}

// --- reads --------------------------------------------------------------------

function one(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? null
  if (typeof value === 'object' && value !== null) return value as Record<string, unknown>
  return null
}

function nameVia(pregnancy: unknown): string | null {
  const patient = one(one(pregnancy)?.patients)
  return typeof patient?.full_name === 'string' ? patient.full_name : null
}

/** Active pregnancies read for the attention list and overdue count. Far above a region's pilot. */
const DASHBOARD_PATIENT_CAP = 5000

/** Most rows read for the activity charts and feed. Far above a pilot's fortnight. */
const ACTIVITY_READ_CAP = 2000

export async function loadDashboard(client: SupabaseClient, now: Date = new Date()): Promise<DashboardData> {
  const today = startOfDay(now)
  const since = addDays(today, -(ACTIVITY_DAYS - 1))

  const [districts, patients, open, acks, recentAssessments, recentEscalations, recentReports, channels] =
    await Promise.all([
      loadDistricts(client),
      // Everyone, not the patients list's first 200 by name: a qizil woman
      // called Yusupova must not fall off "needs attention" alphabetically.
      loadRegistryPatients(client, { limit: DASHBOARD_PATIENT_CAP }, now),
      client.from('escalations').select('id, created_at').eq('status', 'ochiq'),
      loadRecentAcknowledgements(client, now),
      client
        .from('assessments')
        .select(
          'id, pregnancy_id, visit_date, created_at, risk_zone, recorded_by, ' +
            'pregnancies!assessments_pregnancy_id_fkey(patients(full_name))',
        )
        .gte('visit_date', formatISODate(since))
        .order('created_at', { ascending: false })
        .limit(ACTIVITY_READ_CAP),
      client
        .from('escalations')
        .select('id, pregnancy_id, created_at, source, pregnancies!escalations_pregnancy_id_fkey(patients(full_name))')
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: false })
        .limit(ACTIVITY_READ_CAP),
      client
        .from('patient_reports')
        .select('id, pregnancy_id, created_at, triage_level, extracted_json, pregnancies!patient_reports_pregnancy_id_fkey(patients(full_name))')
        .order('created_at', { ascending: false })
        .limit(10),
      client.from('patient_channels').select('id', { count: 'exact', head: true }),
    ])

  for (const result of [open, recentAssessments, recentEscalations, recentReports, channels]) {
    if (result.error) throw new Error(result.error.message)
  }

  const openRows = (open.data ?? []) as Record<string, unknown>[]
  const openDates = openRows.map((r) => new Date(String(r.created_at)))
  const assessmentRows = (recentAssessments.data ?? []) as unknown as Record<string, unknown>[]
  const escalationRows = (recentEscalations.data ?? []) as unknown as Record<string, unknown>[]
  const reportRows = (recentReports.data ?? []) as unknown as Record<string, unknown>[]

  const activity = mergeActivity([
    assessmentRows.slice(0, 10).map((r) => ({
      id: `a-${String(r.id)}`,
      kind: 'assessment' as const,
      at: new Date(String(r.created_at)),
      pregnancyId: String(r.pregnancy_id),
      patientName: nameVia(r.pregnancies),
      zone: r.risk_zone as RiskZone,
      detail: String(r.recorded_by),
    })),
    escalationRows.slice(0, 10).map((r) => ({
      id: `e-${String(r.id)}`,
      kind: 'escalation' as const,
      at: new Date(String(r.created_at)),
      pregnancyId: String(r.pregnancy_id),
      patientName: nameVia(r.pregnancies),
      zone: null,
      detail: String(r.source),
    })),
    reportRows.map((r) => ({
      id: `t-${String(r.id)}`,
      kind: 'telegram' as const,
      at: new Date(String(r.created_at)),
      pregnancyId: String(r.pregnancy_id),
      patientName: nameVia(r.pregnancies),
      zone: null,
      // 'unprocessed' when extraction failed: triage_level 'none' then means nobody checked.
      detail: r.extracted_json === null || r.extracted_json === undefined ? 'unprocessed' : String(r.triage_level),
    })),
  ])

  return {
    districts,
    totals: totalsOf(districts),
    attention: attentionList(patients),
    overdue: patients.filter((p) => p.staleness?.kind === 'overdue').length,
    openEscalations: openRows.length,
    oldestOpenAt: openDates.length === 0 ? null : new Date(Math.min(...openDates.map((d) => d.getTime()))),
    oldestOpenMinutes:
      openDates.length === 0 ? null : minutesBetween(new Date(Math.min(...openDates.map((d) => d.getTime()))), now),
    avgAckMinutes: averageAckMinutes(acks),
    linkedToTelegram: channels.count ?? 0,
    daily: dailyCounts(
      assessmentRows
        .map((r) => parseISODate(String(r.visit_date)))
        .filter((d): d is Date => d !== null),
      escalationRows.map((r) => new Date(String(r.created_at))),
      today,
    ),
    activity,
  }
}
