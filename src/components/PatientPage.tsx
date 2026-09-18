import { useCallback, useEffect, useState } from 'react'
import {
  ESCALATION_SOURCE_LABELS,
  ESCALATION_STATUS_LABELS,
  PATIENT_PAGE_UI,
  TRIAGE_LEVEL_LABELS,
  ZONE_COLORS,
  ZONE_NAMES,
  describeFactor,
} from '../lib/labels'
import {
  formatMoment,
  formatVisit,
  headerFigures,
  latestRecordedGa,
  loadPatientDetail,
  type AssessmentPoint,
  type PatientDetail,
} from '../lib/patient-detail'
import { formatDay } from '../lib/registry'
import type { RiskZone } from '../lib/risk'
import { pathFor, readPatientOrigin } from '../lib/routes'
import { scheduleAnchor } from '../lib/schedule'
import { getAuthedSupabase } from '../lib/supabase'
import { AppLink } from './AppLink'
import { AssessmentChart } from './AssessmentChart'
import { LinkCode } from './LinkCode'
import { VisitSchedule } from './VisitSchedule'
import { ZonePill, ZoneSolid } from './Zone'

const SECTION_TITLE =
  'mb-2 border-b border-border pb-1.5 text-xs font-semibold tracking-wide text-text-muted uppercase'

function titleCase(word: string): string {
  return word.charAt(0) + word.slice(1).toLowerCase()
}

/** The headline zone badge, or a neutral one when she has never been assessed. */
function ZoneBadge({ zone }: { zone: RiskZone | null }) {
  if (zone === null) return <ZonePill zone={null} size="md" />
  return <ZoneSolid zone={zone} className="px-3 py-1.5 text-xl" />
}

function ZoneWord({ zone }: { zone: RiskZone }) {
  return <ZonePill zone={zone} />
}

function SourceBadge({ source }: { source: 'clinic' | 'telegram' }) {
  return (
    <span
      className={[
        'rounded px-1.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase',
        source === 'telegram' ? 'bg-sky-600 text-white' : 'bg-slate-200 text-slate-800',
      ].join(' ')}
    >
      {ESCALATION_SOURCE_LABELS[source]}
    </span>
  )
}

const bpText = (a: AssessmentPoint) =>
  a.bpSystolic !== null && a.bpDiastolic !== null ? `${a.bpSystolic}/${a.bpDiastolic}` : '—'

