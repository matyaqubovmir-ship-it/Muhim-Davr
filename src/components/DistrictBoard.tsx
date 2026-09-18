import { useCallback, useEffect, useRef, useState } from 'react'
import { useChangedFlash } from '../lib/changed-flash'
import { REGISTRY_UI, ZONE_NAMES } from '../lib/labels'
import { useLiveAssessments } from '../lib/live-changes'
import {
  ZONE_ORDER,
  changedPatients,
  formatDay,
  groupByZone,
  loadDistrictPatients,
  type RegistryPatient,
} from '../lib/registry'
import type { RiskZone } from '../lib/risk'
import { pathFor, type PatientOrigin } from '../lib/routes'
import { getAuthedSupabase } from '../lib/supabase'
import { ZONE_CLASS } from '../lib/zone-style'
import { AppLink } from './AppLink'
import { LiveBadge } from './LiveBadge'
import { RegistryTable, SkeletonTable, StalenessChip } from './RegistryTable'
import { ZoneIcon } from './Zone'

type View = 'table' | 'board'
const VIEW_KEY = 'ona.registry.view'

function readView(): View {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'board' ? 'board' : 'table'
  } catch {
    return 'table'
  }
}

function BoardCard({ patient, district, flashing }: { patient: RegistryPatient; district: string; flashing: boolean }) {
  const origin: PatientOrigin = { district, zone: patient.zone }
  const place = [
    patient.village,
    patient.gestationalWeek !== null ? `${patient.gestationalWeek}-${REGISTRY_UI.week}` : null,
  ].filter((part): part is string => part !== null)

  return (
    <li>
      <AppLink
        to={pathFor({ name: 'patient', pregnancyId: patient.pregnancyId })}
        state={{ from: origin }}
        className={[
          'block rounded-md border border-border bg-surface p-3 transition-colors hover:border-slate-400 focus-visible:outline-2 focus-visible:outline-brand',
          flashing ? 'changed-flash' : '',
        ].join(' ')}
      >
        <div className="text-sm font-semibold text-text-primary">{patient.fullName}</div>
        {place.length > 0 ? <div className="text-xs text-text-muted">{place.join(' · ')}</div> : null}
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs text-slate-700">
          <dt className="text-text-muted">{REGISTRY_UI.dueDate}</dt>
          <dd>
            {patient.dueDate === null ? '—' : formatDay(patient.dueDate.date)}
            {patient.dueDate?.computed ? <span className="text-text-muted"> ({REGISTRY_UI.computed})</span> : null}
          </dd>
          <dt className="text-text-muted">{REGISTRY_UI.lastVisit}</dt>
          <dd>{patient.lastVisit === null ? REGISTRY_UI.never : formatDay(patient.lastVisit)}</dd>
        </dl>
        {patient.staleness !== null ? (
          <div className="mt-2">
            <StalenessChip staleness={patient.staleness} />
          </div>
        ) : null}
      </AppLink>
    </li>
  )
}

