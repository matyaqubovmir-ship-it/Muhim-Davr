/**
 * The visits calendar (/visits): who is due, who is overdue, and whether each
 * woman will hear about it — the doctor's side of "does everyone get the dates".
 *
 * Every row is a planned contact from the visits table, the same rows the bot
 * reminds her from (002/004). Nothing here computes a date.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { RiskZone } from './risk'
import { addDays, formatISODate, parseISODate, startOfDay } from './schedule'

/** How far ahead the calendar looks. */
export const CALENDAR_DAYS_AHEAD = 14
/** How far back an unattended planned contact is still shown as overdue. */
export const CALENDAR_DAYS_BACK = 90

export interface CalendarVisit {
  visitId: string
  pregnancyId: string
  fullName: string
  district: string
  village: string | null
  targetWeek: number
  targetDate: Date
  zone: RiskZone | null
  hasTelegram: boolean
  remindersSent: ('ikki_kun' | 'ertalab')[]
}

export type CalendarGroup = 'overdue' | 'today' | 'tomorrow' | 'thisWeek' | 'later'

export const GROUP_ORDER: readonly CalendarGroup[] = ['overdue', 'today', 'tomorrow', 'thisWeek', 'later']

const DAY_MS = 86_400_000

export function groupOf(targetDate: Date, today: Date): CalendarGroup {
  const days = Math.round((startOfDay(targetDate).getTime() - startOfDay(today).getTime()) / DAY_MS)
  if (days < 0) return 'overdue'
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days <= 7) return 'thisWeek'
  return 'later'
}

const ZONE_RANK: Record<string, number> = { qizil: 0, sariq: 1, unassessed: 2, yashil: 3 }

/**
 * Grouped, each group in date order; within a day the red first, then those
 * with no Telegram (someone has to phone them), then by name.
 */
export function groupVisits(visits: readonly CalendarVisit[], today: Date): Record<CalendarGroup, CalendarVisit[]> {
  const groups: Record<CalendarGroup, CalendarVisit[]> = { overdue: [], today: [], tomorrow: [], thisWeek: [], later: [] }
  for (const visit of visits) groups[groupOf(visit.targetDate, today)].push(visit)
  const compare = (a: CalendarVisit, b: CalendarVisit) =>
    a.targetDate.getTime() - b.targetDate.getTime() ||
    ZONE_RANK[a.zone ?? 'unassessed'] - ZONE_RANK[b.zone ?? 'unassessed'] ||
    Number(a.hasTelegram) - Number(b.hasTelegram) ||
    a.fullName.localeCompare(b.fullName, 'uz')
  for (const key of GROUP_ORDER) groups[key].sort(compare)
  return groups
}

function one(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? null
  if (typeof value === 'object' && value !== null) return value as Record<string, unknown>
  return null
}

/** Ids per .in() filter, so a request URL stays short. */
const ID_BATCH = 100

async function inBatches<T>(ids: readonly string[], read: (batch: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += ID_BATCH) out.push(...(await read(ids.slice(i, i + ID_BATCH))))
  return out
}

export async function loadVisitCalendar(client: SupabaseClient, today: Date = new Date()): Promise<CalendarVisit[]> {
  const from = formatISODate(addDays(today, -CALENDAR_DAYS_BACK))
  const to = formatISODate(addDays(today, CALENDAR_DAYS_AHEAD))

  // !inner so the is_active filter removes the visit, not just the embed: an
  // ended pregnancy has no appointments.
  const { data, error } = await client
    .from('visits')
    .select(
      'id, pregnancy_id, target_week, target_date, ' +
        'pregnancies!visits_pregnancy_id_fkey!inner(is_active, patients!pregnancies_patient_id_fkey(full_name, district, village))',
    )
    .eq('status', 'rejalashtirilgan')
    .gte('target_date', from)
    .lte('target_date', to)
    .eq('pregnancies.is_active', true)
    .order('target_date', { ascending: true })
    .limit(2000)
  if (error) throw new Error(error.message)

  const rows = ((data ?? []) as unknown as Record<string, unknown>[]).filter((r) => one(r.pregnancies)?.is_active === true)
  const pregnancyIds = [...new Set(rows.map((r) => String(r.pregnancy_id)))]
  const visitIds = rows.map((r) => String(r.id))

  const [zones, channels, reminders] = await Promise.all([
    inBatches(pregnancyIds, async (batch) => {
      const res = await client.from('latest_assessment_per_pregnancy').select('pregnancy_id, risk_zone').in('pregnancy_id', batch)
      if (res.error) throw new Error(res.error.message)
      return (res.data ?? []) as Record<string, unknown>[]
    }),
    inBatches(pregnancyIds, async (batch) => {
      const res = await client.from('patient_channels').select('pregnancy_id').in('pregnancy_id', batch)
      if (res.error) throw new Error(res.error.message)
      return (res.data ?? []) as Record<string, unknown>[]
    }),
    inBatches(visitIds, async (batch) => {
      const res = await client.from('visit_reminders').select('visit_id, kind').in('visit_id', batch)
      if (res.error) throw new Error(res.error.message)
      return (res.data ?? []) as Record<string, unknown>[]
    }),
  ])

  const zoneOf = new Map(zones.map((z) => [String(z.pregnancy_id), z.risk_zone as RiskZone]))
  const linked = new Set(channels.map((c) => String(c.pregnancy_id)))
  const sent = new Map<string, ('ikki_kun' | 'ertalab')[]>()
  for (const r of reminders) {
    const kinds = sent.get(String(r.visit_id)) ?? []
    const kind = r.kind === 'ertalab' ? 'ertalab' : 'ikki_kun'
    if (!kinds.includes(kind)) kinds.push(kind)
    sent.set(String(r.visit_id), kinds)
  }

  return rows.flatMap((r) => {
    const targetDate = parseISODate(String(r.target_date))
    const patient = one(one(r.pregnancies)?.patients)
    if (targetDate === null || patient === null) return []
    const pregnancyId = String(r.pregnancy_id)
    return [
      {
        visitId: String(r.id),
        pregnancyId,
        fullName: String(patient.full_name ?? ''),
        district: String(patient.district ?? ''),
        village: typeof patient.village === 'string' ? patient.village : null,
        targetWeek: Number(r.target_week),
        targetDate,
        zone: zoneOf.get(pregnancyId) ?? null,
        hasTelegram: linked.has(pregnancyId),
        remindersSent: sent.get(String(r.id)) ?? [],
      },
    ]
  })
}
