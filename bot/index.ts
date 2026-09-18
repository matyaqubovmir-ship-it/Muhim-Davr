/**
 * ONA — the patient's Telegram channel.
 *
 * She has no app and no password. This process is the whole of her interface,
 * and it does exactly four things:
 *
 *   1  linking        /start <code> ties this chat to her pregnancy
 *   2  self-report    what she writes is triaged against the WHO danger signs
 *   3  reminders      two days before and on the morning of each contact
 *   4  announcements  a district-wide message, sent by bot/broadcast.ts
 *
 * AND NOTHING ELSE. It does not diagnose, it does not reassure, and it does not
 * answer a question about medicine — protocol reminders live on the doctor's
 * screen where a clinician confirms them. The reasoning for each of those is in
 * bot/messages.ts next to the strings themselves.
 *
 * LONG POLLING, NOT A WEBHOOK. A webhook needs a public HTTPS URL; getUpdates
 * needs a laptop. Nothing in this codebase calls setWebhook.
 *
 * Run it with `npm run bot`, which loads .env.local into the process.
 */

import { loadBotConfig, type BotConfig } from './config.ts'
import { extractDangerSigns } from './extract.ts'
import { handleStart, LinkAttemptLimiter, startArgument } from './linking.ts'
import { BOT } from './messages.ts'
import { sendDueReminders } from './reminders.ts'
import { handleSelfReport } from './self-report.ts'
import { createSupabaseStore, type BotStore } from './store.ts'
import { getBotSupabase } from './supabase.ts'
import { createTelegramClient, type TelegramClient, type TelegramMessage } from './telegram.ts'

/** How long to wait after a failed poll before trying again. */
const POLL_BACKOFF_MS = 5000

/** Longer than any honest report. Past this it is not her describing symptoms. */
const MAX_REPORT_LENGTH = 4000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Works out the reply to one message.
 *
 * /start is the only command. Anything else she writes is a report about how
 * she feels, which is the honest reading: she is a patient writing to her
 * midwife, not a user operating a menu.
 */
async function replyTo(
  store: BotStore,
  limiter: LinkAttemptLimiter,
  message: TelegramMessage,
): Promise<string> {
  const chatId = message.chat.id
  const text = (message.text ?? message.caption ?? '').trim()

  const argument = startArgument(text)
  if (argument !== null) return handleStart(store, limiter, chatId, argument)

  // Everything past this point is about her pregnancy, so it needs a link first.
  const channel = await store.findChannel(chatId)
  if (channel === null) return BOT.notLinked

  // Voice notes are not transcribed anywhere in this system. Telling her it was
  // received would be a lie capable of burying a danger sign.
  if (message.voice) return BOT.voiceNotSupported

  if (text === '') return BOT.emptyMessage

  // Any other command is someone looking for instructions.
  if (text.startsWith('/')) return BOT.linkedHelp

  return handleSelfReport(store, extractDangerSigns, channel, text.slice(0, MAX_REPORT_LENGTH))
}

async function handleOneMessage(
  store: BotStore,
  limiter: LinkAttemptLimiter,
  telegram: TelegramClient,
  message: TelegramMessage,
): Promise<void> {
  // One woman, one private conversation. In a group the chat id belongs to
  // everyone in it, and a link would send her reminders to all of them.
  if (message.chat.type !== 'private') return

  const chatId = message.chat.id
  let reply: string
  try {
    reply = await replyTo(store, limiter, message)
  } catch (caught) {
    console.error('[bot] handling chat ' + chatId + ' failed: ' + String(caught))
    // She must never be left with silence after writing in.
    reply = BOT.reportFailed
  }

  const outcome = await telegram.sendMessage(chatId, reply)
  if (!outcome.ok) {
    console.error('[bot] reply to ' + chatId + ' failed: ' + (outcome.description ?? 'unknown'))
  }
}

async function pollUntilStopped(
  store: BotStore,
  telegram: TelegramClient,
  running: () => boolean,
): Promise<void> {
  const limiter = new LinkAttemptLimiter()
  let offset = 0

  while (running()) {
    let updates
    try {
      updates = await telegram.getUpdates(offset)
    } catch (caught) {
      // A 409 here almost always means a webhook is registered, or a second
      // copy of this bot is polling the same token.
      console.error('[bot] poll failed: ' + String(caught))
      await sleep(POLL_BACKOFF_MS)
      continue
    }

    for (const update of updates) {
      // The offset advances whether or not handling succeeded. A message that
      // reliably throws would otherwise be retried forever and block every
      // other woman's messages behind it.
      offset = update.update_id + 1
      if (update.message) await handleOneMessage(store, limiter, telegram, update.message)
    }
  }

  // Telegram only forgets a batch when the next poll names a later offset. Without
  // this, the last batch handled before a restart is handled again after it —
  // a second escalation for the same message.
  if (offset > 0) {
    await telegram.getUpdates(offset, 0).catch((caught: unknown) => {
      console.error('[bot] could not acknowledge the last batch: ' + String(caught))
    })
  }
}

function startReminderSweep(
  store: BotStore,
  telegram: TelegramClient,
  config: BotConfig,
): NodeJS.Timeout {
  let sweeping = false
  const sweep = () => {
    // A slow sweep must not overlap the next one.
    if (sweeping) return
    sweeping = true
    sendDueReminders(store, telegram)
      .then((sent) => {
        if (sent > 0) console.log('[bot] sent ' + sent + ' visit reminder(s)')
      })
      .catch((caught: unknown) => {
        console.error('[bot] reminder sweep failed: ' + String(caught))
      })
      .finally(() => {
        sweeping = false
      })
  }

  sweep()
  return setInterval(sweep, config.reminderIntervalMs)
}

async function main(): Promise<void> {
  const config = loadBotConfig()
  const store = createSupabaseStore(await getBotSupabase(config))
  const telegram = createTelegramClient(config.telegramToken, config.pollTimeoutSeconds)

  let running = true
  const stop = () => {
    if (!running) {
      // Second Ctrl+C: do not wait out the long poll.
      process.exit(130)
    }
    running = false
    console.log(
      '\n[bot] stopping after the current poll (up to ' +
        config.pollTimeoutSeconds +
        's). Ctrl+C again to quit now.',
    )
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)

  const timer = startReminderSweep(store, telegram, config)

  console.log(
    '[bot] polling (auth=' +
      (config.usingServiceRole ? 'service role' : 'anonymous') +
      ', reminder sweep every ' +
      Math.round(config.reminderIntervalMs / 60000) +
      ' min)',
  )

  try {
    await pollUntilStopped(store, telegram, () => running)
  } finally {
    clearInterval(timer)
  }
  console.log('[bot] stopped')
  // The database client keeps a token-refresh timer alive; nothing is left to do.
  process.exit(0)
}

main().catch((caught: unknown) => {
  console.error(String(caught))
  process.exit(1)
})
