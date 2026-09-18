import { useState } from 'react'
import { AppLink } from './components/AppLink'
import { DistrictBoard } from './components/DistrictBoard'
import { EntryForm } from './components/EntryForm'
import { EscalationQueue } from './components/EscalationQueue'
import { PatientPage } from './components/PatientPage'
import { RegistryOverview } from './components/RegistryOverview'
import { ResultScreen } from './components/ResultScreen'
import { NOT_FOUND_UI, QUEUE_UI, REGISTRY_UI, UI } from './lib/labels'
import { usePathname } from './lib/navigation'
import { parseRoute, pathFor, type Route } from './lib/routes'
import type { SavedVisit } from './lib/visit-followup'

const TABS: { label: string; route: Route; active: (route: Route) => boolean }[] = [
  { label: QUEUE_UI.tabEntry, route: { name: 'entry' }, active: (r) => r.name === 'entry' },
  {
    label: REGISTRY_UI.tab,
    route: { name: 'registry' },
    active: (r) => r.name === 'registry' || r.name === 'district' || r.name === 'patient',
  },
  { label: QUEUE_UI.tabQueue, route: { name: 'escalations' }, active: (r) => r.name === 'escalations' },
]

/**
 * The midwife's entry form, the district registry and the doctor's escalation
 * queue, each at its own URL.
 */
export default function App() {
  const route = parseRoute(usePathname())
  const [saved, setSaved] = useState<SavedVisit | null>(null)

  // The entry form is a phone screen; the registry and the queue are read on a
  // desk and use the width.
  const wide = route.name !== 'entry'

  return (
    <div className="min-h-screen bg-slate-50">
      <div className={['mx-auto px-4', wide ? 'max-w-5xl' : 'max-w-lg'].join(' ')}>
        <header className="pt-5 pb-1">
          <h1 className="text-lg font-bold tracking-tight text-slate-900">{UI.appTitle}</h1>
          <p className="text-sm text-slate-500">{UI.appSubtitle}</p>
        </header>

        <nav className="mt-2 flex gap-2">
          {TABS.map((tab) => {
            const active = tab.active(route)
            return (
              <AppLink
                key={tab.label}
                to={pathFor(tab.route)}
                className={[
                  'flex min-h-10 flex-1 items-center justify-center rounded-md px-4 text-sm font-semibold sm:flex-none',
                  active
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-300 bg-white text-slate-700 hover:border-slate-500',
                ].join(' ')}
              >
                {tab.label}
              </AppLink>
            )
          })}
        </nav>

        {/* Hidden rather than unmounted, so a half-typed visit survives a look elsewhere. */}
        <div className={route.name === 'entry' ? '' : 'hidden'}>
          {saved ? (
            <ResultScreen saved={saved} onNewEntry={() => setSaved(null)} />
          ) : (
            <EntryForm onSaved={setSaved} />
          )}
        </div>

        {/* The rest mount on arrival, so each one is read fresh when opened. */}
        {route.name === 'registry' ? <RegistryOverview /> : null}
        {route.name === 'district' ? <DistrictBoard key={route.district} district={route.district} /> : null}
        {route.name === 'patient' ? <PatientPage key={route.pregnancyId} pregnancyId={route.pregnancyId} /> : null}
        {route.name === 'escalations' ? <EscalationQueue /> : null}
        {route.name === 'not_found' ? (
          <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700">
            {NOT_FOUND_UI.title}{' '}
            <AppLink to={pathFor({ name: 'entry' })} className="font-semibold underline">
              {NOT_FOUND_UI.home}
            </AppLink>
          </div>
        ) : null}
      </div>
    </div>
  )
}
