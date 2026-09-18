/**
 * All CLINICIAN-facing Uzbek copy, in one file.
 *
 * The patient's side of the system speaks to a different reader under different
 * rules — no diagnosis, no reassurance, no medicine — and its copy lives in
 * bot/messages.ts. Keeping the two apart is not tidiness: a string safe on a
 * midwife's screen, next to a score and a factor list she was trained to read,
 * can be unsafe alone on a patient's phone.
 *
 * This is placeholder wording written to be reasonable, not final. It is kept
 * here rather than inline in the components so the final copy can be dropped in
 * by editing one file, without touching layout or logic.
 *
 * Latin script, as used in Uzbekistan.
 */

// Explicit .ts extensions: bot/ imports this file under Node's own module
// resolution, which does not guess extensions the way the Vite bundler does.
import type { RiskFactor, RiskZone } from './risk.ts'
import type { FormFieldName } from './form-fields.ts'
import type { DangerSign } from './danger-signs.ts'

export const UI = {
  appTitle: 'Muhim Davr',
  appSubtitle: 'Homiladorlik xavfini baholash',

  newEntry: 'Yangi qayd',
  save: 'Saqlash',
  saving: 'Saqlanmoqda...',

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
  numberInvalid: 'Son emas. Masalan: 110 yoki 10,5',
  numbersInvalid: 'Ba’zi maydonlarda son noto‘g‘ri yozilgan. Belgilangan maydonlarni tuzating — qayd saqlanmadi.',

  narrativeLabel: 'Bemor haqida o‘z so‘zlaringiz bilan yozing',
  analyse: 'Tahlil qilish',
  analysing: 'Tahlil qilinmoqda...',
  analyseFailed: 'Tahlil qilinmadi, qo‘lda kiriting',
  aiBadge: 'AI',
  aiFilledNote:
    'AI belgisi qo‘yilgan maydonlarni tekshiring va kerak bo‘lsa to‘g‘rilang.',

  scheduleTitle: 'Ko‘riklar jadvali',
  nextVisit: 'Keyingi ko‘rik',
  today: 'Bugun',
  week: 'hafta',
  contact: 'ko‘rik',
  scheduleNeedsGa:
    'Jadvalni tuzish uchun homiladorlik muddati (hafta) kiritilishi yoki oxirgi hayz sanasi qayd etilgan bo‘lishi kerak.',
  scheduleBasis: 'WHO 2016 — sakkiz marta ko‘rik modeli',
  pastContact: 'O‘tgan sana',

  protocolTitle: 'WHO protokoli bo‘yicha eslatma — shifokor tasdiqlashi kerak',
  protocolStaticNote:
    'Bu ro‘yxat o‘zgarmas. Uni tizim ham, sun’iy intellekt ham yaratmaydi va bemorga moslamaydi.',
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

export const VISIT_STATUS_LABELS: Record<string, string> = {
  rejalashtirilgan: 'Rejalashtirilgan',
  bajarilgan: 'Bajarilgan',
  "o'tkazib yuborilgan": 'O‘tkazib yuborilgan',
}

/** How each zone changes the schedule, shown above the list. */
export const SCHEDULE_ZONE_NOTES: Record<RiskZone, string> = {
  yashil: 'Yashil zona: WHO jadvali o‘zgarishsiz, sakkiz marta ko‘rik.',
  sariq:
    'Sariq zona: 26-haftadan boshlab har ikki ko‘rik orasiga qo‘shimcha ko‘rik qo‘shildi.',
  qizil: 'Qizil zona: keyingi ko‘rik bugunga ko‘chirildi. Qolgan jadval o‘zgarmadi.',
}

/**
 * Static protocol reminders from WHO antenatal care guidance. DISPLAYED, NEVER
 * GENERATED.
 *
 * This is a fixed list of four strings. Nothing computes it, nothing tailors it
 * to the patient, and no model has any path to it — a medication chosen by a
 * language model is not something this system will show a midwife. It is
 * rendered as a reminder for a clinician to confirm, never as an instruction
 * the system has issued.
 *
 * Source: WHO recommendations on antenatal care for a positive pregnancy
 * experience (2016).
 */
export const WHO_PROTOCOL_REMINDERS: readonly string[] = [
  'Temir va folat kislotasi, yoki ko‘p mikroelementli qo‘shimcha — har bir ko‘rikda.',
  'Kalsiy qo‘shimchasi — har bir ko‘rikda.',
  'Vitamin D — har bir ko‘rikda.',
  'Qon bosimi yuqori bo‘lgan ayollarga preeklampsiyaning oldini olish uchun kuniga 150 mg aspirin. 36-haftada to‘xtatiladi.',
] as const

/** Short names for the missing-data warning, read as a list inside a sentence. */
export const MISSING_FIELD_NAMES = {
  bp_systolic: 'yuqori bosim',
  bp_diastolic: 'pastki bosim',
  hemoglobin: 'gemoglobin',
  proteinuria: 'siydikda oqsil',
  age: 'yoshi',
} as const

/**
 * WHO danger signs, named for a clinician reading the escalation queue.
 *
 * Which of these is an emergency is not expressed here — that is the fixed list
 * in src/lib/danger-signs.ts. These are only names.
 */
export const DANGER_SIGN_NAMES: Record<DangerSign, string> = {
  vaginal_bleeding: 'Qindan qon ketishi',
  convulsions: 'Tutqanoq (talvasa)',
  severe_headache_with_blurred_vision:
    'Kuchli bosh og‘rig‘i va ko‘rish xiralashuvi',
  fever_unable_to_rise: 'Isitma, o‘rnidan tura olmaydi',
  severe_abdominal_pain: 'Qorinda kuchli og‘riq',
  fast_or_difficult_breathing: 'Tez yoki qiyin nafas olish',
  fever: 'Isitma',
  abdominal_pain: 'Qorin og‘rig‘i',
  feeling_unwell: 'O‘zini yomon his qilish',
  swelling_face_hands_legs: 'Yuz, qo‘l yoki oyoqlarda shish',
}

/**
 * Sentences opening an escalation raised from the patient channel. The doctor
 * queue also has escalations.source = 'telegram', but the reason is the line a
 * person actually reads, so it says where it came from in words too — and that
 * the reading was taken at home, by her, not on a clinic cuff.
 */
export const TELEGRAM_ESCALATION = {
  signs: 'Bemor Telegram orqali xavf belgisi haqida xabar berdi:',
  homeBp: 'Bemor Telegram orqali uyda o‘lchangan qon bosimini yubordi:',
} as const

/** Opening of an escalation raised by a red assessment on the midwife's form. */
export const CLINIC_ESCALATION_REASON = 'Akusherka ko‘rigida qizil zona aniqlandi.'

/**
 * For a red reached on points alone, where no single finding forced it: the
 * total, before the factors that added up to it.
 */
export function clinicEscalationPointsSentence(score: number): string {
  return `Mutlaq xavf belgisi yo‘q — qizil zona omillar yig‘indisi bo‘yicha: ${score} ball.`
}

/** What happened after the assessment itself was saved. */
export const FOLLOW_UP_UI = {
  escalationSent: 'Shifokor navbatiga yuborildi.',
  escalationFailed:
    'Shifokorga yo‘llanma yuborilmadi. Qayta yuboring yoki shifokorga qo‘ng‘iroq qiling.',
  escalationRetry: 'Qayta yuborish',
  escalationRetrying: 'Yuborilmoqda...',
  scheduleSaved:
    'Jadval saqlandi. Bemor Telegramga ulangan bo‘lsa, har bir ko‘rikdan 2 kun oldin va o‘sha kuni ertalab eslatma oladi.',
  scheduleFailed: 'Jadval saqlanmadi, shuning uchun Telegram eslatmalari yuborilmaydi.',
} as const

/** Shown on the midwife's screen so she can read the code out to the patient. */
export const LINK_CODE_UI = {
  title: 'Telegram uchun kod',
  body: 'Bu kodni bemorga bering. U Telegramda Muhim Davr botiga yuboradi:',
  bot: 'Bot',
  unavailable:
    'Kod ko‘rsatilmadi: homiladorlik ID to‘g‘ri formatda emas.',
} as const

/** The district registry (/registry, /registry/:district). */
export const REGISTRY_UI = {
  tab: 'Reyestr',
  title: 'Tumanlar bo‘yicha reyestr',
  subtitle: 'Faol homiladorliklar, har birining joriy zonasi bo‘yicha.',
  districtSubtitle: 'Faol homiladorliklar zonalar bo‘yicha.',
  allDistricts: 'Barcha tumanlar',
  active: 'faol homiladorlik',
  unassessed: 'Baholanmagan',
  unassessedNote: 'Hali baho yo‘q — xavf noma’lum, past degani emas.',
  emptyZone: 'Bu zonada bemor yo‘q.',
  noDistricts: 'Hozircha faol homiladorlik yo‘q.',
  noPatients: 'Bu tumanda faol homiladorlik topilmadi.',
  loadFailed: 'Reyestrni yuklab bo‘lmadi.',
  retry: 'Qayta urinish',
  week: 'hafta',
  dueDate: 'Tug‘ruq',
  computed: 'hisoblangan',
  lastVisit: 'Oxirgi ko‘rik',
  never: 'yo‘q',
  overdue: 'Ko‘rik muddati o‘tgan',
  neverSeen: 'Akusherka ko‘rigi qayd etilmagan',
  notSeenDays: 'kundan beri ko‘rilmagan',
  live: 'Jonli',
  connecting: 'Ulanmoqda...',
  liveDown: 'Jonli yangilanish uzildi',
  reconnect: 'Qayta ulanish',

  viewTable: 'Jadval',
  viewBoard: 'Doska',
  colZone: 'Zona',
  colPatient: 'Bemor',
  colDistrict: 'Tuman',
  colWeek: 'Muddat',
  colDue: 'Tug‘ruq',
  colLastVisit: 'Oxirgi ko‘rik',
  colStatus: 'Holat',
} as const

/** Registering a patient (/patients/new). */
export const NEW_PATIENT_UI = {
  tab: 'Yangi bemor',
  title: 'Yangi bemor',
  subtitle: 'Bemor va uning joriy homiladorligi ro‘yxatga olinadi.',
  fullName: 'F.I.Sh.',
  birthDate: 'Tug‘ilgan sana',
  district: 'Tuman',
  districtHint: 'Yozing yoki ro‘yxatdan tanlang',
  village: 'Mahalla / qishloq',
  phone: 'Telefon',
  optional: 'ixtiyoriy',
  lmpQuestion: 'Homiladorlik muddati',
  lmpModeLmp: 'Oxirgi hayz sanasi ma’lum',
  lmpModeGa: 'Muddati haftada ma’lum',
  lmpModeUnknown: 'Hozircha noma’lum',
  lmpDate: 'Oxirgi hayz sanasi',
  gaWeeks: 'Bugungi muddati',
  gaWeeksUnit: 'hafta',
  gaNote: 'Oxirgi hayz sanasi shu muddatdan hisoblanadi va “hisoblangan” deb belgilanadi.',
  unknownNote: 'Muddat kiritilmasa, ko‘riklar jadvali birinchi baho saqlanganda tuziladi.',
  submit: 'Ro‘yxatga olish',
  submitting: 'Saqlanmoqda...',
  failed: 'Bemor ro‘yxatga olinmadi.',
  createdTitle: 'Bemor ro‘yxatga olindi',
  recordVisit: 'Ko‘rik kiritish',
  openPatient: 'Bemor sahifasi',
  another: 'Yana bemor qo‘shish',
  errName: 'To‘liq ismni kiriting.',
  errBirthDate: 'Tug‘ilgan sanani tekshiring (10–60 yosh).',
  errDistrict: 'Tumanni kiriting.',
  errPhone: 'Telefon raqamini tekshiring.',
  errLmp: 'Sanani tekshiring: kelajakda yoki 45 haftadan oldin bo‘lishi mumkin emas.',
  errGa: 'Muddatni 1 dan 45 gacha butun hafta bilan kiriting.',
} as const

/** Choosing the patient on the entry form. */
export const PICKER_UI = {
  label: 'Bemor',
  placeholder: 'Ism bo‘yicha qidiring',
  searching: 'Qidirilmoqda...',
  noMatch: 'Topilmadi.',
  searchFailed: 'Qidiruv ishlamadi.',
  createNew: 'Yangi bemor qo‘shish',
  change: 'O‘zgartirish',
  required: 'Bemorni tanlang.',
} as const

/**
 * The demo role switch. It changes which tabs are shown and nothing else: it
 * is not a login and not a permission. See README and src/lib/supabase.ts.
 */
export const ROLE_UI = {
  label: 'Rol',
  midwife: 'Akusherka',
  specialist: 'OvaBMU mutaxassisi',
  note: 'Namoyish uchun: faqat menyuni o‘zgartiradi, ruxsat emas.',
} as const

/** A new escalation arriving on a specialist's screen. */
export const ALERT_UI = {
  newEscalation: 'Yangi yo‘llanma',
  open: 'Navbatni ochish',
  dismiss: 'Yopish',
  openCount: 'ochiq yo‘llanma',
  soundOn: 'Ovoz yoqilgan',
  soundOff: 'Ovoz o‘chirilgan',
} as const

/** The patient page (/patients/:pregnancyId). */
export const PATIENT_PAGE_UI = {
  loading: 'Yuklanmoqda...',
  notFound: 'Bunday homiladorlik topilmadi.',
  loadFailed: 'Bemor ma’lumotini yuklab bo‘lmadi.',
  retry: 'Qayta urinish',
  age: 'yosh',
  gravida: 'Gravida',
  para: 'Para',
  week: 'hafta',
  dueDate: 'Tug‘ruq',
  computed: 'hisoblangan',
  notAssessed: 'BAHOLANMAGAN',
  ended: 'Homiladorlik yakunlangan',

  historyTitle: 'Baholar tarixi',
  bpChart: 'Qon bosimi, mm sim. ust.',
  hbChart: 'Gemoglobin, g/L',
  systolic: 'Sistolik',
  diastolic: 'Diastolik',
  noBp: 'Qon bosimi hech bir bahoda qayd etilmagan.',
  noHb: 'Gemoglobin hech bir bahoda qayd etilmagan.',
  noAssessments: 'Hali baho yo‘q.',
  chartHint: 'Grafikdagi ustunni yoki jadval qatorini tanlang — o‘sha bahoning omillari ko‘rsatiladi.',
  score: 'Ball',
  byMidwife: 'Akusherka',
  byPatient: 'Bemorning o‘zi (Telegram)',
  noFactors: 'Xavf omillari aniqlanmagan.',
  colDate: 'Sana',
  colZone: 'Zona',
  colBp: 'Qon bosimi',
  colHb: 'Gemoglobin',
  colScore: 'Ball',
  colBy: 'Kim qayd etgan',

  escalationsTitle: 'Yo‘llanmalar tarixi',
  noEscalations: 'Yo‘llanma ochilmagan.',
  created: 'Ochilgan',
  acknowledged: 'Qabul qilingan',
  closed: 'Yopilgan',
  referredTo: 'Yo‘naltirilgan joy',
  resolution: 'Yakuniy izoh',

  scheduleRecordedLmp: 'Oxirgi hayz sanasi (qayd etilgan)',
  scheduleEstimatedLmp: 'Oxirgi hayz sanasi (homiladorlik muddatidan hisoblangan)',
  scheduleLmp: 'Oxirgi hayz sanasi',
  scheduleNoZone: 'Ko‘riklar jadvali zonaga bog‘liq; bu homiladorlik hali baholanmagan.',

  telegramTitle: 'Bemorning Telegram xabarlari',
  noReports: 'Bemor hali xabar yubormagan.',
  escalated: 'Yo‘llanma ochildi',
  unprocessed: 'Qayta ishlanmagan — xavf belgilari tekshirilmagan, o‘qing',
} as const

/** How the patient channel triaged each message, for the clinician reading it. */
export const TRIAGE_LEVEL_LABELS = {
  immediate: 'Darhol — WHO xavf belgisi',
  prompt: 'Tez orada ko‘rik',
  none: 'Ro‘yxatdagi belgi yo‘q',
} as const

/**
 * A fired factor or a reported danger sign, as a sentence a clinician reads.
 * Both kinds of code can sit in one fired_factors list: a patient's own report
 * carries danger signs next to the point-table factors.
 */
export function describeFactor(code: string): string {
  return (
    FACTOR_SENTENCES[code as RiskFactor] ?? DANGER_SIGN_NAMES[code as DangerSign] ?? code
  )
}

export const NOT_FOUND_UI = {
  title: 'Sahifa topilmadi.',
  home: 'Bosh sahifa',
} as const

/** The specialist dashboard (/dashboard). */
export const DASHBOARD_UI = {
  title: 'Boshqaruv paneli',
  subtitle: 'Barcha tumanlar bo‘yicha joriy holat — jonli yangilanadi.',
  updated: 'Yangilandi',
  loadFailed: 'Panelni yuklab bo‘lmadi.',

  tileActive: 'Faol homiladorlik',
  tileQizil: 'Qizil zonada',
  tileQizilOf: 'faollarning',
  tileOpen: 'Ochiq yo‘llanma',
  tileOldest: 'eng eskisi',
  tileNoneOpen: 'hammasi ko‘rib chiqilgan',
  tileAvgAck: 'O‘rtacha qabul vaqti',
  tileAvgAckNote: 'oxirgi 30 kun',
  tileOverdue: 'Ko‘rik muddati o‘tgan',
  tileTelegram: 'Telegramga ulangan',
  tileTelegramNote: 'bemor chati',

  zonesTitle: 'Tumanlar bo‘yicha zonalar',
  zonesNote: 'Har bir ustun bitta zona — ranglar bir-biriga tegmaydi, zona joylashuvidan o‘qiladi.',
  tableView: 'Jadval ko‘rinishi',

  activityTitle: 'Oxirgi 14 kun',
  assessmentsPerDay: 'Baholar, kuniga',
  escalationsPerDay: 'Yangi yo‘llanmalar, kuniga',
  day: 'Kun',

  attentionTitle: 'Diqqat talab qiladi',
  attentionNote: 'Qizil zonadagilar va ko‘rigi o‘tib ketganlar',
  attentionEmpty: 'Hozir diqqat talab qiladigan bemor yo‘q.',
  seeAll: 'Hammasi',

  feedTitle: 'So‘nggi faollik',
  feedEmpty: 'Hali faollik yo‘q.',
  feedAssessment: 'Baho saqlandi',
  feedAssessmentPatient: 'Bemor uydan yubordi',
  feedEscalationClinic: 'Yo‘llanma ochildi (klinika)',
  feedEscalationTelegram: 'Yo‘llanma ochildi (Telegram)',
  feedTelegram: 'Telegram xabari',
  feedTelegramUnprocessed: 'Telegram xabari — qayta ishlanmagan',
  ago: 'oldin',
} as const

/** The specialist's shell: its nav and its bell. */
export const NAV_UI = {
  dashboard: 'Panel',
  registry: 'Reyestr',
  escalations: 'Yo‘llanmalar',
  patients: 'Bemorlar',
  bell: 'Ochiq yo‘llanmalar',
} as const

/** The patient list (/patients). */
export const PATIENTS_UI = {
  title: 'Bemorlar',
  subtitle: 'Barcha tumanlardagi faol homiladorliklar.',
  search: 'Ism bo‘yicha qidirish',
  none: 'Faol homiladorlik topilmadi.',
  truncated: 'Birinchi 200 tasi ko‘rsatildi — qidiruvdan foydalaning.',
} as const

/** The doctor's escalation queue. */
export const QUEUE_UI = {
  tabEntry: 'Yangi qayd',
  tabQueue: 'Shifokor navbati',
  title: 'Ochiq yo‘llanmalar',
  refresh: 'Yangilash',
  loading: 'Yuklanmoqda...',
  empty: 'Hech qanday ochiq signal yo‘q.',
  emptyNote: 'Yangi yo‘llanma paydo bo‘lsa, shu yerda va qo‘ng‘iroqchada ko‘rinadi.',
  loadFailed: 'Navbatni yuklab bo‘lmadi.',
  patientWords: 'Bemorning o‘z so‘zlari',
  code: 'Kod',
  truncated: 'Hammasi sig‘madi: har holatdan 100 tadan ko‘rsatildi, eng uzoq kutayotgan ochiqlar birinchi. Yuqoridagi sonlar — to‘liq.',
  patientPage: 'Bemor sahifasi',

  acknowledge: 'Qabul qilish',
  close: 'Yopish',
  working: 'Saqlanmoqda...',
  resolutionNote: 'Yakuniy izoh',
  notePlaceholder: 'Nima qilindi: ko‘rildi, yo‘naltirildi, qo‘ng‘iroq qilindi...',
  noteRequired: 'Yopish uchun nima qilinganini yozing.',
  actionFailed: 'Saqlanmadi',
  alreadyHandled: 'Bu yo‘llanmani boshqa xodim allaqachon ko‘rib chiqqan. Ro‘yxat yangilandi.',
  acknowledgedAfter: 'dan keyin qabul qilindi',

  statOpen: 'Ochiq',
  statAcknowledged: 'Qabul qilingan',
  statAvgAck: 'O‘rtacha qabul vaqti',
  statAvgAckWindow: 'oxirgi 30 kun',
  statNone: '—',

  justNow: 'hozirgina',
  minutes: 'daq',
  hours: 'soat',
  days: 'kun',
} as const

export const ESCALATION_SOURCE_LABELS = {
  telegram: 'Telegram',
  clinic: 'Klinika',
} as const

export const ESCALATION_STATUS_LABELS: Record<string, string> = {
  ochiq: 'Ochiq',
  qabul: 'Qabul qilingan',
  yopiq: 'Yopilgan',
  bekor: 'Bekor qilingan',
}
