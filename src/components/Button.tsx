import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { buttonClass, type ButtonSize, type ButtonVariant } from './button-styles'
import { Spinner } from './Icons'

/**
 * The one button. Every action on every screen is one of these, so a primary
 * action looks the same on the midwife's phone and the specialist's queue.
 *
 *   primary    the one thing this screen is for (save, acknowledge)
 *   secondary  a real action that is not the main one (analyse, upload)
 *   ghost      navigation-weight actions (cancel, show more)
 *   danger     closes or cancels something (close an escalation)
 *   success    confirms a good outcome (reserved; used sparingly)
 *
 * A loading button keeps its width, shows a spinner in place of its icon, is
 * disabled and says aria-busy — a second tap cannot send a second write.
 * Every pairing of text and fill here clears WCAG AA (zone-style.test.ts).
 */

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  fullWidth = false,
  className = '',
  disabled,
  children,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
  fullWidth?: boolean
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[buttonClass(variant, size, fullWidth), className].join(' ')}
      {...rest}
    >
      {loading ? <Spinner size={size === 'lg' ? 18 : 16} /> : icon}
      {children}
    </button>
  )
}
