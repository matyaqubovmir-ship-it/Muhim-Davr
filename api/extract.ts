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

/**
 * Default model. Haiku 4.5 because this is short-form extraction sitting behind
 * an 8 second client timeout on venue wifi; the larger models are slower than
 * this task needs. Override with ANTHROPIC_MODEL.
 */
const DEFAULT_MODEL = 'claude-haiku-4-5'

/**
 * Models that reject output_config.effort. Haiku 4.5 answers any request
 * carrying it with 400 "This model does not support the effort parameter", so
 * sending it unconditionally would trade one upstream 400 for another.
 */
const MODELS_WITHOUT_EFFORT = ['claude-haiku-4-5', 'claude-sonnet-4-5']

function supportsEffort(model: string): boolean {
  return !MODELS_WITHOUT_EFFORT.some((prefix) => model.startsWith(prefix))
}

/**
 * How the model answers a true/false field. Strings rather than a
 * ['boolean', 'null'] union — see buildSchema for why — and "not_mentioned"
 * rather than "null" because it states the intent in words, which is much
 * harder to confuse with a value that simply went missing.
 */
export const BOOLEAN_ENUM = ['true', 'false', 'not_mentioned'] as const

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
 * Every field is required, and every field has an explicit way to say "not
 * mentioned". Required so the model must state a value for each one rather than
 * quietly omitting the fields it is unsure about.
 *
 * Numbers say it with null. Booleans cannot: structured outputs rejects a schema
 * with more than 16 union-typed parameters, and 11 numbers plus 12 booleans all
 * written as ['x', 'null'] is 23 — the request 400s before it ever reaches the
 * model. So the booleans are a three-value string enum, which is a single type
 * and costs nothing against that limit. Strings are the wire format only;
 * coerceBooleanFields turns them back into boolean | null before the form sees
 * them.
 */
