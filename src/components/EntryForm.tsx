import { useState } from 'react'
import {
  ALL_FORM_FIELDS,
  FORM_GROUPS,
  type FormFieldName,
  type UnscoredField,
} from '../lib/form-fields'
import { FIELD_LABELS, FIELD_UNITS, GROUP_TITLES, PICKER_UI, UI } from '../lib/labels'
import {
  differsFromExtraction,
  invalidNumberFields,
  parseDecimal,
  toAssessmentRow,
  toFieldValues,
  toScoringInput,
  type BooleanFormValues,
  type NumericFormValues,
} from '../lib/assessment-row'
import { extractFields, type ExtractedFields } from '../lib/extract-client'
import { scoreAssessment } from '../lib/risk'
import { scheduleAnchor } from '../lib/schedule'
import { getAuthedSupabase } from '../lib/supabase'
import {
  raiseClinicEscalation,
  readRecordedLmp,
  saveSchedule,
  type SavedVisit,
} from '../lib/visit-followup'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PregnancyChoice } from '../lib/patients'
import { NumberField } from './NumberField'
import { PregnancyPicker } from './PregnancyPicker'
import { TriState } from './TriState'

const UNSCORED: UnscoredField[] = ['edema', 'headache_or_visual']
const ALL_FIELD_NAMES: FormFieldName[] = ALL_FORM_FIELDS.map((field) => field.name)

function isUnscored(name: FormFieldName): name is UnscoredField {
  return (UNSCORED as FormFieldName[]).includes(name)
}

