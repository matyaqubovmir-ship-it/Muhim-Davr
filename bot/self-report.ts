/**
 * Function 2 — she tells the bot how she feels, and the bot does something
 * useful with it without ever telling her what it means.
 *
 * THE DIVISION OF LABOUR, which is the whole design:
 *
 *   the model          reads her Uzbek and reports which signs she named
 *   patient-report.ts  decides zone, escalation and reply, from fixed rules
 *   this file          writes it down and picks the fixed reply
 *
 *   No step lets a model decide that a woman is or is not in danger, and no step
 *   produces advice. Every reply she can receive is a fixed string.
 *
 * WHAT SHE IS TOLD NEVER RUNS AHEAD OF WHAT WAS WRITTEN. "Your report was passed
 * to your midwife" is only sent when the patient_reports row exists, and "a
 * doctor has it" only when the escalation does. The instruction to go now for an
 * immediate sign is the one part that never waits on the database: if the
 * writes fail she still gets it, without the claim that anyone was told.
 */

import type { DangerSignReport } from '../src/lib/danger-signs.ts'
import {
  decidePatientReport,
  patientAssessmentRow,
  patientEscalationReason,
  type HomeBloodPressure,
  type PatientReportDecision,
  type ReplyLevel,
} from '../src/lib/patient-report.ts'
import type { ExtractDangerSigns } from './extract.ts'
import { asksAboutMedicine } from './medicine.ts'
import { BOT, WORSENS_LINE } from './messages.ts'
import type { BotStore, LinkedChannel } from './store.ts'

export interface ReplyContext {
  /** Every row this report needed was written. */
  saved: boolean
  /** She sent a complete blood pressure reading. */
  bpRecorded: boolean
  asksMedicine: boolean
}

/**
 * The reply, from fixed pieces.
 *
 * Every non-emergency reply that was saved ends with WORSENS_LINE — the medicine
 * line and the reading acknowledgement go before it, never after. An emergency
 * reply ends on the instruction to go, with the medicine line after it so a
 * question about tablets can never be what she reads first.
 */
export function composeReportReply(
  level: ReplyLevel,
  context: ReplyContext,
  /** The opening line when it was saved. The survey's closing reply passes its own. */
  received: string = BOT.reportReceived,
): string {
  const medicine = context.asksMedicine ? [BOT.medicineRefusal] : []

  if (level === 'immediate') {
    const goNow = context.saved ? BOT.reportImmediate : BOT.reportImmediateNotSaved
    return [goNow, ...medicine].join('\n\n')
  }

  if (!context.saved) return [BOT.reportFailed, ...medicine].join('\n\n')

  const parts: string[] = [received]
  if (level === 'prompt') parts.push(BOT.promptVisit)
  if (context.bpRecorded) parts.push(BOT.bpRecorded)
  parts.push(...medicine, WORSENS_LINE)
  return parts.join('\n\n')
}

export interface RecordedReport {
  decision: PatientReportDecision
  /** Every row this report needed was written. */
  saved: boolean
  assessmentId: string | null
  escalationId: string | null
}

/**
 * Decides and writes one report: what she wrote in her own words, or her
 * answers to the survey (bot/survey.ts). The decision is decidePatientReport's
 * alone — this function only writes down what it decided.
 */
export async function recordPatientReport(
  store: BotStore,
  channel: LinkedChannel,
  report: { text: string; signs: DangerSignReport; bp: HomeBloodPressure | null; raw: unknown },
): Promise<RecordedReport> {
  const { text, signs, bp, raw } = report
  const decision = decidePatientReport(signs, bp)

  let assessmentId: string | null = null
  let escalationId: string | null = null
  let saved = true

  try {
    if (decision.writesAssessment) {
      assessmentId = await store.insertAssessment(
        patientAssessmentRow(channel.pregnancyId, signs, bp, decision, raw),
      )
    }
    if (decision.escalate && assessmentId !== null) {
      // A frightened woman sends the same sign three times in a minute. While
      // her earlier alert still waits for a specialist, the new message joins
      // it (through patient_reports.escalation_id) instead of adding cards to
      // the queue. Once a specialist has taken that alert, a new sign raises a
      // new one: whoever acknowledged the first may think it is handled. A
      // failed lookup raises a new one too — a duplicate is the safe error.
      const existing = await store.findOpenTelegramEscalation(channel.pregnancyId).catch((caught: unknown) => {
        console.error('[bot] open escalation lookup failed: ' + String(caught))
        return null
      })
      escalationId = existing ?? await store.insertEscalation({
        assessment_id: assessmentId,
        // Copied from the assessment just written. The composite foreign key in
        // 001_schema.sql rejects the insert if these two ever disagree.
        pregnancy_id: channel.pregnancyId,
        reason: patientEscalationReason(decision, bp),
        fired_factors: decision.firedFactors,
        source: 'telegram',
      })
    }
  } catch (caught) {
    console.error('[bot] writing a report failed: ' + String(caught))
    saved = false
  }

  // Written even when the records above failed: her words, and whatever ids did
  // get written, are what a midwife needs to see to follow up.
  try {
    await store.insertReport({
      pregnancy_id: channel.pregnancyId,
      telegram_chat_id: channel.telegramChatId,
      message_text: text,
      extracted_json: raw ?? null,
      triage_level: decision.triage.level,
      matched_signs: [...decision.triage.immediate, ...decision.triage.prompt],
      assessment_id: assessmentId,
      escalation_id: escalationId,
    })
  } catch (caught) {
    console.error('[bot] writing a report failed: ' + String(caught))
    saved = false
  }

  return { decision, saved, assessmentId, escalationId }
}

/** What handling one free-text report came to: the reply, and enough to act on it. */
export interface SelfReportOutcome {
  reply: string
  /** Which fixed reply she got. Null when the message could not be processed at all. */
  level: ReplyLevel | null
  escalationId: string | null
}

/** Handles one self-report. Returns the reply to send. */
export async function handleSelfReport(
  store: BotStore,
  extract: ExtractDangerSigns,
  channel: LinkedChannel,
  text: string,
): Promise<string> {
  return (await handleSelfReportDetailed(store, extract, channel, text)).reply
}

export async function handleSelfReportDetailed(
  store: BotStore,
  extract: ExtractDangerSigns,
  channel: LinkedChannel,
  text: string,
): Promise<SelfReportOutcome> {
  const asksMedicine = asksAboutMedicine(text)
  const extraction = await extract(text)

  if (extraction === null) {
    // The model step failed. Her words still have to reach a person, so the row
    // is written with no extraction and a 'none' level — and the reply says it
    // could not be processed, not that it was passed on as normal.
    await store
      .insertReport({
        pregnancy_id: channel.pregnancyId,
        telegram_chat_id: channel.telegramChatId,
        message_text: text,
        extracted_json: null,
        triage_level: 'none',
        matched_signs: [],
        assessment_id: null,
        escalation_id: null,
      })
      .catch((caught: unknown) => {
        console.error('[bot] could not record an unprocessed report: ' + String(caught))
      })
    return {
      reply: composeReportReply('none', { saved: false, bpRecorded: false, asksMedicine }),
      level: null,
      escalationId: null,
    }
  }

  const { signs, bp, raw } = extraction
  const recorded = await recordPatientReport(store, channel, { text, signs, bp, raw })

  return {
    reply: composeReportReply(recorded.decision.reply, {
      saved: recorded.saved,
      bpRecorded: bp !== null,
      asksMedicine,
    }),
    level: recorded.decision.reply,
    escalationId: recorded.escalationId,
  }
}
