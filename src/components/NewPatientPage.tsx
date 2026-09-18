import { useEffect, useId, useState } from 'react'
import { NEW_PATIENT_UI } from '../lib/labels'
import {
  loadKnownDistricts,
  registerPatient,
  validateNewPatient,
  type LmpMode,
  type NewPatientField,
  type NewPatientForm,
  type PregnancyChoice,
} from '../lib/patients'
import { pathFor } from '../lib/routes'
import { formatISODate } from '../lib/schedule'
import { getAuthedSupabase } from '../lib/supabase'
import { AppLink } from './AppLink'
import { LinkCode } from './LinkCode'
import { Button } from './Button'
import { buttonClass } from './button-styles'
import { PlusIcon } from './Icons'

const INPUT =
  'min-h-11 w-full rounded-md border bg-surface px-3 text-base text-text-primary focus:border-brand focus:outline-none'

/** A name typed into the entry form's search, handed over in history state. */
function readNameHint(): string {
  const state: unknown = window.history.state
  if (typeof state === 'object' && state !== null && 'name' in state) {
    const name = (state as { name: unknown }).name
    if (typeof name === 'string') return name
  }
  return ''
}

const EMPTY: NewPatientForm = {
  fullName: '',
  birthDate: '',
  district: '',
  village: '',
  phone: '',
  lmpMode: 'lmp',
  lmpDate: '',
  gaWeeks: '',
}

function Field({
  id,
  label,
  optional,
  error,
  children,
}: {
  id: string
  label: string
  optional?: boolean
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="py-2">
      <label htmlFor={id} className="mb-1.5 block text-sm leading-snug text-slate-800">
        {label}
        {optional ? <span className="ml-1 text-text-muted">({NEW_PATIENT_UI.optional})</span> : null}
      </label>
      {children}
      {error ? <p className="mt-1 text-sm text-red-700">{error}</p> : null}
    </div>
  )
}

/**
 * /patients/new — registers a patient and her current pregnancy in one step
 * (register_patient, 006), then shows the Telegram code: registration is the
 * moment the midwife reads it out to her.
 */
