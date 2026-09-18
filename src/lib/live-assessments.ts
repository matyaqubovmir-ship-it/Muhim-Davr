/**
 * Live updates for screens that show current zones: calls back whenever an
 * assessment is inserted anywhere, through Supabase Realtime.
 *
 * The screen then re-reads its own query. The event itself carries one row and
 * the screen shows aggregates and joins, so re-reading is simpler and cannot
 * drift from what a manual refresh would show.
 *
 * Needs `assessments` in the supabase_realtime publication (migration 005).
 * Realtime applies RLS, so a subscriber only hears about rows it could read.
 */

import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useRef, useState } from 'react'
import { getAuthedSupabase } from './supabase'

export type LiveStatus = 'connecting' | 'live' | 'down'

/**
 * How long after an insert to re-read. A midwife's save is the assessment,
 * then its escalation, then its schedule; reading on the first event would
 * catch the save half-written.
 */
export const REFRESH_DELAY_MS = 1500

let channelCount = 0

export function useLiveAssessments(onInsert: () => void): {
  status: LiveStatus
  reconnect: () => void
} {
  const [status, setStatus] = useState<LiveStatus>('connecting')
  const [attempt, setAttempt] = useState(0)
  const callback = useRef(onInsert)

  useEffect(() => {
    callback.current = onInsert
  })

  useEffect(() => {
    let cancelled = false
    let client: SupabaseClient | null = null
    let channel: RealtimeChannel | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    // Events are not replayed. After any gap in the subscription, re-read once
    // so whatever was inserted during it is not silently missing.
    let missedSome = attempt > 0

    getAuthedSupabase()
      .then((active) => {
        if (cancelled) return
        client = active
        channel = active
          .channel(`assessments-live-${++channelCount}`)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'assessments' }, () => {
            clearTimeout(timer)
            timer = setTimeout(() => callback.current(), REFRESH_DELAY_MS)
          })
          .subscribe((state) => {
            if (cancelled) return
            if (state === 'SUBSCRIBED') {
              setStatus('live')
              if (missedSome) {
                missedSome = false
                callback.current()
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
  }, [attempt])

  const reconnect = () => {
    setStatus('connecting')
    setAttempt((n) => n + 1)
  }

  return { status, reconnect }
}