export function buildSchema() {
  const properties: Record<string, unknown> = {}
  for (const name of EXTRACTION_NUMBER_FIELDS) {
    properties[name] = { type: ['number', 'null'] }
  }
  for (const name of EXTRACTION_BOOLEAN_FIELDS) {
    properties[name] = { type: 'string', enum: [...BOOLEAN_ENUM] }
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

NEVER INVENT A VALUE. If the text does not state something, return null for that number field, or "not_mentioned" for that true/false field. Do not guess, do not infer, do not estimate, and do not fill a field from what is typical or likely for a pregnant woman. Absence of information is never a value.

Rules:
- Numbers: return the number only if the text states it. "Qon bosimi 150/95" gives bp_systolic 150 and bp_diastolic 95. If only one number of a blood pressure is stated, return that one and null for the other.
- The true/false fields have THREE possible answers, not two. Answer each one with exactly one of these three strings:
  * "true"          — the text says the finding is present ("siydikda oqsil bor", "qon ketyapti")
  * "false"         — the text says the finding was checked and is absent ("oqsil yo'q", "shish yo'q")
  * "not_mentioned" — the text does not mention it at all
  "Not mentioned" is "not_mentioned". It is NEVER "false". A finding nobody wrote about is not a finding that was ruled out. This distinction matters more than any other instruction here: a skipped test recorded as a negative test can hide a woman who needs urgent care.
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
- proteinuria: "true"                  (stated as present)
- edema: "false"                       (stated as absent — "shish yo'q")
- gravida: 2                           (stated: "ikkinchi homiladorlik")
- prior_caesarean: "true"              (stated)
- hemoglobin: null                     (NOT MENTIONED — no haemoglobin result appears in this text, so it is null, not a guessed normal value)
- headache_or_visual: "not_mentioned"  (NOT MENTIONED — she did not say the woman has no headache, she simply did not mention headache at all, so it is "not_mentioned", not "false")
- antepartum_bleeding: "not_mentioned" (NOT MENTIONED)
- diabetes: "not_mentioned"            (NOT MENTIONED)
- every other number field: null, every other true/false field: "not_mentioned"  (NOT MENTIONED)

Note the difference between edema and headache_or_visual in that example. Edema is "false" because the text explicitly says there is none. Headache is "not_mentioned" because the text is silent about it. Getting this difference right is the single most important part of your job.

NEVER INVENT A VALUE. Anything the text does not state comes back as null for a number field and "not_mentioned" for a true/false field.`

/**
 * Turns the model's answer strings back into the three states the form holds.
 *
 * Anything unrecognised becomes null — "not mentioned", the state that leaves
 * the field for the midwife to fill in herself. That is the only safe direction
 * to fail: a finding nobody recorded must never reach the form as a finding that
 * was ruled out.
 */
export function coerceTriStateFields(
  fields: Record<string, unknown>,
  names: readonly string[],
): Record<string, unknown> {
  const coerced: Record<string, unknown> = { ...fields }
  for (const name of names) {
    const answer = coerced[name]
    if (answer === 'true') {
      coerced[name] = true
    } else if (answer === 'false') {
      coerced[name] = false
    } else {
      coerced[name] = null
    }
  }
  return coerced
}

/** The assessment schema's booleans. */
export function coerceBooleanFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return coerceTriStateFields(fields, EXTRACTION_BOOLEAN_FIELDS)
}

/** The danger-sign schema's signs. */
export function coerceDangerSigns(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return coerceTriStateFields(fields, EXTRACTION_DANGER_SIGNS)
}

/**
 * The WHO danger signs the patient channel asks about.
 *
 * Duplicated from src/lib/danger-signs.ts for the same reason the field lists
 * above are duplicated from form-fields.ts: this function must bundle without
 * reaching into the client source tree. src/lib/extraction-sync.test.ts fails if
 * the two lists drift.
 *
 * The ORDER AND MEMBERSHIP of this list is all that is shared. Which signs are
 * emergencies is not here and must never be: that is the fixed triage rule in
 * src/lib/danger-signs.ts, and nothing the model returns can reach it.
 */
export const EXTRACTION_DANGER_SIGNS = [
  'vaginal_bleeding',
  'convulsions',
  'severe_headache_with_blurred_vision',
  'fever_unable_to_rise',
  'severe_abdominal_pain',
  'fast_or_difficult_breathing',
  'fever',
  'abdominal_pain',
  'feeling_unwell',
  'swelling_face_hands_legs',
] as const

/**
 * Danger signs plus a home blood pressure reading, which is the other thing she
 * might send. Two nullable numbers is two union-typed parameters, well under the
 * 16 the structured-output compiler allows — see buildSchema.
 */
export function buildDangerSignSchema() {
  const properties: Record<string, unknown> = {}
  for (const name of EXTRACTION_DANGER_SIGNS) {
    properties[name] = { type: 'string', enum: [...BOOLEAN_ENUM] }
  }
  properties.bp_systolic = { type: ['number', 'null'] }
  properties.bp_diastolic = { type: ['number', 'null'] }

  return {
    type: 'object',
    properties,
    required: [...EXTRACTION_DANGER_SIGNS, 'bp_systolic', 'bp_diastolic'],
    additionalProperties: false,
  }
}

const DANGER_SIGN_PROMPT = `Siz Xorazm viloyati perinatal xavf reyestri uchun ma'lumot ajratuvchi yordamchisiz.

Sizga homilador ayolning o'zi Telegram orqali o'zbek tilida yozgan xabari beriladi. Vazifangiz — faqat shu xabarda AYTILGAN xavf belgilarini ajratib olish.

YOU DO NOT TRIAGE. You do not decide what is urgent, you do not rank anything, and you do not advise. You report which signs she named and nothing else. Which of these signs is an emergency is decided by a fixed list elsewhere in the system, which you cannot see and cannot change.

NEVER INVENT A SIGN. If she did not mention something, it is "not_mentioned". Do not guess, do not infer from what usually accompanies what she did say, and do not add a sign because it would be prudent to check.

Every sign has THREE possible answers. Answer each one with exactly one of these three strings:
  * "true"          — she says she has it
  * "false"         — she says she does not have it ("qon ketmayapti", "isitmam yo'q")
  * "not_mentioned" — she does not mention it at all

"Not mentioned" is "not_mentioned". It is NEVER "false". A symptom she did not write about is not a symptom she denied having. This distinction matters more than any other instruction here: a woman who never mentioned bleeding is not a woman who told you she is not bleeding.

The signs:
- vaginal_bleeding — bleeding from the vagina ("qon ketyapti", "qon keldi")
- convulsions — a fit or seizure ("tutqanoq", "talvasa tutdi", "titrab hushidan ketdi")
- severe_headache_with_blurred_vision — a SEVERE headache AND disturbed vision AT THE SAME TIME ("boshim qattiq og'riyapti, ko'zim xiralashdi"). "true" only when she reports both together. A headache with nothing said about vision is "not_mentioned" for this sign, not "true" and not "false".
- fever_unable_to_rise — a fever AND being unable to get out of bed, together ("isitmam bor, o'rnimdan tura olmayapman"). "true" only when she reports both.
- severe_abdominal_pain — severe or very strong abdominal pain ("qornim qattiq og'riyapti")
- fast_or_difficult_breathing — fast or laboured breathing ("nafas olishim qiyin", "hansirayapman")
- fever — a fever of any degree ("isitmam bor", "haroratim baland")
- abdominal_pain — abdominal pain of any degree ("qornim og'riyapti")
- feeling_unwell — feeling generally unwell ("o'zimni yomon his qilyapman", "holim yo'q")
- swelling_face_hands_legs — swelling of the fingers, face or legs ("shish bor", "oyoqlarim shishdi", "yuzim shishdi")

A severe sign implies its milder partner. If severe_abdominal_pain is "true" then abdominal_pain is "true" as well. If fever_unable_to_rise is "true" then fever is "true" as well. This is the one inference you are allowed to make, because it is contained entirely in what she already said.

Blood pressure. She may send a home reading. "Bosim 140/90" gives bp_systolic 140 and bp_diastolic 90. If only one number is stated, return that one and null for the other. If she states no reading, both are null. Do not convert or round anything.

Worked example.

Input:
"Hazrat opa, boshim juda qattiq og'riyapti va ko'zim xiralashib ketdi. Oyoqlarim ham shishgan. Bosim 155/100. Qon ketmayapti."

Correct output:
- severe_headache_with_blurred_vision: "true"   (both reported together)
- swelling_face_hands_legs: "true"              (stated)
- vaginal_bleeding: "false"                     (explicitly denied — "qon ketmayapti")
- bp_systolic: 155
- bp_diastolic: 100
- convulsions: "not_mentioned"
- fever: "not_mentioned"                        (she said nothing about fever, so it is "not_mentioned", not "false")
- abdominal_pain: "not_mentioned"
- severe_abdominal_pain: "not_mentioned"
- fast_or_difficult_breathing: "not_mentioned"
- fever_unable_to_rise: "not_mentioned"
- feeling_unwell: "not_mentioned"

Note the difference between vaginal_bleeding and fever in that example. Bleeding is "false" because she explicitly said there is none. Fever is "not_mentioned" because her message is silent about it. Getting this difference right is the single most important part of your job.

NEVER INVENT A SIGN. Anything she did not write comes back as "not_mentioned" for a sign and null for a blood pressure number.`

/** Which schema and prompt a request is asking for. */
export type ExtractMode = 'assessment' | 'danger_signs'

export interface ExtractResponse {
  status: number
  body: unknown
}

function readMode(input: unknown): ExtractMode | null {
  if (typeof input !== 'object' || input === null || !('mode' in input)) {
    return 'assessment'
  }
  const raw = (input as { mode: unknown }).mode
  if (raw === undefined || raw === null || raw === 'assessment') return 'assessment'
  if (raw === 'danger_signs') return 'danger_signs'
  // An unrecognised mode is rejected rather than quietly served the assessment
  // schema: a caller asking for triage and silently getting the wrong schema
  // back would look like a woman with no danger signs.
  return null
}

export async function handleExtract(input: unknown): Promise<ExtractResponse> {
  const text =
    typeof input === 'object' && input !== null && 'text' in input
      ? String((input as { text: unknown }).text ?? '')
      : ''

  if (text.trim() === '') {
    return { status: 400, body: { error: 'empty_text' } }
  }

  const mode = readMode(input)
  if (mode === null) {
    return { status: 400, body: { error: 'unknown_mode' } }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  // Presence and length only, never the value. An absent key, an empty one and
  // one truncated by a stray quote in .env.local are indistinguishable from the
  // browser; they are distinguishable here.
  console.log(
    `[extract] ANTHROPIC_API_KEY present=${Boolean(apiKey)} length=${apiKey?.length ?? 0}`,
  )
  if (!apiKey) {
    return { status: 500, body: { error: 'missing_api_key' } }
  }

  const client = new Anthropic({ apiKey })
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL
  console.log(`[extract] mode=${mode} model=${model} text_length=${text.length}`)

  let response: Anthropic.Message
  try {
    response = await client.messages.create({
      model,
      max_tokens: 4000,
      system: mode === 'danger_signs' ? DANGER_SIGN_PROMPT : SYSTEM_PROMPT,
      // Low effort: this is short-form extraction, not reasoning, and the client
      // gives up after 8 seconds.
      output_config: {
        // Only sent to models that accept it — see MODELS_WITHOUT_EFFORT.
        ...(supportsEffort(model) ? { effort: 'low' as const } : {}),
        format: {
          type: 'json_schema',
          schema: mode === 'danger_signs' ? buildDangerSignSchema() : buildSchema(),
        },
      },
      messages: [{ role: 'user', content: text }],
    })
  } catch (caught) {
    // Without this branch every upstream failure reaches the midwife as the same
    // "Tahlil qilinmadi" and the actual status and message are thrown away. Logs
    // the status, request id and error body — never the key, never the headers.
    if (caught instanceof Anthropic.APIError) {
      console.error(
        `[extract] Anthropic API error status=${caught.status} type=${caught.type} request_id=${caught.requestID ?? 'none'}`,
      )
      console.error(`[extract] Anthropic error body: ${JSON.stringify(caught.error)}`)
      return {
        status: 502,
        body: {
          error: 'upstream_error',
          upstream_status: caught.status,
          upstream: caught.error,
        },
      }
    }
    console.error(`[extract] non-API failure: ${String(caught)}`)
    throw caught
  }

  console.log(
    `[extract] upstream ok stop_reason=${response.stop_reason} output_tokens=${response.usage.output_tokens}`,
  )

  if (response.stop_reason === 'refusal') {
    return { status: 502, body: { error: 'refused' } }
  }

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    return { status: 502, body: { error: 'no_text_block' } }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(textBlock.text)
  } catch {
    return { status: 502, body: { error: 'unparseable_json' } }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { status: 502, body: { error: 'unparseable_json' } }
  }

  const fields =
    mode === 'danger_signs'
      ? coerceDangerSigns(parsed as Record<string, unknown>)
      : coerceBooleanFields(parsed as Record<string, unknown>)

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
