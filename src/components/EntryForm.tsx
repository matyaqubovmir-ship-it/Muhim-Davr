import { useEffect, useRef, useState } from 'react'
import {
  ALL_FORM_FIELDS,
  FORM_GROUPS,
  type FormFieldName,
  type UnscoredField,
} from '../lib/form-fields'
import { DOCUMENT_UI, FIELD_LABELS, FIELD_UNITS, GROUP_TITLES, PICKER_UI, UI, numberProblemText } from '../lib/labels'
import {
  differsFromExtraction,
  parseDecimal,
  toAssessmentRow,
  toFieldValues,
  toScoringInput,
  type BooleanFormValues,
  type NumericFormValues,
} from '../lib/assessment-row'
import { DOCUMENT_ACCEPT, formatBytes, prepareDocument, type PreparedDocument } from '../lib/document-file'
import { saveDocument } from '../lib/documents'
import { extractFields, extractFromDocument, type ExtractedFields, type ExtractionOutcome } from '../lib/extract-client'
import { numberProblems } from '../lib/field-rules'
import { scoreAssessment } from '../lib/risk'
import { formatISODate, scheduleAnchor } from '../lib/schedule'
import { getAuthedSupabase } from '../lib/supabase'
import {
  raiseClinicEscalation,
  readRecordedLmp,
  saveSchedule,
  type SavedVisit,
} from '../lib/visit-followup'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PregnancyChoice } from '../lib/patients'
import { Button } from './Button'
import { FileIcon, PaperclipIcon, SparkleIcon, XIcon } from './Icons'
import { NumberField } from './NumberField'
import { PregnancyPicker } from './PregnancyPicker'
import { TriState } from './TriState'

const UNSCORED: UnscoredField[] = ['edema', 'headache_or_visual']
const ALL_FIELD_NAMES: FormFieldName[] = ALL_FORM_FIELDS.map((field) => field.name)

/** Postgres error codes the save handles on purpose. */
const UNIQUE_VIOLATION = '23505'
const CHECK_VIOLATION = '23514'

function isUnscored(name: FormFieldName): name is UnscoredField {
  return (UNSCORED as FormFieldName[]).includes(name)
}

type Extracting = 'text' | 'document' | null

/** A document chosen on this form, and what happened when the model read it. */
interface ChosenDocument {
  prepared: PreparedDocument
  status: 'reading' | 'read' | 'failed'
  filled: number
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
  const [showProblems, setShowProblems] = useState(false)

  /**
   * This visit's id, made here rather than by the database. If the save
   * reaches the database but the answer is lost on a village connection, she
   * presses Save again — and the same id is refused as a duplicate instead of
   * a second assessment (and a second escalation) being written.
   */
  const [visitId] = useState(() => crypto.randomUUID())

  // --- extraction state ---
  const [narrative, setNarrative] = useState('')
  const [extracting, setExtracting] = useState<Extracting>(null)
  const [extractError, setExtractError] = useState<string | null>(null)
  /** What the models returned, across every extraction on this form, for corrected_by_human. */
  const [extracted, setExtracted] = useState<ExtractedFields | null>(null)
  /** Each model response verbatim, for extracted_json. */
  const [extractedRaws, setExtractedRaws] = useState<{ source: 'text' | 'document'; response: unknown }[]>([])
  /** Which fields a model filled, for the AI badge. */
  const [aiFields, setAiFields] = useState<Set<FormFieldName>>(new Set())

