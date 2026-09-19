import { describe, expect, it } from 'vitest'
import { ALL_DANGER_SIGNS, IMMEDIATE_SIGNS, type DangerSignReport } from '../src/lib/danger-signs.ts'
import { SURVEY_SUMMARY } from '../src/lib/labels.ts'
import type { DangerSignExtraction, ExtractDangerSigns } from './extract.ts'
import { createFakeStore, type FakeStore } from './fake-store.ts'
import { BOT, SURVEY, WORSENS_LINE } from './messages.ts'
import {
  expireSurveys,
  handleSurveyMessage,
  nextStep,
  parseBpAnswer,
  parseYesNo,
  question,
  SURVEY_SIGNS,
  SURVEY_STEPS,
} from './survey.ts'
import type { Outgoing } from './telegram.ts'

const CHANNEL = { pregnancyId: 'preg-1', telegramChatId: 555 }

function extractor(signs: DangerSignReport = {}) {
  return async (): Promise<DangerSignExtraction> => ({ signs, bp: null, raw: { verbatim: true } })
}

/** A store with one open survey for CHANNEL, at `step`, with `answers` already given. */
function storeWithSurvey(step = 'bp', answers: Record<string, unknown> = {}): FakeStore {
  const store = createFakeStore()
  store.channels.set(CHANNEL.telegramChatId, CHANNEL.pregnancyId)
  store.surveys.push({
    id: 'survey-1',
    pregnancyId: CHANNEL.pregnancyId,
    telegramChatId: CHANNEL.telegramChatId,
    visitId: 'visit-1',
    step,
    answers,
    expiresAt: new Date('2026-09-20T09:00:00Z'),
    closed: null,
  })
  return store
}

/** Sends each message in turn to the open survey, as the poll loop would. Returns the last replies. */
async function answer(store: FakeStore, messages: string[], extract: ExtractDangerSigns = extractor()): Promise<Outgoing[]> {
  let replies: Outgoing[] = []
  for (const text of messages) {
    const survey = await store.findOpenSurvey(CHANNEL.telegramChatId)
    if (survey === null) throw new Error(`no open survey for "${text}"`)
    replies = (await handleSurveyMessage(store, extract, CHANNEL, survey, text)) ?? []
  }
  return replies
}

describe('the question list', () => {
  it('asks about every WHO danger sign, each once', () => {
    expect([...SURVEY_SIGNS].sort()).toEqual([...ALL_DANGER_SIGNS].sort())
  })

  it('starts with blood pressure and ends with her own words', () => {
    expect(SURVEY_STEPS[0]).toBe('bp')
    expect(SURVEY_STEPS.at(-1)).toBe('other')
  })

  it('asks a follow-up only after a "Ha"', () => {
    expect(nextStep('abdominal_pain', { abdominal_pain: false })).toBe('severe_headache_with_blurred_vision')
    expect(nextStep('abdominal_pain', { abdominal_pain: true })).toBe('severe_abdominal_pain')
    expect(nextStep('fever', { fever: false })).toBe('swelling_face_hands_legs')
    expect(nextStep('fever', { fever: true })).toBe('fever_unable_to_rise')
  })

  it('offers Ha / Yo‘q on a sign, "cannot measure" on blood pressure, and "Yo‘q" at the end', () => {
    expect(question('convulsions').keyboard).toEqual([[SURVEY.yes, SURVEY.no]])
    expect(question('bp').keyboard).toEqual([[SURVEY.cannotMeasure]])
    expect(question('other').keyboard).toEqual([[SURVEY.no]])
  })
})

describe('reading an answer', () => {
  it('reads the buttons and the ways people type them', () => {
    for (const yes of ['Ha', 'ha.', 'HA!', 'Ha, bor', 'bor', 'да']) expect(parseYesNo(yes), yes).toBe(true)
    for (const no of ['Yo‘q', "yo'q", 'yoq', 'Yo`q.', 'нет']) expect(parseYesNo(no), no).toBe(false)
  })

  it('does not take a sentence for an answer', () => {
    for (const text of ['qonim ketyapti', 'ha qornim og‘riyapti', 'bilmadim', '']) expect(parseYesNo(text), text).toBeNull()
  })

  it('reads a blood pressure written the usual ways', () => {
    for (const text of ['120/80', '120 80', '120-80', '130 ga 85', 'bosim 140/90', 'Qon bosimim 140/90', '120/80 mm hg']) {
      expect(parseBpAnswer(text).kind, text).toBe('reading')
    }
    expect(parseBpAnswer('130 ga 85')).toEqual({ kind: 'reading', bp: { systolic: 130, diastolic: 85 } })
  })

  it('takes the button, or saying she cannot, as "not measured"', () => {
    for (const text of [SURVEY.cannotMeasure, "o'lchamadim", 'Yo‘q']) expect(parseBpAnswer(text).kind, text).toBe('cannot_measure')
  })

  it('refuses numbers that cannot be a reading instead of storing them', () => {
    for (const text of ['80/120', '400/80', '120/10']) expect(parseBpAnswer(text).kind, text).toBe('not_a_reading')
  })

  it('does not guess where one number ends and the next begins', () => {
    expect(parseBpAnswer('12080').kind).toBe('unrecognised')
    expect(parseBpAnswer('boshim og‘riyapti').kind).toBe('unrecognised')
  })
})

