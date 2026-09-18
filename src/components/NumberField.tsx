import { useId } from 'react'
import { AiBadge } from './AiBadge'

/**
 * Numeric entry. An empty box stays empty and is stored as null — it is never
 * coerced to 0, because "not measured" and "zero" are different facts.
 *
 * A text box with a decimal keypad, not type="number": a number input hands
 * back an empty string for anything the browser cannot read — "10,5" in most
 * locales — and that would be saved as not measured. Here what she typed stays
 * what she typed, and a box that cannot be saved says why (field-rules.ts).
 */
export function NumberField({
  label,
  unit,
  value,
  onChange,
  fromAi = false,
  error = null,
}: {
  label: string
  unit?: string
  value: string
  onChange: (next: string) => void
  fromAi?: boolean
  /** Why this value cannot be saved, or null. */
  error?: string | null
}) {
  const id = useId()
  const invalid = error !== null

  return (
    <div className="py-2">
      <label htmlFor={id} className="mb-1.5 block text-sm leading-snug text-slate-800">
        {label}
        {unit ? <span className="ml-1 text-text-muted">({unit})</span> : null}
        {fromAi ? <AiBadge /> : null}
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
        className={[
          'min-h-11 w-full rounded-lg border bg-surface px-3 text-base text-text-primary tabular-nums shadow-[inset_0_1px_1px_rgba(15,23,42,0.04)] transition-colors focus:outline-none focus:ring-3',
          invalid
            ? 'border-zone-qizil ring-1 ring-zone-qizil focus:ring-zone-qizil/25'
            : fromAi
              ? 'border-violet-400 bg-violet-50/40 focus:border-brand focus:ring-brand/15'
              : 'border-border-input focus:border-brand focus:ring-brand/15',
        ].join(' ')}
      />
      {invalid ? (
        <p id={`${id}-error`} className="mt-1 text-sm text-zone-qizil">
          {error}
        </p>
      ) : null}
    </div>
  )
}
