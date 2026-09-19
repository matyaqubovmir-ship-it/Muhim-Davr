/**
 * Everything the bot says to a patient, in one file.
 *
 * Clinician-facing copy lives in src/lib/labels.ts. This file is the other
 * audience: the woman herself, on her own phone, with no clinician in the room
 * to interpret what she reads. That is why the rules below are rules and not
 * style preferences, and bot/messages.test.ts enforces them.
 *
 * EVERY REPLY IS A FIXED STRING. No model output is ever sent to her; the model
 * only reads her message. So nothing here can be talked into a diagnosis.
 *
 * THE BOT NEVER DIAGNOSES AND NEVER REASSURES.
 *
 *   Not one string here names a condition, and not one tells her she is well.
 *   "Everything looks fine" is a clinical judgement, and a judgement made from a
 *   text message by a system that cannot examine her is a judgement made on no
 *   evidence. The worst outcome this channel can produce is a woman who felt
 *   something was wrong, wrote in, was told she was fine, and stayed home.
 *
 *   So the no-match reply says exactly two things: her report reached her
 *   midwife, and if things get worse she must seek care immediately — and it
 *   always ends on that second thing. It does not say she is fine, because the
 *   bot does not know that.
 *
 * NO MEDICINE, EVER. Not a name, not a dose, not "keep taking what you were
 * given". Protocol reminders stay on the doctor's screen where a clinician
 * confirms them — see WHO_PROTOCOL_REMINDERS in src/lib/labels.ts. When she asks
 * about medicine the only answer is to ask her doctor or midwife.
 *
 * 103 is the ambulance number in Uzbekistan.
 */

/** The closing line every non-emergency reply to a report ends with. */
export const WORSENS_LINE = 'Agar yomonlashsa, darhol murojaat qiling.'

const EMERGENCY_LINE =
  'Shoshilinch holatda bu yerga yozmang — darhol tez yordamga (103) qo‘ng‘iroq qiling.'

const GO_NOW =
  'DARHOL TIBBIY YORDAMGA MUROJAAT QILING.\n\n' +
  'Tez yordamga (103) qo‘ng‘iroq qiling yoki eng yaqin tug‘ruqxonaga boring. ' +
  'Kutmang va yolg‘iz bormang.'

