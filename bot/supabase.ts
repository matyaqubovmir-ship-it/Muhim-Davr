/**
 * Database access for the bot process.
 *
 * Separate from src/lib/supabase.ts on purpose: that file reads
 * import.meta.env and is compiled into the browser bundle. This one runs in
 * Node, reads process.env, and must not be imported by anything under src/.
 *
 * SAME RLS POSTURE AS THE APP. The policies in 001-003 are written `to
 * authenticated`, so the bot signs in anonymously exactly as a midwife's device
 * does and reaches the database as an authenticated user. It is NOT given a
 * service role by default.
 *
 *   That is a deliberate choice and not laziness. A service role key bypasses
 *   RLS entirely; a bot that accepts arbitrary text from the public internet is
 *   the last process in this system that should hold one. If
 *   SUPABASE_SERVICE_ROLE_KEY is set it is honoured — useful when RLS is
 *   tightened later and the bot needs a role of its own — but nothing here
 *   requires it, and the anonymous path is the one that gets exercised.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { BotConfig } from './config.ts'

let client: SupabaseClient | null = null

async function signIn(active: SupabaseClient, usingServiceRole: boolean): Promise<void> {
  // A service role key is already past RLS; asking it to sign in is meaningless.
  if (usingServiceRole) return

  const { data, error } = await active.auth.getSession()
  if (error) throw new Error(`Could not read the existing session: ${error.message}`)
  if (data.session) return

  const { error: signInError } = await active.auth.signInAnonymously()
  if (signInError) throw new Error(`Anonymous sign-in failed: ${signInError.message}`)
}

/**
 * The only way the bot reaches the database. Resolves once a session exists, so
 * a query cannot run unauthenticated — there is no unauthenticated fallback,
 * for the same reason src/lib/supabase.ts has none.
 */
export async function getBotSupabase(config: BotConfig): Promise<SupabaseClient> {
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseKey, {
      auth: {
        // A long-lived server process has no browser storage and no URL to read
        // a session out of. Both would be no-ops at best here.
        persistSession: false,
        detectSessionInUrl: false,
        autoRefreshToken: true,
      },
    })
    await signIn(client, config.usingServiceRole)
  }
  return client
}
