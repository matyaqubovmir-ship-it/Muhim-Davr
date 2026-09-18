/**
 * The short code that ties a Telegram chat to a pregnancy.
 *
 * Pure, like risk.ts and schedule.ts: no I/O, no clock, no randomness. The code
 * is a function of the pregnancy id, so the midwife's screen can show it with
 * nothing to fetch and the database can index it as a generated column.
 *
 * THE DEFINITION LIVES TWICE — here and as the `link_code` generated column in
 * supabase/migrations/003_patient_channel.sql. src/lib/link-code.test.ts pins
 * them together by reading the migration. If you change the derivation, change
 * both; the test fails if you change one.
 */

/** Characters of the code. Hex, upper case — see the migration for why. */
export const LINK_CODE_LENGTH = 6

/**
 * The code for a pregnancy: the first six hex digits of its id, upper case.
 *
 * Returns null for anything that is not a uuid, rather than a code derived from
 * a typo. A midwife reading out a code built from a malformed id would be
 * reading out a code no patient can ever match.
 */
export function linkCodeForPregnancy(pregnancyId: string): string | null {
  const trimmed = pregnancyId.trim().toLowerCase()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(trimmed)) {
    return null
  }
  return trimmed.replace(/-/g, '').slice(0, LINK_CODE_LENGTH).toUpperCase()
}

/**
 * Cleans up a code as a patient actually sends it.
 *
 * She is typing on a phone, into a chat, possibly after reading it off a slip
 * of paper: expect lower case, stray spaces, a dash in the middle, and the odd
 * leading slash left over from /start. Everything that is not a code character
 * is dropped, then the length is checked. Returns null if what is left is not a
 * code, so the bot can say "that code did not work" rather than querying for
 * nonsense.
 */
export function normaliseLinkCode(raw: string): string | null {
  const stripped = raw.toUpperCase().replace(/[^0-9A-F]/g, '')
  if (stripped.length !== LINK_CODE_LENGTH) return null
  return stripped
}
