/**
 * Function 6 — the questions after a contact nobody recorded.
 *
 * The morning after a planned contact whose day passed with no visit entered,
 * bot/missed-visits.ts tells her so and opens this survey: her blood pressure,
 * then the WHO danger signs one at a time, then anything else she wants to say.
 *
 * NOTHING HERE DECIDES ANYTHING. Each yes/no question is one sign from
 * src/lib/danger-signs.ts and its answer is that sign's three-state value; the
 * blood pressure is two numbers. Both go to decidePatientReport, exactly as a
 * free-text report does — and are written by the same recordPatientReport — so
 * which answers are an emergency is the WHO list's and the point table's
 * decision, never this file's and never a model's. There is no model in this
 * path at all: a pressed button needs no reading.
 *
 * AN EMERGENCY ENDS THE SURVEY. The moment her answers make the report red — a
 * sign on the immediate list, or a reading of 160/110 and above — she gets the
 * go-now reply and the escalation is raised. She is not asked about swelling
 * while she is bleeding.
 *
 * NOTHING SHE WRITES IS DROPPED. A message that is not an answer to the question
 * ("qonim ketyapti", a sentence, a question) is handled as an ordinary report
 * first — triaged, recorded, replied to — and then the question is asked again.
 *
 * UNANSWERED IS NOT "NO". answers holds only what she answered. A survey that
 * stops early, or runs out of time (24 hours), records what she did answer and
 * shows every other question as "javob berilmadi".
 */

import type { DangerSign, DangerSignReport } from '../src/lib/danger-signs.ts'
import { DANGER_SIGN_NAMES, SURVEY_SUMMARY } from '../src/lib/labels.ts'
import { decidePatientReport, type HomeBloodPressure } from '../src/lib/patient-report.ts'
import type { ExtractDangerSigns } from './extract.ts'
import { asksAboutMedicine } from './medicine.ts'
import { SURVEY } from './messages.ts'
import { composeReportReply, handleSelfReportDetailed, recordPatientReport, type RecordedReport } from './self-report.ts'
import type { BotStore, LinkedChannel, OpenSurvey, SurveyClose } from './store.ts'
import type { Keyboard, Outgoing } from './telegram.ts'

/** Every sign on the WHO list, in the order she is asked. */
export const SURVEY_SIGNS = [
  'vaginal_bleeding',
  'abdominal_pain',
  'severe_abdominal_pain',
  'severe_headache_with_blurred_vision',
  'fast_or_difficult_breathing',
  'convulsions',
  'fever',
  'fever_unable_to_rise',
  'swelling_face_hands_legs',
  'feeling_unwell',
] as const satisfies readonly DangerSign[]

export type SurveySign = (typeof SURVEY_SIGNS)[number]
export type SurveyStep = 'bp' | SurveySign | 'other'

export const SURVEY_STEPS: readonly SurveyStep[] = ['bp', ...SURVEY_SIGNS, 'other']

/**
 * Follow-ups, asked only after a "Ha" to the question named. Severe abdominal
 * pain is an emergency and abdominal pain is not; asking "is it severe?" only
 * of a woman who has pain keeps the list short for everyone else.
 */
const FOLLOW_UP_OF: Partial<Record<SurveyStep, SurveyStep>> = {
  severe_abdominal_pain: 'abdominal_pain',
  fever_unable_to_rise: 'fever',
}

/** How long a survey waits for her before closing with what she answered. */
export const SURVEY_TTL_HOURS = 24

/** Longest "anything else" text kept on the survey itself; her full words are on their own report. */
const MAX_OTHER_LENGTH = 1000

export type SurveyAnswers = Record<string, unknown>

function isStep(step: string): step is SurveyStep {
  return (SURVEY_STEPS as readonly string[]).includes(step)
}

/** The question after `after`, skipping follow-ups whose question was not answered "Ha". */
export function nextStep(after: SurveyStep, answers: SurveyAnswers): SurveyStep | null {
  for (let i = SURVEY_STEPS.indexOf(after) + 1; i < SURVEY_STEPS.length; i++) {
    const step = SURVEY_STEPS[i]
    const parent = FOLLOW_UP_OF[step]
    if (parent !== undefined && answers[parent] !== true) continue
    return step
  }
  return null
}

