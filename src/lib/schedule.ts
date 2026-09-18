/**
 * ONA — antenatal visit schedule.
 *
 * THE AI NEVER CHOOSES A DATE AND NEVER CHOOSES A MEDICINE.
 *
 * Every date in this file comes from arithmetic on the last menstrual period
 * and a fixed table of gestational weeks. Every protocol reminder shown
 * alongside it is a static string copied from published guidance. No model is
 * called here, and no model output can reach this file. A generated date or a
 * generated dose would be a clinical instruction invented by a language model,
 * which is not something this system will ever do.
 *
 * Pure, like risk.ts: same inputs, same output. `today` is an explicit input
 * with a default rather than a hidden call to the clock, so tests pin it.
 */

export type RiskZoneForSchedule = 'qizil' | 'sariq' | 'yashil'

export type VisitStatus = 'rejalashtirilgan' | 'bajarilgan' | "o'tkazib yuborilgan"

export interface ScheduledVisit {
  contactNumber: number
  targetWeek: number
  targetDate: Date
  status: VisitStatus
}

export interface ScheduleInput {
  lmpDate: Date
  currentZone: RiskZoneForSchedule
  /** Defaults to the current date. Always passed explicitly in tests. */
  today?: Date
}

/**
 * WHO recommendations on antenatal care for a positive pregnancy experience
 * (WHO, 2016) — the eight-contact ANC model. First contact in the first
 * trimester (by 12 weeks), then 20, 26, 30, 34, 36, 38 and 40 weeks.
 *
 * https://www.who.int/publications/i/item/9789241549912
 */
export const WHO_BASE_CONTACT_WEEKS = [12, 20, 26, 30, 34, 36, 38, 40] as const

/** From this week on, the yellow zone gets an extra contact between each pair. */
export const SARIQ_EXTRA_FROM_WEEK = 26

// --- date helpers ----------------------------------------------------------
// Local-midnight dates throughout. Never toISOString() for display: it converts
// to UTC and can land a visit on the wrong calendar day.

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function addDays(date: Date, days: number): Date {
  const next = startOfDay(date)
  next.setDate(next.getDate() + days)
  return next
}

/** YYYY-MM-DD from local components, safe to store in a Postgres `date`. */
export function formatISODate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function sameDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime()
}

// --- schedule --------------------------------------------------------------

/**
 * The weeks a zone is seen at.
 *
 * yashil — the eight WHO contacts, unchanged.
 * sariq  — plus one midway between each consecutive pair from week 26 on:
 *          28, 32, 35, 37, 39. Before 26 the interval is already long and the
 *          yield of an extra visit is low, so the additions are concentrated
 *          where deterioration actually happens.
 * qizil  — the eight contacts; the urgency is expressed in the dates, not the
 *          week list. See generateSchedule.
 */
export function contactWeeksForZone(zone: RiskZoneForSchedule): number[] {
  // Widened to number[]: WHO_BASE_CONTACT_WEEKS is `as const`, so a spread of it
  // keeps the literal union and will not accept a computed midpoint.
  const base: number[] = [...WHO_BASE_CONTACT_WEEKS]
  if (zone !== 'sariq') return base

  const weeks: number[] = [...base]
  for (let i = 0; i < base.length - 1; i++) {
    const from = base[i]
    const to = base[i + 1]
    if (from < SARIQ_EXTRA_FROM_WEEK) continue
    const midpoint = Math.round((from + to) / 2)
    if (midpoint > from && midpoint < to) weeks.push(midpoint)
  }
  return weeks.sort((a, b) => a - b)
}

/**
 * Builds the contact schedule for one pregnancy.
 *
 * Status here is only ever 'rejalashtirilgan' or "o'tkazib yuborilgan": this
 * function knows the calendar, not what actually happened. 'bajarilgan' is
 * written by the visits table when a visit is completed, and it is part of the
 * type because the same status travels to the database.
 */
export function generateSchedule({
  lmpDate,
  currentZone,
  today = new Date(),
}: ScheduleInput): ScheduledVisit[] {
  const anchor = startOfDay(lmpDate)
  const now = startOfDay(today)

  const visits: ScheduledVisit[] = contactWeeksForZone(currentZone).map(
    (targetWeek, index) => {
      const targetDate = addDays(anchor, targetWeek * 7)
      return {
        contactNumber: index + 1,
        targetWeek,
        targetDate,
        status: targetDate.getTime() < now.getTime()
          ? ("o'tkazib yuborilgan" as VisitStatus)
          : ('rejalashtirilgan' as VisitStatus),
      }
    },
  )

  if (currentZone === 'qizil') {
    // Red means she is seen now. The next contact due is pulled forward to
    // today; the contacts after it keep their dates, so the rest of the
    // schedule stays visible rather than being rebuilt around the emergency.
    const nextIndex = visits.findIndex(
      (visit) => visit.targetDate.getTime() >= now.getTime(),
    )
    if (nextIndex !== -1) {
      visits[nextIndex] = {
        ...visits[nextIndex],
        targetDate: now,
        status: 'rejalashtirilgan',
      }
    }
  }

  return visits
}

