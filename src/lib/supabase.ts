import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Supabase access. There is one export, and it is async, because every query
 * must run with a session behind it.
 *
 * The RLS policies in 001_schema.sql are written `to authenticated`. Without a
 * session the app reaches the database as `anon` and every insert is refused —
 * correctly. The fix is a session, never a looser policy.
 *
 * ANONYMOUS SIGN-IN IS A HACKATHON STAND-IN for real midwife accounts. It gives
 * each device an authenticated identity so RLS is satisfied and created_by gets
 * a real auth.uid(), but it does not identify a person: anyone with the app is
 * a valid user, and a cleared browser becomes a new one. When real accounts
 * arrive they replace only what happens in this file. The policies already
 * target authenticated users, so no schema change is needed then.
 *
 * THE ROLE SWITCH IS NOT A STAND-IN FOR ROLES EITHER. The header's "Akusherka"
 * / "OvaBMU mutaxassisi" choice (src/lib/role.ts) only picks which tabs show.
 * Every session here reaches the same data with the same rights. See README.
 */

let client: SupabaseClient | null = null

/**
 * Cached so concurrent saves do not each trigger their own sign-in. Cleared on
 * failure so the next save retries rather than being stuck with a dead promise.
 */
let sessionReady: Promise<void> | null = null

function createRawClient(): SupabaseClient {
  const url = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error(
      'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill it in.',
    )
  }

  return createClient(url, anonKey)
}

async function ensureSession(active: SupabaseClient): Promise<void> {
  const { data, error } = await active.auth.getSession()
  if (error) {
    throw new Error(`Could not read the existing session: ${error.message}`)
  }
  if (data.session) return

  const { error: signInError } = await active.auth.signInAnonymously()
  if (signInError) {
    throw new Error(`Anonymous sign-in failed: ${signInError.message}`)
  }
}

/**
 * The only way to reach the database. Resolves once a session exists, so a
 * query cannot run unauthenticated.
 *
 * Throws if the session could not be established. Callers must surface that as
 * a failure — there is deliberately no unauthenticated client to fall back to.
 */
export async function getAuthedSupabase(): Promise<SupabaseClient> {
  if (!client) client = createRawClient()
  const active = client

  if (!sessionReady) {
    sessionReady = ensureSession(active).catch((caught: unknown) => {
      sessionReady = null
      throw caught
    })
  }

  await sessionReady
  return active
}
