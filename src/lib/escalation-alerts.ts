/**
 * In-app notification to a specialist: a toast, a badge and a short chime when
 * an escalation is raised — the "avtomatik xabarnoma" the brief asks for, on
 * the web dashboard.
 *
 * Driven by Supabase Realtime on escalations (migration 006). The badge is the
 * count of open escalations, re-read from the table on every change, so it is
 * always the database's number and never a tally kept in the browser.
 */

import { useCallback, useEffect, useState } from 'react'
import { useLiveChanges, type LiveChange, type LiveStatus } from './live-changes'
import { getAuthedSupabase } from './supabase'

export interface EscalationToast {
  id: string
  reason: string
  source: 'clinic' | 'telegram'
}

/** Toasts on screen at once. A burst beyond this is in the queue and the badge. */
export const MAX_TOASTS = 3
export const TOAST_MS = 12_000

/** A toast for a newly raised, open escalation; null for anything else. */
export function toastFromChange(change: LiveChange | null): EscalationToast | null {
  if (change === null || change.event !== 'INSERT') return null
  const row = change.row
  if (row.status !== 'ochiq' || typeof row.id !== 'string') return null
  return {
    id: row.id,
    reason: typeof row.reason === 'string' ? row.reason : '',
    source: row.source === 'telegram' ? 'telegram' : 'clinic',
  }
}

/** Newest first, no duplicates, at most MAX_TOASTS. */
export function pushToast(list: readonly EscalationToast[], toast: EscalationToast): EscalationToast[] {
  return [toast, ...list.filter((t) => t.id !== toast.id)].slice(0, MAX_TOASTS)
}

let audio: AudioContext | null = null

/**
 * Two soft rising notes, about a third of a second. Synthesised rather than a
 * file, so there is nothing to load. Browsers keep audio silent until the page
 * has been interacted with; until then this fails quietly and the toast and
 * badge still arrive.
 */
function chime(): void {
  try {
    audio ??= new AudioContext()
    if (audio.state === 'suspended') void audio.resume()
    const start = audio.currentTime
    for (const [offset, frequency] of [
      [0, 660],
      [0.14, 880],
    ] as const) {
      const osc = audio.createOscillator()
      const gain = audio.createGain()
      osc.type = 'sine'
      osc.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, start + offset)
      gain.gain.exponentialRampToValueAtTime(0.06, start + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.18)
      osc.connect(gain).connect(audio.destination)
      osc.start(start + offset)
      osc.stop(start + offset + 0.2)
    }
  } catch {
    // No audio available: the toast and the badge carry the alert.
  }
}

const MUTE_KEY = 'ona.alerts.muted'

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

async function countOpen(): Promise<number> {
  const client = await getAuthedSupabase()
  const { count, error } = await client
    .from('escalations')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'ochiq')
  if (error) throw new Error(error.message)
  return count ?? 0
}

export function useEscalationAlerts(enabled: boolean): {
  openCount: number | null
  toasts: EscalationToast[]
  dismiss: (id: string) => void
  muted: boolean
  toggleMuted: () => void
  live: LiveStatus
} {
  const [openCount, setOpenCount] = useState<number | null>(null)
  const [toasts, setToasts] = useState<EscalationToast[]>([])
  const [muted, setMuted] = useState(readMuted)

  const refreshCount = useCallback(() => {
    countOpen()
      .then(setOpenCount)
      .catch(() => setOpenCount(null))
  }, [])

  useEffect(() => {
    if (enabled) refreshCount()
  }, [enabled, refreshCount])

  const dismiss = useCallback((id: string) => setToasts((list) => list.filter((t) => t.id !== id)), [])

  const onChange = (change: LiveChange | null) => {
    refreshCount()
    const toast = toastFromChange(change)
    if (toast === null) return
    setToasts((list) => pushToast(list, toast))
    setTimeout(() => dismiss(toast.id), TOAST_MS)
    if (!muted) chime()
  }

  const { status } = useLiveChanges(
    { table: 'escalations', events: ['INSERT', 'UPDATE'], delayMs: 0, enabled },
    onChange,
  )

  const toggleMuted = () => {
    setMuted((current) => {
      const next = !current
      try {
        window.localStorage.setItem(MUTE_KEY, next ? '1' : '0')
      } catch {
        // Storage unavailable: the setting lasts until reload.
      }
      return next
    })
  }

  return { openCount, toasts, dismiss, muted, toggleMuted, live: status }
}