/** One question, with the buttons that answer it. */
export function question(step: SurveyStep): Outgoing {
  const keyboard: Keyboard =
    step === 'bp' ? [[SURVEY.cannotMeasure]] : step === 'other' ? [[SURVEY.no]] : [[SURVEY.yes, SURVEY.no]]
  return { text: SURVEY.questions[step], keyboard }
}

/** The notice, the introduction and the first question, as one message so the buttons sit under it. */
export function openingMessage(notice: string): Outgoing {
  const first = question(SURVEY_STEPS[0])
  return { text: [notice, SURVEY.intro, first.text].join('\n\n'), keyboard: first.keyboard }
}

// --- reading an answer ------------------------------------------------------

/** Lower case, one kind of apostrophe, no punctuation, single spaces. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʻʼ`´]/g, "'")
    .replace(/[.!,;:?()«»"]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const YES = new Set(['ha', 'xa', 'ha bor', 'bor', 'ha ha', 'да', 'есть'])
const NO = new Set(["yo'q", 'yoq', "yo'k", 'yuq', "yo'q yo'q", 'нет'])

/** True for yes, false for no, null when the message is not one of the two. */
export function parseYesNo(text: string): boolean | null {
  const said = normalise(text)
  if (YES.has(said)) return true
  if (NO.has(said)) return false
  return null
}

const CANNOT_MEASURE = new Set([
  normalise(SURVEY.cannotMeasure),
  "o'lchay olmadim",
  "o'lchamadim",
  'bilmayman',
  "yo'q",
  'yoq',
])

export type BpAnswer =
  | { kind: 'reading'; bp: HomeBloodPressure }
  | { kind: 'cannot_measure' }
  /** Two numbers that cannot be a reading: asked again, never stored. */
  | { kind: 'not_a_reading' }
  /** Not an answer to this question at all. */
  | { kind: 'unrecognised' }

/**
 * "120/80", "120 80", "120-80", "120 ga 80", "bosim 120/80", "120/80 mm".
 * Two numbers need a separator: "12080" is not guessed at.
 */
export function parseBpAnswer(text: string): BpAnswer {
  const said = normalise(text)
  if (CANNOT_MEASURE.has(said)) return { kind: 'cannot_measure' }

  const match = /^(?:(?:qon )?bosim(?:im)? )?(\d{2,3})(?:\s*(?:\/|\\|-|ga|na)\s*|\s+)(\d{2,3})(?: ?(?:mm|мм)\S*(?: \S+)?)?$/.exec(said)
  if (match === null) return { kind: 'unrecognised' }

  const systolic = Number(match[1])
  const diastolic = Number(match[2])
  // The same bounds as assessments_bp_sane, and the first number is the larger.
  const plausible =
    systolic >= 50 && systolic <= 300 && diastolic >= 20 && diastolic <= 200 && systolic > diastolic
  return plausible ? { kind: 'reading', bp: { systolic, diastolic } } : { kind: 'not_a_reading' }
}

// --- what the answers mean ----------------------------------------------------

/** The signs she answered, three-state; a question never answered stays out. */
export function signsFrom(answers: SurveyAnswers): DangerSignReport {
  const signs: DangerSignReport = {}
  for (const sign of SURVEY_SIGNS) {
    const value = answers[sign]
    if (value === true || value === false) signs[sign] = value
  }
  return signs
}

export function bpFrom(answers: SurveyAnswers): HomeBloodPressure | null {
  const value = answers.bp
  if (typeof value !== 'object' || value === null) return null
  const { systolic, diastolic } = value as Record<string, unknown>
  return typeof systolic === 'number' && typeof diastolic === 'number' ? { systolic, diastolic } : null
}

/** True when what she has answered so far is already red: stop asking, tell her to go. */
export function answersAreEmergency(answers: SurveyAnswers): boolean {
  return decidePatientReport(signsFrom(answers), bpFrom(answers)).escalate
}

/**
 * Her answers, one line per question, as the specialist reads them. Follow-ups
 * that were never asked are left out; anything else not answered says so.
 * `forTelegram` keeps her own words out of the specialist's Telegram chat.
 */
