/**
 * Function 5 — the specialist's own phone rings when an escalation opens.
 *
 * The web app already tells a specialist who has it open (Supabase Realtime:
 * a toast, the bell, a sound). This reaches the one who does not: a Telegram
 * message to a configured chat — one doctor, or the district's on-call group.
 *
 * DRY RUN UNLESS TOLD OTHERWISE, like broadcast.ts. With STAFF_ALERT_CHAT_ID set
 * and STAFF_ALERTS unset, every alert is written to the console and nothing is
 * sent. Only STAFF_ALERTS=send sends. An alert channel that can buzz a real
 * doctor's phone during testing is worse than no channel at all.
 *
 * NOTHING HERE DECIDES ANYTHING. Which escalations exist was settled by
 * scoreAssessment and the danger-sign list when they were written; this file
 * reads open ones and relays the reason already on the row. No patient name is
 * sent — see STAFF_ALERT in src/lib/labels.ts.
 *
 * WHERE IT STARTS. At startup the watermark is the newest escalation already in
 * the database — read from the database, not the laptop's clock, so a clock
 * running ahead cannot swallow the first alerts. Escalations raised while the
 * bot was stopped are not sent afterwards: the queue in the app has them, and
 * a burst of stale alerts on restart would teach a doctor to mute the chat.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { STAFF_ALERT } from '../src/lib/labels.ts'
import { addDays, formatISODate, parseISODate } from '../src/lib/schedule.ts'
import { formatUzbekDate } from './messages.ts'
import { latestPerPregnancy, MISSED_VISIT_HOUR, missedVisitWindow } from './missed-visits.ts'
import { clinicClock, SEND_UNTIL_HOUR } from './reminders.ts'
import type { BotStore, FinishedSurvey, OpenEscalation, PlannedVisit } from './store.ts'
import { surveyLines } from './survey.ts'
import type { TelegramClient } from './telegram.ts'

export interface StaffAlertConfig {
  chatId: number
  /** False is a dry run: log, never send. */
  send: boolean
  /** The app's public address, for a link to her page. Null leaves the link out. */
  appUrl: string | null
  intervalMs: number
}

/** Most alerts sent in one sweep. A backlog beyond this waits for the next one. */
export const SWEEP_LIMIT = 20

/**
 * STAFF_ALERT_CHAT_ID turns the feature on (a group's id is negative);
 * STAFF_ALERTS=send makes it send. Null when it is off. Throws on an id that is
 * not a number, rather than guessing whose phone it is.
 */
export function loadStaffAlertConfig(env: Record<string, string | undefined> = process.env): StaffAlertConfig | null {
  const raw = env.STAFF_ALERT_CHAT_ID?.trim()
  if (!raw) return null
  if (!/^-?\d+$/.test(raw)) throw new Error(`STAFF_ALERT_CHAT_ID must be a Telegram chat id (digits, negative for a group), not "${raw}".`)
  const appUrl = env.APP_URL?.trim().replace(/\/+$/, '') || null
  return { chatId: Number(raw), send: env.STAFF_ALERTS?.trim() === 'send', appUrl, intervalMs: 15_000 }
}

export function staffAlertText(alert: OpenEscalation, appUrl: string | null): string {
  return [
    STAFF_ALERT.title,
    `${STAFF_ALERT.district}: ${alert.district ?? '—'}`,
    alert.source === 'telegram' ? STAFF_ALERT.sourceTelegram : STAFF_ALERT.sourceClinic,
    '',
    alert.reason,
    '',
    appUrl === null ? STAFF_ALERT.openInApp : `${STAFF_ALERT.open}: ${appUrl}/patients/${alert.pregnancyId}`,
    STAFF_ALERT.noName,
  ].join('\n')
}

// --- the morning digest ------------------------------------------------------
//
// The doctor's copy of the day's appointments: sent once a day from 07:00
// Tashkent, counts only — how many are due, where, how many have no Telegram
// and must be phoned, how many are overdue — and a link to the calendar.

