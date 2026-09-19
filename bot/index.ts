/**
 * ONA — the patient's Telegram channel.
 *
 * She has no app and no password. This process is the whole of her interface,
 * and it does exactly these things:
 *
 *   1  linking        /start <code> ties this chat to her pregnancy
 *   2  self-report    what she writes is triaged against the WHO danger signs
 *   3  reminders      two days before and on the morning of each contact
 *   4  announcements  a district-wide message, sent by bot/broadcast.ts
 *   5  staff alerts   the specialist's own Telegram (bot/staff-alerts.ts)
 *   6  after a contact nobody recorded: a notice and a fixed list of questions,
 *                     answered with buttons (bot/missed-visits.ts, bot/survey.ts)
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
import { sendMissedVisitNotices } from './missed-visits.ts'
import { botIdOf, readOffset, writeOffset } from './offset.ts'
import { sendDueReminders } from './reminders.ts'
import { handleSelfReport } from './self-report.ts'
import { createStaffAlerter, loadStaffAlertConfig, type StaffAlertConfig } from './staff-alerts.ts'
import { createSupabaseStore, type BotStore, type OpenSurvey } from './store.ts'
import { getBotSupabase } from './supabase.ts'
import { expireSurveys, handleSurveyMessage } from './survey.ts'
import { createTelegramClient, type Outgoing, type TelegramClient, type TelegramMessage } from './telegram.ts'

/** How long to wait after a failed poll before trying again. */
const POLL_BACKOFF_MS = 5000

/** Longer than any honest report. Past this it is not her describing symptoms. */
const MAX_REPORT_LENGTH = 4000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Her open survey, if she has one. A failed lookup — 008 not applied yet, the
 * database down — means no survey: her message is then handled as a report,
 * which is the safe way to be wrong. It must never be the reason she gets no
 * reply.
 */
async function openSurvey(store: BotStore, chatId: number): Promise<OpenSurvey | null> {
  try {
    return await store.findOpenSurvey(chatId)
  } catch (caught) {
    console.error('[bot] survey lookup failed, handling as a report: ' + String(caught))
    return null
  }
}

/**
 * Works out the reply to one message.
 *
 * /start is the only command. Anything else she writes is a report about how
 * she feels, which is the honest reading: she is a patient writing to her
 * midwife, not a user operating a menu. The one exception is a survey she is in
 * the middle of, where her message is first read as an answer.
 */
async function replyTo(
  store: BotStore,
  limiter: LinkAttemptLimiter,
  message: TelegramMessage,
): Promise<Outgoing[]> {
  const chatId = message.chat.id
  const text = (message.text ?? message.caption ?? '').trim()

  const argument = startArgument(text)
  if (argument !== null) return [{ text: await handleStart(store, limiter, chatId, argument) }]

  // Everything past this point is about her pregnancy, so it needs a link first.
  const channel = await store.findChannel(chatId)
  if (channel === null) return [{ text: BOT.notLinked }]

  // Voice notes are not transcribed anywhere in this system. Telling her it was
  // received would be a lie capable of burying a danger sign.
  if (message.voice) return [{ text: BOT.voiceNotSupported }]

  if (text === '') return [{ text: BOT.emptyMessage }]

  // Any other command is someone looking for instructions.
  if (text.startsWith('/')) return [{ text: BOT.linkedHelp }]

  const report = text.slice(0, MAX_REPORT_LENGTH)
  const survey = await openSurvey(store, chatId)
  if (survey !== null) {
    const replies = await handleSurveyMessage(store, extractDangerSigns, channel, survey, report)
    if (replies !== null) return replies
  }

  return [{ text: await handleSelfReport(store, extractDangerSigns, channel, report) }]
}

/** Makes sure the database session is live before a unit of work. See bot/supabase.ts. */
type EnsureSession = () => Promise<unknown>

async function handleOneMessage(
  store: BotStore,
  ensureSession: EnsureSession,
  limiter: LinkAttemptLimiter,
  telegram: TelegramClient,
  message: TelegramMessage,
): Promise<void> {
  // One woman, one private conversation. In a group the chat id belongs to
  // everyone in it, and a link would send her reminders to all of them.
  if (message.chat.type !== 'private') return

  const chatId = message.chat.id
  let replies: Outgoing[]
  try {
    await ensureSession()
    replies = await replyTo(store, limiter, message)
  } catch (caught) {
    console.error('[bot] handling chat ' + chatId + ' failed: ' + String(caught))
    // She must never be left with silence after writing in.
    replies = [{ text: BOT.reportFailed }]
  }

  // In order: a reply to what she wrote comes before the question asked again.
  for (const reply of replies) {
    const outcome = await telegram.sendMessage(chatId, reply.text, reply.keyboard)
    if (!outcome.ok) {
      console.error('[bot] reply to ' + chatId + ' failed: ' + (outcome.description ?? 'unknown'))
    }
  }
}