  const [chosen, setChosen] = useState<ChosenDocument | null>(null)
  const [docError, setDocError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // The thumbnail is an object URL; release it when it is replaced or the form goes.
  useEffect(() => {
    const url = chosen?.prepared.previewUrl
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [chosen?.prepared.previewUrl])

  const setNumber = (name: FormFieldName, value: string) =>
    setNumbers((prev) => ({ ...prev, [name]: value }))

  const setBoolean = (name: FormFieldName, value: boolean | null) =>
    setBooleans((prev) => ({ ...prev, [name]: value }))

  /** Writes a model's answer into the form. Returns how many fields it filled. */
  function applyExtraction(outcome: Extract<ExtractionOutcome, { ok: true }>, source: 'text' | 'document'): number {
    const filled = new Set<FormFieldName>()
    const nextNumbers: NumericFormValues = {}
    const nextBooleans: BooleanFormValues = {}

    for (const field of ALL_FORM_FIELDS) {
      const value = outcome.fields[field.name]
      // A field the model left null keeps whatever is already in the form.
      if (value === null || value === undefined) continue

      if (field.kind === 'number' && typeof value === 'number') {
        nextNumbers[field.name] = String(value).replace('.', ',')
        filled.add(field.name)
      } else if (field.kind === 'boolean' && typeof value === 'boolean') {
        nextBooleans[field.name] = value
        filled.add(field.name)
      }
    }

    setNumbers((prev) => ({ ...prev, ...nextNumbers }))
    setBooleans((prev) => ({ ...prev, ...nextBooleans }))
    // Only the values a model actually gave, so a later extraction does not
    // erase an earlier one's record of what the model said.
    const given = Object.fromEntries(
      Object.entries(outcome.fields).filter(([, value]) => value !== null && value !== undefined),
    ) as ExtractedFields
    setExtracted((prev) => ({ ...(prev ?? {}), ...given }))
    setExtractedRaws((prev) => [...prev, { source, response: outcome.raw }])
    setAiFields((prev) => new Set([...prev, ...filled]))
    return filled.size
  }

  async function handleExtract() {
    if (narrative.trim() === '' || extracting !== null) return
    setExtractError(null)
    setExtracting('text')

    // No automatic retry: one attempt, then the keyboard.
    const outcome = await extractFields(narrative)
    setExtracting(null)

    if (!outcome.ok) {
      // The form is untouched and still fully usable.
      setExtractError(UI.analyseFailed)
      return
    }
    applyExtraction(outcome, 'text')
  }

  async function handleFile(file: File | undefined) {
    if (file === undefined || extracting !== null) return
    setDocError(null)
    setExtracting('document')
    const prepared = await prepareDocument(file)
    if (typeof prepared === 'string') {
      setExtracting(null)
      setDocError(
        prepared === 'unsupported_type' ? DOCUMENT_UI.unsupported : prepared === 'too_large' ? DOCUMENT_UI.tooLarge : DOCUMENT_UI.unreadable,
      )
      return
    }
    setChosen({ prepared, status: 'reading', filled: 0 })
    const outcome = await extractFromDocument(prepared)
    setExtracting(null)
    if (!outcome.ok) {
      setChosen({ prepared, status: 'failed', filled: 0 })
      return
    }
    const filled = applyExtraction(outcome, 'document')
    setChosen({ prepared, status: 'read', filled })
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (saving) return
    setError(null)

    if (pregnancy === null) {
      setPickerInvalid(true)
      setError(PICKER_UI.required)
      return
    }

    // A box that cannot be saved is not "not measured". Saving it as null would
    // score her on less than was written down; sending it would fail in the
    // database with a message she cannot act on.
    if (Object.keys(numberProblems(numbers)).length > 0) {
      setShowProblems(true)
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

    // One extraction is stored as the model's response itself, as before; two
    // (a note and a sheet) are stored side by side, each labelled.
    const extractedJson =
      extractedRaws.length === 0 ? null : extractedRaws.length === 1 ? extractedRaws[0].response : { extractions: extractedRaws }

    const today = new Date()
    const row = {
      ...toAssessmentRow(pregnancy.pregnancyId, numbers, scoringBooleans, unscoredBooleans, result, {
        extractedJson,
        correctedByHuman,
      }),
      id: visitId,
      // Her calendar date, not the server's UTC one (007).
      visit_date: formatISODate(today),
    }

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

      let insert = await client.from('assessments').insert(row)
      // Before 007 the database compares visit_date with UTC's date, which is
      // still yesterday from 00:00 to 05:00 in Tashkent. Then let it date the
      // visit itself, as it always did.
      if (insert.error?.code === CHECK_VIOLATION && insert.error.message.includes('assessments_visit_not_future')) {
        const { visit_date: _local, ...withoutDate } = row
        insert = await client.from('assessments').insert(withoutDate)
      }
      // The same id already there is this visit, saved by an earlier press
      // whose answer was lost. It is not an error, and it is not a second visit.
      const alreadySaved = insert.error?.code === UNIQUE_VIOLATION && insert.error.message.includes('assessments_pkey')
      if (insert.error && !alreadySaved) {
        // Never claim a save that did not happen — the row is the record.
        setError(`${UI.saveFailed} (${insert.error.message})`)
        return
      }

      // The assessment is saved. Everything below follows from it and reports
      // its own outcome on the result screen; none of it can unsave the visit.
      const assessmentId = visitId
      const savedPregnancyId = pregnancy.pregnancyId

      // A red result goes to the doctor queue first: it matters most.
      const escalation = await raiseClinicEscalation(client, assessmentId, savedPregnancyId, result)

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

      // The sheet the values were read from, kept with the visit. Last, and
      // never able to fail the save.
      const document =
        chosen === null
          ? null
          : await saveDocument(client, {
              pregnancyId: savedPregnancyId,
              assessmentId,
              blob: chosen.prepared.blob,
              fileName: chosen.prepared.name,
              mediaType: chosen.prepared.mediaType,
              usedForExtraction: chosen.status === 'read',
            })

      onSaved({ result, assessmentId, pregnancyId: savedPregnancyId, lmpDate, escalation, schedule, document })
    } catch (caught) {
      setError(`${UI.saveFailed} (${(caught as Error).message})`)
    } finally {
      setSaving(false)
    }
  }

  const problems = numberProblems(numbers)
  // A problem is shown once she has left the box it is in or tried to save —
  // not while she is halfway through typing "1" of "120".
  const problemFor = (field: FormFieldName): string | null => {
    const problem = problems[field]
    if (problem === undefined) return null
    if (!showProblems && problem.kind !== 'hb_units' && problem.kind !== 'not_number') return null
    return numberProblemText(problem)
  }

  return (
    <form onSubmit={handleSubmit} className="pb-28">
      {/*
        The AI path sits above the form and only ever writes into it. It is not
        a shortcut past the form: the midwife still reads every value in the
        normal controls and saves the same way she would after typing.
      */}
      <section className="mt-3 overflow-hidden rounded-2xl border border-violet-200 bg-gradient-to-b from-violet-50 via-surface to-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex items-start gap-3 px-4 pt-4">
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white shadow-sm">
            <SparkleIcon size={17} />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-text-primary">{DOCUMENT_UI.aiTitle}</h2>
            <p className="text-xs leading-snug text-slate-600">{DOCUMENT_UI.aiHint}</p>
          </div>
        </div>

        <div className="p-4 pt-3">
          <label htmlFor="narrative" className="sr-only">
            {UI.narrativeLabel}
          </label>
          <textarea
            id="narrative"
            rows={4}
            value={narrative}
            placeholder={UI.narrativeLabel}
            onChange={(event) => setNarrative(event.target.value)}
            className="w-full resize-y rounded-xl border border-border-input bg-surface p-3 text-base text-text-primary shadow-[inset_0_1px_1px_rgba(15,23,42,0.04)] placeholder:text-slate-500 focus:border-brand focus:ring-3 focus:ring-brand/15 focus:outline-none"
          />

          <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              variant="secondary"
              icon={<SparkleIcon size={16} />}
              loading={extracting === 'text'}
              disabled={extracting !== null || narrative.trim() === ''}
              onClick={handleExtract}
              fullWidth
            >
              {extracting === 'text' ? UI.analysing : DOCUMENT_UI.analyseText}
            </Button>
            <Button
              variant="secondary"
              icon={<PaperclipIcon size={16} />}
              loading={extracting === 'document'}
              disabled={extracting !== null}
              onClick={() => fileInput.current?.click()}
              fullWidth
            >
              {extracting === 'document' ? DOCUMENT_UI.reading : DOCUMENT_UI.upload}
            </Button>
          </div>
          <p className="mt-1.5 text-right text-xs text-text-muted">{DOCUMENT_UI.uploadHint}</p>
          <input
            ref={fileInput}
            type="file"
            accept={DOCUMENT_ACCEPT}
            className="hidden"
            onChange={(event) => {
              void handleFile(event.target.files?.[0])
              // The same file chosen again after removing it must still fire.
              event.target.value = ''
            }}
          />

          {chosen !== null ? (
            <div className="mt-2 flex items-center gap-3 rounded-xl border border-border bg-surface p-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              {chosen.prepared.previewUrl ? (
                <img
                  src={chosen.prepared.previewUrl}
                  alt=""
                  className="h-14 w-11 shrink-0 rounded-md border border-border object-cover"
                />
              ) : (
                <span className="inline-flex h-14 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-bg text-zone-qizil">
                  <FileIcon size={20} />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-text-primary">{chosen.prepared.name}</div>
                <div className="text-xs text-text-muted">
                  {chosen.prepared.mediaType === 'application/pdf' ? DOCUMENT_UI.pdf : 'JPG'} ·{' '}
                  {formatBytes(chosen.prepared.blob.size)}
                </div>
                <div
                  role="status"
                  className={[
                    'mt-0.5 text-xs font-medium',
                    chosen.status === 'failed' ? 'text-slate-700' : chosen.status === 'read' ? 'text-violet-700' : 'text-text-muted',
                  ].join(' ')}
                >
                  {chosen.status === 'reading'
                    ? DOCUMENT_UI.reading
                    : chosen.status === 'failed'
                      ? DOCUMENT_UI.readFailed
                      : chosen.filled > 0
                        ? DOCUMENT_UI.readOk(chosen.filled)
                        : DOCUMENT_UI.readNone}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-label={DOCUMENT_UI.remove}
                title={DOCUMENT_UI.remove}
                disabled={chosen.status === 'reading'}
                onClick={() => setChosen(null)}
                icon={<XIcon size={16} />}
              />
            </div>
          ) : null}

          {docError ? (
            <p role="status" className="mt-2 rounded-lg border border-slate-300 bg-bg p-2.5 text-sm text-slate-700">
              {docError}
            </p>
          ) : null}

          {extractError ? (
            <p role="status" className="mt-2 rounded-lg border border-slate-300 bg-bg p-2.5 text-sm text-slate-700">
              {extractError}
            </p>
          ) : null}

          {aiFields.size > 0 ? (
            <p className="mt-2 flex items-start gap-1.5 text-sm leading-snug text-violet-800">
              <SparkleIcon size={15} className="mt-0.5" />
              <span>
                {UI.aiFilledNote}
                {chosen !== null ? ` ${DOCUMENT_UI.keptNote}` : ''}
              </span>
            </p>
          ) : null}
        </div>
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
                error={problemFor(field.name)}
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
        <p role="alert" className="mt-6 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/90 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md">
        <div className="mx-auto max-w-lg">
          <Button type="submit" variant="primary" size="lg" loading={saving} fullWidth>
            {saving ? UI.saving : UI.save}
          </Button>
        </div>
      </div>
    </form>
  )
}
