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

import { STAFF_ALERT } from '../src/lib/labels.ts'
import type { BotStore, OpenEscalation } from './store.ts'
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

export interface StaffAlerter {
  /** Sets the watermark. Call once, before the first sweep. */
  start(): Promise<void>
  /** Sends (or, in a dry run, logs) every escalation opened since the last sweep. Returns how many. */
  sweep(): Promise<number>
}

export function createStaffAlerter(
  store: BotStore,
  telegram: TelegramClient,
  config: StaffAlertConfig,
  log: (line: string) => void = console.log,
): StaffAlerter {
  let watermark: string | null = null
  let started = false

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
  }
}
