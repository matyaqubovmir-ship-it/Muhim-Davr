/**
 * Function 3 — visit reminders.
 *
 * NO MODEL IS INVOLVED AND NO DATE IS INVENTED. Every date here is read from the
 * visits table, which holds the output of generateSchedule in
 * src/lib/schedule.ts — arithmetic on the last menstrual period and a fixed
 * table of WHO contact weeks. This file selects rows and formats a sentence.
 *
 * Two reminders per contact: one two days before, one on the morning of.
 *
 * SENDING IS GUARDED BY THE DATABASE, NOT BY THIS SCHEDULER. The sweep runs
 * every few minutes and would otherwise resend on each pass. Instead each send
 * inserts into visit_reminders first, whose unique constraint on
 * (visit_id, telegram_chat_id, kind) refuses a duplicate, and only sends if the
 * insert succeeded. A crash between the insert and the send costs one missed
 * reminder, which is the better of the two failures: one woman misses one
 * message, rather than every woman receiving the same message eleven times and
 * learning to ignore the channel.
 */

import { addDays, formatISODate, parseISODate } from '../src/lib/schedule.ts'
import { reminderMorning, reminderTwoDays } from './messages.ts'
import type { BotStore, ReminderKind } from './store.ts'
import type { TelegramClient } from './telegram.ts'

/**
 * Every patient is in Khorezm, so "today" and "morning" are Tashkent's, whatever
 * clock the laptop running the bot happens to be set to.
 */
export const CLINIC_TIME_ZONE = 'Asia/Tashkent'

/**
 * Reminders go out between 07:00 and 21:00 only. A reminder that arrives at
 * 03:00 because the bot happened to be running then is a reminder that wakes a
 * pregnant woman for nothing. One held overnight goes out at 07:00, which for
 * the morning-of reminder is exactly when it should.
 */
export const SEND_FROM_HOUR = 7
export const SEND_UNTIL_HOUR = 21

/**
 * The calendar day and hour in Tashkent. `today` is a local-midnight Date built
 * from Tashkent's year, month and day, so formatISODate and addDays from
 * schedule.ts give Tashkent dates.
 */
export function clinicClock(now: Date): { today: Date; hour: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CLINIC_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return {
    today: new Date(part('year'), part('month') - 1, part('day')),
    hour: part('hour'),
  }
}

/**
 * One sweep. Returns how many reminders were actually sent.
 *
 * `now` is an explicit parameter with a default rather than a hidden call to
 * the clock, the same convention as generateSchedule, so this is testable.
 */
export async function sendDueReminders(
  store: BotStore,
  telegram: TelegramClient,
  now: Date = new Date(),
): Promise<number> {
  const { today, hour } = clinicClock(now)
  if (hour < SEND_FROM_HOUR || hour >= SEND_UNTIL_HOUR) return 0

  const todayISO = formatISODate(today)
  const inTwoDaysISO = formatISODate(addDays(today, 2))

  // Only planned visits of active pregnancies: a completed visit needs no
  // reminder, a missed one needs a phone call from a midwife rather than a
  // message from a bot, and an ended pregnancy must never be reminded.
  const due = await store.findPlannedVisits([todayISO, inTwoDaysISO])
  if (due.length === 0) return 0

  const chats = await store.findChatsForPregnancies([
    ...new Set(due.map((visit) => visit.pregnancyId)),
  ])

  let sent = 0
  for (const visit of due) {
    const kind: ReminderKind = visit.targetDate === todayISO ? 'ertalab' : 'ikki_kun'
    // The query matched this exact string, so it parses; a guard costs nothing.
    const date = parseISODate(visit.targetDate)
    if (date === null) continue
    const text =
      kind === 'ertalab'
        ? reminderMorning(date, visit.district)
        : reminderTwoDays(date, visit.district)

    for (const chatId of chats.get(visit.pregnancyId) ?? []) {
      // Claim the send first. A refused claim means it already went out.
      if (!(await store.claimReminder(visit.visitId, chatId, kind))) continue

      const outcome = await telegram.sendMessage(chatId, text)
      if (outcome.ok) {
        sent++
      } else {
        console.error(
          '[bot] reminder to ' + chatId + ' failed: ' + (outcome.description ?? 'unknown'),
        )
      }
    }
  }

  return sent
}
