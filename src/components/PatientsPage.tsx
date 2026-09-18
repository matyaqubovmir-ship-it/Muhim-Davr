import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useChangedFlash } from '../lib/changed-flash'
import { PATIENTS_UI, REGISTRY_UI } from '../lib/labels'
import { useLiveAssessments } from '../lib/live-changes'
import { PATIENT_LIST_LIMIT, changedPatients, loadRegistryPatients, type RegistryPatient } from '../lib/registry'
import { getAuthedSupabase } from '../lib/supabase'
import { LiveBadge } from './LiveBadge'
import { RegistryTable, SkeletonTable } from './RegistryTable'

const SEARCH_DELAY_MS = 250

/**
 * /patients — every active pregnancy, across districts, searchable by name.
 * The registry answers "which district needs attention"; this answers "where
 * is she", for a specialist who knows a name and not a tuman.
 */
export function PatientsPage() {
  const id = useId()
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')
  const [patients, setPatients] = useState<RegistryPatient[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const previous = useRef<RegistryPatient[] | null>(null)
  const [flashing, flash] = useChangedFlash()

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [text])

  const load = useCallback(() => {
    getAuthedSupabase()
      .then((client) => loadRegistryPatients(client, { nameContains: query }))
      .then((next) => {
        if (previous.current !== null) flash(changedPatients(previous.current, next))
        previous.current = next
        setPatients(next)
        setError(null)
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)))
  }, [query, flash])

  useEffect(() => {
    // A new search is not a change to highlight.
    previous.current = null
    load()
  }, [load])

  const live = useLiveAssessments(load)

  return (
    <div className="pb-10">
      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">{PATIENTS_UI.title}</h2>
          <p className="text-sm text-text-muted">{PATIENTS_UI.subtitle}</p>
        </div>
        <LiveBadge status={live.status} onReconnect={live.reconnect} />
      </div>

      <div className="mt-3 max-w-md">
        <label htmlFor={`${id}-search`} className="sr-only">
          {PATIENTS_UI.search}
        </label>
        <input
          id={`${id}-search`}
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={PATIENTS_UI.search}
          className="min-h-11 w-full rounded-md border border-border bg-surface px-3 text-base text-text-primary focus:border-brand focus:outline-none"
        />
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
        {patients === null && error === null ? <SkeletonTable /> : null}
        {patients !== null && patients.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-4 text-sm text-text-muted">{PATIENTS_UI.none}</p>
        ) : null}
        {patients !== null && patients.length > 0 ? (
          <RegistryTable patients={patients} flashing={flashing} showDistrict />
        ) : null}
        {patients !== null && patients.length >= PATIENT_LIST_LIMIT ? (
          <p className="mt-2 text-xs text-text-muted">{PATIENTS_UI.truncated}</p>
        ) : null}
      </div>
    </div>
  )
}
