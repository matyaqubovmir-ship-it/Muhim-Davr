/**
 * Demo data for Muhim Davr: synthetic women across five Xorazm districts, in
 * every zone, with the history a specialist would actually see.
 *
 *   npm run seed                 dry run: prints what would be written, writes nothing
 *   npm run seed -- --apply      writes it
 *   npm run demo:worsen          the live demo moment: DEMO_PATIENT's next visit, red
 *   npm run seed -- --retire     takes every demo pregnancy off the registry
 *
 * EVERY ROW IS SYNTHETIC AND SAYS SO. Each patient carries SEED_MARK in
 * patients.address_note and each assessment carries SEED_NOTE in its note. No
 * name, date of birth or reading belongs to a real woman. No phone number, no
 * national id, and no Telegram chat is linked, so nothing here can message
 * anyone.
 *
 * NOTHING HERE DECIDES A ZONE. Each visit is a set of readings; the zone,
 * score and fired factors come from scoreAssessment, the escalation row from
 * clinicEscalationRow, the planned visits from generateSchedule through
 * replace_planned_visits, and the Telegram case goes through the bot's own
 * handleSelfReport with a fixed extractor in place of the model. The expected
 * zone written beside each visit is a check on the data, not an input: the
 * dry run fails if the scorer disagrees with it.
 *
 * WHY --retire AND NOT DELETE. assessments is append-only (001_schema.sql), so
 * a seeded visit cannot be removed. --retire closes each demo pregnancy with
 * an outcome, which takes it out of every registry view, and cancels its live
 * escalations as created in error ('bekor'), which takes them out of the queue.
 */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseStore } from '../bot/store.ts'
import { handleSelfReport } from '../bot/self-report.ts'
import type { DangerSignExtraction } from '../bot/extract.ts'
import {
  toAssessmentRow,
  toScoringInput,
  type BooleanFormValues,
  type NumericFormValues,
} from '../src/lib/assessment-row.ts'
import type { DangerSignReport } from '../src/lib/danger-signs.ts'
import { clinicEscalationRow, escalates } from '../src/lib/escalation.ts'
import { decidePatientReport } from '../src/lib/patient-report.ts'
import { scoreAssessment, type RiskResult, type RiskZone } from '../src/lib/risk.ts'
import { addDays, formatISODate, generateSchedule, upcomingVisitRows } from '../src/lib/schedule.ts'

export const SEED_MARK = 'DEMO — sintetik maʼlumot (npm run seed)'
export const SEED_NOTE = 'Demo: sintetik maʼlumot'

/** The woman whose next visit turns red on stage. Her name is what the presenter types. */
export const DEMO_PATIENT = 'Oydin Karimova'

// --- the women ---------------------------------------------------------------------

interface Visit {
  daysAgo: number
  /** Minutes before now, for a visit today. Ignored otherwise. */
  minutesAgo?: number
  ga: number
  bp: [number, number]
  hb: number
  proteinuria?: boolean
  edema?: boolean
  headache?: boolean
  /** What scoreAssessment is expected to say. Checked, never written. */
  expect: RiskZone
  /** For a qizil visit: what happened to the escalation it raised. */
  escalation?: {
    ackAfterMinutes?: number
    closedAfterHours?: number
    resolution?: string
  }
}

interface History {
  prior_caesarean?: boolean
  prior_preeclampsia?: boolean
  chronic_hypertension?: boolean
  prior_stillbirth_or_neonatal_death?: boolean
  multiple_gestation?: boolean
  birthIntervalMonths?: number
  travelMinutes?: number
  bmi?: number
}

interface SeedPatient {
  name: string
  age: number
  district: string
  village: string
  gravida: number
  para: number
  history?: History
  /** Days ago she was registered, for a woman with no visit yet. */
  registeredDaysAgo?: number
  /** Gestational age at registration, for a woman with no visit yet. */
  gaAtRegistration?: number
  visits: Visit[]
  /** A message she sends the bot after her last clinic visit. */
  telegram?: { text: string; signs: DangerSignReport; expect: RiskZone }
}

