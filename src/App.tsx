import { Suspense, lazy, useState, type ReactNode } from 'react'
import { AppLink } from './components/AppLink'
import { EntryForm } from './components/EntryForm'
import { EscalationToasts } from './components/EscalationToasts'
import { AlertIcon, CalendarIcon, DashboardIcon, LogoMark, PatientsIcon, PlusIcon, RegistryIcon } from './components/Icons'
import { ResultScreen } from './components/ResultScreen'
import { useEscalationAlerts } from './lib/escalation-alerts'
import { ALERT_UI, NAV_UI, NEW_PATIENT_UI, NOT_FOUND_UI, QUEUE_UI, ROLE_UI, UI, VISITS_UI } from './lib/labels'
import { navigate, usePathname } from './lib/navigation'
import type { PregnancyChoice } from './lib/patients'
import { ROLE_TABS, homeFor, useRole, type Role } from './lib/role'
import { parseRoute, pathFor, type Route } from './lib/routes'
import type { SavedVisit } from './lib/visit-followup'

// The specialist's screens load on first visit, so a midwife's phone never
// downloads the dashboard, the charts or the queue it will not open.
const Dashboard = lazy(() => import('./components/Dashboard').then((m) => ({ default: m.Dashboard })))
const RegistryOverview = lazy(() => import('./components/RegistryOverview').then((m) => ({ default: m.RegistryOverview })))
const DistrictBoard = lazy(() => import('./components/DistrictBoard').then((m) => ({ default: m.DistrictBoard })))
const PatientsPage = lazy(() => import('./components/PatientsPage').then((m) => ({ default: m.PatientsPage })))
const PatientPage = lazy(() => import('./components/PatientPage').then((m) => ({ default: m.PatientPage })))
const EscalationQueue = lazy(() => import('./components/EscalationQueue').then((m) => ({ default: m.EscalationQueue })))
const VisitsPage = lazy(() => import('./components/VisitsPage').then((m) => ({ default: m.VisitsPage })))
const NewPatientPage = lazy(() => import('./components/NewPatientPage').then((m) => ({ default: m.NewPatientPage })))

/** While a screen's code arrives: a quiet placeholder, never a bare spinner. */
function ScreenLoading() {
  return (
    <div className="mt-5 space-y-3" aria-hidden="true">
      <div className="h-6 w-56 animate-pulse rounded bg-slate-200" />
      <div className="h-40 animate-pulse rounded-xl border border-border bg-surface" />
    </div>
  )
}

type Tab = (typeof ROLE_TABS)[Role][number]

const TAB_LABELS: Record<Tab, string> = {
  dashboard: NAV_UI.dashboard,
  entry: QUEUE_UI.tabEntry,
  new_patient: NEW_PATIENT_UI.tab,
  registry: NAV_UI.registry,
  escalations: NAV_UI.escalations,
  patients: NAV_UI.patients,
  visits: VISITS_UI.nav,
}

const TAB_ICONS: Partial<Record<Tab, (props: { size?: number }) => React.ReactNode>> = {
  entry: PlusIcon,
  new_patient: PatientsIcon,
  dashboard: DashboardIcon,
  registry: RegistryIcon,
  escalations: AlertIcon,
  patients: PatientsIcon,
  visits: CalendarIcon,
}