describe('a survey answered to the end', () => {
  it('writes her answers as one report, scored by the same rules, and closes the buttons', async () => {
    const store = storeWithSurvey()
    // Eight signs (the two follow-ups are skipped after a "no"), then the last question.
    const noToEverything = Array(SURVEY_SIGNS.length - 2 + 1).fill(SURVEY.no)
    const replies = await answer(store, ['120/80', ...noToEverything])

    // Two follow-ups were never asked; the rest were, then the last question.
    const survey = store.surveys[0]
    expect(survey.closed?.status).toBe('yakunlangan')
    expect(survey.answers).not.toHaveProperty('severe_abdominal_pain')
    expect(survey.answers).not.toHaveProperty('fever_unable_to_rise')
    expect(survey.answers.other).toBeNull()

    expect(replies).toHaveLength(1)
    expect(replies[0].keyboard).toBe('remove')
    expect(replies[0].text.startsWith(SURVEY.received)).toBe(true)
    expect(replies[0].text.endsWith(WORSENS_LINE)).toBe(true)

    expect(store.reports).toHaveLength(1)
    const report = store.reports[0]
    expect(report.triage_level).toBe('none')
    expect(report.message_text.startsWith(SURVEY_SUMMARY.heading)).toBe(true)
    expect(report.message_text).toContain('120/80')
    expect(report.extracted_json).toMatchObject({ source: 'sorovnoma', survey_id: 'survey-1', visit_id: 'visit-1' })

    // A home reading is a real observation, stored as the patient's.
    expect(store.assessments).toHaveLength(1)
    expect(store.assessments[0]).toMatchObject({ bp_systolic: 120, bp_diastolic: 80, recorded_by: 'patient', antepartum_bleeding: false })
    expect(store.escalations).toHaveLength(0)
  })

  it('asks her to be seen when an answer is on the prompt list', async () => {
    const store = storeWithSurvey('fever', { bp: null })
    const replies = await answer(store, [SURVEY.yes, SURVEY.no, SURVEY.no, SURVEY.no, SURVEY.no])
    expect(store.surveys[0].closed?.status).toBe('yakunlangan')
    expect(store.reports[0].triage_level).toBe('prompt')
    expect(replies[0].text).toContain(BOT.promptVisit)
    expect(store.escalations).toHaveLength(0)
  })
})

describe('an answer that means go now', () => {
  it.each(IMMEDIATE_SIGNS.map((sign) => [sign]))('stops at "Ha" to %s and raises an escalation', async (sign) => {
    // Everything before this sign answered "no", including a follow-up's parent.
    const before: Record<string, unknown> = { bp: null }
    for (const step of SURVEY_SIGNS) {
      if (step === sign) break
      before[step] = false
    }
    if (sign === 'severe_abdominal_pain') before.abdominal_pain = true
    if (sign === 'fever_unable_to_rise') before.fever = true

    const store = storeWithSurvey(sign, before)
    const replies = await answer(store, [SURVEY.yes])

    expect(replies).toEqual([{ text: BOT.reportImmediate, keyboard: 'remove' }])
    expect(store.surveys[0].closed?.status).toBe('yakunlangan')
    expect(store.escalations).toHaveLength(1)
    expect(store.escalations[0]).toMatchObject({ pregnancy_id: CHANNEL.pregnancyId, source: 'telegram' })
    expect(store.reports[0].triage_level).toBe('immediate')
  })

  it('stops at a severe blood pressure without asking anything else', async () => {
    const store = storeWithSurvey()
    const replies = await answer(store, ['165/112'])
    expect(replies[0].text).toBe(BOT.reportImmediate)
    expect(store.escalations).toHaveLength(1)
    expect(store.surveys[0].answers).toEqual({ bp: { systolic: 165, diastolic: 112 } })
  })
})

