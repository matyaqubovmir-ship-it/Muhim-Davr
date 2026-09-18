/**
 * Live updates through Supabase Realtime: calls back when a row in one table is
 * inserted or updated.
 *
 * Screens that show aggregates re-read their own query on the callback rather
 * than patching themselves from the event — the event carries one row, the
 * screen shows joins and counts, and re-reading cannot drift from what a manual
 * refresh would show.
 *
 * The table must be in the supabase_realtime publication: assessments since
 * migration 005, escalations since 006. Realtime applies RLS, so a subscriber
 * only hears about rows it could read.
 */

import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useRef, useState } from 'react'
import { getAuthedSupabase } from './supabase'

export type LiveStatus = 'connecting' | 'live' | 'down'

/** visits and pregnancies broadcast once 007 has added them to the publication; before that they are silent, not an error. */
export type LiveTable = 'assessments' | 'escalations' | 'visits' | 'pregnancies'
export type LiveEvent = 'INSERT' | 'UPDATE'

/** What a callback receives: the event, and the row as it now is. */
export interface LiveChange {
  event: LiveEvent
  row: Record<string, unknown>
}

/**
 * How long after an insert a screen re-reads. A midwife's save is the
 * assessment, then its escalation, then its schedule; reading on the first
 * event would catch the save half-written.
 */
export const REFRESH_DELAY_MS = 1500

let channelCount = 0

export function useLiveChanges(
  options: {
    table: LiveTable
    events: readonly LiveEvent[]
    /** Wait this long after the last event before calling back; 0 calls back on every event. */
    delayMs: number
    enabled?: boolean
  },
  onChange: (change: LiveChange | null) => void,
): { status: LiveStatus; reconnect: () => void } {
  const { table, delayMs, enabled = true } = options
  const events = options.events.join(',')
  const [status, setStatus] = useState<LiveStatus>('connecting')
  const [attempt, setAttempt] = useState(0)
  const callback = useRef(onChange)

  useEffect(() => {
    callback.current = onChange
  })

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let client: SupabaseClient | null = null
    let channel: RealtimeChannel | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    // Events are not replayed. After any gap in the subscription, call back
    // once with no change, so the screen re-reads whatever it missed.
    let missedSome = attempt > 0
    const wanted = new Set(events.split(','))

    getAuthedSupabase()
      .then((active) => {
        if (cancelled) return
        client = active
        channel = active
          .channel(`${table}-live-${++channelCount}`)
          .on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
            if (!wanted.has(payload.eventType)) return
            const change: LiveChange = {
              event: payload.eventType as LiveEvent,
              row: (payload.new ?? {}) as Record<string, unknown>,
            }
            if (delayMs <= 0) {
              callback.current(change)
              return
            }
            clearTimeout(timer)
            timer = setTimeout(() => callback.current(change), delayMs)
          })
          .subscribe((state) => {
            if (cancelled) return
            if (state === 'SUBSCRIBED') {
              setStatus('live')
              if (missedSome) {
                missedSome = false
                callback.current(null)
              }
            } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
              setStatus('down')
              missedSome = true
            }
          })
      })
      .catch(() => {
        if (!cancelled) setStatus('down')
      })

    return () => {
      cancelled = true
      clearTimeout(timer)
      if (client !== null && channel !== null) void client.removeChannel(channel)
    }
  }, [table, events, delayMs, enabled, attempt])

  const reconnect = () => {
    setStatus('connecting')
    setAttempt((n) => n + 1)
  }

  return { status, reconnect }
}

/** Any new assessment, anywhere: what the registry screens re-read on. */
export function useLiveAssessments(onInsert: () => void) {
  const live = useLiveChanges({ table: 'assessments', events: ['INSERT'], delayMs: REFRESH_DELAY_MS }, () => onInsert())
  // A newly registered woman has no assessment yet, so she arrives through
  // pregnancies — broadcast once 007 adds it to Realtime, silent before.
  useLiveChanges({ table: 'pregnancies', events: ['INSERT', 'UPDATE'], delayMs: REFRESH_DELAY_MS }, () => onInsert())
  return live
}
