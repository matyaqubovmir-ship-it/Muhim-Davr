/**
 * Client-side navigation over the History API.
 *
 * navigate() pushes a URL and tells every useLocation() to re-read it; the back
 * button arrives as popstate. history.state carries anything a screen wants to
 * hand the next one without putting it in the URL — the registry passes where a
 * patient row was clicked from.
 */

import { useSyncExternalStore } from 'react'

const NAVIGATE_EVENT = 'app:navigate'

export function navigate(path: string, state: unknown = null): void {
  window.history.pushState(state, '', path)
  window.dispatchEvent(new Event(NAVIGATE_EVENT))
  window.scrollTo(0, 0)
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange)
  window.addEventListener(NAVIGATE_EVENT, onChange)
  return () => {
    window.removeEventListener('popstate', onChange)
    window.removeEventListener(NAVIGATE_EVENT, onChange)
  }
}

/** The current path. Re-renders on navigate() and on the back and forward buttons. */
export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname)
}
