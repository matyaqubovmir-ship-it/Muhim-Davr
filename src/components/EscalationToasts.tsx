import { ALERT_UI, ESCALATION_SOURCE_LABELS, ZONE_COLORS } from '../lib/labels'
import type { EscalationToast } from '../lib/escalation-alerts'
import { pathFor } from '../lib/routes'
import { AppLink } from './AppLink'

/**
 * New escalations, top right, newest first. Each says where it came from and
 * why, and links to the queue; they leave on their own. The queue and the badge
 * keep every escalation, so a toast that is missed or dismissed loses nothing.
 */
export function EscalationToasts({
  toasts,
  onDismiss,
}: {
  toasts: readonly EscalationToast[]
  onDismiss: (id: string) => void
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed top-3 right-3 left-3 z-50 flex flex-col items-end gap-2 sm:left-auto sm:w-96"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="changed-flash pointer-events-auto w-full rounded-lg border border-slate-200 border-l-4 bg-white p-3 shadow-lg"
          style={{ borderLeftColor: ZONE_COLORS.qizil }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <span
                className={[
                  'rounded px-1.5 py-0.5 text-[11px] font-bold tracking-wide uppercase',
                  toast.source === 'telegram' ? 'bg-sky-600 text-white' : 'bg-slate-200 text-slate-800',
                ].join(' ')}
              >
                {ESCALATION_SOURCE_LABELS[toast.source]}
              </span>
              <span className="text-sm font-semibold text-slate-900">{ALERT_UI.newEscalation}</span>
            </div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label={ALERT_UI.dismiss}
              className="-mt-1 -mr-1 rounded px-2 py-0.5 text-lg leading-none text-slate-500 hover:text-slate-900"
            >
              ×
            </button>
          </div>
          <p className="mt-1 line-clamp-3 text-sm leading-snug text-slate-800">{toast.reason}</p>
          <AppLink
            to={pathFor({ name: 'escalations' })}
            className="mt-2 inline-block text-sm font-semibold text-slate-900 underline"
          >
            {ALERT_UI.open}
          </AppLink>
        </div>
      ))}
    </div>
  )
}
