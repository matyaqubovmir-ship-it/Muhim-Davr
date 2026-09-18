/**
 * Does the AI read notes correctly? A fixed set of midwife notes and patient
 * messages, each with the values a careful human would take from it, run
 * through the real endpoint code against the live model.
 *
 *   npm run eval:ai            every case, a score per field
 *
 * Every field the case does not list must come back empty (null / "not
 * mentioned"). That is the point of the exercise: the failures that matter
 * here are not a wrong number but a value the model invented, and above all a
 * finding nobody wrote about reported as absent ("not_mentioned" read as
 * "false") — the error that hides a woman who needs care.
 *
 * Costs a few cents on Claude Haiku 4.5. Needs ANTHROPIC_API_KEY (.env.local).
 */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  EXTRACTION_BOOLEAN_FIELDS,
  EXTRACTION_DANGER_SIGNS,
  EXTRACTION_NUMBER_FIELDS,
  handleExtract,
} from '../api/extract.ts'

type Value = number | boolean | null

export interface EvalCase {
  name: string
  mode: 'assessment' | 'danger_signs'
  text: string
  /** Only what the text states. Everything else must come back null. */
  expect: Record<string, Value>
}

export const CASES: EvalCase[] = [
  // --- the midwife's note ----------------------------------------------------------
  {
    name: 'plain visit note',
    mode: 'assessment',
    text: 'Dilnoza 24 yosh, 32 hafta. Qon bosimi 145/95. Siydikda oqsil bor. Shish yo‘q. Ikkinchi homiladorlik.',
    expect: { age: 24, gestational_age_weeks: 32, bp_systolic: 145, bp_diastolic: 95, proteinuria: true, edema: false, gravida: 2 },
  },
  {
    name: 'a test not done is not negative',
    mode: 'assessment',
    text: 'Bosim 118/76. Siydik tahlili bugun o‘tkazilmadi, keyingi safar. Gemoglobin 121.',
    expect: { bp_systolic: 118, bp_diastolic: 76, hemoglobin: 121 },
  },
  {
    name: 'explicit negatives',
    mode: 'assessment',
    text: 'Shish yo‘q, boshi og‘rimaydi, ko‘rishi yaxshi. Qon ketishi kuzatilmadi. Qandli diabet yo‘q.',
    expect: { edema: false, headache_or_visual: false, antepartum_bleeding: false, diabetes: false },
  },
  {
    name: 'haemoglobin in g/dL',
    mode: 'assessment',
    text: 'Hb 9,8 g/dL. 26 haftalik.',
    expect: { hemoglobin: 98, gestational_age_weeks: 26 },
  },
  {
    name: 'Russian clinical shorthand',
    mode: 'assessment',
    text: 'АД 150/100, белок в моче ++, отёки на ногах. Срок 34 недели.',
    expect: { bp_systolic: 150, bp_diastolic: 100, proteinuria: true, edema: true, gestational_age_weeks: 34 },
  },
  {
    name: 'age and weeks side by side',
    mode: 'assessment',
    text: '28 yoshda, homiladorlik muddati 31 hafta.',
    expect: { age: 28, gestational_age_weeks: 31 },
  },
  {
    name: 'half a blood pressure',
    mode: 'assessment',
    text: 'Yuqori bosimi 150 edi, pastkisini o‘lchashga ulgurmadik.',
    expect: { bp_systolic: 150 },
  },
  {
    name: 'gravida and para',
    mode: 'assessment',
    text: 'Uchinchi homiladorlik, ikki marta tug‘gan. Oxirgi tug‘ruq 18 oy oldin, kesar kesish bilan.',
    expect: { gravida: 3, para: 2, birth_interval_months: 18, prior_caesarean: true },
  },
  {
    name: 'a plan is not a history',
    mode: 'assessment',
    text: 'Preeklampsiya rivojlanmasligi uchun bosimini har hafta kuzatamiz. Bosim 128/82.',
    expect: { bp_systolic: 128, bp_diastolic: 82 },
  },
  {
    name: 'family history and twins',
    mode: 'assessment',
    text: 'Onasida preeklampsiya bo‘lgan. UZIda egizak.',
    expect: { family_history_preeclampsia: true, multiple_gestation: true },
  },
  {
    name: 'nothing measured: nothing invented',
    mode: 'assessment',
    text: 'Bemor ko‘rikka keldi, shikoyati yo‘q, kayfiyati yaxshi.',
    expect: {},
  },
  {
    name: 'bleeding and headache present',
    mode: 'assessment',
    text: 'Kecha qon ketgan. Boshi qattiq og‘riyapti, ko‘zlari xiralashyapti. Bosim 165/112.',
    expect: { antepartum_bleeding: true, headache_or_visual: true, bp_systolic: 165, bp_diastolic: 112 },
  },
  {
    name: 'prior stillbirth, chronic hypertension',
    mode: 'assessment',
    text: 'Avvalgi homiladorlikda o‘lik tug‘ilgan. Surunkali gipertoniyasi bor, dori ichadi.',
    expect: { prior_stillbirth_or_neonatal_death: true, chronic_hypertension: true },
  },
  {
    name: 'BMI and missed visits',
    mode: 'assessment',
    text: 'TMI 31,5. Ikki ko‘rikni o‘tkazib yuborgan.',
    expect: { bmi: 31.5, missed_visits: 2 },
  },
  {
    name: 'normal reference is not a value',
    mode: 'assessment',
    text: 'Gemoglobin me‘yori 120-140, lekin tahlil hali tayyor emas.',
    expect: {},
  },

  // --- the patient's own Telegram message --------------------------------------------
  {
    name: 'patient: bleeding',
    mode: 'danger_signs',
    text: 'Opa, qon kelyapti, nima qilay',
    expect: { vaginal_bleeding: true },
  },
  {
    name: 'patient: headache alone is not the combined sign',
    mode: 'danger_signs',
    text: 'Boshim og‘riyapti',
    expect: {},
  },
  {
    name: 'patient: headache with blurred vision',
    mode: 'danger_signs',
    text: 'Boshim juda qattiq og‘riyapti, ko‘zlarim xira ko‘ryapti',
    expect: { severe_headache_with_blurred_vision: true },
  },
  {
    name: 'patient: fever and cannot get up',
    mode: 'danger_signs',
    text: 'Isitmam baland, o‘rnimdan tura olmayapman',
    expect: { fever_unable_to_rise: true, fever: true },
  },
  {
    name: 'patient: explicit denial',
    mode: 'danger_signs',
    text: 'Qon ketmayapti, faqat biroz charchadim',
    expect: { vaginal_bleeding: false, feeling_unwell: true },
  },
  {
    name: 'patient: home blood pressure only',
    mode: 'danger_signs',
    text: 'Bosimim 160/110 chiqdi',
    expect: { bp_systolic: 160, bp_diastolic: 110 },
  },
  {
    name: 'patient: severe abdominal pain implies abdominal pain',
    mode: 'danger_signs',
    text: 'Qornim qattiq og‘riyapti',
    expect: { severe_abdominal_pain: true, abdominal_pain: true },
  },
  {
    name: 'patient: Russian',
    mode: 'danger_signs',
    text: 'У меня кровотечение и судороги',
    expect: { vaginal_bleeding: true, convulsions: true },
  },
]

