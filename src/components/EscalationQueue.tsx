import { useCallback, useEffect, useRef, useState } from 'react'
import {
  acknowledgeEscalation,
  averageAckMinutes,
  closeEscalation,
  formatElapsed,
  loadRecentAcknowledgements,
  minutesBetween,
  urgencyFor,
  type Urgency,
} from '../lib/escalation-actions'
import {
  ESCALATION_SOURCE_LABELS,
  ESCALATION_STATUS_LABELS,
  QUEUE_UI,
  describeFactor,
} from '../lib/labels'
import { useLatestOnly } from '../lib/latest-only'
import { useLiveChanges } from '../lib/live-changes'
import { formatMoment } from '../lib/patient-detail'
import { pathFor } from '../lib/routes'
import { getAuthedSupabase } from '../lib/supabase'
import { AppLink } from './AppLink'
import { Button } from './Button'
import { CheckIcon } from './Icons'
import { LiveBadge } from './LiveBadge'
import { ZoneIcon } from './Zone'

/** Most rows read per status. More than a district sees in a day. */
const QUEUE_LIMIT = 100

/** How often the elapsed-time chips re-read the clock. */
const TICK_MS = 30_000

interface QueueRow {
  id: string
  pregnancyId: string
  status: string
  reason: string
  firedFactors: string[]
  source: 'clinic' | 'telegram'
  createdAt: Date
  acknowledgedAt: Date | null
  patientName: string | null
  district: string | null
  linkCode: string | null
  /** Her own words, when the escalation came from the Telegram channel. */
  patientWords: string[]
}

function one(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? null
  if (typeof value === 'object' && value !== null) return value as Record<string, unknown>
  return null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

interface Queue {
  rows: QueueRow[]
  /** Exact counts, from the database — not from the rows that fit on screen. */
  openCount: number
  ackCount: number
}

// Foreign keys named explicitly, so an embed cannot silently change meaning or
// start failing as ambiguous when another relationship between these tables
// is added.
const QUEUE_SELECT =
  'id, pregnancy_id, status, reason, fired_factors, source, created_at, acknowledged_at, ' +
  'pregnancies!escalations_pregnancy_id_fkey(link_code, patients(full_name, district)), ' +
  'patient_reports!patient_reports_escalation_id_fkey(message_text)'

/**
 * Unacknowledged first, then acknowledged — each read on its own, so a busy
 * day of acknowledged work can never push a waiting alert off the list. The
 * waiting ones are read oldest first: if the cap is ever reached, it is the
 * longest-waiting that are kept.
 */
async function loadQueue(): Promise<Queue> {
  const client = await getAuthedSupabase()
  const [open, acknowledged, openCount, ackCount] = await Promise.all([
    client
      .from('escalations')
      .select(QUEUE_SELECT)
      .eq('status', 'ochiq')
      .order('created_at', { ascending: true })
      .limit(QUEUE_LIMIT),
    client
      .from('escalations')
      .select(QUEUE_SELECT)
      .eq('status', 'qabul')
      .order('created_at', { ascending: false })
      .limit(QUEUE_LIMIT),
    client.from('escalations').select('id', { count: 'exact', head: true }).eq('status', 'ochiq'),
    client.from('escalations').select('id', { count: 'exact', head: true }).eq('status', 'qabul'),
  ])
  for (const result of [open, acknowledged, openCount, ackCount]) {
    if (result.error) throw new Error(result.error.message)
  }

  // Newest waiting alert on top, where a live arrival lands.
  const waiting = toRows(open.data).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  return {
    rows: [...waiting, ...toRows(acknowledged.data)],
    openCount: openCount.count ?? waiting.length,
    ackCount: ackCount.count ?? 0,
  }
}

function toRows(data: unknown): QueueRow[] {
  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const pregnancy = one(row.pregnancies)
    const patient = one(pregnancy?.patients)
    const reports = Array.isArray(row.patient_reports) ? row.patient_reports : []
    return {
      id: String(row.id),
      pregnancyId: String(row.pregnancy_id),
      status: String(row.status),
      reason: String(row.reason),
      firedFactors: Array.isArray(row.fired_factors) ? row.fired_factors.map(String) : [],
      source: row.source === 'telegram' ? 'telegram' : 'clinic',
      createdAt: new Date(String(row.created_at)),
      acknowledgedAt: typeof row.acknowledged_at === 'string' ? new Date(row.acknowledged_at) : null,
      patientName: text(patient?.full_name),
      district: text(patient?.district),
      linkCode: text(pregnancy?.link_code),
      patientWords: reports
        .map((report) => text((report as Record<string, unknown>).message_text))
        .filter((words): words is string => words !== null),
    }
  })
}

const URGENCY_CHIP: Record<Urgency, string> = {
  calm: 'bg-slate-100 text-slate-700',
  waiting: 'bg-zone-sariq-soft text-text-primary ring-1 ring-zone-sariq',
  overdue: 'bg-zone-qizil text-white',
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <div className="text-xs text-text-muted">{label}</div>
      <div className="text-lg font-semibold text-text-primary">
        {value}
        {note ? <span className="ml-1 text-xs font-normal text-text-muted">{note}</span> : null}
      </div>
    </div>
  )
}