export const PATIENTS: SeedPatient[] = [
  {
    name: 'Dilnoza Otajonova',
    age: 24, district: 'Urganch', village: 'Beshariq', gravida: 2, para: 1,
    history: { birthIntervalMonths: 40 },
    visits: [
      { daysAgo: 31, ga: 28, bp: [126, 80], hb: 114, proteinuria: false, expect: 'yashil' },
      { daysAgo: 0, minutesAgo: 35, ga: 32, bp: [150, 100], hb: 108, proteinuria: true, edema: true, headache: true, expect: 'qizil', escalation: {} },
    ],
  },
  {
    name: 'Madina Sobirova',
    age: 29, district: 'Xiva', village: 'Sayot', gravida: 3, para: 2,
    history: { birthIntervalMonths: 30 },
    visits: [
      { daysAgo: 30, ga: 20, bp: [112, 72], hb: 92, proteinuria: false, expect: 'yashil' },
      { daysAgo: 2, ga: 24, bp: [110, 70], hb: 64, proteinuria: false, expect: 'qizil', escalation: { ackAfterMinutes: 22 } },
    ],
  },
  {
    name: 'Nigora Yusupova',
    age: 31, district: 'Gurlan', village: 'Vazir', gravida: 2, para: 1,
    history: { prior_caesarean: true, birthIntervalMonths: 36 },
    visits: [{ daysAgo: 9, ga: 30, bp: [136, 86], hb: 104, proteinuria: false, expect: 'sariq' }],
    telegram: {
      text: 'Qorin pastim ogʻriyapti, ozgina qon kelyapti',
      signs: { vaginal_bleeding: true, severe_abdominal_pain: null, convulsions: null },
      expect: 'qizil',
    },
  },
  {
    name: 'Shahnoza Rahimova',
    age: 37, district: 'Urganch', village: 'Chandir', gravida: 4, para: 3,
    history: { prior_caesarean: true, birthIntervalMonths: 48 },
    visits: [{ daysAgo: 6, ga: 22, bp: [124, 78], hb: 116, proteinuria: false, expect: 'sariq' }],
  },
  {
    name: 'Feruza Matyoqubova',
    age: 27, district: 'Xiva', village: 'Shomahulum', gravida: 1, para: 0,
    visits: [
      { daysAgo: 20, ga: 29, bp: [132, 84], hb: 118, proteinuria: false, expect: 'yashil' },
      { daysAgo: 4, ga: 31, bp: [142, 92], hb: 116, proteinuria: false, edema: true, expect: 'sariq' },
    ],
  },
  {
    name: 'Zarina Qurbonova',
    age: 33, district: 'Hazorasp', village: 'Xalqobod', gravida: 5, para: 4,
    history: { birthIntervalMonths: 18 },
    visits: [{ daysAgo: 40, ga: 20, bp: [118, 76], hb: 100, proteinuria: false, expect: 'sariq' }],
  },
  {
    name: 'Malika Ismoilova',
    age: 19, district: 'Shovot', village: 'Ipakchi', gravida: 1, para: 0,
    history: { travelMinutes: 75 },
    visits: [{ daysAgo: 3, ga: 17, bp: [108, 68], hb: 96, proteinuria: false, expect: 'sariq' }],
  },
  {
    name: DEMO_PATIENT,
    age: 26, district: 'Urganch', village: 'Chandir', gravida: 2, para: 1,
    history: { birthIntervalMonths: 34 },
    visits: [
      { daysAgo: 43, ga: 23, bp: [124, 80], hb: 118, proteinuria: false, expect: 'yashil' },
      { daysAgo: 22, ga: 26, bp: [134, 86], hb: 116, proteinuria: false, expect: 'yashil' },
      { daysAgo: 8, ga: 28, bp: [142, 90], hb: 114, proteinuria: false, expect: 'sariq' },
    ],
  },
  {
    name: 'Gulchehra Xudoyberganova',
    age: 25, district: 'Urganch', village: 'Beshariq', gravida: 2, para: 1,
    history: { birthIntervalMonths: 38 },
    visits: [{ daysAgo: 10, ga: 18, bp: [118, 76], hb: 124, proteinuria: false, expect: 'yashil' }],
  },
  {
    name: 'Sevara Bekchanova',
    age: 22, district: 'Xiva', village: 'Sayot', gravida: 2, para: 1,
    history: { birthIntervalMonths: 30 },
    visits: [{ daysAgo: 5, ga: 13, bp: [112, 70], hb: 121, proteinuria: false, expect: 'yashil' }],
  },
  {
    name: 'Mohira Davletova',
    age: 28, district: 'Gurlan', village: 'Vazir', gravida: 3, para: 2,
    history: { birthIntervalMonths: 36 },
    visits: [{ daysAgo: 12, ga: 22, bp: [120, 78], hb: 118, proteinuria: false, expect: 'yashil' }],
  },
  {
    name: 'Umida Sapayeva',
    age: 30, district: 'Shovot', village: 'Kat', gravida: 2, para: 1,
    history: { birthIntervalMonths: 44 },
    visits: [{ daysAgo: 2, ga: 34, bp: [116, 74], hb: 126, proteinuria: false, expect: 'yashil' }],
  },
  {
    name: 'Barno Jumaniyozova',
    age: 23, district: 'Hazorasp', village: 'Xalqobod', gravida: 1, para: 0,
    registeredDaysAgo: 1,
    gaAtRegistration: 11,
    visits: [],
  },
  {
    name: 'Kamola Allaberganova',
    age: 32, district: 'Shovot', village: 'Ipakchi', gravida: 3, para: 2,
    history: { birthIntervalMonths: 28 },
    visits: [
      {
        daysAgo: 29, ga: 25, bp: [162, 108], hb: 112, proteinuria: false, expect: 'qizil',
        escalation: {
          ackAfterMinutes: 41,
          closedAfterHours: 20,
          resolution: 'Tuman tugʻruq kompleksida koʻrildi; bosim nazoratga olindi, kuzatuv davom etadi.',
        },
      },
      { daysAgo: 15, ga: 27, bp: [136, 84], hb: 114, proteinuria: false, expect: 'yashil' },
      { daysAgo: 1, ga: 29, bp: [128, 82], hb: 116, proteinuria: false, expect: 'yashil' },
    ],
  },
]