export const BOT = {
  // --- linking -------------------------------------------------------------
  startNoCode:
    'Assalomu alaykum. Bu — Muhim Davr xizmati.\n\n' +
    'Ulanish uchun akusherkangiz bergan kodni yuboring:\n' +
    '/start KOD\n\n' +
    'Masalan: /start A3F91C',

  linkBadCode:
    'Kod noto‘g‘ri ko‘rinadi. Kod 6 ta belgidan iborat (0-9 va A-F).\n\n' +
    'Qaytadan urinib ko‘ring: /start KOD\n' +
    'Kodni akusherkangizdan so‘rang.',

  linkNotFound:
    'Bu kod bo‘yicha hech narsa topilmadi.\n\n' +
    'Kodni akusherkangizdan qaytadan so‘rang va yana urinib ko‘ring.',

  // Two pregnancies can share a six-character code. Linking the wrong woman is
  // worse than not linking at all, so the bot stops and asks for a human.
  linkAmbiguous:
    'Bu kodni tekshirib bo‘lmadi. Iltimos, akusherkangizga murojaat qiling.',

  // Codes are short, so repeated wrong guesses from one chat are cut off.
  linkTooManyAttempts:
    'Juda ko‘p noto‘g‘ri urinish bo‘ldi. Bir soatdan keyin qayta urinib ko‘ring ' +
    'yoki akusherkangizga murojaat qiling.',

  linkOk:
    'Ulandingiz. Endi o‘zingizni qanday his qilayotganingizni shu yerga yozishingiz mumkin. ' +
    'Uyda o‘lchagan qon bosimingizni ham yuborishingiz mumkin (masalan: bosim 120/80).\n\n' +
    'Ko‘riklaringiz haqida eslatma ham shu yerga keladi.\n\n' +
    EMERGENCY_LINE,

  notLinked:
    'Siz hali ulanmagansiz.\n\n' +
    'Akusherkangiz bergan kodni yuboring: /start KOD\n\n' +
    EMERGENCY_LINE,

  linkedHelp:
    'O‘zingizni qanday his qilayotganingizni shu yerga yozing yoki uyda o‘lchagan ' +
    'qon bosimingizni yuboring (masalan: bosim 120/80). Xabaringiz akusherkangizga boradi.\n\n' +
    EMERGENCY_LINE,

  // --- self-report ---------------------------------------------------------
  // Pieces, composed by composeReportReply in bot/self-report.ts. Note what the
  // no-match pieces do NOT contain: no "hammasi yaxshi", no interpretation, no
  // condition named.
  reportReceived: 'Xabaringiz qabul qilindi va akusherkangizga yuborildi.',

  promptVisit: 'Iltimos, yaqin kunlarda oilaviy poliklinikangizga boring.',

  bpRecorded: 'Qon bosimi ko‘rsatkichingiz ham akusherkangizga yuborildi.',

  reportImmediate: GO_NOW + '\n\nXabaringiz shifokorga ham yuborildi.',

  // The emergency was recognised but could not be recorded. She still gets the
  // instruction to go now — that part never depends on the database — but she
  // is not told a doctor has it, because no doctor does.
  reportImmediateNotSaved: GO_NOW + '\n\nAkusherkangizga ham qo‘ng‘iroq qiling.',

  // --- refusals ------------------------------------------------------------
  medicineRefusal:
    'Dori-darmon haqida bu yerda javob berilmaydi. ' +
    'Iltimos, shifokoringiz yoki akusherkangizdan so‘rang — ular sizni ko‘rgan ' +
    'va holatingizni biladi.',

  // Voice notes are not transcribed. Saying "received" would be a lie that
  // could bury a danger sign, so the bot asks her to write instead.
  voiceNotSupported:
    'Ovozli xabarni o‘qiy olmadim.\n\n' +
    'Iltimos, matn qilib yozing. Telefoningiz klaviaturasidagi mikrofon ' +
    'tugmasi orqali gapirib yozishingiz ham mumkin.\n\n' +
    WORSENS_LINE,

  emptyMessage:
    'Xabaringizni o‘qiy olmadim. Iltimos, o‘zingizni qanday his qilayotganingizni yozing.\n\n' +
    WORSENS_LINE,

  // The report could not be processed or could not be recorded. She must not be
  // left thinking a silent bot means nothing is wrong, and she must not be told
  // her midwife has it.
  reportFailed:
    'Xabaringizni hozir qayta ishlay olmadim.\n\n' +
    'Agar o‘zingizni yomon his qilsangiz, kutmang — akusherkangizga qo‘ng‘iroq ' +
    'qiling yoki tez yordamga (103) murojaat qiling.',
} as const

// --- visit reminders -------------------------------------------------------

/** Date.getDay() order: Sunday first. */
const WEEKDAYS = [
  'yakshanba',
  'dushanba',
  'seshanba',
  'chorshanba',
  'payshanba',
  'juma',
  'shanba',
] as const

/** DD.MM.YYYY — how a date is written and read in Uzbekistan. */
export function formatUzbekDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${day}.${month}.${date.getFullYear()}`
}

function dateWithWeekday(date: Date): string {
  return `${formatUzbekDate(date)}, ${WEEKDAYS[date.getDay()]}`
}

/**
 * Where to go.
 *
 * There is no facility column anywhere in the schema — patients records a
 * district and a village, not a clinic — so the destination is her family
 * polyclinic in her own district rather than a named building. Naming a specific
 * facility here would mean inventing one.
 */
function destination(district: string | null): string {
  // "Urganch tumani" and "Urganch" are both how a district gets typed in.
  const name = (district ?? '').trim().replace(/\s+tuman(i)?$/i, '')
  return name !== ''
    ? `${name} tumanidagi oilaviy poliklinikangizga boring.`
    : 'Oilaviy poliklinikangizga boring.'
}

const CANNOT_GO = 'Bora olmasangiz, akusherkangizga xabar bering.'

export function reminderTwoDays(date: Date, district: string | null): string {
  return (
    `Eslatma: ${dateWithWeekday(date)} kuni ko‘rigingiz bor (2 kundan keyin).\n\n` +
    `${destination(district)}\n\n${CANNOT_GO}`
  )
}

/**
 * The day before, sent only when the two-day reminder never went out — the bot
 * was not running that day. Same facts, same close; only the day word differs.
 */
export function reminderTomorrow(date: Date, district: string | null): string {
  return (
    `Eslatma: ertaga, ${dateWithWeekday(date)}, ko‘rigingiz bor.