/**
 * The contact to highlight: the first one not in the past. Returns null once
 * every contact is behind us.
 */
export function findNextVisit(
  schedule: readonly ScheduledVisit[],
  today: Date = new Date(),
): ScheduledVisit | null {
  const now = startOfDay(today)
  return (
    schedule.find(
      (visit) =>
        visit.targetDate.getTime() >= now.getTime() || sameDay(visit.targetDate, now),
    ) ?? null
  )
}

/** Weeks between a contact and the one before it, for showing the interval. */
export function intervalFromPrevious(
  schedule: readonly ScheduledVisit[],
  index: number,
): number | null {
  if (index <= 0) return null
  return schedule[index].targetWeek - schedule[index - 1].targetWeek
}

/** Parses a Postgres `date` (YYYY-MM-DD) as a local midnight, never through UTC. */
export function parseISODate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return null
  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(year, month - 1, day)
  // new Date(2026, 1, 31) quietly becomes 3 March; a date that moved is not the date given.
  return date.getMonth() === month - 1 && date.getDate() === day ? date : null
}

/**
 * What the schedule is counted from.
 *
 * The recorded LMP when the pregnancy has one: it is the real anchor, and it
 * does not move between visits. Otherwise an estimate from this visit's
 * gestational age, which is rounded to whole weeks and so can be out by several
 * days. Otherwise nothing, and there is no schedule to show or to save.
 */
export function scheduleAnchor(
  recordedLmp: Date | null,
  gestationalAgeWeeks: number | null,
  visitDate: Date,
): Date | null {
  if (recordedLmp !== null) return startOfDay(recordedLmp)
  if (gestationalAgeWeeks !== null && Number.isFinite(gestationalAgeWeeks)) {
    return estimateLmpFromGestationalAge(visitDate, gestationalAgeWeeks)
  }
  return null
}

/** One upcoming contact, as replace_planned_visits in 004_persist_schedule.sql takes it. */
export interface PlannedVisitRow {
  target_week: number
  target_date: string
}

/**
 * The contacts to store as planned: those dated strictly after today.
 *
 * Today's contact is not among them — she is being seen today, and the saved
 * assessment is that visit. Past contacts are not among them either: the
 * calendar says their date passed, not whether she came, so they are never
 * written down as missed.
 */
export function upcomingVisitRows(
  schedule: readonly ScheduledVisit[],
  today: Date,
): PlannedVisitRow[] {
  const now = startOfDay(today).getTime()
  const future = schedule.filter((visit) => startOfDay(visit.targetDate).getTime() > now)

  // A visit a few days early is that contact, not an extra one. Without this,
  // seeing her on Wednesday for a Friday contact left Friday planned: she was
  // reminded of a visit she had already had, then flagged overdue for missing
  // it. When a contact falls on today (including qizil's pulled-forward one),
  // today's visit is that contact and nothing further is consumed.
  const hasToday = schedule.some((visit) => startOfDay(visit.targetDate).getTime() === now)
  const next = future[0]
  const fulfilledEarly =
    !hasToday &&
    next !== undefined &&
    startOfDay(next.targetDate).getTime() - now <= FULFILS_WITHIN_DAYS * 86_400_000

  return (fulfilledEarly ? future.slice(1) : future).map((visit) => ({
    target_week: visit.targetWeek,
    target_date: formatISODate(visit.targetDate),
  }))
}

/**
 * How early a visit can be and still count as the next contact. WHO contacts
 * are at least two weeks apart from week 34, so a week cannot swallow two.
 */
export const FULFILS_WITHIN_DAYS = 7

/**
 * Estimates the LMP from a visit date and a gestational age in weeks.
 *
 * A fallback, not a substitute for a recorded LMP: gestational age on the form
 * is usually rounded to whole weeks, so this can be out by several days.
 * Prefer pregnancies.lmp_date when it is available.
 */
export function estimateLmpFromGestationalAge(
  visitDate: Date,
  gestationalAgeWeeks: number,
): Date {
  return addDays(visitDate, -gestationalAgeWeeks * 7)
}