/** Her next visit, recorded live: the reading that makes the registry turn red. */
export const WORSENING_VISIT = { bp: [164, 112] as [number, number], hb: 112, proteinuria: true, edema: true, headache: true }

// --- from readings to rows, through the app's own code ---------------------------------

/** The midwife form's two maps, from one visit's readings. Every history item is recorded, true or false. */
export function formValues(p: SeedPatient, v: Pick<Visit, 'ga' | 'bp' | 'hb' | 'proteinuria'>) {
  const h = p.history ?? {}
  const numbers: NumericFormValues = {
    age: String(p.age),
    gravida: String(p.gravida),
    para: String(p.para),
    gestational_age_weeks: String(v.ga),
    bp_systolic: String(v.bp[0]),
    bp_diastolic: String(v.bp[1]),
    hemoglobin: String(v.hb),
    missed_visits: '0',
    travel_minutes_to_facility: String(h.travelMinutes ?? 25),
  }
  if (h.birthIntervalMonths !== undefined) numbers.birth_interval_months = String(h.birthIntervalMonths)
  if (h.bmi !== undefined) numbers.bmi = String(h.bmi)
  const booleans: BooleanFormValues = {
    proteinuria: v.proteinuria ?? null,
    antepartum_bleeding: false,
    prior_preeclampsia: h.prior_preeclampsia ?? false,
    chronic_hypertension: h.chronic_hypertension ?? false,
    diabetes: false,
    kidney_disease: false,
    prior_stillbirth_or_neonatal_death: h.prior_stillbirth_or_neonatal_death ?? false,
    multiple_gestation: h.multiple_gestation ?? false,
    prior_caesarean: h.prior_caesarean ?? false,
    family_history_preeclampsia: false,
  }
  return { numbers, booleans }
}

export function scoreVisit(p: SeedPatient, v: Pick<Visit, 'ga' | 'bp' | 'hb' | 'proteinuria'>): RiskResult {
  const { numbers, booleans } = formValues(p, v)
  return scoreAssessment(toScoringInput(numbers, booleans))
}

