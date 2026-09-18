/**
 * The Telegram Bot API, over plain fetch.
 *
 * LONG POLLING, NOT A WEBHOOK. A webhook needs a public HTTPS URL and a
 * deployment; getUpdates needs neither, so the bot runs on a laptop behind
 * venue wifi with no tunnel. Nothing here registers a webhook, and setWebhook is
 * deliberately not wrapped: calling it would silently stop getUpdates working.
 */

export interface TelegramChat {
  id: number
  /** Only 'private' chats are served. See bot/index.ts. */
  type: 'private' | 'group' | 'supergroup' | 'channel'
}

export interface TelegramVoice {
  file_id: string
  duration: number
}

export interface TelegramMessage {
  message_id: number
  chat: TelegramChat
  date: number
  text?: string
  /** Text attached to a photo — e.g. a picture of the cuff with the numbers typed under it. */
  caption?: string
  /** Present when she sent a voice note instead of typing. */
  voice?: TelegramVoice
}

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
}

interface TelegramEnvelope<T> {
  ok: boolean
  result?: T
  description?: string
  error_code?: number
  parameters?: { retry_after?: number }
}

export interface SendOutcome {
  ok: boolean
  /** Set when Telegram refused permanently, e.g. she blocked the bot. */
  blocked: boolean
  description?: string
}

export interface TelegramClient {
  /** timeoutSeconds 0 returns at once; used to acknowledge the last batch on shutdown. */
  getUpdates: (offset: number, timeoutSeconds?: number) => Promise<TelegramUpdate[]>
  sendMessage: (chatId: number, text: string) => Promise<SendOutcome>
}

/** Telegram refuses a message body over 4096 characters. */
const MAX_MESSAGE_LENGTH = 4096

/** A 429 asking for longer than this is not waited out inline. */
const MAX_RETRY_AFTER_SECONDS = 30

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createTelegramClient(
  token: string,
  pollTimeoutSeconds: number,
): TelegramClient {
  const base = `https://api.telegram.org/bot${token}`

  // The token is part of every URL. Nothing that reaches a log may carry it.
  const redact = (text: string) => text.split(token).join('<token>')

  async function call<T>(
    method: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<TelegramEnvelope<T>> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(`${base}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      // Telegram reports application errors in the body with HTTP 200 as often
      // as not, so the envelope is parsed either way and `ok` is the real check.
      const parsed: unknown = await response.json().catch(() => null)
      if (parsed === null) {
        return { ok: false, description: `http_${response.status}` }
      }
      return parsed as TelegramEnvelope<T>
    } catch (caught) {
      // A network failure is an outcome to report, not an exception to unwind
      // a whole reminder sweep or broadcast with.
      return { ok: false, description: redact(`network: ${String(caught)}`) }
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    async getUpdates(offset: number, timeoutSeconds = pollTimeoutSeconds) {
      // The local timeout must outlast the long poll, or every poll aborts.
      const envelope = await call<TelegramUpdate[]>(
        'getUpdates',
        { offset, timeout: timeoutSeconds, allowed_updates: ['message'] },
        (timeoutSeconds + 10) * 1000,
      )
      if (!envelope.ok || !envelope.result) {
        throw new Error(`getUpdates failed: ${envelope.description ?? 'unknown'}`)
      }
      return envelope.result
    },

    async sendMessage(chatId: number, text: string): Promise<SendOutcome> {
      const body = { chat_id: chatId, text: text.slice(0, MAX_MESSAGE_LENGTH) }
      let envelope = await call<unknown>('sendMessage', body, 15000)

      // Rate limited: wait as asked, once. A district announcement is the case
      // this exists for.
      const retryAfter = envelope.parameters?.retry_after
      if (!envelope.ok && envelope.error_code === 429 && retryAfter !== undefined) {
        if (retryAfter <= MAX_RETRY_AFTER_SECONDS) {
          await sleep(retryAfter * 1000)
          envelope = await call<unknown>('sendMessage', body, 15000)
        }
      }

      if (envelope.ok) return { ok: true, blocked: false }

      // 403 is her choice, not a fault: she blocked the bot or deleted the chat.
      // Retrying it forever would be pointless, so it is reported separately.
      const blocked = envelope.error_code === 403
      return { ok: false, blocked, description: envelope.description }
    },
  }
}
