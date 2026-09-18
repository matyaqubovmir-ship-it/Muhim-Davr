import type { ReactNode } from 'react'
import { navigate } from '../lib/navigation'

/**
 * A real <a href>, so it can be opened in a new tab and read by a screen
 * reader as a link, that navigates in place on a plain left click.
 */
export function AppLink({
  to,
  state,
  className,
  style,
  children,
}: {
  to: string
  state?: unknown
  className?: string
  style?: React.CSSProperties
  children: ReactNode
}) {
  return (
    <a
      href={to}
      className={className}
      style={style}
      onClick={(event) => {
        // Let the browser handle new-tab and new-window clicks.
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return
        }
        event.preventDefault()
        navigate(to, state)
      }}
    >
      {children}
    </a>
  )
}
