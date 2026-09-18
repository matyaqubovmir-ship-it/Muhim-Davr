import { useCallback, useEffect, useMemo, useState } from 'react'
import { REGISTRY_UI, VISITS_UI } from '../lib/labels'
import { useLatestOnly } from '../lib/latest-only'
import { REFRESH_DELAY_MS, useLiveChanges } from '../lib/live-changes'
import type { PregnancyChoice } from '../lib/patients'
import { formatDay } from '../lib/registry'
import { pathFor } from '../lib/routes'
import { startOfDay } from '../lib/schedule'
import { getAuthedSupabase } from '../lib/supabase'
import { GROUP_ORDER, groupVisits, loadVisitCalendar, type CalendarGroup, type CalendarVisit } from '../lib/visits'
import { AppLink } from './AppLink'
import { Button } from './Button'
import { CalendarIcon, PlusIcon, SendIcon } from './Icons'
import { LiveBadge } from './LiveBadge'
import { ZonePill } from './Zone'

const DAY_MS = 86_400_000

const GROUP_TITLE: Record<CalendarGroup, string> = {
  overdue: VISITS_UI.overdue,
  today: VISITS_UI.today,
  tomorrow: VISITS_UI.tomorrow,
  thisWeek: VISITS_UI.thisWeek,
  later: VISITS_UI.later,
}

function ReminderStatus({ visit, days }: { visit: CalendarVisit; days: number }) {
  if (!visit.hasTelegram) {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
        {VISITS_UI.noTelegram}
      </span>
    )
  }
  if (visit.remindersSent.length > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800 ring-1 ring-sky-200">
        <SendIcon size={11} />
        {VISITS_UI.remindersSent}:{' '}
        {visit.remindersSent.map((k) => (k === 'ikki_kun' ? VISITS_UI.reminderTwoDays : VISITS_UI.reminderMorning)).join(', ')}
      </span>
    )
  }
  if (days < 0) return null
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-text-muted">
      <SendIcon size={11} /> {VISITS_UI.reminderWillSend}
    </span>
  )
}

function Row({ visit, today, onRecordVisit }: { visit: CalendarVisit; today: Date; onRecordVisit: (c: PregnancyChoice) => void }) {
  const days = Math.round((startOfDay(visit.targetDate).getTime() - startOfDay(today).getTime()) / DAY_MS)
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-shadow hover:shadow-[0_2px_8px_rgba(15,23,42,0.07)] sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <ZonePill zone={visit.zone} />
        <div className="min-w-0">
          <AppLink
            to={pathFor({ name: 'patient', pregnancyId: visit.pregnancyId })}
            className="block truncate text-sm font-semibold text-text-primary hover:text-brand hover:underline"
          >
            {visit.fullName}
          </AppLink>
          <div className="truncate text-xs text-text-muted">
            {[visit.district, visit.village].filter(Boolean).join(' · ')} · {visit.targetWeek}-{VISITS_UI.week}
          </div>
          <div className="mt-1.5">
            <ReminderStatus visit={visit} days={days} />
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <div className="text-right">
          <div className="text-sm font-semibold text-text-primary tabular-nums">{formatDay(visit.targetDate)}</div>
          <div className={['text-xs', days < 0 ? 'font-semibold text-amber-800' : 'text-text-muted'].join(' ')}>
            {days < 0 ? VISITS_UI.daysOverdue(-days) : days === 0 ? VISITS_UI.today : VISITS_UI.inDays(days)}
          </div>
        </div>
        <Button
          size="sm"
          variant={days <= 0 ? 'primary' : 'secondary'}
          icon={<PlusIcon size={15} />}
          onClick={() =>
            onRecordVisit({ pregnancyId: visit.pregnancyId, fullName: visit.fullName, district: visit.district, village: visit.village })
          }
        >
          {VISITS_UI.recordVisit}
        </Button>
      </div>
    </li>
  )
}

function Stat({ label, value, note, tone = 'neutral' }: { label: string; value: number; note?: string; tone?: 'neutral' | 'amber' | 'brand' }) {
  return (
    <div
      className={[
        'rounded-xl border bg-surface px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]',
        tone === 'amber' && value > 0 ? 'border-amber-300' : tone === 'brand' && value > 0 ? 'border-brand/40' : 'border-border',
      ].join(' ')}
    >
      <div className="text-xs font-medium text-text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-text-primary">{value}</div>
      {note ? <div className="text-xs text-text-muted">{note}</div> : null}
    </div>
  )
}

