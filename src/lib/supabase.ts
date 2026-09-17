import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Created on first use, not at import time.
 *
 * An earlier version threw while the module was being imported, which took the
 * whole app down to a blank screen when .env.local was missing. A midwife
 * should still see the form; the failure belongs at the moment we try to save,
 * where it can be shown as a message.
 */
let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (client) return client

  const url = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error(
      'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill it in.',
    )
  }

  client = createClient(url, anonKey)
  return client
}
