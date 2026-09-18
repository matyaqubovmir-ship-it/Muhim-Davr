import { useState } from 'react'
import { AppLink } from './components/AppLink'
import { DistrictBoard } from './components/DistrictBoard'
import { EntryForm } from './components/EntryForm'
import { EscalationQueue } from './components/EscalationQueue'
import { EscalationToasts } from './components/EscalationToasts'
import { NewPatientPage } from './components/NewPatientPage'
import { PatientPage } from './components/PatientPage'
import { RegistryOverview } from './components/RegistryOverview'
import { ResultScreen } from './components/ResultScreen'
import { useEscalationAlerts } from './lib/escalation-alerts'
import { ALERT_UI, NEW_PATIENT_UI, NOT_FOUND_UI, QUEUE_UI, REGISTRY_UI, ROLE_UI, UI } from './lib/labels'
import { navigate, usePathname } from './lib/navigation'
import type { PregnancyChoice } from './lib/patients'
import { ROLE_TABS, homeFor, useRole, type Role } from './lib/role'
import { parseRoute, pathFor, type Route } from './lib/routes'
import type { SavedVisit } from './lib/visit-followup'

const TAB_LABELS: Record<(typeof ROLE_TABS)[Role][number], string> = {
  entry: QUEUE_UI.tabEntry,
  new_patient: NEW_PATIENT_UI.tab,
  registry: REGISTRY_UI.tab,
  escalations: QUEUE_UI.tabQueue,
}

/** A tab is active on its own route and on the screens it leads to. */
function isActive(tab: (typeof ROLE_TABS)[Role][number], route: Route): boolean {
  if (tab === 'registry') return route.name === 'registry' || route.name === 'district' || route.name === 'patient'
  return route.name === tab
}

/**
 * The midwife's entry form and patient registration, the district registry and
 * the escalation queue, each at its own URL. The role switch only chooses which
 * of them the tabs show; every URL works for everyone (see src/lib/role.ts).
 */
export default function App() {
  const route = parseRoute(usePathname())
  const [role, setRole] = useRole()
  const [saved, setSaved] = useState<SavedVisit | null>(null)
  // Who the entry form is recording for. Held here so it survives a trip to
  // /patients/new and back, and so does whatever was already typed.
  const [pregnancy, setPregnancy] = useState<PregnancyChoice | null>(null)
  const alerts = useEscalationAlerts(role === 'specialist')

  // Phone-width for the midwife's forms; the width of a desk for the rest.
  const wide = route.name !== 'entry' && route.name !== 'new_patient'

  const switchRole = (next: Role) => {
    setRole(next)
    navigate(pathFor(homeFor(next)))
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {role === 'specialist' ? <EscalationToasts toasts={alerts.toasts} onDismiss={alerts.dismiss} /> : null}

      <div className={['mx-auto px-4', wide ? 'max-w-5xl' : 'max-w-lg'].join(' ')}>
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 pt-5 pb-1">
          <div>
            <h1 className="text-lg font-bold tracking-tight text-slate-900">{UI.appTitle}</h1>
            <p className="text-sm text-slate-500">{UI.appSubtitle}</p>
          </div>
          <div className="text-right">
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              {ROLE_UI.label}
              <select
                value={role}
                onChange={(event) => switchRole(event.target.value as Role)}
                className="min-h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
              >
                <option value="midwife">{ROLE_UI.midwife}</option>
                <option value="specialist">{ROLE_UI.specialist}</option>
              </select>
            </label>
            <p className="mt-0.5 text-[11px] text-slate-500">{ROLE_UI.note}</p>
          </div>
        </header>

        <nav className="mt-2 flex flex-wrap items-center gap-2">
          {ROLE_TABS[role].map((tab) => {
            const active = isActive(tab, route)
            const count = tab === 'escalations' ? alerts.openCount : null
            return (
              <AppLink
                key={tab}
                to={pathFor({ name: tab } as Route)}
                className={[
                  'flex min-h-10 flex-1 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold sm:flex-none',
                  active
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-300 bg-white text-slate-700 hover:border-slate-500',
                ].join(' ')}
              >
                {TAB_LABELS[tab]}
                {count !== null && count > 0 ? (
                  // Keyed on the count, so each increase replays the one-off flash.
                  <span
                    key={count}
                    aria-label={`${count} ${ALERT_UI.openCount}`}
                    className="changed-flash rounded-full bg-red-700 px-1.5 py-0.5 text-[11px] leading-none font-bold text-white tabular-nums"
                  >
                    {count}
                  </span>
                ) : null}
              </AppLink>
            )
          })}
          {role === 'specialist' ? (
            <button
              type="button"
              onClick={alerts.toggleMuted}
              aria-pressed={!alerts.muted}
              className="ml-auto rounded-md px-2 py-1 text-xs text-slate-600 hover:text-slate-900"
            >
              {alerts.muted ? ALERT_UI.soundOff : ALERT_UI.soundOn}
            </button>
          ) : null}
        </nav>

        {/* Hidden rather than unmounted, so a half-typed visit survives a look elsewhere. */}
        <div className={route.name === 'entry' ? '' : 'hidden'}>
          {saved ? (
            <ResultScreen
              saved={saved}
              onNewEntry={() => {
                setSaved(null)
                // A new entry starts with nobody chosen: carrying the last woman
                // over is how a visit gets recorded against the wrong pregnancy.
                setPregnancy(null)
              }}
            />
          ) : (
            <EntryForm
              onSaved={setSaved}
              pregnancy={pregnancy}
              onPregnancyChange={setPregnancy}
              onCreatePatient={(typed) => navigate(pathFor({ name: 'new_patient' }), { name: typed })}
            />
          )}
        </div>

        {/* The rest mount on arrival, so each one is read fresh when opened. */}
        {route.name === 'new_patient' ? (
          <NewPatientPage
            onRecordVisit={(choice) => {
              setSaved(null)
              setPregnancy(choice)
              navigate(pathFor({ name: 'entry' }))
            }}
          />
        ) : null}
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