/**
 * /visits — the appointment calendar. For the midwife: who is coming today
 * and who has not come. For the specialist: the same across every district,
 * and who will not get a Telegram reminder and must be phoned.
 */
export function VisitsPage({ onRecordVisit }: { onRecordVisit: (choice: PregnancyChoice) => void }) {
  const [visits, setVisits] = useState<CalendarVisit[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [district, setDistrict] = useState<string>('')
  const [today, setToday] = useState(() => new Date())
  const begin = useLatestOnly()

  const load = useCallback(() => {
    const isLatest = begin()
    const now = new Date()
    getAuthedSupabase()
      .then((client) => loadVisitCalendar(client, now))
      .then((next) => {
        if (!isLatest()) return
        setVisits(next)
        setToday(now)
        setError(null)
      })
      .catch((caught: unknown) => {
        if (isLatest()) setError(caught instanceof Error ? caught.message : String(caught))
      })
  }, [begin])

  useEffect(() => {
    load()
  }, [load])

  // A saved visit closes today's contact and rewrites the plan: re-read on it.
  const live = useLiveChanges({ table: 'assessments', events: ['INSERT'], delayMs: REFRESH_DELAY_MS }, () => load())
  useLiveChanges({ table: 'visits', events: ['INSERT', 'UPDATE'], delayMs: REFRESH_DELAY_MS }, () => load())

  const districts = useMemo(() => [...new Set((visits ?? []).map((v) => v.district))].sort((a, b) => a.localeCompare(b, 'uz')), [visits])
  const shown = useMemo(() => (visits ?? []).filter((v) => district === '' || v.district === district), [visits, district])
  const groups = useMemo(() => groupVisits(shown, today), [shown, today])

  return (
    <div className="pb-12">
      <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-brand-soft text-brand">
            <CalendarIcon size={19} />
          </span>
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-text-primary">{VISITS_UI.title}</h2>
            <p className="text-sm text-text-muted">{VISITS_UI.subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {districts.length > 1 ? (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <span className="sr-only">{REGISTRY_UI.colDistrict}</span>
              <select
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                className="min-h-9 rounded-lg border border-border-input bg-surface px-2.5 text-sm text-text-primary shadow-[0_1px_2px_rgba(15,23,42,0.06)] focus:border-brand focus:ring-3 focus:ring-brand/15 focus:outline-none"
              >
                <option value="">{REGISTRY_UI.allDistricts}</option>
                {districts.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <LiveBadge status={live.status} onReconnect={live.reconnect} />
        </div>
      </div>

      {error !== null ? (
        <div role="alert" className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {VISITS_UI.loadFailed} ({error})
          <Button size="sm" variant="secondary" onClick={load}>
            {REGISTRY_UI.retry}
          </Button>
        </div>
      ) : null}

      {visits === null && error === null ? (
        <div className="mt-4 space-y-3" aria-hidden="true">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="h-[84px] animate-pulse rounded-xl border border-border bg-surface" />
            ))}
          </div>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl border border-border bg-surface" />
          ))}
        </div>
      ) : null}

      {visits !== null ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={VISITS_UI.statTotal} value={shown.length - groups.overdue.length} />
            <Stat label={VISITS_UI.statToday} value={groups.today.length} tone="brand" />
            <Stat label={VISITS_UI.statOverdue} value={groups.overdue.length} tone="amber" />
            <Stat label={VISITS_UI.statNoTelegram} value={shown.filter((v) => !v.hasTelegram).length} note={VISITS_UI.statNoTelegramNote} tone="amber" />
          </div>

          {shown.length === 0 ? (
            <p className="mt-6 rounded-xl border border-border bg-surface p-5 text-center text-sm text-slate-600">{VISITS_UI.allEmpty}</p>
          ) : (
            GROUP_ORDER.filter((g) => groups[g].length > 0).map((g) => (
              <section key={g} className="mt-6">
                <h3
                  className={[
                    'mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide uppercase',
                    g === 'overdue' ? 'text-amber-800' : g === 'today' ? 'text-brand' : 'text-text-muted',
                  ].join(' ')}
                >
                  {GROUP_TITLE[g]}
                  <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700 tabular-nums">{groups[g].length}</span>
                </h3>
                <ul className="space-y-2">
                  {groups[g].map((visit) => (
                    <Row key={visit.visitId} visit={visit} today={today} onRecordVisit={onRecordVisit} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </>
      ) : null}
    </div>
  )
}
