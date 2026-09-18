import { LINK_CODE_UI } from '../lib/labels'
import { linkCodeForPregnancy } from '../lib/link-code'

/**
 * The code the midwife reads out so the patient can link her Telegram.
 *
 * Derived from the pregnancy id with nothing fetched — the database computes the
 * same string as a generated column, and src/lib/link-code.test.ts pins the two
 * together. Shown after a save, when the pregnancy is known to exist.
 *
 * The bot's @username is not a secret, so it may come from a VITE_ variable. The
 * bot's TOKEN must never do so; see bot/config.ts.
 */
export function LinkCode({ pregnancyId }: { pregnancyId: string }) {
  const code = linkCodeForPregnancy(pregnancyId)
  const botUsername = import.meta.env.VITE_TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, '')

  return (
    <section className="mt-6 rounded-lg border border-sky-300 bg-sky-50 p-4">
      <h2 className="text-sm font-semibold text-sky-950">{LINK_CODE_UI.title}</h2>

      {code === null ? (
        <p className="mt-1.5 text-sm leading-snug text-sky-950">{LINK_CODE_UI.unavailable}</p>
      ) : (
        <>
          <p className="mt-1.5 text-sm leading-snug text-sky-950">{LINK_CODE_UI.body}</p>
          <p className="mt-2 rounded-md bg-surface px-3 py-2 text-center font-mono text-2xl font-semibold tracking-[0.2em] text-text-primary">
            /start {code}
          </p>
          {botUsername ? (
            <p className="mt-2 text-sm text-sky-950">
              {LINK_CODE_UI.bot}: <span className="font-semibold">@{botUsername}</span>
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}