function Card({
  row,
  now,
  isNew,
  onChanged,
}: {
  row: QueueRow
  now: Date
  isNew: boolean
  onChanged: (message: string | null) => void
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  // The status this card moved away from, until the re-read shows the new
  // one. Without it the buttons woke up while the card still said "ochiq", and
  // a second tap told her someone else had already taken her own alert.
  const [movedFrom, setMovedFrom] = useState<string | null>(null)
  const working = busy || movedFrom === row.status
  const [error, setError] = useState<string | null>(null)
  const open = minutesBetween(row.createdAt, now)
  const urgency = urgencyFor(row.status, open)

  async function act(kind: 'acknowledge' | 'close') {
    if (kind === 'close' && note.trim() === '') {
      setError(QUEUE_UI.noteRequired)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const client = await getAuthedSupabase()
      const outcome =
        kind === 'acknowledge'
          ? await acknowledgeEscalation(client, row.id)
          : await closeEscalation(client, row.id, note)
      if (outcome === 'done') setMovedFrom(row.status)
      onChanged(outcome === 'already_handled' ? QUEUE_UI.alreadyHandled : null)
    } catch (caught) {
      setError(`${QUEUE_UI.actionFailed} (${caught instanceof Error ? caught.message : String(caught)})`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li
      className={[
        'rounded-xl border border-l-4 border-border border-l-zone-qizil bg-surface p-4 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_4px_16px_-8px_rgba(15,23,42,0.12)]',
        isNew ? 'row-enter' : '',
      ].join(' ')}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={[
            'rounded px-1.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase',
            row.source === 'telegram' ? 'bg-sky-600 text-white' : 'bg-slate-200 text-slate-800',
          ].join(' ')}
        >
          {ESCALATION_SOURCE_LABELS[row.source]}
        </span>
        <span className="text-sm font-medium text-slate-700">{ESCALATION_STATUS_LABELS[row.status] ?? row.status}</span>
        <span className={['rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums', URGENCY_CHIP[urgency]].join(' ')}>
          {formatElapsed(open)}
        </span>
        <span className="ml-auto text-xs text-text-muted">{formatMoment(row.createdAt)}</span>
      </div>

      <div className="mt-2 text-base font-semibold text-text-primary">
        <AppLink
          to={pathFor({ name: 'patient', pregnancyId: row.pregnancyId })}
          className="hover:text-brand hover:underline"
        >
          {row.patientName ?? '—'}
        </AppLink>
        {row.district ? <span className="text-sm font-normal text-text-muted"> · {row.district}</span> : null}
        {row.linkCode ? (
          <span className="text-sm font-normal text-text-muted">
            {' '}
            · {QUEUE_UI.code} {row.linkCode}
          </span>
        ) : null}
      </div>

      <p className="mt-1 text-sm leading-snug text-slate-800">{row.reason}</p>

      {row.firedFactors.length > 0 ? (
        <ul className="mt-1.5 list-inside list-disc text-sm leading-snug text-slate-700">
          {row.firedFactors.map((code) => (
            <li key={code}>{describeFactor(code)}</li>
          ))}
        </ul>
      ) : null}

      {row.patientWords.length > 0 ? (
        <div className="mt-2 rounded-md bg-bg p-2.5">
          <div className="text-xs font-medium text-text-muted">{QUEUE_UI.patientWords}</div>
          {row.patientWords.map((words, index) => (
            <p key={index} className="mt-0.5 text-sm leading-snug whitespace-pre-wrap text-text-primary">
              «{words}»
            </p>
          ))}
        </div>
      ) : null}

      <div className="mt-3 border-t border-border pt-3">
        {row.status === 'ochiq' ? (
          <Button variant="primary" loading={working} onClick={() => act('acknowledge')} icon={<CheckIcon size={16} />}>
            {working ? QUEUE_UI.working : QUEUE_UI.acknowledge}
          </Button>
        ) : null}

        {row.status === 'qabul' ? (
          <div className="space-y-2">
            {row.acknowledgedAt !== null ? (
              <p className="text-xs text-text-muted">
                {formatMoment(row.acknowledgedAt)} · {formatElapsed(minutesBetween(row.createdAt, row.acknowledgedAt))}{' '}
                {QUEUE_UI.acknowledgedAfter}
              </p>
            ) : null}
            <label className="block text-sm text-slate-800">
              {QUEUE_UI.resolutionNote}
              <textarea
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={QUEUE_UI.notePlaceholder}
                className="mt-1 w-full resize-y rounded-lg border border-border-input bg-surface p-2.5 text-sm text-text-primary shadow-[inset_0_1px_1px_rgba(15,23,42,0.04)] focus:border-brand focus:ring-3 focus:ring-brand/15 focus:outline-none"
              />
            </label>
            <Button variant="success" loading={working} onClick={() => act('close')} icon={<CheckIcon size={16} />}>
              {working ? QUEUE_UI.working : QUEUE_UI.close}
            </Button>
          </div>
        ) : null}

        {error !== null ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      </div>
    </li>
  )
}

/**
 * The escalation queue: every open escalation, newest first, whatever raised it.
 *
 * Kept global and not by district on purpose: a specialist should not have to
 * click through geography to see who is in crisis now. Clinic and Telegram
 * escalations share one list with the same urgency, marked by source — the two
 * warrant the same response and a different first question.
 *
 * The only actions are the two the schema allows: acknowledge (ochiq -> qabul)
 * and close with a note (qabul -> yopiq).
 */
export function EscalationQueue() {
  const [queue, setQueue] = useState<Queue | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [avgAck, setAvgAck] = useState<number | null>(null)
  const [now, setNow] = useState(() => new Date())
  const seen = useRef<Set<string> | null>(null)
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set())
  const begin = useLatestOnly()

  const load = useCallback(() => {
    const isLatest = begin()
    getAuthedSupabase()
      .then(async (client) => {
        const [next, acks] = await Promise.all([loadQueue(), loadRecentAcknowledgements(client)])
        if (!isLatest()) return
        // Only rows that arrive while the queue is on screen animate in.
        const before = seen.current
        setFresh(new Set(before === null ? [] : next.rows.filter((r) => !before.has(r.id)).map((r) => r.id)))
        seen.current = new Set(next.rows.map((r) => r.id))
        setQueue(next)
        setAvgAck(averageAckMinutes(acks))
        setNow(new Date())
        setError(null)
      })
      .catch((caught: unknown) => {
        if (isLatest()) setError(caught instanceof Error ? caught.message : String(caught))
      })
  }, [begin])

  const rows = queue?.rows ?? null

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), TICK_MS)
    return () => clearInterval(timer)
  }, [])

  // Re-read when an escalation is raised or changes. The current list stays on
  // screen until the new one arrives — no flash back to a loading state.
  const live = useLiveChanges({ table: 'escalations', events: ['INSERT', 'UPDATE'], delayMs: 800 }, () => load())

  const openCount = queue?.openCount ?? 0
  const ackCount = queue?.ackCount ?? 0
  const truncated = queue !== null && queue.rows.length < queue.openCount + queue.ackCount

  return (
    <div className="pb-10">
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-text-primary">{QUEUE_UI.title}</h2>
        <div className="flex items-center gap-3">
          <LiveBadge status={live.status} onReconnect={live.reconnect} />
          <Button size="sm" variant="secondary" onClick={load}>
            {QUEUE_UI.refresh}
          </Button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 sm:max-w-xl">
        <Stat label={QUEUE_UI.statOpen} value={rows === null ? QUEUE_UI.statNone : String(openCount)} />
        <Stat label={QUEUE_UI.statAcknowledged} value={rows === null ? QUEUE_UI.statNone : String(ackCount)} />
        <Stat
          label={QUEUE_UI.statAvgAck}
          value={avgAck === null ? QUEUE_UI.statNone : formatElapsed(avgAck)}
          note={QUEUE_UI.statAvgAckWindow}
        />
      </div>

      {notice !== null ? (
        <p role="status" className="mt-3 rounded-md border border-border bg-brand-soft p-3 text-sm text-text-primary">
          {notice}
        </p>
      ) : null}

      {error !== null ? (
        <div role="alert" className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {QUEUE_UI.loadFailed} ({error})
          <Button size="sm" variant="secondary" onClick={load} className="ml-2">
            {QUEUE_UI.refresh}
          </Button>
        </div>
      ) : null}

      {rows === null && error === null ? (
        <div className="mt-4 space-y-3" aria-hidden="true">
          {[0, 1].map((i) => (
            <div key={i} className="h-36 animate-pulse rounded-lg border border-border bg-surface" />
          ))}
        </div>
      ) : null}

      {rows !== null && rows.length === 0 ? (
        <div className="mt-6 rounded-lg border border-border bg-surface px-4 py-8 text-center">
          <div className="flex justify-center">
            <ZoneIcon zone="yashil" size={28} />
          </div>
          <p className="mt-2 text-sm font-medium text-text-primary">{QUEUE_UI.empty}</p>
          <p className="mt-1 text-xs text-text-muted">{QUEUE_UI.emptyNote}</p>
        </div>
      ) : null}

      {rows !== null && rows.length > 0 ? (
        <ul className="mt-4 space-y-3">
          {rows.map((row) => (
            <Card
              key={row.id}
              row={row}
              now={now}
              isNew={fresh.has(row.id)}
              onChanged={(message) => {
                setNotice(message)
                load()
              }}
            />
          ))}
        </ul>
      ) : null}

      {truncated ? (
        <p className="mt-3 text-xs text-text-muted">{QUEUE_UI.truncated}</p>
      ) : null}
    </div>
  )
}
