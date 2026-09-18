/**
 * Bot configuration, read from the environment once at startup.
 *
 * THE TOKEN IS SERVER-SIDE AND MUST STAY THERE. TELEGRAM_BOT_TOKEN has no VITE_
 * prefix, so Vite cannot inline it into the client bundle — the same protection
 * ANTHROPIC_API_KEY relies on in api/extract.ts. loadBotConfig refuses to start
 * if it ever finds a VITE_-prefixed copy, because a bot token in a browser
 * bundle is a bot anyone can impersonate, and the failure is silent otherwise.
 */

export interface BotConfig {
  telegramToken: string
  supabaseUrl: string
  supabaseKey: string
  /** True when supabaseKey is a service role key rather than the anon key. */
  usingServiceRole: boolean
  /** Long-poll hold time. Telegram holds the request open this long. */
  pollTimeoutSeconds: number
  /** How often the visit-reminder sweep runs. */
  reminderIntervalMs: number
}

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') {
    throw new Error(
      `${name} is not set. Copy .env.example to .env.local and fill it in, ` +
        'then run the bot with `npm run bot` (which loads .env.local).',
    )
  }
  return value.trim()
}

export function loadBotConfig(): BotConfig {
  // A token that reached the client bundle is a compromised token. Fail loudly.
  if (process.env.VITE_TELEGRAM_BOT_TOKEN) {
    throw new Error(
      'VITE_TELEGRAM_BOT_TOKEN is set. The bot token must never carry a VITE_ ' +
        'prefix: Vite inlines VITE_ variables into the browser bundle, which ' +
        'would publish the token. Rename it to TELEGRAM_BOT_TOKEN.',
    )
  }

  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

  return {
    telegramToken: required('TELEGRAM_BOT_TOKEN'),
    supabaseUrl: required('VITE_SUPABASE_URL'),
    // The anon key is the default and is enough: the bot signs in anonymously
    // and reaches the database as `authenticated`, which is what the RLS
    // policies are written against. A service role key is honoured if one is
    // provided but is deliberately not required — see bot/supabase.ts.
    supabaseKey: serviceRole && serviceRole !== '' ? serviceRole : required('VITE_SUPABASE_ANON_KEY'),
    usingServiceRole: Boolean(serviceRole && serviceRole !== ''),
    pollTimeoutSeconds: 25,
    reminderIntervalMs: 5 * 60 * 1000,
  }
}