` +
    `${destination(district)}

${CANNOT_GO}`
  )
}

export function reminderMorning(date: Date, district: string | null): string {
  return (
    `Eslatma: bugun, ${dateWithWeekday(date)}, ko‘rigingiz bor.\n\n` +
    `${destination(district)}\n\n${CANNOT_GO}`
  )
}

// --- a visit that was not recorded, and the questions after it ------------
//
// "NOT RECORDED", NEVER "YOU SKIPPED". The system knows only that no visit was
// entered for that day; a midwife may have seen her and not typed it in yet.
// Telling a woman who came that she did not is how she stops trusting the
// channel, so the notice states the fact the system has and asks her to call.

/** The morning after a planned contact that nobody recorded. */
export function missedVisitNotice(date: Date): string {
  return (
    `${dateWithWeekday(date)} kuni ko‘rigingiz rejalashtirilgan edi, lekin ko‘rik qayd etilmadi.\n\n` +
    'Iltimos, akusherkangiz bilan bog‘laning va yangi ko‘rik vaqtini belgilang.\n\n' +
    EMERGENCY_LINE
  )
}

/**
 * The questions. Every yes/no question is one sign from the WHO list in
 * src/lib/danger-signs.ts, asked in plain words; the answer is that sign's
 * three-state value and nothing else. Which answers are an emergency is the
 * list's decision, not this file's — these are only the words.
 *
 * The order is bot/survey.ts's. Two are follow-ups, asked only after a "Ha":
 * severe_abdominal_pain after abdominal_pain, fever_unable_to_rise after fever.
 */
export const SURVEY = {
  yes: 'Ha',
  no: 'Yo‘q',
  cannotMeasure: 'O‘lchay olmayman',

  intro:
    'Akusherkangiz holatingizni bilishi uchun bir nechta qisqa savol beramiz. ' +
    'Pastdagi tugmalar orqali javob bering.',

  questions: {
    bp:
      'Qon bosimingiz hozir qancha? Ikki raqamni yozing, masalan: 120/80.\n\n' +
      'O‘lchay olmasangiz, pastdagi tugmani bosing.',
    vaginal_bleeding: 'Qindan qon ketyaptimi?',
    abdominal_pain: 'Qorningizda og‘riq bormi?',
    severe_abdominal_pain: 'Qorindagi og‘riq kuchlimi?',
    severe_headache_with_blurred_vision: 'Kuchli bosh og‘rig‘i va ko‘z oldi xiralashishi bormi?',
    fast_or_difficult_breathing: 'Nafas olishingiz qiyinlashdimi yoki tezlashdimi?',
    convulsions: 'Tutqanoq (talvasa) bo‘ldimi?',
    fever: 'Isitmangiz bormi?',
    fever_unable_to_rise: 'Isitma tufayli o‘rningizdan tura olmayapsizmi?',
    swelling_face_hands_legs: 'Yuzingiz, qo‘lingiz yoki oyog‘ingizda shish bormi?',
    feeling_unwell: 'O‘zingizni yomon his qilyapsizmi?',
    other:
      'Yana nima bezovta qilyapti? Yozib yuboring.\n\n' +
      'Boshqa hech narsa bo‘lmasa, «Yo‘q» tugmasini bosing.',
  },

  // Two numbers that cannot be a reading — a transposed or missing digit. She
  // is asked again rather than having a wrong number stored as a measurement.
  bpNotReadable:
    'Bu raqamlarni qon bosimi sifatida o‘qiy olmadim. ' +
    'Iltimos, ikki raqamni yozing, masalan: 120/80.',

  // After something she wrote that was not an answer: it was handled as a
  // report in its own right, and now the question is asked again.
  backToQuestions: 'Endi savollarga qaytamiz:',

  // Opens the closing reply in place of BOT.reportReceived. Like that line, it
  // is only used when her answers were actually written down.
  received: 'Javoblaringiz qabul qilindi va akusherkangizga yuborildi.',
} as const
