import { AiBadge } from './AiBadge'

/**
 * Numeric entry. An empty box stays empty and is stored as null — it is never
 * coerced to 0, because "not measured" and "zero" are different facts.
 */
export function NumberField({
  label,
  unit,
  value,
  onChange,
  fromAi = false,
}: {
  label: string
  unit?: string
  value: string
  onChange: (next: string) => void
  fromAi?: boolean
}) {
  const id = `field-${label.replace(/\s+/g, '-')}`

  return (
    <div className="py-2">
      <label htmlFor={id} className="mb-1.5 block text-sm leading-snug text-slate-800">
        {label}
        {unit ? <span className="ml-1 text-text-muted">({unit})</span> : null}
        {fromAi ? <AiBadge /> : null}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 w-full rounded-md border border-slate-300 bg-surface px-3 text-base text-text-primary focus:border-brand focus:outline-none"
      />
    </div>
  )
}
