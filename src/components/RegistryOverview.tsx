import { useCallback, useEffect, useRef, useState } from 'react'
import { useChangedFlash } from '../lib/changed-flash'
import { REGISTRY_UI, ZONE_NAMES } from '../lib/labels'
import { ZONE_CLASS } from '../lib/zone-style'
import { ZoneIcon } from './Zone'
import { useLiveAssessments } from '../lib/live-changes'
import { ZONE_ORDER, changedDistricts, loadDistricts, type DistrictSummary } from '../lib/registry'
import { pathFor } from '../lib/routes'
import { getAuthedSupabase } from '../lib/supabase'
import { AppLink } from './AppLink'
import { LiveBadge } from './LiveBadge'

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-lg border border-border bg-surface p-4" aria-hidden="true">
      <div className="h-4 w-32 rounded bg-slate-200" />
      <div className="mt-4 grid grid-cols-3 gap-2">
        {ZONE_ORDER.map((zone) => (
          <div key={zone} className="h-14 rounded-md bg-slate-100" />
        ))}
      </div>
    </div>
  )
}

function DistrictCard({ summary, flashing }: { summary: DistrictSummary; flashing: boolean }) {
  return (
    <AppLink
      to={pathFor({ name: 'district', district: summary.district })}
      className={[
        'block rounded-lg border border-border bg-surface p-4 transition-colors hover:border-slate-400 focus-visible:outline-2 focus-visible:outline-brand',
        flashing ? 'changed-flash' : '',
      ].join(' ')}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-semibold text-text-primary">{summary.district}</h3>
        <span className="text-xs text-text-muted">
          {summary.total} {REGISTRY_UI.active}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {ZONE_ORDER.map((zone) => (
          <div
            key={zone}
            className={['rounded-md border-t-4 bg-bg px-2.5 py-2', ZONE_CLASS[zone].borderTop].join(' ')}
          >
            {/* 24px bold: large text, so the zone colour clears 3:1 even for sariq. */}
            <div className={['text-2xl leading-none font-semibold', ZONE_CLASS[zone].text].join(' ')}>
              {summary[zone]}
            </div>
            <div className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold tracking-wide text-slate-700">
              <ZoneIcon zone={zone} size={11} />
              {ZONE_NAMES[zone]}
            </div>
          </div>
        ))}
      </div>

      {summary.unassessed > 0 ? (
        <p className="mt-2 text-xs text-slate-600">
          {REGISTRY_UI.unassessed}: <span className="font-semibold">{summary.unassessed}</span>
        </p>
      ) : null}
    </AppLink>
  )
}

/**
 * /registry — one card per district that has an active pregnancy, the most red
 * first. Districts come from the data, never from a list in code.
 */
export function RegistryOverview() {
  const [districts, setDistricts] = useState<DistrictSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const previous = useRef<DistrictSummary[] | null>(null)
  const [flashing, flash] = useChangedFlash()

  const load = useCallback(() => {
    getAuthedSupabase()
      .then(loadDistricts)
      .then((next) => {
        if (previous.current !== null) flash(changedDistricts(previous.current, next))
        previous.current = next
        setDistricts(next)
        setError(null)
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)))
  }, [flash])

  useEffect(() => {
    load()
  }, [load])

  const live = useLiveAssessments(load)

  return (
    <div className="pb-10">
      <div className="mt-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">{REGISTRY_UI.title}</h2>
          <p className="text-sm text-slate-600">{REGISTRY_UI.subtitle}</p>
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

      {districts === null && error === null ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : null}

      {districts !== null && districts.length === 0 ? (
        <p className="mt-6 rounded-lg border border-border bg-surface p-4 text-sm text-slate-600">
          {REGISTRY_UI.noDistricts}
        </p>
      ) : null}

      {districts !== null && districts.length > 0 ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {districts.map((summary) => (
            <DistrictCard
              key={summary.district}
              summary={summary}
              flashing={flashing.has(summary.district)}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