/** The digest goes out from this hour, Tashkent time. */
export const DIGEST_HOUR = 7
/** How far back an unattended planned contact counts as overdue. */
export const DIGEST_OVERDUE_DAYS = 90

/** Gitignored. The last day a digest went out, so a restart does not send it twice. */
export const DIGEST_FILE = new URL('./.staff-digest.json', import.meta.url)

export interface Digest {
  date: Date
  todayByDistrict: [string, number][]
  todayTotal: number
  todayWithoutTelegram: number
  overdue: number
}

export function buildDigest(visits: readonly PlannedVisit[], linked: ReadonlySet<string>, today: Date): Digest {
  const todayISO = formatISODate(today)
  const due = visits.filter((v) => v.targetDate === todayISO)
  const byDistrict = new Map<string, number>()
  for (const v of due) byDistrict.set(v.district ?? '—', (byDistrict.get(v.district ?? '—') ?? 0) + 1)
  return {
    date: today,
    todayByDistrict: [...byDistrict].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'uz')),
    todayTotal: due.length,
    todayWithoutTelegram: due.filter((v) => !linked.has(v.pregnancyId)).length,
    overdue: visits.filter((v) => v.targetDate < todayISO).length,
  }
}

export function digestText(digest: Digest, appUrl: string | null): string {
  const lines = [STAFF_ALERT.digestTitle(formatUzbekDate(digest.date)), '']
  if (digest.todayTotal === 0) {
    lines.push(STAFF_ALERT.digestNone)
  } else {
    lines.push(STAFF_ALERT.digestToday(digest.todayTotal) + ': ' + digest.todayByDistrict.map(([d, n]) => `${d} ${n}`).join(', '))
    if (digest.todayWithoutTelegram > 0) lines.push(STAFF_ALERT.digestNoTelegram(digest.todayWithoutTelegram))
  }
  if (digest.overdue > 0) lines.push(STAFF_ALERT.digestOverdue(digest.overdue))
  lines.push('', appUrl === null ? STAFF_ALERT.openInApp : `${STAFF_ALERT.digestOpen}: ${appUrl}/visits`, STAFF_ALERT.noNames)
  return lines.join('\n')
}

// --- a contact nobody recorded, and her answers afterwards --------------------
//
// One message per unrecorded contact, from 09:00 the next day (the same moment
// she is told — bot/missed-visits.ts), saying whether she can be reached on
// Telegram or has to be phoned. When the survey she is sent then closes, her
// answers follow — unless they raised an escalation, in which case the red
// alert above already carried them.

/** The unrecorded-contact check runs at most this often; the query is not free. */
export const MISSED_CHECK_EVERY_MS = 5 * 60_000

function isoToUzbek(iso: string | null): string {
  const date = iso === null ? null : parseISODate(iso)
  return date === null ? '—' : formatUzbekDate(date)
}

function patientLink(pregnancyId: string, appUrl: string | null): string {
  return appUrl === null ? STAFF_ALERT.openInApp : `${STAFF_ALERT.open}: ${appUrl}/patients/${pregnancyId}`
}

export function missedVisitAlertText(visit: PlannedVisit, hasTelegram: boolean, appUrl: string | null): string {
  return [
    STAFF_ALERT.missedTitle,
    `${STAFF_ALERT.district}: ${visit.district ?? '—'}`,
    STAFF_ALERT.missedDate(isoToUzbek(visit.targetDate)),
    hasTelegram ? STAFF_ALERT.missedTelegram : STAFF_ALERT.missedNoTelegram,
    '',
    STAFF_ALERT.missedAction,
    '',
    patientLink(visit.pregnancyId, appUrl),
    STAFF_ALERT.noName,
  ].join('\n')
}

