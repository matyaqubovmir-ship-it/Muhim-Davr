import { useState, type ReactNode } from 'react'
import { AppLink } from './components/AppLink'
import { DistrictBoard } from './components/DistrictBoard'
import { EntryForm } from './components/EntryForm'
import { EscalationQueue } from './components/EscalationQueue'
import { EscalationToasts } from './components/EscalationToasts'
import { NewPatientPage } from './components/NewPatientPage'
import { PatientPage } from './components/PatientPage'
import { PatientsPage } from './components/PatientsPage'
import { RegistryOverview } from './components/RegistryOverview'
import { ResultScreen } from './components/ResultScreen'
import { useEscalationAlerts } from './lib/escalation-alerts'
import { ALERT_UI, NAV_UI, NEW_PATIENT_UI, NOT_FOUND_UI, QUEUE_UI, ROLE_UI, UI } from './lib/labels'
import { navigate, usePathname } from './lib/navigation'
import type { PregnancyChoice } from './lib/patients'
import { ROLE_TABS, homeFor, useRole, type Role } from './lib/role'
import { parseRoute, pathFor, type Route } from './lib/routes'
import type { SavedVisit } from './lib/visit-followup'

type Tab = (typeof ROLE_TABS)[Role][number]

const TAB_LABELS: Record<Tab, string> = {
  entry: QUEUE_UI.tabEntry,
  new_patient: NEW_PATIENT_UI.tab,
  registry: NAV_UI.registry,
  escalations: NAV_UI.escalations,
  patients: NAV_UI.patients,
}

/** A tab is active on its own route and on the screens it leads to. */
function isActive(tab: Tab, route: Route): boolean {
  if (tab === 'registry') return route.name === 'registry' || route.name === 'district'
  if (tab === 'patients') return route.name === 'patients' || route.name === 'patient'
  return route.name === tab
}

/**
 * The open-escalation count. Pulses once when it goes up — not when it first
 * loads, and not when an escalation is acknowledged and it goes down.
 */
function CountBadge({ count }: { count: number | null }) {
  const [seen, setSeen] = useState(count)
  const [pulses, setPulses] = useState(0)
  if (count !== seen) {
    if (count !== null && seen !== null && count > seen) setPulses((p) => p + 1)
    setSeen(count)
  }
  if (count === null || count === 0) return null
  return (
    <span
      key={pulses}
      aria-label={`${count} ${ALERT_UI.openCount}`}
      className={[
        'inline-flex min-w-5 justify-center rounded-full bg-zone-qizil px-1.5 py-0.5 text-[11px] leading-none font-semibold text-white tabular-nums',
        pulses > 0 ? 'badge-pulse' : '',
      ].join(' ')}
    >
      {count}
    </span>
  )
}

function RoleSelect({ role, onChange }: { role: Role; onChange: (role: Role) => void }) {
  return (
    <div className="text-right">
      <label className="inline-flex items-center gap-2 text-sm text-slate-700">
        {ROLE_UI.label}
        <select
          value={role}
          onChange={(event) => onChange(event.target.value as Role)}
          className="min-h-9 rounded-md border border-border bg-surface px-2 text-sm text-text-primary"
        >
          <option value="midwife">{ROLE_UI.midwife}</option>
          <option value="specialist">{ROLE_UI.specialist}</option>
        </select>
      </label>
      <p className="mt-0.5 text-[11px] text-text-muted">{ROLE_UI.note}</p>
    </div>
  )
}

function Bell({ count }: { count: number | null }) {
  return (
    <AppLink
      to={pathFor({ name: 'escalations' })}
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-700 hover:bg-bg hover:text-text-primary"
    >
      <span className="sr-only">{NAV_UI.bell}</span>
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      <span className="absolute -top-1 -right-1">
        <CountBadge count={count} />
      </span>
    </AppLink>
  )
}

/**
 * The specialist's desk: a slim top bar and a left nav, content beside it. On a
 * phone the nav folds into a row under the bar.
 */