export interface FieldMiss {
  field: string
  expected: Value
  got: Value
  /** The failure this system exists to prevent. */
  kind: 'invented' | 'not_mentioned_as_false' | 'missed' | 'wrong'
}

/** Every field of the case's schema, compared. */
export function compare(c: EvalCase, fields: Record<string, unknown>): FieldMiss[] {
  const names =
    c.mode === 'danger_signs'
      ? [...EXTRACTION_DANGER_SIGNS, 'bp_systolic', 'bp_diastolic']
      : [...EXTRACTION_NUMBER_FIELDS, ...EXTRACTION_BOOLEAN_FIELDS]
  const misses: FieldMiss[] = []
  for (const field of names) {
    const expected = field in c.expect ? c.expect[field] : null
    const raw = fields[field]
    const got: Value = typeof raw === 'number' || typeof raw === 'boolean' ? raw : null
    if (got === expected) continue
    const kind =
      expected === null && got === false
        ? 'not_mentioned_as_false'
        : expected === null
          ? 'invented'
          : got === null
            ? 'missed'
            : 'wrong'
    misses.push({ field, expected, got, kind })
  }
  return misses
}

async function main() {
  let fieldsChecked = 0
  let fieldMisses = 0
  let perfect = 0
  const byKind: Record<FieldMiss['kind'], number> = { invented: 0, not_mentioned_as_false: 0, missed: 0, wrong: 0 }
  const times: number[] = []

  for (const c of CASES) {
    const t = Date.now()
    const result = await handleExtract({ text: c.text, mode: c.mode })
    times.push(Date.now() - t)
    if (result.status !== 200) {
      console.log(`✗ ${c.name}: HTTP ${result.status} ${JSON.stringify(result.body).slice(0, 200)}`)
      fieldMisses++
      continue
    }
    const fields = (result.body as { fields: Record<string, unknown> }).fields
    const misses = compare(c, fields)
    const total = c.mode === 'danger_signs' ? EXTRACTION_DANGER_SIGNS.length + 2 : EXTRACTION_NUMBER_FIELDS.length + EXTRACTION_BOOLEAN_FIELDS.length
    fieldsChecked += total
    fieldMisses += misses.length
    for (const m of misses) byKind[m.kind]++
    if (misses.length === 0) perfect++
    console.log(
      `${misses.length === 0 ? '✓' : '✗'} ${c.name}` +
        (misses.length ? '\n    ' + misses.map((m) => `${m.field}: expected ${m.expected}, got ${m.got} (${m.kind})`).join('\n    ') : ''),
    )
  }

  const sorted = [...times].sort((a, b) => a - b)
  console.log(`\n${perfect}/${CASES.length} cases exactly right`)
  console.log(`${fieldsChecked - fieldMisses}/${fieldsChecked} fields right (${(((fieldsChecked - fieldMisses) / fieldsChecked) * 100).toFixed(1)}%)`)
  console.log(`invented: ${byKind.invented} · not-mentioned reported as absent: ${byKind.not_mentioned_as_false} · missed: ${byKind.missed} · wrong: ${byKind.wrong}`)
  console.log(`latency: median ${sorted[Math.floor(sorted.length / 2)]} ms, slowest ${sorted.at(-1)} ms`)
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  // The endpoint logs every call; the report is what matters here.
  console.log = ((original) => (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith('[extract]')) return
    original(...args)
  })(console.log)
  main().catch((caught: unknown) => {
    console.error(caught)
    process.exitCode = 1
  })
}