/** A tab is active on its own route and on the screens it leads to. */
function isActive(tab: Tab, route: Route): boolean {
  if (tab === 'dashboard') return route.name === 'dashboard'
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
      <AlertIcon size={20} />
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
    const Icon = TAB_ICONS[tab]
    return (
      <AppLink
        key={tab}
        to={pathFor({ name: tab } as Route)}
        className={[
          'flex items-center gap-2.5 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
          layout === 'side' ? 'min-h-10' : 'min-h-9 flex-1 justify-center',
          active
            ? 'bg-brand-soft font-semibold text-brand shadow-[inset_2px_0_0_var(--color-brand)]'
            : 'text-slate-700 hover:bg-slate-100 hover:text-text-primary',
        ].join(' ')}
      >
        {Icon ? <Icon size={18} /> : null}
        {/* sr-only, not hidden, on a phone: the icon is decorative and the word is the link's name. */}
        <span className={layout === 'side' ? 'flex-1' : 'sr-only sm:not-sr-only'}>{TAB_LABELS[tab]}</span>
        {tab === 'escalations' ? <CountBadge count={alerts.openCount} /> : null}
      </AppLink>
    )
  }

  return (
    <div className="min-h-screen bg-bg">
      <EscalationToasts toasts={alerts.toasts} onDismiss={alerts.dismiss} />

      <header className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur-md print:hidden">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
          <AppLink to={pathFor({ name: 'dashboard' })} className="mr-auto flex items-center gap-2.5">
            <LogoMark size={32} />
            <div>
              <div className="text-base leading-tight font-semibold tracking-tight text-text-primary">{UI.appTitle}</div>
              <div className="text-xs text-text-muted">{UI.appSubtitle}</div>
            </div>
          </AppLink>
          <button
            type="button"
            onClick={alerts.toggleMuted}
            aria-pressed={!alerts.muted}
            className="rounded-md px-2 py-1 text-xs text-text-muted transition-colors hover:bg-slate-100 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
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
        <nav className="sticky top-[57px] hidden h-[calc(100vh-57px)] w-56 shrink-0 flex-col gap-1 border-r border-border bg-surface/60 px-3 py-4 md:flex print:hidden">
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
          <div className="flex items-center gap-2.5">
            <LogoMark size={36} />
            <div>
              <h1 className="text-lg leading-tight font-semibold tracking-tight text-text-primary">{UI.appTitle}</h1>
              <p className="text-sm text-text-muted">{UI.appSubtitle}</p>
            </div>
          </div>
          <RoleSelect role={role} onChange={onRole} />
        </header>
        <nav className="mt-3 grid grid-cols-3 gap-1 rounded-xl border border-border bg-surface p-1 shadow-[0_1px_2px_rgba(15,23,42,0.05)] sm:inline-grid sm:w-auto print:hidden">
          {ROLE_TABS.midwife.map((tab) => {
            const active = isActive(tab, route)
            const Icon = TAB_ICONS[tab]
            return (
              <AppLink
                key={tab}
                to={pathFor({ name: tab } as Route)}
                aria-current={active ? 'page' : undefined}
                className={[
                  'flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg px-2 text-[12px] leading-tight font-semibold whitespace-nowrap transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand sm:min-h-10 sm:flex-row sm:gap-1.5 sm:px-3 sm:text-sm',
                  active
                    ? 'bg-brand text-white shadow-[0_1px_2px_rgba(15,23,42,0.1),0_4px_10px_-4px_rgba(37,99,235,0.55)]'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-text-primary',
                ].join(' ')}
              >
                {Icon ? <Icon size={16} /> : null}
                <span className="truncate">{TAB_LABELS[tab]}</span>
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
      <Suspense fallback={<ScreenLoading />}>
        {route.name === 'new_patient' ? (
          <NewPatientPage
            onRecordVisit={(choice) => {
              setSaved(null)
              setPregnancy(choice)
              navigate(pathFor({ name: 'entry' }))
            }}
          />
        ) : null}
        {route.name === 'dashboard' ? <Dashboard /> : null}
        {route.name === 'registry' ? <RegistryOverview /> : null}
        {route.name === 'district' ? <DistrictBoard key={route.district} district={route.district} /> : null}
        {route.name === 'patients' ? <PatientsPage /> : null}
        {route.name === 'patient' ? <PatientPage key={route.pregnancyId} pregnancyId={route.pregnancyId} /> : null}
        {route.name === 'escalations' ? <EscalationQueue /> : null}
        {route.name === 'visits' ? (
          <VisitsPage
            onRecordVisit={(choice) => {
              setSaved(null)
              setPregnancy(choice)
              navigate(pathFor({ name: 'entry' }))
            }}
          />
        ) : null}
      </Suspense>
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