describe('something that is not an answer', () => {
  it('is handled as a report first, and then the question is asked again', async () => {
    const store = storeWithSurvey('fever', { bp: null, vaginal_bleeding: false })
    const replies = await answer(store, ['boshim og‘riyapti'])

    expect(replies).toHaveLength(2)
    expect(replies[0].text.startsWith(BOT.reportReceived)).toBe(true)
    expect(replies[1].text).toBe(`${SURVEY.backToQuestions}\n\n${SURVEY.questions.fever}`)
    expect(replies[1].keyboard).toEqual([[SURVEY.yes, SURVEY.no]])

    expect(store.reports).toHaveLength(1)
    expect(store.reports[0].message_text).toBe('boshim og‘riyapti')
    const open = await store.findOpenSurvey(CHANNEL.telegramChatId)
    expect(open?.step).toBe('fever')
  })

  it('ends the survey when it names an emergency', async () => {
    const store = storeWithSurvey('fever', { bp: null })
    const replies = await answer(store, ['qonim ketyapti'], extractor({ vaginal_bleeding: true }))
    expect(replies).toEqual([{ text: BOT.reportImmediate, keyboard: 'remove' }])
    expect(store.escalations).toHaveLength(1)
    expect(store.surveys[0].closed).toMatchObject({ status: 'yakunlangan', escalationId: 'escalation-1' })
  })

  it('asks again for numbers that cannot be a blood pressure, storing nothing', async () => {
    const store = storeWithSurvey()
    const replies = await answer(store, ['80/120'])
    expect(replies).toEqual([{ text: SURVEY.bpNotReadable, keyboard: [[SURVEY.cannotMeasure]] }])
    expect(store.assessments).toHaveLength(0)
    expect((await store.findOpenSurvey(CHANNEL.telegramChatId))?.step).toBe('bp')
  })
})

describe('her own words at the end', () => {
  it('are triaged as a report of their own and kept with the answers', async () => {
    const store = storeWithSurvey('other', { bp: null, vaginal_bleeding: false })
    const replies = await answer(store, ['bola kam qimirlayapti'])

    expect(replies).toHaveLength(1)
    expect(replies[0].text.startsWith(SURVEY.received)).toBe(true)
    expect(store.reports.map((r) => r.message_text)).toEqual([
      'bola kam qimirlayapti',
      expect.stringContaining(`${SURVEY_SUMMARY.other}: bola kam qimirlayapti`),
    ])
  })

  it('tell her when they could not be processed, and still close the survey', async () => {
    const store = storeWithSurvey('other', { bp: null })
    const replies = await answer(store, ['qandaydir yozuv'], async () => null)
    expect(replies[0].text).toBe(BOT.reportFailed)
    expect(replies[1].text.startsWith(SURVEY.received)).toBe(true)
    expect(store.surveys[0].closed?.status).toBe('yakunlangan')
  })
})

describe('unanswered is not "no"', () => {
  it('an expired survey records what she answered and marks the rest unanswered', async () => {
    const store = storeWithSurvey('abdominal_pain', { bp: { systolic: 128, diastolic: 84 }, vaginal_bleeding: false })
    const closed = await expireSurveys(store, new Date('2026-09-20T10:00:00Z'))

    expect(closed).toBe(1)
    expect(store.surveys[0].closed?.status).toBe('muddati_otgan')
    const text = store.reports[0].message_text
    expect(text.startsWith(SURVEY_SUMMARY.headingExpired)).toBe(true)
    expect(text).toContain(`Qorin og‘rig‘i: ${SURVEY_SUMMARY.noAnswer}`)
    expect(text).toContain(`Qindan qon ketishi: ${SURVEY_SUMMARY.no}`)
    // Answered "no" is written false; never asked is absent from the row.
    expect(store.assessments[0]).toMatchObject({ bp_systolic: 128, antepartum_bleeding: false })
    expect(store.assessments[0]).not.toHaveProperty('edema')
  })

  it('an expired survey with no answers writes nothing', async () => {
    const store = storeWithSurvey()
    await expireSurveys(store, new Date('2026-09-20T10:00:00Z'))
    expect(store.reports).toHaveLength(0)
    expect(store.surveys[0].closed?.status).toBe('muddati_otgan')
  })

  it('an expired survey is not filed under a chat that now belongs to someone else', async () => {
    const store = storeWithSurvey('fever', { bp: null })
    store.channels.set(CHANNEL.telegramChatId, 'preg-other')
    await expireSurveys(store, new Date('2026-09-20T10:00:00Z'))
    expect(store.reports).toHaveLength(0)
    expect(store.surveys[0].closed?.status).toBe('muddati_otgan')
  })
})

describe('a chat linked to another pregnancy mid-survey', () => {
  it('closes the old survey and leaves the message to be handled as usual', async () => {
    const store = storeWithSurvey('fever', { bp: null })
    const survey = await store.findOpenSurvey(CHANNEL.telegramChatId)
    const replies = await handleSurveyMessage(store, extractor(), { ...CHANNEL, pregnancyId: 'preg-2' }, survey!, SURVEY.yes)
    expect(replies).toBeNull()
    expect(store.surveys[0].closed?.status).toBe('muddati_otgan')
    expect(store.reports).toHaveLength(0)
  })
})