export function surveyLines(answers: SurveyAnswers, { forTelegram = false } = {}): string[] {
  const S = SURVEY_SUMMARY
  const bp = bpFrom(answers)
  const lines = [
    `${S.bp}: ${!('bp' in answers) ? S.noAnswer : bp !== null ? `${bp.systolic}/${bp.diastolic}` : S.bpCannotMeasure}`,
  ]
  for (const sign of SURVEY_SIGNS) {
    const parent = FOLLOW_UP_OF[sign]
    if (parent !== undefined && answers[parent] !== true) continue
    const value = answers[sign]
    lines.push(`${DANGER_SIGN_NAMES[sign]}: ${value === true ? S.yes : value === false ? S.no : S.noAnswer}`)
  }
  const other = answers.other
  const otherText = typeof other === 'string' ? other.trim() : ''
  lines.push(
    `${S.other}: ${!('other' in answers) ? S.noAnswer : otherText === '' ? S.otherNone : forTelegram ? S.otherInApp : otherText}`,
  )
  return lines
}

export function surveySummary(answers: SurveyAnswers, status: SurveyClose['status']): string {
  const heading = status === 'muddati_otgan' ? SURVEY_SUMMARY.headingExpired : SURVEY_SUMMARY.heading
  return [heading, ...surveyLines(answers)].join('\n')
}

// --- writing it down ----------------------------------------------------------

/**
 * Records her answers as one report — through recordPatientReport, so the zone,
 * the assessment and the escalation are decided and written exactly as for a
 * message she typed — and closes the survey. Nothing answered, nothing written.
 *
 * `escalationId` is an alert her own words already raised during the survey, so
 * the specialist's survey summary knows a red alert covered it.
 */
export async function recordSurvey(
  store: BotStore,
  channel: LinkedChannel,
  survey: OpenSurvey,
  answers: SurveyAnswers,
  status: SurveyClose['status'],
  escalationId: string | null = null,
): Promise<RecordedReport | null> {
  let recorded: RecordedReport | null = null
  if (Object.keys(answers).length > 0) {
    recorded = await recordPatientReport(store, channel, {
      text: surveySummary(answers, status),
      signs: signsFrom(answers),
      bp: bpFrom(answers),
      // For audit, like a model response on a typed report: the answers the
      // decision was made from, so the row reproduces its own zone.
      raw: { source: 'sorovnoma', survey_id: survey.id, visit_id: survey.visitId, answers },
    })
  }
  await store
    .closeSurvey(survey.id, {
      status,
      answers,
      triageLevel: recorded?.decision.triage.level ?? null,
      escalationId: recorded?.escalationId ?? escalationId,
    })
    .catch((caught: unknown) => {
      console.error('[bot] could not close survey ' + survey.id + ': ' + String(caught))
    })
  return recorded
}

/** The closing reply: the same fixed pieces as a report reply, opening with SURVEY.received. */
function closingMessage(recorded: RecordedReport | null, answers: SurveyAnswers, asksMedicine: boolean): Outgoing {
  const text =
    recorded === null
      ? composeReportReply('none', { saved: false, bpRecorded: false, asksMedicine })
      : composeReportReply(
          recorded.decision.reply,
          { saved: recorded.saved, bpRecorded: bpFrom(answers) !== null, asksMedicine },
          SURVEY.received,
        )
  return { text, keyboard: 'remove' }
}

// --- one message from her, while a survey is open -----------------------------

/**
 * Handles one message from a woman with an open survey. Returns what to send
 * back, or null when the survey no longer applies to her — she re-linked this
 * chat to another pregnancy — so the caller handles the message as usual.
 */
