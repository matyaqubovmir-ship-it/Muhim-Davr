import { useCallback, useEffect, useRef, useState } from 'react'
import { useChangedFlash } from '../lib/changed-flash'
import { REGISTRY_UI, ZONE_COLORS, ZONE_NAMES } from '../lib/labels'
import { useLiveAssessments } from '../lib/live-changes'
import {
  ZONE_ORDER,
  changedPatients,
  formatDay,
  groupByZone,
  loadDistrictPatients,
  type RegistryPatient,
  type Staleness,
} from '../lib/registry'
import type { RiskZone } from '../lib/risk'
import { pathFor, type PatientOrigin } from '../lib/routes'
import { getAuthedSupabase } from '../lib/supabase'
import { AppLink } from './AppLink'
import { LiveBadge } from './LiveBadge'

function stalenessText(staleness: Staleness): string {
  switch (staleness.kind) {
    case 'overdue':
      return `${REGISTRY_UI.overdue}: ${formatDay(staleness.since)}`
    case 'never_seen':
      return REGISTRY_UI.neverSeen
    case 'not_seen':
      return `${staleness.days} ${REGISTRY_UI.notSeenDays}`
  }
}

function PatientRow({
  patient,
  district,
  flashing,
}: {
  patient: RegistryPatient
  district: string
  flashing: boolean
}) {
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
          'block rounded-md border border-slate-200 bg-white p-3 transition-colors hover:border-slate-400 focus-visible:outline-2 focus-visible:outline-slate-900',
          flashing ? 'changed-flash' : '',
        ].join(' ')}
      >
        <div className="text-sm font-semibold text-slate-900">{patient.fullName}</div>
        {place.length > 0 ? <div className="text-xs text-slate-600">{place.join(' · ')}</div> : null}

        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs text-slate-700">
          <dt className="text-slate-500">{REGISTRY_UI.dueDate}</dt>
          <dd>
            {patient.dueDate === null ? (
              '—'
            ) : (
              <>
                {formatDay(patient.dueDate.date)}
                {patient.dueDate.computed ? (
                  <span className="text-slate-500"> ({REGISTRY_UI.computed})</span>
                ) : null}
              </>
            )}
          </dd>
          <dt className="text-slate-500">{REGISTRY_UI.lastVisit}</dt>
          <dd>{patient.lastVisit === null ? REGISTRY_UI.never : formatDay(patient.lastVisit)}</dd>
        </dl>

        {patient.staleness !== null ? (
          <div className="mt-2 inline-block rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">
            {stalenessText(patient.staleness)}
          </div>
        ) : null}
      </AppLink>
    </li>
  )
}

function ZoneColumn({
  zone,
  patients,
  district,
  flashing,
}: {
  zone: RiskZone
  patients: readonly RegistryPatient[]
  district: string
  flashing: ReadonlySet<string>
}) {
  return (
    <section
      className="rounded-lg border border-t-4 border-slate-200 bg-slate-100/60 p-2.5"
      style={{ borderTopColor: ZONE_COLORS[zone] }}
      aria-label={ZONE_NAMES[zone]}
    >
      <h3 className="flex items-baseline justify-between px-1 pb-2">
        <span className="text-sm font-bold tracking-wide text-slate-900">{ZONE_NAMES[zone]}</span>
        <span className="text-xl font-bold tabular-nums" style={{ color: ZONE_COLORS[zone] }}>
          {patients.length}
        </span>
      </h3>

      {patients.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 bg-white/70 px-3 py-4 text-center text-xs text-slate-500">
          {REGISTRY_UI.emptyZone}
        </p>
      ) : (
        <ul className="space-y-2">
          {patients.map((patient) => (
            <PatientRow
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

function SkeletonColumn() {
  return (
    <div className="animate-pulse rounded-lg border border-slate-200 bg-slate-100/60 p-2.5" aria-hidden="true">
      <div className="h-4 w-16 rounded bg-slate-200" />
      <div className="mt-3 h-20 rounded-md bg-white" />
      <div className="mt-2 h-20 rounded-md bg-white" />
    </div>
  )
}

/**
 * /registry/:district — this district's active pregnancies in three zone
 * columns, most urgent first, then anyone not yet assessed. The zone comes from
 * latest_assessment_per_pregnancy through registry_pregnancies; nothing here
 * works it out.
 */
export function DistrictBoard({ district }: { district: string }) {
  const [patients, setPatients] = useState<RegistryPatient[] | null>(null)
  const [error, setError] = useState<string | null>(null)
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
  const groups = patients === null ? null : groupByZone(patients)

  return (
    <div className="pb-10">
      <nav className="mt-4 text-sm">
        <AppLink to={pathFor({ name: 'registry' })} className="text-slate-600 hover:text-slate-900 hover:underline">
          ← {REGISTRY_UI.allDistricts}
        </AppLink>
      </nav>

      <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{district}</h2>
          <p className="text-sm text-slate-600">{REGISTRY_UI.districtSubtitle}</p>
        </div>
        <LiveBadge status={live.status} onReconnect={live.reconnect} />
      </div>

      {error !== null ? (
        <div role="alert" className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {REGISTRY_UI.loadFailed} ({error})
          <button type="button" onClick={load} className="ml-2 font-semibold underline">
            {REGISTRY_UI.retry}
          </button>
        </div>
      ) : null}

      {groups === null && error === null ? (
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <SkeletonColumn />
          <SkeletonColumn />
          <SkeletonColumn />
        </div>
      ) : null}

      {patients !== null && patients.length === 0 ? (
        <p className="mt-6 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
          {REGISTRY_UI.noPatients}
        </p>
      ) : null}

      {groups !== null && patients !== null && patients.length > 0 ? (
        <>
          <div className="mt-4 grid items-start gap-3 md:grid-cols-3">
            {ZONE_ORDER.map((zone) => (
              <ZoneColumn
                key={zone}
                zone={zone}
                patients={groups[zone]}
                district={district}
                flashing={flashing}
              />
            ))}
          </div>

          {groups.unassessed.length > 0 ? (
            <section className="mt-4 rounded-lg border border-t-4 border-slate-200 border-t-slate-400 bg-slate-100/60 p-2.5">
              <h3 className="flex items-baseline justify-between px-1">
                <span className="text-sm font-bold tracking-wide text-slate-900">
                  {REGISTRY_UI.unassessed.toUpperCase()}
                </span>
                <span className="text-xl font-bold text-slate-700 tabular-nums">
                  {groups.unassessed.length}
                </span>
              </h3>
              <p className="px-1 pb-2 text-xs text-slate-600">{REGISTRY_UI.unassessedNote}</p>
              <ul className="grid gap-2 md:grid-cols-3">
                {groups.unassessed.map((patient) => (
                  <PatientRow
                    key={patient.pregnancyId}
                    patient={patient}
                    district={district}
                    flashing={flashing.has(patient.pregnancyId)}
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