function SpecialistShell({
  route,
  role,
  onRole,
  alerts,
  children,
}: {
  route: Route
  role: Role
  onRole: (role: Role) => void
  alerts: ReturnType<typeof useEscalationAlerts>
  children: ReactNode
}) {
  const navLink = (tab: Tab, layout: 'side' | 'row') => {
    const active = isActive(tab, route)
    return (
      <AppLink
        key={tab}
        to={pathFor({ name: tab } as Route)}
        className={[
          'flex items-center justify-between gap-2 rounded-md px-3 text-sm font-medium',
          layout === 'side' ? 'min-h-9' : 'min-h-9 flex-1 justify-center',
          active ? 'bg-brand-soft text-brand' : 'text-slate-700 hover:bg-bg hover:text-text-primary',
        ].join(' ')}
      >
        {TAB_LABELS[tab]}
        {tab === 'escalations' ? <CountBadge count={alerts.openCount} /> : null}
      </AppLink>
    )
  }

  return (
    <div className="min-h-screen bg-bg">
      <EscalationToasts toasts={alerts.toasts} onDismiss={alerts.dismiss} />

      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
          <div className="mr-auto">
            <div className="text-base font-semibold tracking-tight text-text-primary">{UI.appTitle}</div>
            <div className="text-xs text-text-muted">{UI.appSubtitle}</div>
          </div>
          <button
            type="button"
            onClick={alerts.toggleMuted}
            aria-pressed={!alerts.muted}
            className="rounded-md px-2 py-1 text-xs text-text-muted hover:text-text-primary"
          >
            {alerts.muted ? ALERT_UI.soundOff : ALERT_UI.soundOn}
          </button>
          <Bell count={alerts.openCount} />
          <RoleSelect role={role} onChange={onRole} />
        </div>
        <nav className="flex gap-1 border-t border-border px-2 py-1.5 md:hidden">
          {ROLE_TABS.specialist.map((tab) => navLink(tab, 'row'))}
        </nav>
      </header>

      <div className="mx-auto flex max-w-7xl">
        <nav className="sticky top-[57px] hidden h-[calc(100vh-57px)] w-52 shrink-0 flex-col gap-1 border-r border-border px-3 py-4 md:flex">
          {ROLE_TABS.specialist.map((tab) => navLink(tab, 'side'))}
        </nav>
        <main className="min-w-0 flex-1 px-4 md:px-6">{children}</main>
      </div>
    </div>
  )
}

/**
 * The midwife's phone: a focused page with no desk chrome — the entry form and
 * patient registration, and nothing to navigate around.
 */
function MidwifeShell({
  route,
  role,
  onRole,
  wide,
  children,
}: {
  route: Route
  role: Role
  onRole: (role: Role) => void
  wide: boolean
  children: ReactNode
}) {
  return (
    <div className="min-h-screen bg-bg">
      <div className={['mx-auto px-4', wide ? 'max-w-5xl' : 'max-w-lg'].join(' ')}>
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 pt-5 pb-1">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-text-primary">{UI.appTitle}</h1>
            <p className="text-sm text-text-muted">{UI.appSubtitle}</p>
          </div>
          <RoleSelect role={role} onChange={onRole} />
        </header>
        <nav className="mt-2 flex gap-2">
          {ROLE_TABS.midwife.map((tab) => {
            const active = isActive(tab, route)
            return (
              <AppLink
                key={tab}
                to={pathFor({ name: tab } as Route)}
                className={[
                  'flex min-h-10 flex-1 items-center justify-center rounded-md px-4 text-sm font-semibold sm:flex-none',
                  active ? 'bg-brand text-white' : 'border border-border bg-surface text-slate-700 hover:border-slate-400',
                ].join(' ')}
              >
                {TAB_LABELS[tab]}
              </AppLink>
            )
          })}
        </nav>
        {children}
      </div>
    </div>
  )
}

/**
 * Every screen at its own URL. The role switch picks the shell and the tabs;
 * every URL works for everyone (see src/lib/role.ts).
 */
export default function App() {
  const route = parseRoute(usePathname())
  const [role, setRole] = useRole()
  const [saved, setSaved] = useState<SavedVisit | null>(null)
  // Who the entry form is recording for. Held here so it survives a trip to
  // /patients/new and back, and so does whatever was already typed.
  const [pregnancy, setPregnancy] = useState<PregnancyChoice | null>(null)
  const alerts = useEscalationAlerts(role === 'specialist')

  const switchRole = (next: Role) => {
    setRole(next)
    navigate(pathFor(homeFor(next)))
  }

  const content = (
    <>
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
      {route.name === 'patients' ? <PatientsPage /> : null}
      {route.name === 'patient' ? <PatientPage key={route.pregnancyId} pregnancyId={route.pregnancyId} /> : null}
      {route.name === 'escalations' ? <EscalationQueue /> : null}
      {route.name === 'not_found' ? (
        <div className="mt-6 rounded-lg border border-border bg-surface p-4 text-sm text-slate-700">
          {NOT_FOUND_UI.title}{' '}
          <AppLink to={pathFor({ name: 'entry' })} className="font-semibold text-brand underline">
            {NOT_FOUND_UI.home}
          </AppLink>
        </div>
      ) : null}
    </>
  )

  if (role === 'specialist') {
    return (
      <SpecialistShell route={route} role={role} onRole={switchRole} alerts={alerts}>
        {content}
      </SpecialistShell>
    )
  }
  return (
    <MidwifeShell
      route={route}
      role={role}
      onRole={switchRole}
      wide={route.name !== 'entry' && route.name !== 'new_patient'}
    >
      {content}
    </MidwifeShell>
  )
}