export function surveyAlertText(survey: FinishedSurvey, appUrl: string | null): string {
  return [
    survey.status === 'muddati_otgan' ? STAFF_ALERT.surveyExpiredTitle : STAFF_ALERT.surveyTitle,
    `${STAFF_ALERT.district}: ${survey.district ?? '—'}`,
    ...(survey.visitDate === null ? [] : [STAFF_ALERT.surveyVisit(isoToUzbek(survey.visitDate))]),
    '',
    ...surveyLines(survey.answers, { forTelegram: true }),
    '',
    patientLink(survey.pregnancyId, appUrl),
    STAFF_ALERT.noName,
  ].join('\n')
}

export function readDigestDay(file: URL = DIGEST_FILE): string | null {
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { day?: unknown }
    return typeof saved.day === 'string' ? saved.day : null
  } catch {
    return null
  }
}

export function writeDigestDay(day: string, file: URL = DIGEST_FILE): void {
  try {
    writeFileSync(file, JSON.stringify({ day }))
  } catch (caught) {
    console.error('[bot] could not save the digest day: ' + String(caught))
  }
}

export interface StaffAlerter {
  /** Sets the watermark. Call once, before the first sweep. */
  start(): Promise<void>
  /** Sends (or, in a dry run, logs) every escalation opened since the last sweep. Returns how many. */
  sweep(): Promise<number>
  /** Sends today's digest if it is 07:00 or later in Tashkent and it has not gone out today. */
  digest(now?: Date): Promise<boolean>
  /** From 09:00: one message per planned contact that passed unrecorded. Returns how many. */
  missedVisits(now?: Date): Promise<number>
  /** Her answers, for each survey closed since the last sweep that raised no alert. Returns how many. */
  surveys(): Promise<number>
}

