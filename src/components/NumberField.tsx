/**
 * Numeric entry. An empty box stays empty and is stored as null — it is never
 * coerced to 0, because "not measured" and "zero" are different facts.
 */
export function NumberField({
  label,
  unit,
  value,
  onChange,
}: {
  label: string
  unit?: string
  value: string
  onChange: (next: string) => void
}) {
  const id = `field-${label.replace(/\s+/g, '-')}`

  return (
    <div className="py-2">
      <label htmlFor={id} className="mb-1.5 block text-sm leading-snug text-slate-800">
        {label}
        {unit ? <span className="ml-1 text-slate-500">({unit})</span> : null}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base text-slate-900 focus:border-slate-900 focus:outline-none"
      />
    </div>
  )
}
