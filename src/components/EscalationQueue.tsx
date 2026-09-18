import { useCallback, useEffect, useState } from 'react'
import type { DangerSign } from '../lib/danger-signs'
import {
  DANGER_SIGN_NAMES,
  ESCALATION_SOURCE_LABELS,
  ESCALATION_STATUS_LABELS,
  FACTOR_SENTENCES,
  QUEUE_UI,
  ZONE_COLORS,
} from '../lib/labels'
import type { RiskFactor } from '../lib/risk'
import { getAuthedSupabase } from '../lib/supabase'

/** More than a district sees in a day; the queue is for what is open now. */
const QUEUE_LIMIT = 50

interface QueueRow {
  id: string
  status: string
  reason: string
  firedFactors: string[]
  source: 'clinic' | 'telegram'
  createdAt: string
  patientName: string | null
  district: string | null
  linkCode: string | null
  /** Her own words, when the escalation came from the Telegram channel. */
  patientWords: string[]
}

type QueueState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; rows: QueueRow[] }

function one(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? null
  if (typeof value === 'object' && value !== null) return value as Record<string, unknown>
  return null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** A danger sign or a point-table factor, named for a clinician. */
function factorName(code: string): string {
  return (
    DANGER_SIGN_NAMES[code as DangerSign] ?? FACTOR_SENTENCES[code as RiskFactor] ?? code
  )
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function loadQueue(): Promise<QueueRow[]> {
  const client = await getAuthedSupabase()
  // Foreign keys named explicitly, so an embed cannot silently change meaning or
  // start failing as ambiguous when another relationship between these tables
  // is added.
  const { data, error } = await client
    .from('escalations')
    .select(
      'id, status, reason, fired_factors, source, created_at, ' +
        'pregnancies!escalations_pregnancy_id_fkey(link_code, patients(full_name, district)), ' +
        'patient_reports!patient_reports_escalation_id_fkey(message_text)',
    )
    .in('status', ['ochiq', 'qabul'])
    .order('created_at', { ascending: false })
    .limit(QUEUE_LIMIT)

  if (error) throw new Error(error.message)

  return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => {
    const pregnancy = one(row.pregnancies)
    const patient = one(pregnancy?.patients)
    const reports = Array.isArray(row.patient_reports) ? row.patient_reports : []
    return {
      id: String(row.id),
      status: String(row.status),
      reason: String(row.reason),
      firedFactors: Array.isArray(row.fired_factors) ? row.fired_factors.map(String) : [],
      source: row.source === 'telegram' ? 'telegram' : 'clinic',
      createdAt: String(row.created_at),
      patientName: text(patient?.full_name),
      district: text(patient?.district),
      linkCode: text(pregnancy?.link_code),
      patientWords: reports
        .map((report) => text((report as Record<string, unknown>).message_text))
        .filter((words): words is string => words !== null),
    }
  })
}

/**
 * The doctor's queue: every open escalation, newest first, whatever raised it.
 *
 * Read-only. An escalation from the patient's Telegram is shown in the same list
 * as one raised in clinic, with the same urgency, and marked by source — the two
 * warrant the same response and a different first question. Where she wrote in
 * herself, her own words are shown under the reason, because that is what the
 * doctor will want to read before calling her.
 */
export function EscalationQueue() {
  // Starts as loading, so the first fetch needs no state change before it.
  const [state, setState] = useState<QueueState>({ kind: 'loading' })

  const load = useCallback(() => {
    loadQueue()
      .then((rows) => setState({ kind: 'ready', rows }))
      .catch((caught: unknown) =>
        setState({ kind: 'error', message: caught instanceof Error ? caught.message : String(caught) }),
      )
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const refresh = () => {
    setState({ kind: 'loading' })
    load()
  }

  return (
    <div className="pb-10">
      <div className="mt-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900">{QUEUE_UI.title}</h2>
        <button
          type="button"
          onClick={refresh}
          disabled={state.kind === 'loading'}
          className="min-h-10 rounded-md border border-slate-900 bg-white px-3 text-sm font-semibold text-slate-900 disabled:opacity-40"
        >
          {QUEUE_UI.refresh}
        </button>
      </div>

      {state.kind === 'loading' ? (
        <p className="mt-4 text-sm text-slate-600">{QUEUE_UI.loading}</p>
      ) : null}

      {state.kind === 'error' ? (
        <p
          role="alert"
          className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800"
        >
          {QUEUE_UI.loadFailed} ({state.message})
        </p>
      ) : null}

      {state.kind === 'ready' && state.rows.length === 0 ? (
        <p className="mt-4 text-sm text-slate-600">{QUEUE_UI.empty}</p>
      ) : null}

      {state.kind === 'ready' && state.rows.length > 0 ? (
        <ul className="mt-3 space-y-3">
          {state.rows.map((row) => (
            <li
              key={row.id}
              className="rounded-lg border border-slate-200 border-l-4 bg-white p-3"
              style={{ borderLeftColor: ZONE_COLORS.qizil }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={[
                    'rounded px-1.5 py-0.5 text-[11px] font-bold tracking-wide uppercase',
                    row.source === 'telegram'
                      ? 'bg-sky-600 text-white'
                      : 'bg-slate-200 text-slate-800',
                  ].join(' ')}
                >
                  {ESCALATION_SOURCE_LABELS[row.source]}
                </span>
                <span className="text-xs text-slate-500">
                  {ESCALATION_STATUS_LABELS[row.status] ?? row.status}
                </span>
                <span className="ml-auto text-xs text-slate-500">{formatTime(row.createdAt)}</span>
              </div>

              <div className="mt-1.5 text-sm font-semibold text-slate-900">
                {row.patientName ?? '—'}
                {row.district ? (
                  <span className="font-normal text-slate-600"> · {row.district}</span>
                ) : null}
                {row.linkCode ? (
                  <span className="font-normal text-slate-500">
                    {' '}
                    · {QUEUE_UI.code} {row.linkCode}
                  </span>
                ) : null}
              </div>

              <p className="mt-1 text-sm leading-snug text-slate-800">{row.reason}</p>

              {row.firedFactors.length > 0 ? (
                <ul className="mt-1.5 list-inside list-disc text-sm leading-snug text-slate-700">
                  {row.firedFactors.map((code) => (
                    <li key={code}>{factorName(code)}</li>
                  ))}
                </ul>
              ) : null}

              {row.patientWords.length > 0 ? (
                <div className="mt-2 rounded-md bg-slate-50 p-2.5">
                  <div className="text-xs font-semibold text-slate-500">{QUEUE_UI.patientWords}</div>
                  {row.patientWords.map((words, index) => (
                    <p key={index} className="mt-0.5 text-sm leading-snug whitespace-pre-wrap text-slate-900">
                      «{words}»
                    </p>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {state.kind === 'ready' && state.rows.length === QUEUE_LIMIT ? (
        <p className="mt-3 text-xs text-slate-500">{QUEUE_UI.truncated}</p>
      ) : null}
    </div>
  )
}