function BoardColumn({
  zone,
  patients,
  district,
  flashing,
}: {
  zone: RiskZone | null
  patients: readonly RegistryPatient[]
  district: string
  flashing: ReadonlySet<string>
}) {
  const title = zone === null ? REGISTRY_UI.unassessed.toUpperCase() : ZONE_NAMES[zone]
  return (
    <section
      className={[
        'rounded-lg border border-t-4 border-border bg-bg p-2.5',
        zone === null ? 'border-t-slate-400' : ZONE_CLASS[zone].borderTop,
      ].join(' ')}
      aria-label={title}
    >
      <h3 className="flex items-center justify-between px-1 pb-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold tracking-wide text-text-primary">
          <ZoneIcon zone={zone} />
          {title}
        </span>
        <span className="text-sm font-semibold text-text-muted tabular-nums">{patients.length}</span>
      </h3>
      {zone === null ? <p className="px-1 pb-2 text-xs text-text-muted">{REGISTRY_UI.unassessedNote}</p> : null}
      {patients.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 bg-surface/70 px-3 py-4 text-center text-xs text-text-muted">
          {REGISTRY_UI.emptyZone}
        </p>
      ) : (
        <ul className="space-y-2">
          {patients.map((patient) => (
            <BoardCard
              key={patient.pregnancyId}
              patient={patient}
              district={district}
              flashing={flashing.has(patient.pregnancyId)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function SkeletonBoard() {
  return (
    <div className="grid gap-3 md:grid-cols-3" aria-hidden="true">
      {ZONE_ORDER.map((zone) => (
        <div key={zone} className="animate-pulse rounded-lg border border-border bg-bg p-2.5">
          <div className="h-4 w-16 rounded bg-slate-200" />
          <div className="mt-3 h-20 rounded-md bg-surface" />
          <div className="mt-2 h-20 rounded-md bg-surface" />
        </div>
      ))}
    </div>
  )
}

/**
 * /registry/:district — this district's active pregnancies. A sortable table
 * by default, zone pill leftmost; the three-column board as a toggle. The zone
 * comes from latest_assessment_per_pregnancy through registry_pregnancies;
 * nothing here works it out.
 */
export function DistrictBoard({ district }: { district: string }) {
  const [patients, setPatients] = useState<RegistryPatient[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>(readView)
  const previous = useRef<RegistryPatient[] | null>(null)
  const [flashing, flash] = useChangedFlash()

  const load = useCallback(() => {
    getAuthedSupabase()
      .then((client) => loadDistrictPatients(client, district))
      .then((next) => {
        if (previous.current !== null) flash(changedPatients(previous.current, next))
        previous.current = next
        setPatients(next)
        setError(null)
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)))
  }, [district, flash])

  useEffect(() => {
    load()
  }, [load])

  const live = useLiveAssessments(load)
  const chooseView = (next: View) => {
    setView(next)
    try {
      window.localStorage.setItem(VIEW_KEY, next)
    } catch {
      // Storage unavailable: the choice lasts until reload.
    }
  }
  const groups = patients === null ? null : groupByZone(patients)

  return (
    <div className="pb-10">
      <nav className="mt-4 text-sm">
        <AppLink to={pathFor({ name: 'registry' })} className="text-text-muted hover:text-text-primary hover:underline">
          ← {REGISTRY_UI.allDistricts}
        </AppLink>
      </nav>

      <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">{district}</h2>
          <p className="text-sm text-text-muted">{REGISTRY_UI.districtSubtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          <LiveBadge status={live.status} onReconnect={live.reconnect} />
          <div role="group" className="inline-flex rounded-md border border-border bg-surface p-0.5 text-sm">
            {(['table', 'board'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={view === option}
                onClick={() => chooseView(option)}
                className={[
                  'rounded px-3 py-1 font-medium',
                  view === option ? 'bg-brand text-white' : 'text-slate-700 hover:text-text-primary',
                ].join(' ')}
              >
                {option === 'table' ? REGISTRY_UI.viewTable : REGISTRY_UI.viewBoard}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error !== null ? (
        <div role="alert" className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {REGISTRY_UI.loadFailed} ({error})
          <button type="button" onClick={load} className="ml-2 font-semibold underline">
            {REGISTRY_UI.retry}
          </button>
        </div>
      ) : null}

      <div className="mt-4">
        {patients === null && error === null ? view === 'table' ? <SkeletonTable /> : <SkeletonBoard /> : null}

        {patients !== null && patients.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-4 text-sm text-text-muted">{REGISTRY_UI.noPatients}</p>
        ) : null}

        {patients !== null && patients.length > 0 && view === 'table' ? (
          <RegistryTable patients={patients} flashing={flashing} origin={district} />
        ) : null}

        {groups !== null && patients !== null && patients.length > 0 && view === 'board' ? (
          <>
            <div className="grid items-start gap-3 md:grid-cols-3">
              {ZONE_ORDER.map((zone) => (
                <BoardColumn key={zone} zone={zone} patients={groups[zone]} district={district} flashing={flashing} />
              ))}
            </div>
            {groups.unassessed.length > 0 ? (
              <div className="mt-3">
                <BoardColumn zone={null} patients={groups.unassessed} district={district} flashing={flashing} />
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  )
}
