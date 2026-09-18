/**
 * Extraction endpoint. Turns a midwife's free-text Uzbek note into structured
 * field values.
 *
 * SERVER SIDE ON PURPOSE. The API key is read from ANTHROPIC_API_KEY, which has
 * no VITE_ prefix, so Vite cannot inline it into the client bundle. Nothing in
 * src/ ever sees the key; the browser only ever talks to this endpoint.
 *
 * WHAT THIS DOES NOT DO: it does not score, and it does not decide a zone. It
 * returns values only. scoreAssessment in src/lib/risk.ts is the only thing
 * that scores, and it runs on what is in the form when the midwife saves —
 * after she has seen and corrected every extracted value.
 */

import Anthropic from '@anthropic-ai/sdk'

/** Default model. Override with ANTHROPIC_MODEL if the demo needs lower latency. */
const DEFAULT_MODEL = 'claude-opus-5'

/**
 * The fields the model is asked for. Listed here rather than imported from
 * src/lib/form-fields.ts so this function bundles with no dependency on the
 * client source tree — a serverless build resolving a cross-directory .ts
 * import is one more thing to go wrong during a demo.
 *
 * The duplication is guarded: src/lib/extraction-sync.test.ts fails if these
 * lists drift from FORM_GROUPS.
 */
export const EXTRACTION_NUMBER_FIELDS = [
  'bp_systolic',
  'bp_diastolic',
  'hemoglobin',
  'age',
  'gravida',
  'para',
  'gestational_age_weeks',
  'bmi',
  'birth_interval_months',
  'travel_minutes_to_facility',
  'missed_visits',
] as const

export const EXTRACTION_BOOLEAN_FIELDS = [
  'proteinuria',
  'edema',
  'headache_or_visual',
  'antepartum_bleeding',
  'prior_preeclampsia',
  'prior_caesarean',
  'prior_stillbirth_or_neonatal_death',
  'multiple_gestation',
  'chronic_hypertension',
  'diabetes',
  'kidney_disease',
  'family_history_preeclampsia',
] as const

/**
 * Every field is required and nullable. Required so the model must state a
 * value for each one rather than quietly omitting the fields it is unsure
 * about; nullable so the honest answer for "not mentioned" is available and
 * explicit.
 */
export function buildSchema() {
  const properties: Record<string, unknown> = {}
  for (const name of EXTRACTION_NUMBER_FIELDS) {
    properties[name] = { type: ['number', 'null'] }
  }
  for (const name of EXTRACTION_BOOLEAN_FIELDS) {
    properties[name] = { type: ['boolean', 'null'] }
  }
  return {
    type: 'object',
    properties,
    required: [...EXTRACTION_NUMBER_FIELDS, ...EXTRACTION_BOOLEAN_FIELDS],
    additionalProperties: false,
  }
}

const SYSTEM_PROMPT = `Siz Xorazm viloyati perinatal xavf reyestri uchun ma'lumot ajratuvchi yordamchisiz.

Sizga akusherka (doya) o'zbek tilida erkin yozgan matn beriladi. Vazifangiz — faqat shu matnda AYTILGAN qiymatlarni tuzilgan maydonlarga ajratib olish.

NEVER INVENT A VALUE. If the text does not state something, return null for that field. Do not guess, do not infer, do not estimate, and do not fill a field from what is typical or likely for a pregnant woman. Absence of information is null.

Rules:
- Numbers: return the number only if the text states it. "Qon bosimi 150/95" gives bp_systolic 150 and bp_diastolic 95. If only one number of a blood pressure is stated, return that one and null for the other.
- Booleans have THREE possible answers, not two:
  * true  — the text says the finding is present ("siydikda oqsil bor", "qon ketyapti")
  * false — the text says the finding was checked and is absent ("oqsil yo'q", "shish yo'q")
  * null  — the text does not mention it at all
  "Not mentioned" is null. It is NEVER false. A finding nobody wrote about is not a finding that was ruled out. This distinction matters more than any other instruction here: a skipped test recorded as a negative test can hide a woman who needs urgent care.
- hemoglobin is in g/L (normal 120-140). If the text gives a small number like 9.5, that is g/dL — multiply by 10 and return 95.
- age is the woman's age in years. gestational_age_weeks is the pregnancy's age in weeks. Do not confuse them.
- Do not convert, round or normalise anything else. Return what was written.

Worked example.

Input:
"Dilnoza 24 yosh, 32 hafta homilador. Qon bosimi 145/95. Siydikda oqsil bor. Shish yo'q. Ikkinchi homiladorlik, birinchisi kesar kesish bilan tug'gan."

Correct output:
- age: 24
- gestational_age_weeks: 32
- bp_systolic: 145
- bp_diastolic: 95
- proteinuria: true            (stated as present)
- edema: false                 (stated as absent — "shish yo'q")
- gravida: 2                   (stated: "ikkinchi homiladorlik")
- prior_caesarean: true        (stated)
- hemoglobin: null             (NOT MENTIONED — no haemoglobin result appears in this text, so it is null, not a guessed normal value)
- headache_or_visual: null     (NOT MENTIONED — she did not say the woman has no headache, she simply did not mention headache at all, so it is null, not false)
- antepartum_bleeding: null    (NOT MENTIONED)
- diabetes: null               (NOT MENTIONED)
- every other field: null      (NOT MENTIONED)

Note the difference between edema and headache_or_visual in that example. Edema is false because the text explicitly says there is none. Headache is null because the text is silent about it. Getting this difference right is the single most important part of your job.

NEVER INVENT A VALUE. Anything the text does not state comes back as null.`

export interface ExtractResponse {
  status: number
  body: unknown
}

export async function handleExtract(input: unknown): Promise<ExtractResponse> {
  const text =
    typeof input === 'object' && input !== null && 'text' in input
      ? String((input as { text: unknown }).text ?? '')
      : ''

  if (text.trim() === '') {
    return { status: 400, body: { error: 'empty_text' } }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return { status: 500, body: { error: 'missing_api_key' } }
  }

  const client = new Anthropic({ apiKey })

  const response = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    // Low effort: this is short-form extraction, not reasoning, and the client
    // gives up after 8 seconds.
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: buildSchema() },
    },
    messages: [{ role: 'user', content: text }],
  })

  if (response.stop_reason === 'refusal') {
    return { status: 502, body: { error: 'refused' } }
  }

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    return { status: 502, body: { error: 'no_text_block' } }
  }

  let fields: unknown
  try {
    fields = JSON.parse(textBlock.text)
  } catch {
    return { status: 502, body: { error: 'unparseable_json' } }
  }

  // `raw` is the model's response stored verbatim, for extracted_json.
  return { status: 200, body: { fields, raw: response } }
}

/** Vercel serverless entry point. */
export default async function handler(
  req: { method?: string; body?: unknown },
  res: {
    status: (code: number) => { json: (body: unknown) => unknown }
  },
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' })
    return
  }

  try {
    const result = await handleExtract(req.body)
    res.status(result.status).json(result.body)
  } catch (caught) {
    res.status(502).json({ error: 'extraction_failed', detail: String(caught) })
  }
}