/** The assessment the chart or table points at, in full. */
function Readout({ assessment }: { assessment: AssessmentPoint }) {
  return (
    <div className="rounded-md border border-border bg-surface p-3" aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <ZoneWord zone={assessment.zone} />
        <span className="text-slate-700">{formatVisit(assessment)}</span>
        <span className="text-text-muted">
          {assessment.recordedBy === 'patient' ? PATIENT_PAGE_UI.byPatient : PATIENT_PAGE_UI.byMidwife}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 text-sm text-slate-700">
        <span>
          {PATIENT_PAGE_UI.colBp}: <strong className="text-text-primary">{bpText(assessment)}</strong>
        </span>
        <span>
          {PATIENT_PAGE_UI.colHb}:{' '}
          <strong className="text-text-primary">{assessment.hemoglobin ?? '—'}</strong>
        </span>
        <span>
          {PATIENT_PAGE_UI.score}: <strong className="text-text-primary">{assessment.score}</strong>
        </span>
      </div>
      {assessment.firedFactors.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">{PATIENT_PAGE_UI.noFactors}</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {assessment.firedFactors.map((code) => (
            <li key={code} className="flex gap-2 text-sm leading-snug text-slate-800">
              <span
                aria-hidden="true"
                className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: ZONE_COLORS[assessment.zone] }}
              />
              {describeFactor(code)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function History({ assessments }: { assessments: readonly AssessmentPoint[] }) {
  const [selected, setSelected] = useState<number>(assessments.length - 1)
  const [hovered, setHovered] = useState<number | null>(null)
  const shown = hovered ?? selected

  if (assessments.length === 0) {
    return <p className="text-sm text-slate-600">{PATIENT_PAGE_UI.noAssessments}</p>
  }

  return (
    <div className="space-y-3">
      <AssessmentChart assessments={assessments} active={shown} onHover={setHovered} onSelect={setSelected} />
      <p className="text-xs text-text-muted">{PATIENT_PAGE_UI.chartHint}</p>
      <Readout assessment={assessments[shown]} />

      {/* The table is the chart's twin: every plotted value, readable without a pointer. */}
      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="bg-bg text-xs text-text-muted">
            <tr>
              <th className="px-3 py-2 font-semibold">{PATIENT_PAGE_UI.colDate}</th>
              <th className="px-3 py-2 font-semibold">{PATIENT_PAGE_UI.colZone}</th>
              <th className="px-3 py-2 text-right font-semibold">{PATIENT_PAGE_UI.colBp}</th>
              <th className="px-3 py-2 text-right font-semibold">{PATIENT_PAGE_UI.colHb}</th>
              <th className="px-3 py-2 text-right font-semibold">{PATIENT_PAGE_UI.colScore}</th>
              <th className="px-3 py-2 font-semibold">{PATIENT_PAGE_UI.colBy}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {assessments
              .map((a, i) => ({ a, i }))
              .reverse()
              .map(({ a, i }) => (
                <tr
                  key={a.id}
                  tabIndex={0}
                  aria-selected={i === shown}
                  onClick={() => setSelected(i)}
                  onFocus={() => setSelected(i)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') setSelected(i)
                  }}
                  className={[
                    'cursor-pointer outline-none focus-visible:bg-slate-100',
                    i === shown ? 'bg-slate-100' : 'hover:bg-bg',
                  ].join(' ')}
                >
                  <td className="px-3 py-2 whitespace-nowrap text-slate-800">{formatVisit(a)}</td>
                  <td className="px-3 py-2">
                    <ZoneWord zone={a.zone} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{bpText(a)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{a.hemoglobin ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{a.score}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {a.recordedBy === 'patient' ? PATIENT_PAGE_UI.byPatient : PATIENT_PAGE_UI.byMidwife}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Escalations({ detail }: { detail: PatientDetail }) {
  if (detail.escalations.length === 0) {
    return <p className="text-sm text-slate-600">{PATIENT_PAGE_UI.noEscalations}</p>
  }
  return (
    <ul className="space-y-2">
      {detail.escalations.map((e) => (
        <li key={e.id} className="rounded-md border border-border bg-surface p-3">
          <div className="flex flex-wrap items-center gap-2">
            <SourceBadge source={e.source} />
            <span className="text-sm font-semibold text-text-primary">
              {ESCALATION_STATUS_LABELS[e.status] ?? e.status}
            </span>
          </div>
          <p className="mt-1 text-sm leading-snug text-slate-800">{e.reason}</p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-slate-700">
            <dt className="text-text-muted">{PATIENT_PAGE_UI.created}</dt>
            <dd>{formatMoment(e.createdAt)}</dd>
            {e.acknowledgedAt !== null ? (
              <>
                <dt className="text-text-muted">{PATIENT_PAGE_UI.acknowledged}</dt>
                <dd>{formatMoment(e.acknowledgedAt)}</dd>
              </>
            ) : null}
            {e.closedAt !== null ? (
              <>
                <dt className="text-text-muted">{PATIENT_PAGE_UI.closed}</dt>
                <dd>{formatMoment(e.closedAt)}</dd>
              </>
            ) : null}
            {e.referredTo !== null ? (
              <>
                <dt className="text-text-muted">{PATIENT_PAGE_UI.referredTo}</dt>
                <dd>{e.referredTo}</dd>
              </>
            ) : null}
            {e.resolutionNote !== null ? (
              <>
                <dt className="text-text-muted">{PATIENT_PAGE_UI.resolution}</dt>
                <dd>{e.resolutionNote}</dd>
              </>
            ) : null}
          </dl>
        </li>
      ))}
    </ul>
  )
}

function Schedule({ detail }: { detail: PatientDetail }) {
  const ga = latestRecordedGa(detail.assessments)
  const recorded = detail.header.lmpDate
  // The same anchor a saved visit stores its schedule from: the recorded LMP,
  // else an estimate from the latest recorded gestational age.
  const anchor = scheduleAnchor(recorded, ga?.weeks ?? null, ga?.on ?? new Date())

  // Say where the anchor came from: she gave it, it was worked back from a
  // gestational age, or it predates the record of which (null).
  const lmpLabel =
    recorded === null || detail.header.lmpEstimated === true
      ? PATIENT_PAGE_UI.scheduleEstimatedLmp
      : detail.header.lmpEstimated === false
        ? PATIENT_PAGE_UI.scheduleRecordedLmp
        : PATIENT_PAGE_UI.scheduleLmp

  if (detail.currentZone === null) {
    return <p className="text-sm text-slate-600">{PATIENT_PAGE_UI.scheduleNoZone}</p>
  }
  return (
    <>
      <VisitSchedule lmpDate={anchor} zone={detail.currentZone} />
      {anchor !== null ? (
        <p className="mt-2 text-xs text-text-muted">
          {lmpLabel}:{' '}
          {formatDay(anchor)}
        </p>
      ) : null}
    </>
  )
}

function TelegramFeed({ detail }: { detail: PatientDetail }) {
  if (detail.reports.length === 0) {
    return <p className="text-sm text-slate-600">{PATIENT_PAGE_UI.noReports}</p>
  }
  return (
    <ul className="space-y-2">
      {detail.reports.map((r) => (
        <li key={r.id} className="rounded-md border border-border bg-surface p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-text-muted">{formatMoment(r.createdAt)}</span>
            <span
              className={[
                'rounded px-1.5 py-0.5 font-semibold',
                r.triageLevel === 'immediate'
                  ? 'bg-red-50 text-red-800 ring-1 ring-red-200'
                  : r.triageLevel === 'prompt'
                    ? 'bg-amber-50 text-amber-900 ring-1 ring-amber-200'
                    : 'bg-slate-100 text-slate-700',
              ].join(' ')}
            >
              {TRIAGE_LEVEL_LABELS[r.triageLevel]}
            </span>
            {r.escalationId !== null ? (
              <span className="font-semibold text-slate-700">· {PATIENT_PAGE_UI.escalated}</span>
            ) : null}
          </div>
          <p className="mt-1.5 text-sm leading-snug whitespace-pre-wrap text-text-primary">«{r.messageText}»</p>
          {r.matchedSigns.length > 0 ? (
            <p className="mt-1 text-xs text-slate-600">{r.matchedSigns.map(describeFactor).join(' · ')}</p>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

/**
 * /patients/:pregnancyId — one woman's pregnancy in one place. Every figure on
 * it is read from a row; the zone is read from latest_assessment_per_pregnancy
 * and never worked out here.
 */
export function PatientPage({ pregnancyId }: { pregnancyId: string }) {
  const [detail, setDetail] = useState<PatientDetail | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  // Where the registry says she was clicked from. Survives a reload with the
  // history entry; absent when the page was opened from a pasted link.
  const origin = readPatientOrigin(window.history.state)

  const load = useCallback(() => {
    getAuthedSupabase()
      .then((client) => loadPatientDetail(client, pregnancyId))
      .then((next) => {
        setDetail(next)
        setError(null)
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)))
  }, [pregnancyId])

  useEffect(() => {
    load()
  }, [load])

  const figures = detail ? headerFigures(detail, new Date()) : null

  return (
    <div className="pb-12">
      {origin !== null ? (
        <nav className="mt-4 text-sm">
          <AppLink
            to={pathFor({ name: 'district', district: origin.district })}
            className="text-slate-600 hover:text-text-primary hover:underline"
          >
            ← {origin.zone !== null ? `${titleCase(ZONE_NAMES[origin.zone])} · ` : ''}
            {origin.district}
          </AppLink>
        </nav>
      ) : null}

      {error !== null ? (
        <div role="alert" className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {PATIENT_PAGE_UI.loadFailed} ({error})
          <button type="button" onClick={load} className="ml-2 font-semibold underline">
            {PATIENT_PAGE_UI.retry}
          </button>
        </div>
      ) : null}

      {detail === undefined && error === null ? (
        <div className="mt-4 animate-pulse space-y-3" aria-label={PATIENT_PAGE_UI.loading}>
          <div className="h-7 w-64 rounded bg-slate-200" />
          <div className="h-4 w-80 rounded bg-slate-200" />
          <div className="h-56 rounded-lg bg-slate-100" />
        </div>
      ) : null}

      {detail === null ? (
        <p className="mt-6 rounded-lg border border-border bg-surface p-4 text-sm text-slate-700">
          {PATIENT_PAGE_UI.notFound}
        </p>
      ) : null}

      {detail && figures ? (
        <>
          <header className="mt-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-text-primary">{detail.header.fullName}</h2>
              <p className="text-sm text-slate-600">
                {[detail.header.district, detail.header.village].filter(Boolean).join(' · ')}
              </p>
              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-slate-800">
                {figures.age !== null ? (
                  <span>
                    {figures.age} {PATIENT_PAGE_UI.age}
                  </span>
                ) : null}
                {detail.header.gravida !== null ? (
                  <span>
                    {PATIENT_PAGE_UI.gravida} {detail.header.gravida}
                  </span>
                ) : null}
                {detail.header.para !== null ? (
                  <span>
                    {PATIENT_PAGE_UI.para} {detail.header.para}
                  </span>
                ) : null}
                {figures.gestationalWeek !== null ? (
                  <span>
                    {figures.gestationalWeek}-{PATIENT_PAGE_UI.week}
                  </span>
                ) : null}
                {figures.dueDate !== null ? (
                  <span>
                    {PATIENT_PAGE_UI.dueDate}: {formatDay(figures.dueDate.date)}
                    {figures.dueDate.computed ? (
                      <span className="text-text-muted"> ({PATIENT_PAGE_UI.computed})</span>
                    ) : null}
                  </span>
                ) : null}
              </p>
              {!detail.header.isActive ? (
                <p className="mt-1 text-sm font-medium text-slate-700">
                  {PATIENT_PAGE_UI.ended}
                  {detail.header.outcome ? `: ${detail.header.outcome}` : ''}
                </p>
              ) : null}
            </div>
            <ZoneBadge zone={detail.currentZone} />
          </header>

          <section className="mt-6">
            <h2 className={SECTION_TITLE}>{PATIENT_PAGE_UI.historyTitle}</h2>
            <History key={detail.assessments.length} assessments={detail.assessments} />
          </section>

          <section className="mt-6">
            <h2 className={SECTION_TITLE}>{PATIENT_PAGE_UI.escalationsTitle}</h2>
            <Escalations detail={detail} />
          </section>

          <section className="mt-2">
            <Schedule detail={detail} />
          </section>

          <LinkCode pregnancyId={detail.header.pregnancyId} />

          {detail.hasTelegram || detail.reports.length > 0 ? (
            <section className="mt-6">
              <h2 className={SECTION_TITLE}>{PATIENT_PAGE_UI.telegramTitle}</h2>
              <TelegramFeed detail={detail} />
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