export function NewPatientPage({ onRecordVisit }: { onRecordVisit: (choice: PregnancyChoice) => void }) {
  const id = useId()
  const [form, setForm] = useState<NewPatientForm>(() => ({ ...EMPTY, fullName: readNameHint() }))
  const [errors, setErrors] = useState<Partial<Record<NewPatientField, string>>>({})
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [created, setCreated] = useState<PregnancyChoice | null>(null)
  const [districts, setDistricts] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    getAuthedSupabase()
      .then(loadKnownDistricts)
      .then((known) => {
        if (!cancelled) setDistricts(known)
      })
      .catch(() => undefined) // Suggestions only; typing still works.
    return () => {
      cancelled = true
    }
  }, [])

  const set = (field: keyof NewPatientForm, value: string) => setForm((prev) => ({ ...prev, [field]: value }))
  const today = formatISODate(new Date())

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setFailure(null)
    const { errors: found, args } = validateNewPatient(form, new Date())
    setErrors(found)
    if (args === null) return

    setSubmitting(true)
    try {
      const client = await getAuthedSupabase()
      const pregnancyId = await registerPatient(client, args)
      setCreated({
        pregnancyId,
        fullName: args.p_full_name,
        district: args.p_district,
        village: args.p_village,
      })
    } catch (caught) {
      setFailure(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSubmitting(false)
    }
  }

  if (created !== null) {
    return (
      <div className="pb-12">
        <section className="mt-4 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-base font-semibold text-text-primary">{NEW_PATIENT_UI.createdTitle}</h2>
          <p className="mt-1 text-sm text-slate-800">{created.fullName}</p>
          <p className="text-sm text-slate-600">{[created.district, created.village].filter(Boolean).join(' · ')}</p>
        </section>

        <LinkCode pregnancyId={created.pregnancyId} />

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button variant="primary" size="lg" className="flex-1" icon={<PlusIcon size={18} />} onClick={() => onRecordVisit(created)}>
            {NEW_PATIENT_UI.recordVisit}
          </Button>
          <AppLink
            to={pathFor({ name: 'patient', pregnancyId: created.pregnancyId })}
            className={buttonClass('secondary', 'lg') + ' flex-1'}
          >
            {NEW_PATIENT_UI.openPatient}
          </AppLink>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="mt-3"
          onClick={() => {
            setCreated(null)
            setForm(EMPTY)
            setErrors({})
          }}
        >
          {NEW_PATIENT_UI.another}
        </Button>
      </div>
    )
  }

  const modes: { mode: LmpMode; label: string }[] = [
    { mode: 'lmp', label: NEW_PATIENT_UI.lmpModeLmp },
    { mode: 'ga', label: NEW_PATIENT_UI.lmpModeGa },
    { mode: 'unknown', label: NEW_PATIENT_UI.lmpModeUnknown },
  ]
  const border = (field: NewPatientField) => (errors[field] ? 'border-red-400' : 'border-border-input')

  return (
    <form onSubmit={submit} className="pb-12" noValidate>
      <div className="mt-4">
        <h2 className="text-lg font-semibold text-text-primary">{NEW_PATIENT_UI.title}</h2>
        <p className="text-sm text-slate-600">{NEW_PATIENT_UI.subtitle}</p>
      </div>

      <Field id={`${id}-name`} label={NEW_PATIENT_UI.fullName} error={errors.fullName}>
        <input
          id={`${id}-name`}
          value={form.fullName}
          onChange={(e) => set('fullName', e.target.value)}
          autoComplete="off"
          className={`${INPUT} ${border('fullName')}`}
        />
      </Field>

      <Field id={`${id}-birth`} label={NEW_PATIENT_UI.birthDate} error={errors.birthDate}>
        <input
          id={`${id}-birth`}
          type="date"
          max={today}
          value={form.birthDate}
          onChange={(e) => set('birthDate', e.target.value)}
          className={`${INPUT} ${border('birthDate')}`}
        />
      </Field>

      <Field id={`${id}-district`} label={NEW_PATIENT_UI.district} error={errors.district}>
        <input
          id={`${id}-district`}
          list={`${id}-districts`}
          value={form.district}
          onChange={(e) => set('district', e.target.value)}
          placeholder={NEW_PATIENT_UI.districtHint}
          autoComplete="off"
          className={`${INPUT} ${border('district')}`}
        />
        {/* Suggestions are the districts already on record — never a fixed list. */}
        <datalist id={`${id}-districts`}>
          {districts.map((district) => (
            <option key={district} value={district} />
          ))}
        </datalist>
      </Field>

      <Field id={`${id}-village`} label={NEW_PATIENT_UI.village} optional>
        <input
          id={`${id}-village`}
          value={form.village}
          onChange={(e) => set('village', e.target.value)}
          autoComplete="off"
          className={`${INPUT} border-border-input`}
        />
      </Field>

      <Field id={`${id}-phone`} label={NEW_PATIENT_UI.phone} optional error={errors.phone}>
        <input
          id={`${id}-phone`}
          type="tel"
          inputMode="tel"
          value={form.phone}
          onChange={(e) => set('phone', e.target.value)}
          placeholder="+998"
          className={`${INPUT} ${border('phone')}`}
        />
      </Field>

      <fieldset className="mt-4">
        <legend className="mb-1.5 text-sm leading-snug text-slate-800">{NEW_PATIENT_UI.lmpQuestion}</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {modes.map(({ mode, label }) => (
            <label
              key={mode}
              className={[
                'flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm',
                form.lmpMode === mode ? 'border-brand bg-brand text-white' : 'border-border-input bg-surface text-slate-800',
              ].join(' ')}
            >
              <input
                type="radio"
                name={`${id}-mode`}
                className="sr-only"
                checked={form.lmpMode === mode}
                onChange={() => setForm((prev) => ({ ...prev, lmpMode: mode }))}
              />
              {label}
            </label>
          ))}
        </div>

        {form.lmpMode === 'lmp' ? (
          <Field id={`${id}-lmp`} label={NEW_PATIENT_UI.lmpDate} error={errors.lmpDate}>
            <input
              id={`${id}-lmp`}
              type="date"
              max={today}
              value={form.lmpDate}
              onChange={(e) => set('lmpDate', e.target.value)}
              className={`${INPUT} ${border('lmpDate')}`}
            />
          </Field>
        ) : null}

        {form.lmpMode === 'ga' ? (
          <Field id={`${id}-ga`} label={`${NEW_PATIENT_UI.gaWeeks} (${NEW_PATIENT_UI.gaWeeksUnit})`} error={errors.gaWeeks}>
            <input
              id={`${id}-ga`}
              type="number"
              inputMode="numeric"
              min={1}
              max={45}
              value={form.gaWeeks}
              onChange={(e) => set('gaWeeks', e.target.value)}
              className={`${INPUT} ${border('gaWeeks')}`}
            />
            <p className="mt-1 text-xs text-slate-600">{NEW_PATIENT_UI.gaNote}</p>
          </Field>
        ) : null}

        {form.lmpMode === 'unknown' ? (
          <p className="mt-2 text-xs text-slate-600">{NEW_PATIENT_UI.unknownNote}</p>
        ) : null}
      </fieldset>

      {failure !== null ? (
        <p role="alert" className="mt-5 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {NEW_PATIENT_UI.failed} ({failure})
        </p>
      ) : null}

      <Button type="submit" variant="primary" size="lg" fullWidth loading={submitting} className="mt-6">
        {submitting ? NEW_PATIENT_UI.submitting : NEW_PATIENT_UI.submit}
      </Button>
    </form>
  )
}
