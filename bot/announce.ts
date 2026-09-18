/**
 * Function 4 — an announcement to every linked patient in one tuman.
 *
 * NO AI ANYWHERE IN THIS FILE. The text is whatever the administrator typed,
 * sent unchanged. Nothing rewrites it, nothing translates it and nothing
 * personalises it.
 *
 * The command-line entry point is bot/broadcast.ts; this file is what it runs,
 * kept separate so it can be tested without sending anything.
 */

import type { BroadcastTarget } from './store.ts'
import type { TelegramClient } from './telegram.ts'

/**
 * Telegram starts refusing bulk sends at around 30 messages a second. A small
 * gap keeps a district-wide announcement inside that without any bookkeeping.
 */
export const SEND_GAP_MS = 60

export interface BroadcastOutcome {
  sent: number
  failed: number
  blocked: number
}

export async function sendAnnouncement(
  telegram: TelegramClient,
  targets: readonly BroadcastTarget[],
  message: string,
  gapMs: number = SEND_GAP_MS,
): Promise<BroadcastOutcome> {
  const outcome: BroadcastOutcome = { sent: 0, failed: 0, blocked: 0 }

  for (const target of targets) {
    const result = await telegram.sendMessage(target.chatId, message)
    if (result.ok) {
      outcome.sent++
    } else if (result.blocked) {
      // She blocked the bot. Her choice, and not an error to retry.
      outcome.blocked++
    } else {
      outcome.failed++
      console.error(
        '[broadcast] ' + target.chatId + ' failed: ' + (result.description ?? 'unknown'),
      )
    }
    if (gapMs > 0) await new Promise((resolve) => setTimeout(resolve, gapMs))
  }

  return outcome
}

export interface BroadcastArgs {
  tuman: string
  message: string
  /** Without --send it is a dry run. */
  send: boolean
}

/** Parses `--tuman X --message Y [--send]`. Null if either value is missing. */
export function parseBroadcastArgs(argv: readonly string[]): BroadcastArgs | null {
  const flag = (name: string): string | null => {
    const index = argv.indexOf('--' + name)
    if (index === -1 || index + 1 >= argv.length) return null
    const value = argv[index + 1]
    return value.startsWith('--') ? null : value
  }

  const tuman = flag('tuman')?.trim() ?? ''
  const message = flag('message')?.trim() ?? ''
  if (tuman === '' || message === '') return null
  return { tuman, message, send: argv.includes('--send') }
}