/** The LMP that puts her at `ga` weeks and three days on the day of her latest visit. */
export function lmpFor(p: SeedPatient, today: Date): Date {
  const anchor = p.visits.at(-1)
  if (anchor === undefined) return addDays(today, -((p.gaAtRegistration ?? 10) * 7 + 3 + (p.registeredDaysAgo ?? 0)))
  return addDays(today, -(anchor.daysAgo + anchor.ga * 7 + 3))
}

function birthDate(age: number, today: Date): string {
  // Mid-year, so the age is right on every visit in the last few months.
  return `${today.getFullYear() - age - 1}-${String(today.getMonth() + 1).padStart(2, '0')}-01`
}

/** A backdated visit at 10:00 local that day; a visit today, `minutesAgo` before now. */
function visitMoment(v: Visit, now: Date, order: number): Date {
  if (v.daysAgo === 0) return new Date(now.getTime() - (v.minutesAgo ?? 30) * 60_000)
  const day = addDays(now, -v.daysAgo)
  day.setHours(10, order * 7)
  return day
}

/**
 * Today for visit_date. assessments_visit_not_future compares with the
 * database's current_date, which is UTC — from midnight to 05:00 in Tashkent
 * that is still yesterday, and today's local date would be refused.
 */
function dbToday(now: Date): string {
  const local = formatISODate(now)
  const utc = now.toISOString().slice(0, 10)
  return local < utc ? local : utc
}

// --- dry run -------------------------------------------------------------------------

/** Every visit scored, and each woman's first planned contact after her last visit. Throws if a zone is not the one expected. */
export function plan(today: Date) {
  const lines: string[] = []
  const mismatches: string[] = []
  for (const p of PATIENTS) {
    const lmp = lmpFor(p, today)
    const zones = p.visits.map((v) => {
      const result = scoreVisit(p, v)
      if (result.zone !== v.expect) mismatches.push(`${p.name}, ${v.daysAgo} days ago: scored ${result.zone}, expected ${v.expect}`)
      return `${result.zone}(${result.score})`
    })
    if (p.telegram) {
      const zone = decidePatientReport(p.telegram.signs, null).zone
      if (zone !== p.telegram.expect) mismatches.push(`${p.name}, Telegram: expected ${p.telegram.expect}`)
      zones.push(`telegram→${p.telegram.expect}`)
    }
    const last = p.visits.at(-1)
    let next = '—'
    if (last !== undefined) {
      const visitDay = addDays(today, -last.daysAgo)
      const lastZone = scoreVisit(p, last).zone
      const rows = upcomingVisitRows(generateSchedule({ lmpDate: lmp, currentZone: lastZone, today: visitDay }), visitDay)
      const first = rows[0]?.target_date
      next = first === undefined ? 'none' : `${first}${first < formatISODate(today) ? ' OVERDUE' : ''}`
    }
    lines.push(`${p.name.padEnd(26)} ${p.district.padEnd(9)} ${zones.join(' → ').padEnd(44)} next: ${next}`)
  }
  if (mismatches.length > 0) throw new Error('The scorer disagrees with the demo data:\n  ' + mismatches.join('\n  '))
  return lines
}

// --- writes --------------------------------------------------------------------------

async function connect(): Promise<SupabaseClient> {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set (npm run seed loads .env.local).')
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  // Anonymous, like the app: the seed is written as `authenticated` under the same RLS.
  const { error } = await db.auth.signInAnonymously()
  if (error) throw new Error(`Could not sign in: ${error.message}`)
  return db
}

async function seededActivePregnancies(db: SupabaseClient): Promise<{ id: string; name: string }[]> {
  const { data, error } = await db
    .from('pregnancies')
    .select('id, patients!inner(full_name, address_note)')
    .eq('is_active', true)
    .eq('patients.address_note', SEED_MARK)
  if (error) throw new Error(`Could not look for earlier demo data: ${error.message}`)
  return (data ?? []).map((row) => {
    const patient = Array.isArray(row.patients) ? row.patients[0] : row.patients
    return { id: String(row.id), name: String((patient as { full_name: string }).full_name) }
  })
}

