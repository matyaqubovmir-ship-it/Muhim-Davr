/**
 * Function 5b — the morning after a planned contact nobody recorded.
 *
 * From 09:00 Tashkent, for each active pregnancy whose planned contact's day has
 * passed with no visit entered, she gets one message: the visit was not
 * recorded, please call your midwife — and the first question of the survey
 * (bot/survey.ts). The specialist is told separately, from bot/staff-alerts.ts.
 *
 * NO DATE IS INVENTED AND NOTHING IS MARKED MISSED. The date is the visits row's,
 * written by generateSchedule. The row stays 'rejalashtirilgan': 004 explains
 * why the calendar cannot say whether she came, and missedVisitNotice in
 * bot/messages.ts says only that nothing was recorded.
 *
 * WHY 09:00 THE NEXT DAY. A midwife who enters her visits in the evening has the
 * rest of the day; a notice sent the same afternoon would tell women who were
 * seen that they were not. The lookback of a few days catches a morning the bot
 * was not running, the way reminders.ts catches a missed two-day reminder.
 *
 * ONCE PER CONTACT PER CHAT, guarded by visit_reminders exactly like the other
 * reminders: claim first, send only if the claim succeeded, give it back if the
 * send failed for a reason worth retrying.
 */

import { addDays, formatISODate, parseISODate } from '../src/lib/schedule.ts'
import { missedVisitNotice } from './messages.ts'
import { clinicClock, SEND_UNTIL_HOUR } from './reminders.ts'
import type { BotStore, PlannedVisit } from './store.ts'
import { openingMessage, SURVEY_STEPS, SURVEY_TTL_HOURS } from './survey.ts'
import type { TelegramClient } from './telegram.ts'

/** Not before this hour, Tashkent time, the day after the planned contact. */
export const MISSED_VISIT_HOUR = 9

/** How many days back an unrecorded contact still gets its notice. */
export const MISSED_VISIT_LOOKBACK_DAYS = 3

/** The window of dates an unrecorded contact is looked for in: [since, yesterday]. */
export function missedVisitWindow(today: Date): { since: string; yesterday: string } {
  return {
    since: formatISODate(addDays(today, -MISSED_VISIT_LOOKBACK_DAYS)),
    yesterday: formatISODate(addDays(today, -1)),
  }
}

/**
 * The latest unrecorded contact of each pregnancy. Two in the window — the bot
 * was off for days — are one conversation about the most recent, not two.
 */
export function latestPerPregnancy(visits: readonly PlannedVisit[]): PlannedVisit[] {
  const latest = new Map<string, PlannedVisit>()
  for (const visit of visits) {
    const seen = latest.get(visit.pregnancyId)
    if (seen === undefined || visit.targetDate > seen.targetDate) latest.set(visit.pregnancyId, visit)
  }
  return [...latest.values()].sort((a, b) => a.targetDate.localeCompare(b.targetDate) || a.visitId.localeCompare(b.visitId))
}

/** One sweep. Returns how many notices were sent. */
export async function sendMissedVisitNotices(
  store: BotStore,
  telegram: TelegramClient,
  now: Date = new Date(),
): Promise<number> {
  const { today, hour } = clinicClock(now)
  if (hour < MISSED_VISIT_HOUR || hour >= SEND_UNTIL_HOUR) return 0

  const { since, yesterday } = missedVisitWindow(today)
  const missed = latestPerPregnancy(await store.plannedVisitsBetween(since, yesterday))
  if (missed.length === 0) return 0

  const chats = await store.findChatsForPregnancies([...new Set(missed.map((visit) => visit.pregnancyId))])

  let sent = 0
  for (const visit of missed) {
    const date = parseISODate(visit.targetDate)
    if (date === null) continue

    for (const chatId of chats.get(visit.pregnancyId) ?? []) {
      if (!(await store.claimReminder(visit.visitId, chatId, 'kechikkan'))) continue

      // Already answering questions — another notice's, say: she gets the
      // notice, and the survey she is in carries on. Two at once would each
      // take her next "Ha" as their own.
      const inSurvey = (await store.findOpenSurvey(chatId)) !== null
      const message = inSurvey ? { text: missedVisitNotice(date) } : openingMessage(missedVisitNotice(date))

      const outcome = await telegram.sendMessage(chatId, message.text, message.keyboard)
      if (!outcome.ok) {
        console.error('[bot] missed-visit notice to ' + chatId + ' failed: ' + (outcome.description ?? 'unknown'))
        if (!outcome.blocked) {
          await store.releaseReminder(visit.visitId, chatId, 'kechikkan').catch((caught: unknown) => {
            console.error('[bot] could not release missed-visit claim: ' + String(caught))
          })
        }
        continue
      }
      sent++

      // After the send, not before: if this insert fails she has the question
      // but no survey, and her answer is simply handled as a report — which
      // reads blood pressure and signs from her words the same way.
      if (!inSurvey) {
        await store
          .createSurvey({
            pregnancyId: visit.pregnancyId,
            telegramChatId: chatId,
            visitId: visit.visitId,
            step: SURVEY_STEPS[0],
            expiresAt: new Date(now.getTime() + SURVEY_TTL_HOURS * 3600_000),
          })
          .catch((caught: unknown) => {
            console.error('[bot] could not open a survey for ' + chatId + ': ' + String(caught))
          })
      }
    }
  }
  return sent
}