export async function handleSurveyMessage(
  store: BotStore,
  extract: ExtractDangerSigns,
  channel: LinkedChannel,
  survey: OpenSurvey,
  text: string,
): Promise<Outgoing[] | null> {
  if (survey.pregnancyId !== channel.pregnancyId || !isStep(survey.step)) {
    // Her answers belong to the pregnancy the survey was opened for; they are
    // not carried over to another one. What she did answer is still recorded.
    const sameWoman = survey.pregnancyId === channel.pregnancyId
    if (sameWoman) await recordSurvey(store, channel, survey, survey.answers, 'yakunlangan')
    else {
      await store
        .closeSurvey(survey.id, { status: 'muddati_otgan', answers: survey.answers, triageLevel: null, escalationId: null })
        .catch((caught: unknown) => console.error('[bot] could not close survey ' + survey.id + ': ' + String(caught)))
    }
    return null
  }

  const step = survey.step
  const answers: SurveyAnswers = { ...survey.answers }

  if (step === 'bp') {
    const parsed = parseBpAnswer(text)
    if (parsed.kind === 'not_a_reading') return [{ text: SURVEY.bpNotReadable, keyboard: question('bp').keyboard }]
    if (parsed.kind === 'unrecognised') return notAnAnswer(store, extract, channel, survey, step, text)
    answers.bp = parsed.kind === 'reading' ? parsed.bp : null
  } else if (step === 'other') {
    if (parseYesNo(text) !== false) return lastWords(store, extract, channel, survey, answers, text)
    answers.other = null
  } else {
    const said = parseYesNo(text)
    if (said === null) return notAnAnswer(store, extract, channel, survey, step, text)
    answers[step] = said
  }

  const next = answersAreEmergency(answers) ? null : nextStep(step, answers)
  if (next === null) {
    const recorded = await recordSurvey(store, channel, survey, answers, 'yakunlangan')
    return [closingMessage(recorded, answers, false)]
  }

  await store.saveSurveyProgress(survey.id, next, answers)
  return [question(next)]
}

/**
 * She wrote something that is not an answer. It is a report in its own right:
 * triaged and recorded like any message. If it is an emergency the survey ends
 * with the go-now reply; otherwise the question is asked again.
 */
async function notAnAnswer(
  store: BotStore,
  extract: ExtractDangerSigns,
  channel: LinkedChannel,
  survey: OpenSurvey,
  step: SurveyStep,
  text: string,
): Promise<Outgoing[]> {
  const outcome = await handleSelfReportDetailed(store, extract, channel, text)
  if (outcome.level === 'immediate') {
    await recordSurvey(store, channel, survey, survey.answers, 'yakunlangan', outcome.escalationId)
    return [{ text: outcome.reply, keyboard: 'remove' }]
  }
  const again = question(step)
  return [{ text: outcome.reply }, { text: `${SURVEY.backToQuestions}\n\n${again.text}`, keyboard: again.keyboard }]
}

/**
 * The last question, answered in her own words. The words are triaged as a
 * report of their own — they may name a sign no question asked about — and
 * kept on the survey too, so the specialist reads them next to the answers.
 */
async function lastWords(
  store: BotStore,
  extract: ExtractDangerSigns,
  channel: LinkedChannel,
  survey: OpenSurvey,
  answers: SurveyAnswers,
  text: string,
): Promise<Outgoing[]> {
  answers.other = text.slice(0, MAX_OTHER_LENGTH)
  const outcome = await handleSelfReportDetailed(store, extract, channel, text)
  const recorded = await recordSurvey(store, channel, survey, answers, 'yakunlangan', outcome.escalationId)
  if (outcome.level === 'immediate') return [{ text: outcome.reply, keyboard: 'remove' }]

  // Her words could not be processed: she is told so, as for any report, before the close.
  const unprocessed: Outgoing[] = outcome.level === null ? [{ text: outcome.reply }] : []
  return [...unprocessed, closingMessage(recorded, answers, asksAboutMedicine(text))]
}

// --- a survey she never finished ----------------------------------------------

/**
 * Closes every survey whose time ran out, recording what she answered. She is
 * not messaged: the specialist was already told the visit was not recorded, and
 * gets her partial answers in the survey summary.
 */
export async function expireSurveys(store: BotStore, now: Date = new Date()): Promise<number> {
  const expired = await store.expiredSurveys(now, 50)
  for (const survey of expired) {
    const channel = await store.findChannel(survey.telegramChatId).catch(() => null)
    if (channel !== null && channel.pregnancyId === survey.pregnancyId) {
      await recordSurvey(store, channel, survey, survey.answers, 'muddati_otgan')
    } else {
      // The chat was unlinked or the pregnancy ended: nothing is filed under a
      // case the registry no longer shows.
      await store.closeSurvey(survey.id, { status: 'muddati_otgan', answers: survey.answers, triageLevel: null, escalationId: null })
    }
  }
  return expired.length
}