export function EntryForm({
  onSaved,
  pregnancy,
  onPregnancyChange,
  onCreatePatient,
}: {
  onSaved: (saved: SavedVisit) => void
  /** Who this visit is for. Held by App, so it survives a trip to register a new patient. */
  pregnancy: PregnancyChoice | null
  onPregnancyChange: (choice: PregnancyChoice | null) => void
  onCreatePatient: (typedName: string) => void
}) {
  const [pickerInvalid, setPickerInvalid] = useState(false)
  const [numbers, setNumbers] = useState<NumericFormValues>({})
  // Every boolean starts as null: not recorded, until someone records it.
  const [booleans, setBooleans] = useState<BooleanFormValues>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // --- extraction state ---
  const [narrative, setNarrative] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)
  /** What the model returned, kept for the corrected_by_human comparison. */
  const [extracted, setExtracted] = useState<ExtractedFields | null>(null)
  /** The model's response verbatim, for extracted_json. */
  const [extractedRaw, setExtractedRaw] = useState<unknown>(null)
  /** Which fields the model filled, for the AI badge. */
  const [aiFields, setAiFields] = useState<Set<FormFieldName>>(new Set())

  const setNumber = (name: FormFieldName, value: string) =>
    setNumbers((prev) => ({ ...prev, [name]: value }))

  const setBoolean = (name: FormFieldName, value: boolean | null) =>
    setBooleans((prev) => ({ ...prev, [name]: value }))

  async function handleExtract() {
    if (narrative.trim() === '' || extracting) return
    setExtractError(null)
    setExtracting(true)

    // No automatic retry: one attempt, then the keyboard.
    const outcome = await extractFields(narrative)
    setExtracting(false)

    if (!outcome.ok) {
      // The form is untouched and still fully usable.
      setExtractError(UI.analyseFailed)
      return
    }

    const filled = new Set<FormFieldName>()
    const nextNumbers: NumericFormValues = {}
    const nextBooleans: BooleanFormValues = {}

    for (const field of ALL_FORM_FIELDS) {
      const value = outcome.fields[field.name]
      // A field the model left null keeps whatever is already in the form.
      if (value === null || value === undefined) continue

      if (field.kind === 'number' && typeof value === 'number') {
        nextNumbers[field.name] = String(value)
        filled.add(field.name)
      } else if (field.kind === 'boolean' && typeof value === 'boolean') {
        nextBooleans[field.name] = value
        filled.add(field.name)
      }
    }

    setNumbers((prev) => ({ ...prev, ...nextNumbers }))
    setBooleans((prev) => ({ ...prev, ...nextBooleans }))
    setExtracted(outcome.fields)
    setExtractedRaw(outcome.raw)
    setAiFields(filled)
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    if (pregnancy === null) {
      setPickerInvalid(true)
      setError(PICKER_UI.required)
      return
    }

    // A box that is not a number is not "not measured". Saving it as null would
    // score her on less than was written down.
    if (invalidNumberFields(numbers).length > 0) {
      setError(UI.numbersInvalid)
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

    // The score is computed from the form as it stands now — what the midwife
    // confirmed — never from what the model returned.
    const result = scoreAssessment(toScoringInput(numbers, scoringBooleans))

    const saved = toFieldValues(numbers, scoringBooleans, unscoredBooleans)
    const correctedByHuman =
      extracted !== null && differsFromExtraction(extracted, saved, ALL_FIELD_NAMES)

    const row = toAssessmentRow(
      pregnancy.pregnancyId,
      numbers,
      scoringBooleans,
      unscoredBooleans,
      result,
      { extractedJson: extractedRaw, correctedByHuman },
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

      // The assessment is saved. Everything below follows from it and reports
      // its own outcome on the result screen; none of it can unsave the visit.
      const assessmentId = String(data.id)
      const savedPregnancyId = row.pregnancy_id as string
      const today = new Date()

      // A red result goes to the doctor queue first: it matters most.
      const escalation = await raiseClinicEscalation(
        client,
        assessmentId,
        savedPregnancyId,
        result,
      )

      // The schedule is anchored on pregnancies.lmp_date when it is recorded,
      // otherwise estimated from this visit's gestational age. The screen shows
      // it from the same anchor it is stored from, so the dates she sees are the
      // dates the patient is reminded of.
      const ga = parseDecimal(numbers.gestational_age_weeks)
      const lmpDate = scheduleAnchor(
        await readRecordedLmp(client, savedPregnancyId),
        typeof ga === 'number' ? ga : null,
        today,
      )
      const schedule = await saveSchedule(client, {
        pregnancyId: savedPregnancyId,
        assessmentId,
        lmpDate,
        zone: result.zone,
        today,
      })

      onSaved({
        result,
        assessmentId,
        pregnancyId: savedPregnancyId,
        lmpDate,
        escalation,
        schedule,
      })
    } catch (caught) {
      setError(`${UI.saveFailed} (${(caught as Error).message})`)
    } finally {
      setSaving(false)
    }
  }

  const invalidNumbers = new Set(invalidNumberFields(numbers))

  return (
    <form onSubmit={handleSubmit} className="pb-24">
      {/*
        The AI path sits above the form and only ever writes into it. It is not
        a shortcut past the form: the midwife still reads every value in the
        normal controls and saves the same way she would after typing.
      */}
      <section className="mt-3 rounded-lg border border-border bg-surface p-3">
        <label
          htmlFor="narrative"
          className="mb-1.5 block text-sm leading-snug text-slate-800"
        >
          {UI.narrativeLabel}
        </label>
        <textarea
          id="narrative"
          rows={4}
          value={narrative}
          onChange={(event) => setNarrative(event.target.value)}
          className="w-full resize-y rounded-md border border-border-input bg-surface p-3 text-base text-text-primary focus:border-brand focus:outline-none"
        />
        <button
          type="button"
          onClick={handleExtract}
          disabled={extracting || narrative.trim() === ''}
          className="mt-2 min-h-11 w-full rounded-md border border-text-primary bg-surface text-sm font-semibold text-text-primary disabled:opacity-40"
        >
          {extracting ? UI.analysing : UI.analyse}
        </button>

        {extractError ? (
          <p
            role="status"
            className="mt-2 rounded-md border border-slate-300 bg-bg p-2.5 text-sm text-slate-700"
          >
            {extractError}
          </p>
        ) : null}

        {aiFields.size > 0 ? (
          <p className="mt-2 text-sm leading-snug text-violet-700">{UI.aiFilledNote}</p>
        ) : null}
      </section>

      <PregnancyPicker
        value={pregnancy}
        onChange={(choice) => {
          onPregnancyChange(choice)
          if (choice !== null) setPickerInvalid(false)
        }}
        onCreateNew={onCreatePatient}
        invalid={pickerInvalid}
      />

      {FORM_GROUPS.map((group) => (
        <section key={group.id} className="mt-6">
          <h2 className="mb-1 border-b border-border pb-1.5 text-xs font-semibold tracking-wide text-text-muted uppercase">
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
                fromAi={aiFields.has(field.name)}
                invalid={invalidNumbers.has(field.name)}
              />
            ) : (
              <TriState
                key={field.name}
                label={FIELD_LABELS[field.name]}
                value={booleans[field.name] ?? null}
                onChange={(value) => setBoolean(field.name, value)}
                fromAi={aiFields.has(field.name)}
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

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-surface/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto max-w-lg">
          <button
            type="submit"
            disabled={saving}
            className="min-h-12 w-full rounded-lg bg-brand text-base font-semibold text-white disabled:opacity-60"
          >
            {saving ? UI.saving : UI.save}
          </button>
        </div>
      </div>
    </form>
  )
}
