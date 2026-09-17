/**
 * The shape of the entry form: which fields, in which groups, in which order.
 *
 * Field names are AssessmentInput keys from risk.ts wherever the field feeds the
 * score, plus the two observations that are recorded but not yet scored
 * (edema, headache_or_visual). Keeping the names identical to risk.ts means the
 * form state can be handed to scoreAssessment with no translation step.
 */

import type { ScoringInputField } from './risk'

/** Recorded on the assessment but not read by the scorer (yet). */
export type UnscoredField = 'edema' | 'headache_or_visual'

export type FormFieldName = ScoringInputField | UnscoredField

export type FieldKind = 'number' | 'boolean'

export interface FormField {
  name: FormFieldName
  kind: FieldKind
}

export interface FormGroup {
  id: 'vitals' | 'woman' | 'history' | 'context'
  fields: readonly FormField[]
}

const n = (name: FormFieldName): FormField => ({ name, kind: 'number' })
const b = (name: FormFieldName): FormField => ({ name, kind: 'boolean' })

export const FORM_GROUPS: readonly FormGroup[] = [
  {
    id: 'vitals',
    fields: [
      n('bp_systolic'),
      n('bp_diastolic'),
      n('hemoglobin'),
      b('proteinuria'),
      b('edema'),
      b('headache_or_visual'),
      b('antepartum_bleeding'),
    ],
  },
  {
    id: 'woman',
    fields: [n('age'), n('gravida'), n('para'), n('gestational_age_weeks'), n('bmi')],
  },
  {
    id: 'history',
    fields: [
      b('prior_preeclampsia'),
      b('prior_caesarean'),
      b('prior_stillbirth_or_neonatal_death'),
      b('multiple_gestation'),
      b('chronic_hypertension'),
      b('diabetes'),
      b('kidney_disease'),
      b('family_history_preeclampsia'),
      n('birth_interval_months'),
    ],
  },
  {
    id: 'context',
    fields: [n('travel_minutes_to_facility'), n('missed_visits')],
  },
]

export const ALL_FORM_FIELDS: readonly FormField[] = FORM_GROUPS.flatMap(
  (group) => group.fields,
)

export const NUMBER_FIELDS = ALL_FORM_FIELDS.filter((f) => f.kind === 'number').map(
  (f) => f.name,
)

export const BOOLEAN_FIELDS = ALL_FORM_FIELDS.filter((f) => f.kind === 'boolean').map(
  (f) => f.name,
)
