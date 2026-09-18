/**
 * What a specialist does with an escalation: acknowledge it, then close it.
 *
 * Only these two moves, matching the status machine and the
 * escalations_status_timestamps check in 001_schema.sql:
 *
 *   ochiq -> qabul   acknowledged_at and acknowledged_by set, closed_at empty
 *   qabul -> yopiq   closed_at, closed_by and a resolution note set
 *
 * Each write is conditional on the status it starts from. If someone else got
 * there first the update matches no row, and the caller is told so rather than
 * silently overwriting their acknowledgement.
 *
 * Timestamps come from this device's clock; the database has no server-side
 * default for them and PostgREST cannot write now(). Good enough for a pilot;
 * a database function would make them authoritative.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { QUEUE_UI } from './labels'

export type ActionOutcome = 'done' | 'already_handled'

export function acknowledgePatch(userId: string | null, now: Date) {
  return { status: 'qabul', acknowledged_at: now.toISOString(), acknowledged_by: userId }
}

export function closePatch(userId: string | null, now: Date, note: string) {
  return { status: 'yopiq', closed_at: now.toISOString(), closed_by: userId, resolution_note: note.trim() }
}

async function currentUserId(client: SupabaseClient): Promise<string | null> {
  const { data } = await client.auth.getUser()
  return data.user?.id ?? null
}

export async function acknowledgeEscalation(
  client: SupabaseClient,
  id: string,
  now: Date = new Date(),
): Promise<ActionOutcome> {
  const { data, error } = await client
    .from('escalations')
    .update(acknowledgePatch(await currentUserId(client), now))
    .eq('id', id)
    .eq('status', 'ochiq')
    .select('id')
  if (error) throw new Error(error.message)
  return (data ?? []).length > 0 ? 'done' : 'already_handled'
}

export async function closeEscalation(
  client: SupabaseClient,
  id: string,
  note: string,
  now: Date = new Date(),
): Promise<ActionOutcome> {
  if (note.trim() === '') throw new Error(QUEUE_UI.noteRequired)
  const { data, error } = await client
    .from('escalations')
    .update(closePatch(await currentUserId(client), now, note))
    .eq('id', id)
    .eq('status', 'qabul')
    .select('id')
  if (error) throw new Error(error.message)
  return (data ?? []).length > 0 ? 'done' : 'already_handled'
}

// --- time ---------------------------------------------------------------------

export function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000))
}

/** "hozirgina", "12 daq", "3 soat 5 daq", "2 kun". */
export function formatElapsed(minutes: number): string {
  if (minutes < 1) return QUEUE_UI.justNow
  if (minutes < 60) return `${minutes} ${QUEUE_UI.minutes}`
  if (minutes < 24 * 60) {
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    return rest === 0 ? `${hours} ${QUEUE_UI.hours}` : `${hours} ${QUEUE_UI.hours} ${rest} ${QUEUE_UI.minutes}`
  }
  return `${Math.floor(minutes / (24 * 60))} ${QUEUE_UI.days}`
}

export type Urgency = 'calm' | 'waiting' | 'overdue'

/**
 * How loudly an open escalation's age is shown. Under 15 minutes it is simply
 * new; past 15 someone should be on it; past an hour nobody has, and the chip
 * turns red. Once acknowledged, its age no longer measures neglect.
 */
export const WAITING_AFTER_MIN = 15
export const OVERDUE_AFTER_MIN = 60

export function urgencyFor(status: string, minutesOpen: number): Urgency {
  if (status !== 'ochiq') return 'calm'
  if (minutesOpen >= OVERDUE_AFTER_MIN) return 'overdue'
  if (minutesOpen >= WAITING_AFTER_MIN) return 'waiting'
  return 'calm'
}

/** Mean minutes from raised to acknowledged, over the rows that were acknowledged. */
export function averageAckMinutes(
  rows: readonly { createdAt: Date; acknowledgedAt: Date | null }[],
): number | null {
  const waits = rows
    .filter((r) => r.acknowledgedAt !== null)
    .map((r) => minutesBetween(r.createdAt, r.acknowledgedAt as Date))
  if (waits.length === 0) return null
  return Math.round(waits.reduce((sum, m) => sum + m, 0) / waits.length)
}

/** Acknowledged escalations of the last 30 days, for the time-to-acknowledge figure. */
export async function loadRecentAcknowledgements(
  client: SupabaseClient,
  now: Date = new Date(),
): Promise<{ createdAt: Date; acknowledgedAt: Date | null }[]> {
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const { data, error } = await client
    .from('escalations')
    .select('created_at, acknowledged_at')
    .not('acknowledged_at', 'is', null)
    .gte('created_at', since.toISOString())
    .limit(500)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({
    createdAt: new Date(String(row.created_at)),
    acknowledgedAt: row.acknowledged_at ? new Date(String(row.acknowledged_at)) : null,
  }))
}