async function pollUntilStopped(
  store: BotStore,
  ensureSession: EnsureSession,
  telegram: TelegramClient,
  botId: string,
  running: () => boolean,
): Promise<void> {
  const limiter = new LinkAttemptLimiter()
  let offset = readOffset(botId)
  if (offset > 0) console.log('[bot] resuming after update ' + (offset - 1))

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
      // other woman's messages behind it. It is saved after handling, so a
      // crash mid-message handles that message again instead of losing it.
      if (update.message) await handleOneMessage(store, ensureSession, limiter, telegram, update.message)
      offset = update.update_id + 1
      writeOffset(botId, offset)
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
  ensureSession: EnsureSession,
  telegram: TelegramClient,
  config: BotConfig,
): NodeJS.Timeout {
  let sweeping = false
  // Each step on its own: a failure in the newer ones (before 008 is applied,
  // say) must not stop the visit reminders that were already working.
  const step = async (name: string, run: () => Promise<number>, done: (n: number) => string) => {
    try {
      const n = await run()
      if (n > 0) console.log('[bot] ' + done(n))
    } catch (caught) {
      console.error('[bot] ' + name + ' failed: ' + String(caught))
    }
  }
  const sweep = () => {
    // A slow sweep must not overlap the next one.
    if (sweeping) return
    sweeping = true
    ensureSession()
      .then(async () => {
        await step('reminder sweep', () => sendDueReminders(store, telegram), (n) => `sent ${n} visit reminder(s)`)
        await step('missed-visit sweep', () => sendMissedVisitNotices(store, telegram), (n) => `sent ${n} missed-visit notice(s)`)
        await step('survey expiry', () => expireSurveys(store), (n) => `closed ${n} unfinished survey(s)`)
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

/**
 * The specialist's Telegram alert (bot/staff-alerts.ts), when STAFF_ALERT_CHAT_ID
 * is set. A failed start is logged and retried on the next tick rather than
 * stopping the bot: the patient channel matters more than this one.
 */
function startStaffAlerts(
  store: BotStore,
  ensureSession: EnsureSession,
  telegram: TelegramClient,
  config: StaffAlertConfig,
): NodeJS.Timeout {
  const alerter = createStaffAlerter(store, telegram, config)
  let started = false
  let sweeping = false
  const tick = () => {
    // A slow sweep must not overlap the next one.
    if (sweeping) return
    sweeping = true
    ensureSession()
      .then(async () => {
        if (!started) {
          await alerter.start()
          started = true
          return 0
        }
        const relayed = await alerter.sweep()
        await alerter.digest()
        // Separately caught: before 008 is applied these fail, and the
        // escalation alerts above must keep working regardless.
        const missed = await alerter.missedVisits().catch((caught: unknown) => {
          console.error('[bot] staff missed-visit notices failed: ' + String(caught))
          return 0
        })
        const answers = await alerter.surveys().catch((caught: unknown) => {
          console.error('[bot] staff survey summaries failed: ' + String(caught))
          return 0
        })
        return relayed + missed + answers
      })
      .then((relayed) => {
        if (relayed > 0 && config.send) console.log('[bot] sent ' + relayed + ' staff alert(s)')
      })
      .catch((caught: unknown) => {
        console.error('[bot] staff alert sweep failed: ' + String(caught))
      })
      .finally(() => {
        sweeping = false
      })
  }

  tick()
  return setInterval(tick, config.intervalMs)
}

async function main(): Promise<void> {
  const config = loadBotConfig()
  const store = createSupabaseStore(await getBotSupabase(config))
  const ensureSession = () => getBotSupabase(config)
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

  const timer = startReminderSweep(store, ensureSession, telegram, config)
  const staffConfig = loadStaffAlertConfig()
  const staffTimer = staffConfig === null ? null : startStaffAlerts(store, ensureSession, telegram, staffConfig)

  console.log(
    '[bot] polling (auth=' +
      (config.usingServiceRole ? 'service role' : 'anonymous') +
      ', reminder sweep every ' +
      Math.round(config.reminderIntervalMs / 60000) +
      ' min)',
  )
  console.log(
    staffConfig === null
      ? '[bot] staff alerts off (set STAFF_ALERT_CHAT_ID to turn them on)'
      : '[bot] staff alerts to chat ' + staffConfig.chatId + (staffConfig.send ? ' — SENDING' : ' — DRY RUN, set STAFF_ALERTS=send to send'),
  )

  try {
    await pollUntilStopped(store, ensureSession, telegram, botIdOf(config.telegramToken), () => running)
  } finally {
    clearInterval(timer)
    if (staffTimer !== null) clearInterval(staffTimer)
  }
  console.log('[bot] stopped')
  // The database client keeps a token-refresh timer alive; nothing is left to do.
  process.exit(0)
}

main().catch((caught: unknown) => {
  console.error(String(caught))
  process.exit(1)
})
