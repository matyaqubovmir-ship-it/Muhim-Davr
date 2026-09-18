import { useId } from 'react'
import { UI } from '../lib/labels'
import { AiBadge } from './AiBadge'

/**
 * Numeric entry. An empty box stays empty and is stored as null — it is never
 * coerced to 0, because "not measured" and "zero" are different facts.
 *
 * A text box with a decimal keypad, not type="number": a number input hands
 * back an empty string for anything the browser cannot read — "10,5" in most
 * locales — and that would be saved as not measured. Here what she typed stays
 * what she typed, and a box that is not a number says so.
 */
export function NumberField({
  label,
  unit,
  value,
  onChange,
  fromAi = false,
  invalid = false,
}: {
  label: string
  unit?: string
  value: string
  onChange: (next: string) => void
  fromAi?: boolean
  invalid?: boolean
}) {
  const id = useId()

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
          'min-h-11 w-full rounded-md border bg-surface px-3 text-base text-text-primary tabular-nums focus:outline-none',
          invalid ? 'border-zone-qizil ring-1 ring-zone-qizil' : 'border-border-input focus:border-brand',
        ].join(' ')}
      />
      {invalid ? (
        <p id={`${id}-error`} className="mt-1 text-sm text-zone-qizil">
          {UI.numberInvalid}
        </p>
      ) : null}
    </div>
  )
}
