/**
 * Where polling resumes after the process stops — including when it crashes.
 *
 * Telegram forgets an update only once a later getUpdates names a higher
 * offset. A bot that keeps the offset in memory alone re-reads, after a crash,
 * every message it had already handled in the last batch: a second assessment
 * and a second alert for one message. So the offset is written to disk after
 * each message is handled — after, not before: a crash mid-message then handles
 * that one message again (the duplicate alert joins the first, see
 * self-report.ts) rather than losing it. Losing a danger sign is the worse error.
 *
 * A SAVED OFFSET CAN BE WRONG IN A WAY THAT DROPS EVERY MESSAGE. After a week
 * with no updates Telegram starts numbering them from a random point, and
 * another bot's ids are unrelated to this one's. An offset above the new ids
 * would skip everything, silently. So a saved offset is used only if it belongs
 * to this bot and is less than a day old — Telegram keeps updates for 24 hours,
 * so an older offset has nothing left to protect.
 */

import { readFileSync, writeFileSync } from 'node:fs'

/** Gitignored. Holds no secret: a bot id and a number. */
export const OFFSET_FILE = new URL('./.poll-offset.json', import.meta.url)

/** Telegram keeps an unconfirmed update this long. */
export const OFFSET_MAX_AGE_MS = 24 * 60 * 60 * 1000

export interface SavedOffset {
  botId: string
  offset: number
  savedAt: number
}

/** The numeric id before the colon in a bot token. Not a secret on its own: without the part after the colon it cannot act as the bot. */
export function botIdOf(token: string): string {
  return token.split(':')[0] ?? ''
}

/** The offset to resume from, or 0 when there is nothing safe to resume. */
export function resumeOffset(saved: unknown, botId: string, now: number): number {
  if (typeof saved !== 'object' || saved === null) return 0
  const { botId: savedBot, offset, savedAt } = saved as Partial<SavedOffset>
  if (savedBot !== botId) return 0
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) return 0
  if (typeof savedAt !== 'number' || now - savedAt > OFFSET_MAX_AGE_MS || savedAt > now) return 0
  return offset
}

export function readOffset(botId: string, now: number = Date.now(), file: URL = OFFSET_FILE): number {
  try {
    return resumeOffset(JSON.parse(readFileSync(file, 'utf8')), botId, now)
  } catch {
    // No file yet, or a torn write: start from Telegram's own unconfirmed queue.
    return 0
  }
}

export function writeOffset(botId: string, offset: number, now: number = Date.now(), file: URL = OFFSET_FILE): void {
  const saved: SavedOffset = { botId, offset, savedAt: now }
  try {
    writeFileSync(file, JSON.stringify(saved))
  } catch (caught) {
    // Not fatal: the in-memory offset still moves on. Only a crash re-reads.
    console.error('[bot] could not save the poll offset: ' + String(caught))
  }
}
