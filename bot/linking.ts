/**
 * Function 1 — linking a Telegram chat to a pregnancy.
 *
 * She has no app and no password. The whole of her authentication is a six
 * character code the midwife read out to her, which is why the failure modes
 * below matter more than the happy path.
 */

import { normaliseLinkCode } from '../src/lib/link-code.ts'
import { BOT } from './messages.ts'
import type { BotStore } from './store.ts'

/**
 * Wrong codes allowed per chat per window.
 *
 * Six hex characters is 16.7 million codes, and a correct guess links a
 * stranger to a woman's reminders. Five misses an hour makes guessing hopeless
 * while leaving room for a patient who mistypes the code a few times. Only
 * lookups that found nothing count — a code of the wrong shape never reaches
 * the database, so it cannot be used to probe it.
 */
export const MAX_FAILED_LINKS = 5
export const FAILED_LINK_WINDOW_MS = 60 * 60 * 1000

/**
 * In memory: a restart forgives everyone, which is acceptable for a pilot and
 * is recorded in 003_patient_channel.sql as the trade that it is.
 */
export class LinkAttemptLimiter {
  private readonly failures = new Map<number, number[]>()
  private readonly maxFailures: number
  private readonly windowMs: number

  constructor(maxFailures = MAX_FAILED_LINKS, windowMs = FAILED_LINK_WINDOW_MS) {
    this.maxFailures = maxFailures
    this.windowMs = windowMs
  }

  private recent(chatId: number, now: number): number[] {
    const kept = (this.failures.get(chatId) ?? []).filter((at) => now - at < this.windowMs)
    if (kept.length === 0) this.failures.delete(chatId)
    else this.failures.set(chatId, kept)
    return kept
  }

  isBlocked(chatId: number, now: number): boolean {
    return this.recent(chatId, now).length >= this.maxFailures
  }

  recordFailure(chatId: number, now: number): void {
    this.failures.set(chatId, [...this.recent(chatId, now), now])
  }
}

/**
 * The argument of `/start`, `/start CODE` or `/start@SomeBot CODE` — '' for a
 * bare /start — or null if the message is not /start at all. A link opened as
 * t.me/<bot>?start=CODE arrives as "/start CODE" too.
 */
export function startArgument(text: string): string | null {
  const match = /^\/start(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(text.trim())
  return match ? (match[1] ?? '').trim() : null
}

/**
 * Handles `/start <code>`. Returns the reply to send.
 *
 * Re-sending /start with a different code re-points the chat rather than adding
 * a second link — patient_channels is unique on telegram_chat_id, so one phone
 * follows one woman. A phone that quietly followed two would eventually deliver
 * one woman's reminder into the other's conversation.
 */
export async function handleStart(
  store: BotStore,
  limiter: LinkAttemptLimiter,
  chatId: number,
  argument: string,
  now: number = Date.now(),
): Promise<string> {
  if (argument.trim() === '') {
    // A bare /start from a chat that is already linked is someone looking for
    // instructions, not someone who has lost their link.
    return (await store.findChannel(chatId)) === null ? BOT.startNoCode : BOT.linkedHelp
  }

  if (limiter.isBlocked(chatId, now)) return BOT.linkTooManyAttempts

  const code = normaliseLinkCode(argument)
  if (code === null) return BOT.linkBadCode

  const matches = await store.findActivePregnancyIdsByCode(code)
  if (matches.length === 0) {
    limiter.recordFailure(chatId, now)
    return BOT.linkNotFound
  }

  // Six hex characters collide by birthday long before they run out. Linking
  // the wrong woman is worse than not linking, so an ambiguous code stops here
  // and asks for a human rather than picking the first row.
  if (matches.length > 1) {
    limiter.recordFailure(chatId, now)
    return BOT.linkAmbiguous
  }

  await store.linkChat(matches[0], chatId)
  return BOT.linkOk
}