async function insertAssessment(db: SupabaseClient, pregnancyId: string, p: SeedPatient, v: Visit, at: Date, visitDate: string) {
  const { numbers, booleans } = formValues(p, v)
  const result = scoreAssessment(toScoringInput(numbers, booleans))
  const unscored = { edema: v.edema ?? false, headache_or_visual: v.headache ?? false }
  const row = toAssessmentRow(pregnancyId, numbers, booleans, unscored, result, { extractedJson: null, correctedByHuman: false })
  const { data, error } = await db
    .from('assessments')
    .insert({ ...row, visit_date: visitDate, created_at: at.toISOString(), note: SEED_NOTE })
    .select('id')
    .single()
  if (error) throw new Error(`${p.name}: assessment insert failed: ${error.message}`)
  return { id: String(data.id), result }
}

async function insertEscalation(
  db: SupabaseClient,
  assessmentId: string,
  pregnancyId: string,
  result: RiskResult,
  at: Date,
  fate: NonNullable<Visit['escalation']>,
) {
  const created = new Date(at.getTime() + 60_000)
  const acknowledged = fate.ackAfterMinutes === undefined ? null : new Date(created.getTime() + fate.ackAfterMinutes * 60_000)
  const closed =
    acknowledged === null || fate.closedAfterHours === undefined ? null : new Date(created.getTime() + fate.closedAfterHours * 3_600_000)
  const { error } = await db.from('escalations').insert({
    ...clinicEscalationRow(assessmentId, pregnancyId, result),
    created_at: created.toISOString(),
    status: closed ? 'yopiq' : acknowledged ? 'qabul' : 'ochiq',
    acknowledged_at: acknowledged?.toISOString() ?? null,
    closed_at: closed?.toISOString() ?? null,
    resolution_note: closed ? (fate.resolution ?? null) : null,
  })
  if (error) throw new Error(`escalation insert failed: ${error.message}`)
}

/** replace_planned_visits as the app calls it after a save — with that visit's day as today. */
async function saveSchedule(db: SupabaseClient, pregnancyId: string, assessmentId: string, lmp: Date, zone: RiskZone, day: Date) {
  const schedule = generateSchedule({ lmpDate: lmp, currentZone: zone, today: day })
  const { error } = await db.rpc('replace_planned_visits', {
    p_pregnancy_id: pregnancyId,
    p_today: formatISODate(day),
    p_assessment_id: assessmentId,
    p_visits: upcomingVisitRows(schedule, day),
  })
  if (error) throw new Error(`schedule write failed: ${error.message}`)
}

async function seedPatient(db: SupabaseClient, p: SeedPatient, now: Date): Promise<string> {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const lmp = lmpFor(p, today)

  const { data: pregnancyId, error } = await db.rpc('register_patient', {
    p_full_name: p.name,
    p_birth_date: birthDate(p.age, today),
    p_district: p.district,
    p_village: p.village,
    p_phone: null,
    p_lmp_date: formatISODate(lmp),
    p_lmp_estimated: false,
  })
  if (error) throw new Error(`${p.name}: register_patient failed: ${error.message}`)
  const id = String(pregnancyId)

  const { data: pregnancy, error: readError } = await db.from('pregnancies').select('patient_id').eq('id', id).single()
  if (readError) throw new Error(`${p.name}: could not read the new pregnancy: ${readError.message}`)
  const marks = await Promise.all([
    db.from('patients').update({ address_note: SEED_MARK }).eq('id', pregnancy.patient_id),
    db.from('pregnancies').update({ gravida: p.gravida, para: p.para }).eq('id', id),
  ])
  for (const m of marks) if (m.error) throw new Error(`${p.name}: could not mark as demo data: ${m.error.message}`)

  let last: { id: string; result: RiskResult; day: Date } | null = null
  for (const [i, v] of p.visits.entries()) {
    const at = visitMoment(v, now, i)
    const visitDate = v.daysAgo === 0 ? dbToday(now) : formatISODate(at)
    const saved = await insertAssessment(db, id, p, v, at, visitDate)
    if (v.escalation !== undefined && escalates(saved.result.zone)) {
      await insertEscalation(db, saved.id, id, saved.result, at, v.escalation)
    }
    last = { ...saved, day: addDays(today, -v.daysAgo) }
  }
  if (last !== null) await saveSchedule(db, id, last.id, lmp, last.result.zone, last.day)

  if (p.telegram !== undefined) {
    const { signs, text } = p.telegram
    // The bot's own path, with a fixed extractor where the model would be.
    const extract = async (): Promise<DangerSignExtraction> => ({
      signs,
      bp: null,
      raw: { demo: true, izoh: 'Sintetik demo xabari — model chaqirilmagan', signs },
    })
    await handleSelfReport(createSupabaseStore(db), extract, { pregnancyId: id, telegramChatId: 0 }, text)
  }
  return id
}

