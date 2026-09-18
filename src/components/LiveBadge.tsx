import { REGISTRY_UI } from '../lib/labels'
import type { LiveStatus } from '../lib/live-changes'

/**
 * Whether this screen is updating itself. When the subscription drops it says
 * so and offers to reconnect — a registry that has quietly stopped updating
 * looks exactly like one that is up to date.
 */
export function LiveBadge({ status, onReconnect }: { status: LiveStatus; onReconnect: () => void }) {
  if (status === 'down') {
    return (
      <span className="inline-flex items-center gap-2 text-xs text-amber-900">
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-amber-500" />
        {REGISTRY_UI.liveDown}
        <button
          type="button"
          onClick={onReconnect}
          className="rounded border border-amber-400 bg-amber-50 px-2 py-0.5 font-semibold"
        >
          {REGISTRY_UI.reconnect}
        </button>
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
      <span
        aria-hidden="true"
        className={[
          'h-2 w-2 rounded-full',
          status === 'live' ? 'bg-emerald-600' : 'animate-pulse bg-slate-400',
        ].join(' ')}
      />
      {status === 'live' ? REGISTRY_UI.live : REGISTRY_UI.connecting}
    </span>
  )
}
