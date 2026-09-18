import { useCallback, useEffect, useState } from 'react'
import { loadDashboard, type ActivityItem, type DailyCount, type DashboardData } from '../lib/dashboard'
import { formatElapsed } from '../lib/escalation-actions'
import { DASHBOARD_UI, REGISTRY_UI, ZONE_COLORS, ZONE_NAMES } from '../lib/labels'
import { useLatestOnly } from '../lib/latest-only'
import { REFRESH_DELAY_MS, useLiveChanges } from '../lib/live-changes'
import { formatDay, type DistrictSummary } from '../lib/registry'
import type { RiskZone } from '../lib/risk'
import { pathFor } from '../lib/routes'
import { getAuthedSupabase } from '../lib/supabase'
import { useWidth } from '../lib/use-width'
import { TOKENS } from '../lib/zone-style'
import { AppLink } from './AppLink'
import { AlertIcon, ChatIcon } from './Icons'
import { LiveBadge } from './LiveBadge'
import { StalenessChip } from './RegistryTable'
import { ZoneIcon, ZonePill } from './Zone'

const pad = (n: number) => String(n).padStart(2, '0')
const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

function Card({ title, note, action, children }: { title: string; note?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          {note ? <p className="mt-0.5 text-xs text-text-muted">{note}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

// --- stat tiles ------------------------------------------------------------------

type Tone = 'neutral' | 'qizil' | 'sariq'

const TONE_ACCENT: Record<Tone, string> = {
  neutral: 'before:bg-slate-200',
  qizil: 'before:bg-zone-qizil',
  sariq: 'before:bg-zone-sariq',
}

function StatTile({ label, value, note, tone = 'neutral' }: { label: string; value: string; note?: string; tone?: Tone }) {
  return (
    <div
      className={[
        'relative overflow-hidden rounded-xl border border-border bg-surface px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]',
        "before:absolute before:inset-y-0 before:left-0 before:w-1 before:content-['']",
        TONE_ACCENT[tone],
      ].join(' ')}
    >
      <div className="text-xs font-medium text-text-muted">{label}</div>
      {/* Proportional figures: a large standalone number reads tighter without tabular-nums. */}
      <div className="mt-1 text-2xl font-semibold tracking-tight text-text-primary">{value}</div>
      {note ? <div className="mt-0.5 truncate text-xs text-text-muted">{note}</div> : null}
    </div>
  )
}

// --- zones by district: a bar matrix ----------------------------------------------

type Column = { key: RiskZone | 'unassessed'; label: string; color: string }

const COLUMNS: Column[] = [
  { key: 'qizil', label: ZONE_NAMES.qizil, color: ZONE_COLORS.qizil },
  { key: 'sariq', label: ZONE_NAMES.sariq, color: ZONE_COLORS.sariq },
  { key: 'yashil', label: ZONE_NAMES.yashil, color: ZONE_COLORS.yashil },
  { key: 'unassessed', label: REGISTRY_UI.unassessed.toUpperCase(), color: '#94A3B8' },
]

/**
 * One row per district, one column per zone, each cell a bar on a shared scale
 * with its count beside it. Not a stacked bar: red and amber sit 13.6 apart in
 * OKLab, too close to tell apart where they touch, so here they never touch and
 * the column says which zone it is. It is a real table, so it reads without the
 * bars at all.
 */
function ZoneMatrix({ districts }: { districts: readonly DistrictSummary[] }) {
  const max = Math.max(1, ...districts.flatMap((d) => [d.qizil, d.sariq, d.yashil, d.unassessed]))
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-text-muted">
            <th scope="col" className="py-1.5 pr-3 text-left font-medium">
              {REGISTRY_UI.colDistrict}
            </th>
            {COLUMNS.map((column) => (
              <th key={column.key} scope="col" className="px-2 py-1.5 text-left font-medium whitespace-nowrap">
                <span className="inline-flex items-center gap-1">
                  <ZoneIcon zone={column.key === 'unassessed' ? null : column.key} size={11} />
                  {column.label}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {districts.map((d) => (
            <tr key={d.district}>
              <th scope="row" className="py-2.5 pr-3 text-left font-medium whitespace-nowrap">
                <AppLink to={pathFor({ name: 'district', district: d.district })} className="text-text-primary hover:text-brand hover:underline">
                  {d.district}
                </AppLink>
                <div className="text-xs font-normal text-text-muted">
                  {d.total} {REGISTRY_UI.active}
                </div>
              </th>
              {COLUMNS.map((column) => {
                const count = d[column.key]
                return (
                  <td key={column.key} className="min-w-28 px-2 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 rounded-full bg-bg">
                        <div
                          className="h-2 rounded-full"
                          style={{ width: `${(count / max) * 100}%`, minWidth: count > 0 ? 4 : 0, backgroundColor: column.color }}
                        />
                      </div>
                      <span className="w-6 text-right text-text-primary tabular-nums">{count}</span>
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// --- activity: two single-series column charts -----------------------------------

function niceMax(value: number): number {
  if (value <= 4) return 4
  const step = value <= 10 ? 2 : value <= 25 ? 5 : 10
  return Math.ceil(value / step) * step
}

/**
 * Columns per day for one measure. One colour and one axis; the title names
 * it. Hover a day for its figure; the table beneath has every value.
 */
function DailyColumns({
  title,
  series,
  pick,
  color,
}: {
  title: string
  series: readonly DailyCount[]
  pick: (d: DailyCount) => number
  color: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const values = series.map(pick)
  const top = niceMax(Math.max(...values))
  const height = 120
  const margin = { top: 8, right: 4, bottom: 22, left: 26 }
  const plotW = Math.max(0, width - margin.left - margin.right)
  const slot = plotW / Math.max(1, series.length)
  const barW = Math.min(24, slot * 0.62)
  const y = (v: number) => margin.top + height - (v / top) * height
  const total = values.reduce((a, b) => a + b, 0)
  const shown = hover ?? series.length - 1
  // Day labels counted back from today, so today is always labelled and no two
  // labels ever sit side by side. A "dd.mm" label needs about 34px.
  const labelEvery = Math.max(2, Math.ceil(34 / Math.max(1, slot)))
  const labelled = (i: number) => (series.length - 1 - i) % labelEvery === 0

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h4 className="text-xs font-medium text-text-muted">{title}</h4>
        <span className="text-xs text-text-muted tabular-nums">
          {formatDay(series[shown].date).slice(0, 5)}: <strong className="font-semibold text-text-primary">{values[shown]}</strong>
          <span className="ml-2">Σ {total}</span>
        </span>
      </div>
      <div ref={ref}>
        {width > 0 ? (
          <svg width={width} height={margin.top + height + margin.bottom} role="img" aria-label={`${title}: ${total}`} className="block">
            {[0, top / 2, top].map((t) => (
              <g key={t}>
                <line x1={margin.left} x2={width - margin.right} y1={y(t)} y2={y(t)} stroke={TOKENS.border} strokeWidth={1} />
                <text x={margin.left - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill={TOKENS.textMuted} style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {t}
                </text>
              </g>
            ))}
            {series.map((d, i) => {
              const v = values[i]
              const x = margin.left + slot * i + (slot - barW) / 2
              const h = (v / top) * height
              const r = Math.min(4, h)
              // Rounded data end, square at the baseline.
              const path =
                v === 0
                  ? ''
                  : `M${x},${y(0)} V${y(v) + r} Q${x},${y(v)} ${x + r},${y(v)} H${x + barW - r} Q${x + barW},${y(v)} ${x + barW},${y(v) + r} V${y(0)} Z`
              return (
                <g key={d.date.getTime()}>
                  {path ? <path d={path} fill={color} fillOpacity={hover === null || hover === i ? 1 : 0.45} /> : null}
                  {labelled(i) ? (
                    <text x={margin.left + slot * i + slot / 2} y={margin.top + height + 15} textAnchor="middle" fontSize={10} fill={TOKENS.textMuted}>
                      {formatDay(d.date).slice(0, 5)}
                    </text>
                  ) : null}
                  <rect
                    x={margin.left + slot * i}
                    y={margin.top}
                    width={slot}
                    height={height}
                    fill="transparent"
                    onPointerEnter={() => setHover(i)}
                    onPointerLeave={() => setHover(null)}
                  />
                </g>
              )
            })}
          </svg>
        ) : (
          <div style={{ height: margin.top + height + margin.bottom }} />
        )}
      </div>
    </div>
  )
}

function ActivityTable({ series }: { series: readonly DailyCount[] }) {
  return (
    <details className="mt-3 text-xs">
      <summary className="cursor-pointer text-text-muted hover:text-text-primary">{DASHBOARD_UI.tableView}</summary>
      <table className="mt-2 w-full tabular-nums">
        <thead className="text-text-muted">
          <tr>
            <th className="py-1 text-left font-medium">{DASHBOARD_UI.day}</th>
            <th className="py-1 text-right font-medium">{DASHBOARD_UI.assessmentsPerDay}</th>
            <th className="py-1 text-right font-medium">{DASHBOARD_UI.escalationsPerDay}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border text-text-primary">
          {[...series].reverse().map((d) => (
            <tr key={d.date.getTime()}>
              <td className="py-1">{formatDay(d.date)}</td>
              <td className="py-1 text-right">{d.assessments}</td>
              <td className="py-1 text-right">{d.escalations}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

// --- feed ---------------------------------------------------------------------------

function feedLabel(item: ActivityItem): string {
  if (item.kind === 'assessment') return item.detail === 'patient' ? DASHBOARD_UI.feedAssessmentPatient : DASHBOARD_UI.feedAssessment
  if (item.kind === 'escalation') return item.detail === 'telegram' ? DASHBOARD_UI.feedEscalationTelegram : DASHBOARD_UI.feedEscalationClinic
  return item.detail === 'unprocessed' ? DASHBOARD_UI.feedTelegramUnprocessed : DASHBOARD_UI.feedTelegram
}

function FeedIcon({ item }: { item: ActivityItem }) {
  if (item.kind === 'assessment') return <ZoneIcon zone={item.zone} size={16} />
  if (item.kind === 'escalation') return <AlertIcon size={16} className="text-zone-qizil" />
  return <ChatIcon size={16} className="text-sky-600" />
}

function ActivityFeed({ items, now }: { items: readonly ActivityItem[]; now: Date }) {
  if (items.length === 0) return <p className="text-sm text-text-muted">{DASHBOARD_UI.feedEmpty}</p>
  return (
    <ol className="space-y-3">
      {items.map((item) => (
        <li key={item.id} className="flex gap-3">
          <div className="mt-0.5">
            <FeedIcon item={item} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm text-text-primary">{feedLabel(item)}</div>
            <div className="truncate text-xs text-text-muted">
              <AppLink to={pathFor({ name: 'patient', pregnancyId: item.pregnancyId })} className="hover:text-brand hover:underline">
                {item.patientName ?? '—'}
              </AppLink>
              {' · '}
              {formatElapsed(Math.max(0, Math.floor((now.getTime() - item.at.getTime()) / 60_000)))} {DASHBOARD_UI.ago}
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}

// --- page -------------------------------------------------------------------------

function Skeleton() {
  return (
    <div className="mt-4 space-y-4" aria-hidden="true">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-[88px] animate-pulse rounded-xl border border-border bg-surface" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="h-64 animate-pulse rounded-xl border border-border bg-surface lg:col-span-2" />
        <div className="h-64 animate-pulse rounded-xl border border-border bg-surface" />
      </div>
    </div>
  )
}

/**
 * /dashboard — the specialist's landing page: the district picture at a
 * glance, who needs attention, and what has just happened. Re-reads itself on
 * every new assessment and every escalation change; the previous figures stay
 * on screen until the new ones arrive.
 */
export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  const begin = useLatestOnly()

  const load = useCallback(() => {
    const isLatest = begin()
    getAuthedSupabase()
      .then((client) => loadDashboard(client))
      .then((next) => {
        if (!isLatest()) return
        setData(next)
        setUpdatedAt(new Date())
        setError(null)
      })
      .catch((caught: unknown) => {
        if (isLatest()) setError(caught instanceof Error ? caught.message : String(caught))
      })
  }, [begin])

  useEffect(() => {
    load()
  }, [load])

  const liveAssessments = useLiveChanges({ table: 'assessments', events: ['INSERT'], delayMs: REFRESH_DELAY_MS }, () => load())
  useLiveChanges({ table: 'escalations', events: ['INSERT', 'UPDATE'], delayMs: 800 }, () => load())

  const now = updatedAt ?? new Date()
  const t = data?.totals

  return (
    <div className="pb-12">
      <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-text-primary">{DASHBOARD_UI.title}</h2>
          <p className="text-sm text-text-muted">{DASHBOARD_UI.subtitle}</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-text-muted">
          {updatedAt ? (
            <span>
              {DASHBOARD_UI.updated} {clock(updatedAt)}
            </span>
          ) : null}
          <LiveBadge status={liveAssessments.status} onReconnect={liveAssessments.reconnect} />
        </div>
      </div>

      {error !== null ? (
        <div role="alert" className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {DASHBOARD_UI.loadFailed} ({error})
          <button type="button" onClick={load} className="ml-2 font-semibold underline">
            {REGISTRY_UI.retry}
          </button>
        </div>
      ) : null}

      {data === null && error === null ? <Skeleton /> : null}

      {data !== null && t !== undefined ? (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatTile label={DASHBOARD_UI.tileActive} value={String(t.active)} note={`${data.districts.length} ${REGISTRY_UI.colDistrict.toLowerCase()}`} />
            <StatTile
              label={DASHBOARD_UI.tileQizil}
              value={String(t.qizil)}
              note={t.active > 0 ? `${DASHBOARD_UI.tileQizilOf} ${Math.round((t.qizil / t.active) * 100)}%` : undefined}
              tone={t.qizil > 0 ? 'qizil' : 'neutral'}
            />
            <StatTile
              label={DASHBOARD_UI.tileOpen}
              value={String(data.openEscalations)}
              note={data.oldestOpenMinutes === null ? DASHBOARD_UI.tileNoneOpen : `${DASHBOARD_UI.tileOldest} ${formatElapsed(data.oldestOpenMinutes)}`}
              tone={data.openEscalations > 0 ? 'qizil' : 'neutral'}
            />
            <StatTile
              label={DASHBOARD_UI.tileAvgAck}
              value={data.avgAckMinutes === null ? '—' : formatElapsed(data.avgAckMinutes)}
              note={DASHBOARD_UI.tileAvgAckNote}
            />
            <StatTile label={DASHBOARD_UI.tileOverdue} value={String(data.overdue)} tone={data.overdue > 0 ? 'sariq' : 'neutral'} />
            <StatTile label={DASHBOARD_UI.tileTelegram} value={String(data.linkedToTelegram)} note={DASHBOARD_UI.tileTelegramNote} />
          </div>

          {/* grid-cols-1 is minmax(0, 1fr): without it the column grows to the
              zone table's widest row and pushes the page sideways on a phone. */}
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Card title={DASHBOARD_UI.zonesTitle} note={DASHBOARD_UI.zonesNote}>
                <ZoneMatrix districts={data.districts} />
              </Card>
            </div>
            <Card
              title={DASHBOARD_UI.attentionTitle}
              note={DASHBOARD_UI.attentionNote}
              action={
                <AppLink to={pathFor({ name: 'patients' })} className="text-xs font-medium text-brand hover:underline">
                  {DASHBOARD_UI.seeAll}
                </AppLink>
              }
            >
              {data.attention.length === 0 ? (
                <p className="text-sm text-text-muted">{DASHBOARD_UI.attentionEmpty}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {data.attention.map((p) => (
                    <li key={p.pregnancyId} className="flex items-center gap-3 py-2.5">
                      <ZonePill zone={p.zone} />
                      <div className="min-w-0 flex-1">
                        <AppLink
                          to={pathFor({ name: 'patient', pregnancyId: p.pregnancyId })}
                          state={{ from: { district: p.district, zone: p.zone } }}
                          className="block truncate text-sm font-medium text-text-primary hover:text-brand hover:underline"
                        >
                          {p.fullName}
                        </AppLink>
                        <div className="truncate text-xs text-text-muted">{[p.district, p.village].filter(Boolean).join(' · ')}</div>
                      </div>
                      {p.staleness !== null ? <StalenessChip staleness={p.staleness} /> : null}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Card title={DASHBOARD_UI.activityTitle}>
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <DailyColumns title={DASHBOARD_UI.assessmentsPerDay} series={data.daily} pick={(d) => d.assessments} color={TOKENS.brand} />
                  <DailyColumns title={DASHBOARD_UI.escalationsPerDay} series={data.daily} pick={(d) => d.escalations} color={ZONE_COLORS.qizil} />
                </div>
                <ActivityTable series={data.daily} />
              </Card>
            </div>
            <Card title={DASHBOARD_UI.feedTitle}>
              <ActivityFeed items={data.activity} now={now} />
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  )
}
