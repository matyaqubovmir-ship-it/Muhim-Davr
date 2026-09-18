import { UI } from '../lib/labels'
import { AiBadge } from './AiBadge'

/**
 * Three-state control: Ha / Yo'q / Tekshirilmagan, defaulting to the last.
 *
 * Deliberately not a checkbox. A checkbox has two states and would force "not
 * checked" to be stored as "no", which is the exact distinction the schema
 * exists to preserve — a skipped dipstick is not a negative dipstick.
 */
export function TriState({
  label,
  value,
  onChange,
  fromAi = false,
}: {
  label: string
  value: boolean | null
  onChange: (next: boolean | null) => void
  fromAi?: boolean
}) {
  const options: { key: string; label: string; state: boolean | null }[] = [
    { key: 'yes', label: UI.yes, state: true },
    { key: 'no', label: UI.no, state: false },
    { key: 'unknown', label: UI.notChecked, state: null },
  ]

  return (
    <div className="py-2">
      <div className="mb-1.5 text-sm leading-snug text-slate-800">
        {label}
        {fromAi ? <AiBadge /> : null}
      </div>
      <div role="group" aria-label={label} className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
        {options.map((option) => {
          const selected = value === option.state
          const unknown = option.state === null
          return (
            <button
              key={option.key}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.state)}
              className={[
                'min-h-10 rounded-lg px-1 text-[13px] leading-tight font-semibold',
                'transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                selected
                  ? unknown
                    ? 'bg-slate-600 text-white shadow-[0_1px_2px_rgba(15,23,42,0.15)]'
                    : 'bg-brand text-white shadow-[0_1px_2px_rgba(15,23,42,0.1),0_3px_8px_-3px_rgba(37,99,235,0.55)]'
                  : 'text-slate-700 hover:bg-white hover:text-text-primary',
              ].join(' ')}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