export function createStaffAlerter(
  store: BotStore,
  telegram: TelegramClient,
  config: StaffAlertConfig,
  log: (line: string) => void = console.log,
  digestDay: { read: () => string | null; write: (day: string) => void } = { read: () => readDigestDay(), write: (day) => writeDigestDay(day) },
): StaffAlerter {
  let watermark: string | null = null
  let started = false
  let lastDigest: string | null = digestDay.read()
  let lastMissedCheck: number | null = null
  /** A dry run claims nothing in the database, so it remembers here what it already logged. */
  const dryRunLogged = new Set<string>()
  // Surveys start on their own, and failing to (008 not applied yet) must not
  // stop the escalation alerts, which need nothing new.
  let surveyWatermark: string | null = null
  let surveysStarted = false

  return {
    async start() {
      watermark = await store.latestEscalationCreatedAt()
      started = true
    },

    async sweep() {
      if (!started) throw new Error('staff alerts: start() was not called')
      const open = await store.openEscalationsAfter(watermark, SWEEP_LIMIT)
      let relayed = 0
      for (const alert of open) {
        const text = staffAlertText(alert, config.appUrl)
        if (config.send) {
          const outcome = await telegram.sendMessage(config.chatId, text)
          // Not sent and worth retrying: stop here without moving past it, so
          // the next sweep tries it again. Blocked (the bot was removed from
          // the chat) is permanent, and retrying it would stall every alert
          // behind it, so that one is logged and passed.
          if (!outcome.ok && !outcome.blocked) {
            log(`[staff-alert] send failed, will retry: ${outcome.description ?? 'unknown'}`)
            break
          }
          if (outcome.blocked) log(`[staff-alert] chat ${config.chatId} refused the alert: ${outcome.description ?? 'blocked'}`)
        } else {
          log(`[staff-alert] DRY RUN — would send to chat ${config.chatId}:\n${text}`)
        }
        watermark = alert.createdAt
        relayed++
      }
      return relayed
    },

    async digest(now = new Date()) {
      const { today, hour } = clinicClock(now)
      const todayISO = formatISODate(today)
      if (hour < DIGEST_HOUR || lastDigest === todayISO) return false

      const visits = await store.plannedVisitsBetween(formatISODate(addDays(today, -DIGEST_OVERDUE_DAYS)), todayISO)
      const dueIds = [...new Set(visits.filter((v) => v.targetDate === todayISO).map((v) => v.pregnancyId))]
      const chats = await store.findChatsForPregnancies(dueIds)
      const text = digestText(buildDigest(visits, new Set(chats.keys()), today), config.appUrl)

      if (config.send) {
        const outcome = await telegram.sendMessage(config.chatId, text)
        // A failed send is tried again next tick; blocked is logged and passed.
        if (!outcome.ok && !outcome.blocked) {
          log(`[staff-alert] digest send failed, will retry: ${outcome.description ?? 'unknown'}`)
          return false
        }
      } else {
        log(`[staff-alert] DRY RUN — would send the morning digest to chat ${config.chatId}:\n${text}`)
      }
      lastDigest = todayISO
      digestDay.write(todayISO)
      return true
    },

    async missedVisits(now = new Date()) {
      const { today, hour } = clinicClock(now)
      if (hour < MISSED_VISIT_HOUR || hour >= SEND_UNTIL_HOUR) return 0
      if (lastMissedCheck !== null && now.getTime() - lastMissedCheck < MISSED_CHECK_EVERY_MS) return 0
      lastMissedCheck = now.getTime()

      const { since, yesterday } = missedVisitWindow(today)
      const missed = latestPerPregnancy(await store.plannedVisitsBetween(since, yesterday))
      if (missed.length === 0) return 0
      const chats = await store.findChatsForPregnancies([...new Set(missed.map((v) => v.pregnancyId))])

      let relayed = 0
      for (const visit of missed) {
        const text = missedVisitAlertText(visit, chats.has(visit.pregnancyId), config.appUrl)
        if (!config.send) {
          if (dryRunLogged.has(visit.visitId)) continue
          dryRunLogged.add(visit.visitId)
          log(`[staff-alert] DRY RUN — would send to chat ${config.chatId}:\n${text}`)
          relayed++
          continue
        }

        if (!(await store.claimStaffVisitAlert(visit.visitId, config.chatId))) continue
        const outcome = await telegram.sendMessage(config.chatId, text)
        if (!outcome.ok && !outcome.blocked) {
          log(`[staff-alert] missed-visit notice failed, will retry: ${outcome.description ?? 'unknown'}`)
          await store.releaseStaffVisitAlert(visit.visitId, config.chatId).catch((caught: unknown) => {
            log(`[staff-alert] could not release the claim: ${String(caught)}`)
          })
          lastMissedCheck = null
          break
        }
        if (outcome.blocked) log(`[staff-alert] chat ${config.chatId} refused the notice: ${outcome.description ?? 'blocked'}`)
        relayed++
      }
      return relayed
    },

    async surveys() {
      if (!surveysStarted) {
        // Like the escalation watermark: surveys closed before this start are in
        // the app, and are not replayed into the chat.
        surveyWatermark = await store.latestSurveyFinishedAt()
        surveysStarted = true
        return 0
      }

      const closed = await store.finishedSurveysAfter(surveyWatermark, SWEEP_LIMIT)
      let relayed = 0
      for (const survey of closed) {
        const answered = Object.keys(survey.answers).length > 0
        if (survey.escalationId === null && answered) {
          const text = surveyAlertText(survey, config.appUrl)
          if (config.send) {
            const outcome = await telegram.sendMessage(config.chatId, text)
            if (!outcome.ok && !outcome.blocked) {
              log(`[staff-alert] survey summary failed, will retry: ${outcome.description ?? 'unknown'}`)
              break
            }
            if (outcome.blocked) log(`[staff-alert] chat ${config.chatId} refused the summary: ${outcome.description ?? 'blocked'}`)
          } else {
            log(`[staff-alert] DRY RUN — would send to chat ${config.chatId}:\n${text}`)
          }
          relayed++
        }
        surveyWatermark = survey.finishedAt
      }
      return relayed
    },
  }
}
