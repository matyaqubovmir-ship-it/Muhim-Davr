import { UI } from '../lib/labels'

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
}: {
  label: string
  value: boolean | null
  onChange: (next: boolean | null) => void
}) {
  const options: { key: string; label: string; state: boolean | null }[] = [
    { key: 'yes', label: UI.yes, state: true },
    { key: 'no', label: UI.no, state: false },
    { key: 'unknown', label: UI.notChecked, state: null },
  ]

  return (
    <div className="py-2">
      <div className="mb-1.5 text-sm leading-snug text-slate-800">{label}</div>
      <div role="group" aria-label={label} className="grid grid-cols-3 gap-1.5">
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
                'min-h-11 rounded-md border px-1 text-[11px] leading-tight font-medium',
                'transition-colors',
                selected
                  ? unknown
                    ? 'border-slate-500 bg-slate-600 text-white'
                    : 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-300 bg-white text-slate-600',
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
