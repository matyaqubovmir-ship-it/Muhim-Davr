import { useState } from 'react'
import {
  FORM_GROUPS,
  type FormFieldName,
  type UnscoredField,
} from '../lib/form-fields'
import { FIELD_LABELS, FIELD_UNITS, GROUP_TITLES, UI } from '../lib/labels'
import {
  toAssessmentRow,
  toScoringInput,
  type BooleanFormValues,
  type NumericFormValues,
} from '../lib/assessment-row'
import { scoreAssessment, type RiskResult } from '../lib/risk'
import { getAuthedSupabase } from '../lib/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'
import { NumberField } from './NumberField'
import { TriState } from './TriState'

const UNSCORED: UnscoredField[] = ['edema', 'headache_or_visual']

function isUnscored(name: FormFieldName): name is UnscoredField {
  return (UNSCORED as FormFieldName[]).includes(name)
}

export function EntryForm({
  onSaved,
}: {
  onSaved: (result: RiskResult, assessmentId: string) => void
}) {
  const [pregnancyId, setPregnancyId] = useState('')
  const [numbers, setNumbers] = useState<NumericFormValues>({})
  // Every boolean starts as null: not recorded, until someone records it.
  const [booleans, setBooleans] = useState<BooleanFormValues>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setNumber = (name: FormFieldName, value: string) =>
    setNumbers((prev) => ({ ...prev, [name]: value }))

  const setBoolean = (name: FormFieldName, value: boolean | null) =>
    setBooleans((prev) => ({ ...prev, [name]: value }))

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    if (pregnancyId.trim() === '') {
      setError(UI.pregnancyIdRequired)
      return
    }

    // Split the two observations the scorer does not read back out, so they are
    // stored on the row without being handed to scoreAssessment.
    const scoringBooleans: BooleanFormValues = {}
    const unscoredBooleans: Partial<Record<UnscoredField, boolean | null>> = {}
    for (const [name, value] of Object.entries(booleans)) {
      if (isUnscored(name as FormFieldName)) {
        unscoredBooleans[name as UnscoredField] = value ?? null
      } else {
        scoringBooleans[name as FormFieldName] = value ?? null
      }
    }

    const result = scoreAssessment(toScoringInput(numbers, scoringBooleans))
    const row = toAssessmentRow(
      pregnancyId,
      numbers,
      scoringBooleans,
      unscoredBooleans,
      result,
    )

    setSaving(true)
    try {
      // Sign-in first, as its own step. If it fails the save fails — there is
      // no unauthenticated retry, because an unauthenticated insert is exactly
      // what RLS is there to refuse.
      let client: SupabaseClient
      try {
        client = await getAuthedSupabase()
      } catch (caught) {
        setError(`${UI.authFailed} (${(caught as Error).message})`)
        return
      }

      const { data, error: insertError } = await client
        .from('assessments')
        .insert(row)
        .select('id')
        .single()

      if (insertError) {
        // Never claim a save that did not happen — the row is the record.
        setError(`${UI.saveFailed} (${insertError.message})`)
        return
      }
      onSaved(result, String(data?.id ?? ''))
    } catch (caught) {
      setError(`${UI.saveFailed} (${(caught as Error).message})`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="pb-24">
      <div className="py-2">
        <label
          htmlFor="pregnancy-id"
          className="mb-1.5 block text-sm leading-snug text-slate-800"
        >
          {UI.pregnancyIdLabel}
        </label>
        <input
          id="pregnancy-id"
          value={pregnancyId}
          onChange={(event) => setPregnancyId(event.target.value)}
          placeholder={UI.pregnancyIdHint}
          className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base text-slate-900 focus:border-slate-900 focus:outline-none"
        />
      </div>

      {FORM_GROUPS.map((group) => (
        <section key={group.id} className="mt-6">
          <h2 className="mb-1 border-b border-slate-200 pb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            {GROUP_TITLES[group.id]}
          </h2>
          {group.fields.map((field) =>
            field.kind === 'number' ? (
              <NumberField
                key={field.name}
                label={FIELD_LABELS[field.name]}
                unit={FIELD_UNITS[field.name]}
                value={numbers[field.name] ?? ''}
                onChange={(value) => setNumber(field.name, value)}
              />
            ) : (
              <TriState
                key={field.name}
                label={FIELD_LABELS[field.name]}
                value={booleans[field.name] ?? null}
                onChange={(value) => setBoolean(field.name, value)}
              />
            ),
          )}
        </section>
      ))}

      {error ? (
        <p
          role="alert"
          className="mt-6 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto max-w-lg">
          <button
            type="submit"
            disabled={saving}
            className="min-h-12 w-full rounded-lg bg-slate-900 text-base font-semibold text-white disabled:opacity-60"
          >
            {saving ? UI.saving : UI.save}
          </button>
        </div>
      </div>
    </form>
  )
}
