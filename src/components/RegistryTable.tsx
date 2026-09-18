import { useState } from 'react'
import { REGISTRY_UI } from '../lib/labels'
import {
  formatDay,
  sortPatients,
  type RegistryPatient,
  type SortDirection,
  type SortKey,
  stalenessText,
  type Staleness,
} from '../lib/registry'
import { pathFor, type PatientOrigin } from '../lib/routes'
import { AppLink } from './AppLink'
import { ZonePill } from './Zone'

export function StalenessChip({ staleness }: { staleness: Staleness }) {
  return (
    <span className="inline-block max-w-full rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] leading-snug font-medium text-amber-900">
      {stalenessText(staleness)}
    </span>
  )
}

function SortHeader({
  label,
  column,
  sort,
  onSort,
  align = 'left',
}: {
  label: string
  column: SortKey
  sort: { key: SortKey; direction: SortDirection }
  onSort: (key: SortKey) => void
  align?: 'left' | 'right'
}) {
  const active = sort.key === column
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={['px-3 py-2 font-medium', align === 'right' ? 'text-right' : 'text-left'].join(' ')}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={['inline-flex items-center gap-1 hover:text-text-primary', active ? 'text-text-primary' : ''].join(' ')}
      >
        {label}
        <span aria-hidden="true" className={active ? 'opacity-100' : 'opacity-0'}>
          {sort.direction === 'asc' ? '↑' : '↓'}
        </span>
      </button>
    </th>
  )
}

/**
 * Pregnancies as a sortable table, the zone pill leftmost. The default order is
 * the triage order: most urgent zone first, and within it whoever needs
 * chasing. Every row opens the patient page, carrying where it came from.
 */
export function RegistryTable({
  patients,
  flashing,
  showDistrict = false,
  origin,
}: {
  patients: readonly RegistryPatient[]
  flashing: ReadonlySet<string>
  showDistrict?: boolean
  /** The district the table belongs to, for the patient page's back link. */
  origin?: string
}) {
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({ key: 'zone', direction: 'asc' })
  const rows = sortPatients(patients, sort.key, sort.direction)
  const onSort = (key: SortKey) =>
    setSort((current) =>
      current.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' },
    )

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-bg text-xs text-text-muted">
          <tr>
            <SortHeader label={REGISTRY_UI.colZone} column="zone" sort={sort} onSort={onSort} />
            <SortHeader label={REGISTRY_UI.colPatient} column="name" sort={sort} onSort={onSort} />
            {showDistrict ? <SortHeader label={REGISTRY_UI.colDistrict} column="district" sort={sort} onSort={onSort} /> : null}
            <SortHeader label={REGISTRY_UI.colWeek} column="week" sort={sort} onSort={onSort} align="right" />
            <SortHeader label={REGISTRY_UI.colDue} column="dueDate" sort={sort} onSort={onSort} />
            <SortHeader label={REGISTRY_UI.colLastVisit} column="lastVisit" sort={sort} onSort={onSort} />
            <th scope="col" className="px-3 py-2 text-left font-medium">
              {REGISTRY_UI.colStatus}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((patient) => {
            const from: PatientOrigin = { district: origin ?? patient.district, zone: patient.zone }
            return (
              <tr
                key={patient.pregnancyId}
                className={['hover:bg-bg', flashing.has(patient.pregnancyId) ? 'changed-flash' : ''].join(' ')}
              >
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <ZonePill zone={patient.zone} />
                </td>
                <td className="px-3 py-2.5">
                  <AppLink
                    to={pathFor({ name: 'patient', pregnancyId: patient.pregnancyId })}
                    state={{ from }}
                    className="font-semibold text-text-primary hover:text-brand hover:underline"
                  >
                    {patient.fullName}
                  </AppLink>
                  {patient.village ? <div className="text-xs text-text-muted">{patient.village}</div> : null}
                </td>
                {showDistrict ? <td className="px-3 py-2.5 text-slate-700">{patient.district}</td> : null}
                <td className="px-3 py-2.5 text-right text-slate-700 tabular-nums">
                  {patient.gestationalWeek !== null ? `${patient.gestationalWeek}-${REGISTRY_UI.week}` : '—'}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-slate-700 tabular-nums">
                  {patient.dueDate === null ? '—' : formatDay(patient.dueDate.date)}
                  {patient.dueDate?.computed ? <span className="text-xs text-text-muted"> ({REGISTRY_UI.computed})</span> : null}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-slate-700 tabular-nums">
                  {patient.lastVisit === null ? REGISTRY_UI.never : formatDay(patient.lastVisit)}
                </td>
                <td className="px-3 py-2.5">{patient.staleness !== null ? <StalenessChip staleness={patient.staleness} /> : null}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="animate-pulse overflow-hidden rounded-lg border border-border bg-surface" aria-hidden="true">
      <div className="h-9 border-b border-border bg-bg" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-border px-3 py-3 last:border-b-0">
          <div className="h-5 w-20 rounded-full bg-slate-200" />
          <div className="h-4 w-40 rounded bg-slate-200" />
          <div className="ml-auto h-4 w-24 rounded bg-slate-100" />
        </div>
      ))}
    </div>
  )
}
