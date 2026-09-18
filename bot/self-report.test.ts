import { describe, expect, it } from 'vitest'
import type { DangerSignReport } from '../src/lib/danger-signs.ts'
import type { HomeBloodPressure } from '../src/lib/patient-report.ts'
import { PATIENT_REPORT_RULES_VERSION } from '../src/lib/patient-report.ts'
import type { DangerSignExtraction } from './extract.ts'
import { createFakeStore } from './fake-store.ts'
import { BOT, WORSENS_LINE } from './messages.ts'
import { composeReportReply, handleSelfReport } from './self-report.ts'

const CHANNEL = { pregnancyId: 'preg-1', telegramChatId: 555 }

function extractor(signs: DangerSignReport, bp: HomeBloodPressure | null = null) {
  return async (): Promise<DangerSignExtraction> => ({ signs, bp, raw: { verbatim: true } })
}

describe('composeReportReply', () => {
  const levels = ['none', 'prompt'] as const
  const flags = [false, true]

  it('ends every saved non-emergency reply with the worsens line, whatever else it says', () => {
    for (const level of levels) {
      for (const bpRecorded of flags) {
        for (const asksMedicine of flags) {
          const reply = composeReportReply(level, { saved: true, bpRecorded, asksMedicine })
          expect(reply.startsWith(BOT.reportReceived)).toBe(true)
          expect(reply.endsWith(WORSENS_LINE)).toBe(true)
        }
      }
    }
  })

  it('asks for a clinic visit only at the prompt level', () => {
    expect(composeReportReply('prompt', { saved: true, bpRecorded: false, asksMedicine: false })).toContain(
      BOT.promptVisit,
    )
    expect(composeReportReply('none', { saved: true, bpRecorded: false, asksMedicine: false })).not.toContain(
      BOT.promptVisit,
    )
  })

  it('puts the instruction to go first on an emergency, and the medicine line after it', () => {
    const reply = composeReportReply('immediate', { saved: true, bpRecorded: false, asksMedicine: true })
    expect(reply.startsWith(BOT.reportImmediate)).toBe(true)
    expect(reply.indexOf(BOT.medicineRefusal)).toBeGreaterThan(0)
  })

  it('never says a report was passed on when it was not saved', () => {
    for (const level of levels) {
      const reply = composeReportReply(level, { saved: false, bpRecorded: true, asksMedicine: false })
      expect(reply).not.toContain(BOT.reportReceived)
      expect(reply).toContain(BOT.reportFailed)
    }
    const emergency = composeReportReply('immediate', { saved: false, bpRecorded: false, asksMedicine: false })
    expect(emergency).toBe(BOT.reportImmediateNotSaved)
  })
})

describe('handleSelfReport — immediate sign', () => {
  it('writes a qizil patient assessment and a telegram escalation pointing at it', async () => {
    const store = createFakeStore()
    const reply = await handleSelfReport(store, extractor({ convulsions: true }), CHANNEL, 'talvasa tutdi')

    expect(reply).toBe(BOT.reportImmediate)

    expect(store.assessments).toHaveLength(1)
    const assessment = store.assessments[0]
    expect(assessment.recorded_by).toBe('patient')
    expect(assessment.risk_zone).toBe('qizil')
    expect(assessment.rules_version).toBe(PATIENT_REPORT_RULES_VERSION)
    expect(assessment.pregnancy_id).toBe('preg-1')

    expect(store.escalations).toEqual([
      expect.objectContaining({
        assessment_id: 'assessment-1',
        pregnancy_id: 'preg-1',
        source: 'telegram',
        fired_factors: ['convulsions'],
      }),
    ])

    expect(store.reports).toEqual([
      expect.objectContaining({
        message_text: 'talvasa tutdi',
        triage_level: 'immediate',
        matched_signs: ['convulsions'],
        assessment_id: 'assessment-1',
        escalation_id: 'escalation-1',
        telegram_chat_id: 555,
      }),
    ])
  })

  it('still tells her to go now when the database is down, without claiming anyone was told', async () => {
    const store = createFakeStore()
    store.failing.add('insertAssessment')
    store.failing.add('insertReport')
    const reply = await handleSelfReport(store, extractor({ vaginal_bleeding: true }), CHANNEL, 'qon ketyapti')
    expect(reply).toBe(BOT.reportImmediateNotSaved)
  })

  it('does not claim the doctor has it when only the escalation failed', async () => {
    const store = createFakeStore()
    store.failing.add('insertEscalation')
    const reply = await handleSelfReport(store, extractor({ vaginal_bleeding: true }), CHANNEL, 'qon ketyapti')
    expect(reply).toBe(BOT.reportImmediateNotSaved)
    // Her words are still recorded, with the assessment that did get written.
    expect(store.reports[0]).toEqual(
      expect.objectContaining({ assessment_id: 'assessment-1', escalation_id: null }),
    )
  })
})