async function worsen(db: SupabaseClient, now: Date) {
  const p = PATIENTS.find((x) => x.name === DEMO_PATIENT)!
  const found = (await seededActivePregnancies(db)).find((x) => x.name === DEMO_PATIENT)
  if (found === undefined) throw new Error(`${DEMO_PATIENT} is not in the database. Run npm run seed -- --apply first.`)

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const { data: preg, error } = await db.from('pregnancies').select('lmp_date').eq('id', found.id).single()
  if (error || typeof preg.lmp_date !== 'string') throw new Error(`Could not read her LMP: ${error?.message ?? 'none recorded'}`)
  const lmp = new Date(`${preg.lmp_date}T00:00:00`)
  const ga = Math.floor((today.getTime() - lmp.getTime()) / (7 * 86_400_000))

  const visit: Visit = { daysAgo: 0, minutesAgo: 0, ga, ...WORSENING_VISIT, expect: 'qizil' }
  const saved = await insertAssessment(db, found.id, p, visit, now, dbToday(now))
  if (escalates(saved.result.zone)) await insertEscalation(db, saved.id, found.id, saved.result, new Date(now.getTime() - 60_000), {})
  await saveSchedule(db, found.id, saved.id, lmp, saved.result.zone, today)
  console.log(`${DEMO_PATIENT}: ${saved.result.zone} (${saved.result.score}) — ${saved.result.firedFactors.join(', ')}`)
  console.log(escalates(saved.result.zone) ? 'Escalation raised: it is on /escalations and the bell now.' : 'No escalation: not qizil.')
}

async function retire(db: SupabaseClient, now: Date) {
  const pregnancies = await seededActivePregnancies(db)
  const ids = pregnancies.map((p) => p.id)
  if (ids.length === 0) {
    console.log('No active demo pregnancies. Nothing to retire.')
    return
  }
  const closed = now.toISOString()
  const cancel = await db
    .from('escalations')
    .update({ status: 'bekor', closed_at: closed, resolution_note: 'Demo maʼlumoti — olib tashlandi' })
    .in('pregnancy_id', ids)
    .in('status', ['ochiq', 'qabul'])
  if (cancel.error) throw new Error(`Could not cancel demo escalations: ${cancel.error.message}`)
  const close = await db
    .from('pregnancies')
    .update({ is_active: false, outcome: 'Demo maʼlumoti — olib tashlandi', outcome_date: formatISODate(now) })
    .in('id', ids)
  if (close.error) throw new Error(`Could not close demo pregnancies: ${close.error.message}`)
  console.log(`Retired ${ids.length} demo pregnancies and cancelled their live escalations.`)
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  if (args.has('--worsen')) return worsen(await connect(), now)
  if (args.has('--retire')) return retire(await connect(), now)

  const lines = plan(today)
  console.log(`${PATIENTS.length} synthetic women, every zone checked against scoreAssessment:\n`)
  for (const line of lines) console.log('  ' + line)

  if (!args.has('--apply')) {
    console.log('\nDry run: nothing was written. Run `npm run seed -- --apply` to write it.')
    return
  }

  const db = await connect()
  const existing = await seededActivePregnancies(db)
  if (existing.length > 0) {
    throw new Error(
      `${existing.length} demo pregnancies are already active, so the seed has run. ` +
        'Run `npm run seed -- --retire` first to seed a fresh set.',
    )
  }
  for (const p of PATIENTS) {
    await seedPatient(db, p, now)
    console.log(`  written: ${p.name}`)
  }
  console.log(`\nDone. On stage: open /entry, pick "${DEMO_PATIENT}", type 164/112 with protein in the urine —`)
  console.log('or run `npm run demo:worsen` to record that visit from here.')
}

// Only when run, not when a test imports this file.
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((caught: unknown) => {
    console.error(caught instanceof Error ? caught.message : String(caught))
    process.exitCode = 1
  })
}
