/**
 * All user-facing Uzbek copy, in one file.
 *
 * This is placeholder wording written to be reasonable, not final. It is kept
 * here rather than inline in the components so the final copy can be dropped in
 * by editing one file, without touching layout or logic.
 *
 * Latin script, as used in Uzbekistan.
 */

import type { RiskFactor, RiskZone } from './risk'
import type { FormFieldName } from './form-fields'

export const UI = {
  appTitle: 'ONA',
  appSubtitle: 'Homiladorlik xavfini baholash',

  newEntry: 'Yangi qayd',
  save: 'Saqlash',
  saving: 'Saqlanmoqda...',

  pregnancyIdLabel: 'Homiladorlik ID',
  pregnancyIdHint: 'Ro‘yxatdagi homiladorlik raqami',
  pregnancyIdRequired: 'Homiladorlik ID kiritilishi shart.',

  yes: 'Ha',
  no: 'Yo‘q',
  notChecked: 'Tekshirilmagan',

  score: 'Ball',
  factorsTitle: 'Aniqlangan omillar',
  noFactors: 'Xavf omillari aniqlanmadi.',

  incompleteTitle: 'Baho to‘liq emas',
  incompleteBody: 'Quyidagi ko‘rsatkichlar qayd etilmagan:',
  incompleteNote: 'Qayd etilmagan ma’lumot — xavf yo‘q degani emas.',

  saveFailed: 'Saqlashda xatolik yuz berdi. Qayd saqlanmadi.',
  authFailed: 'Tizimga kirib bo‘lmadi. Qayd saqlanmadi.',

  narrativeLabel: 'Bemor haqida o‘z so‘zlaringiz bilan yozing',
  analyse: 'Tahlil qilish',
  analysing: 'Tahlil qilinmoqda...',
  analyseFailed: 'Tahlil qilinmadi, qo‘lda kiriting',
  aiBadge: 'AI',
  aiFilledNote:
    'AI belgisi qo‘yilgan maydonlarni tekshiring va kerak bo‘lsa to‘g‘rilang.',
  savedAs: 'Qayd saqlandi',
} as const

export const GROUP_TITLES = {
  vitals: 'Hayotiy ko‘rsatkichlar',
  woman: 'Ayol haqida',
  history: 'Anamnez',
  context: 'Sharoit',
} as const

export const FIELD_LABELS: Record<FormFieldName, string> = {
  // vitals
  bp_systolic: 'Yuqori bosim (sistolik)',
  bp_diastolic: 'Pastki bosim (diastolik)',
  hemoglobin: 'Gemoglobin',
  proteinuria: 'Siydikda oqsil',
  edema: 'Shishlar',
  headache_or_visual: 'Bosh og‘rig‘i yoki ko‘rish buzilishi',
  antepartum_bleeding: 'Tug‘ruqdan oldingi qon ketishi',

  // woman
  age: 'Yoshi',
  gravida: 'Homiladorliklar soni (gravida)',
  para: 'Tug‘ruqlar soni (para)',
  gestational_age_weeks: 'Homiladorlik muddati',
  bmi: 'Tana massasi indeksi',

  // history
  prior_preeclampsia: 'Avval preeklampsiya bo‘lganmi',
  prior_caesarean: 'Avval kesar kesish bo‘lganmi',
  prior_stillbirth_or_neonatal_death: 'Avval o‘lik tug‘ilish yoki chaqaloq o‘limi',
  multiple_gestation: 'Ko‘p homilalik (egizak)',
  chronic_hypertension: 'Surunkali gipertoniya',
  diabetes: 'Qandli diabet',
  kidney_disease: 'Buyrak kasalligi',
  family_history_preeclampsia: 'Oilada preeklampsiya bo‘lganmi',
  birth_interval_months: 'Oldingi tug‘ruqdan keyingi tanaffus',

  // context
  travel_minutes_to_facility: 'Shifoxonagacha yo‘l',
  missed_visits: 'O‘tkazib yuborilgan ko‘riklar soni',
}

/** Units, shown next to the label so the midwife cannot guess wrong. */
export const FIELD_UNITS: Partial<Record<FormFieldName, string>> = {
  bp_systolic: 'mm sim. ust.',
  bp_diastolic: 'mm sim. ust.',
  hemoglobin: 'g/L',
  gestational_age_weeks: 'hafta',
  birth_interval_months: 'oy',
  travel_minutes_to_facility: 'daqiqa',
  age: 'yosh',
}

export const ZONE_NAMES: Record<RiskZone, string> = {
  qizil: 'QIZIL',
  sariq: 'SARIQ',
  yashil: 'YASHIL',
}

export const ZONE_ADVICE: Record<RiskZone, string> = {
  qizil: 'Zudlik bilan yuqori bosqichga yo‘naltirish kerak.',
  sariq: 'Kuzatuv va takroriy ko‘rik talab etiladi.',
  yashil: 'Xavf past. Rejali kuzatuvni davom ettiring.',
}

export const ZONE_COLORS: Record<RiskZone, string> = {
  qizil: '#BE3A2B',
  sariq: '#B97609',
  yashil: '#2C7A50',
}

/** Each factor as a plain sentence a midwife can read aloud. */
export const FACTOR_SENTENCES: Record<RiskFactor, string> = {
  severe_hypertension: 'Qon bosimi juda yuqori (160/110 va undan yuqori).',
  preeclampsia_suspected:
    'Preeklampsiyaga shubha: siydikda oqsil va yuqori qon bosimi birga aniqlandi.',
  severe_anemia: 'Og‘ir kamqonlik: gemoglobin 70 g/L dan past.',
  antepartum_bleeding: 'Tug‘ruqdan oldingi qon ketishi qayd etilgan.',
  gestational_age_unknown:
    'Homiladorlik muddati qayd etilmagan, shuning uchun bu xulosa to‘liq aniq emas.',
  hypertension_moderate: 'Qon bosimi o‘rtacha darajada yuqori (140/90 va undan yuqori).',
  anemia: 'Kamqonlik: gemoglobin 110 g/L dan past.',
  prior_preeclampsia: 'Avvalgi homiladorlikda preeklampsiya bo‘lgan.',
  chronic_condition:
    'Surunkali kasallik bor (gipertoniya, qandli diabet yoki buyrak kasalligi).',
  prior_loss: 'Avval o‘lik tug‘ilish yoki chaqaloq o‘limi bo‘lgan.',
  multiple_gestation: 'Ko‘p homilalik: egizak yoki undan ko‘p.',
  maternal_age: 'Onaning yoshi xavf guruhida (18 dan kichik yoki 35 dan katta).',
  prior_caesarean: 'Avval kesar kesish operatsiyasi o‘tkazilgan.',
  grand_multipara: 'Besh yoki undan ko‘p tug‘ruq bo‘lgan.',
  distance_from_care: 'Shifoxonagacha yo‘l bir soatdan ko‘p.',
  missed_visits: 'Ikki yoki undan ko‘p ko‘rik o‘tkazib yuborilgan.',
  primigravida: 'Birinchi homiladorlik.',
  obesity: 'Tana massasi indeksi 30 dan yuqori.',
  family_history: 'Oilada preeklampsiya bo‘lgan.',
  short_interval: 'Oldingi tug‘ruqdan keyin 24 oydan kam vaqt o‘tgan.',
}

/** Short names for the missing-data warning, read as a list inside a sentence. */
export const MISSING_FIELD_NAMES = {
  bp_systolic: 'yuqori bosim',
  bp_diastolic: 'pastki bosim',
  hemoglobin: 'gemoglobin',
  proteinuria: 'siydikda oqsil',
  age: 'yoshi',
} as const