describe('handleSelfReport — prompt sign and no match', () => {
  it('records a prompt report with no assessment and asks for a clinic visit', async () => {
    const store = createFakeStore()
    const reply = await handleSelfReport(store, extractor({ fever: true }), CHANNEL, 'isitmam bor')
    expect(store.assessments).toHaveLength(0)
    expect(store.escalations).toHaveLength(0)
    expect(store.reports[0].triage_level).toBe('prompt')
    expect(reply).toContain(BOT.promptVisit)
    expect(reply.endsWith(WORSENS_LINE)).toBe(true)
  })

  it('on no match says it was received and passed on, and ends with the worsens line', async () => {
    const store = createFakeStore()
    const reply = await handleSelfReport(store, extractor({}), CHANNEL, 'bugun charchadim')
    expect(reply).toBe(BOT.reportReceived + '\n\n' + WORSENS_LINE)
    expect(store.reports[0].triage_level).toBe('none')
  })

  it('answers a medicine question by referring her to her doctor or midwife', async () => {
    const store = createFakeStore()
    const reply = await handleSelfReport(store, extractor({}), CHANNEL, 'Qaysi dorini ichsam bo‘ladi?')
    expect(reply).toContain(BOT.medicineRefusal)
    expect(reply.endsWith(WORSENS_LINE)).toBe(true)
  })
})

describe('handleSelfReport — home blood pressure', () => {
  it('stores a normal reading as a patient assessment without escalating', async () => {
    const store = createFakeStore()
    const reply = await handleSelfReport(
      store,
      extractor({}, { systolic: 118, diastolic: 76 }),
      CHANNEL,
      'bosim 118/76',
    )
    expect(store.assessments).toHaveLength(1)
    expect(store.assessments[0]).toEqual(
      expect.objectContaining({ bp_systolic: 118, bp_diastolic: 76, recorded_by: 'patient', risk_zone: 'yashil' }),
    )
    expect(store.escalations).toHaveLength(0)
    expect(reply).toContain(BOT.bpRecorded)
    expect(reply.endsWith(WORSENS_LINE)).toBe(true)
  })

  it('escalates a severe reading and tells her to go now', async () => {
    const store = createFakeStore()
    const reply = await handleSelfReport(
      store,
      extractor({}, { systolic: 172, diastolic: 114 }),
      CHANNEL,
      'bosim 172/114',
    )
    expect(store.assessments[0].risk_zone).toBe('qizil')
    expect(store.escalations).toHaveLength(1)
    expect(store.escalations[0].reason).toContain('172/114')
    expect(reply).toBe(BOT.reportImmediate)
  })
})

describe('handleSelfReport — extraction failed', () => {
  it('records her words and says it could not be processed', async () => {
    const store = createFakeStore()
    const reply = await handleSelfReport(store, async () => null, CHANNEL, 'nimadir')
    expect(reply).toBe(BOT.reportFailed)
    expect(store.reports).toEqual([
      expect.objectContaining({ message_text: 'nimadir', extracted_json: null, triage_level: 'none' }),
    ])
    expect(store.assessments).toHaveLength(0)
  })

  it('still answers when even that record cannot be written', async () => {
    const store = createFakeStore()
    store.failing.add('insertReport')
    expect(await handleSelfReport(store, async () => null, CHANNEL, 'nimadir')).toBe(BOT.reportFailed)
  })
})
