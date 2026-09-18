/**
 * ONA — what a patient's own report means, and what gets written because of it.
 *
 * Pure, like risk.ts and danger-signs.ts: no I/O, no clock, no model. The bot
 * reads her message through the extraction step and hands the result here; this
 * file decides the zone, whether to escalate and which fixed reply she gets.
 * Nothing a model returns can reach any of those decisions except as the three
 * states of a sign or the two numbers of a reading.
 *
 * TWO PUBLISHED RULES, COMPOSED, NEITHER BLENDED:
 *
 *   risk.ts          scores what she measured — a home blood pressure reading,
 *                    and bleeding, which is both a danger sign and a scoring
 *                    input — exactly as it scores a midwife's visit.
 *   danger-signs.ts  says whether anything she reported is on the WHO
 *                    immediate list.
 *
 *   An immediate sign makes the row qizil. That is the WHO rule — any one sign
 *   means go now — and it is not expressible in risk.ts, because most of the
 *   signs (convulsions, breathing, abdominal pain) are not scoring inputs. So
 *   the zone is composed here and the row says so: rules_version names both
 *   rule sets, fired_factors lists the signs next to the point-table factors,
 *   and the signs themselves are on the same row in extracted_json. The row
 *   still reproduces its own zone from itself alone, which is what the snapshot
 *   rule in 001_schema.sql asks for.
 *
 *   The score is left exactly as the point table computed it. A sign adds no
 *   points; it forces the zone, the way risk.ts's own absolute flags do.
 *
 * A RED ROW ESCALATES, WHATEVER MADE IT RED. An immediate sign, bleeding, or a
 * home reading of 160/110 and above all produce qizil, and qizil is what raises
 * an escalation. A woman whose reading is in the severe range is not told her
 * report was "received" while the doctor queue shows her as an emergency.
 */

import { RULES_VERSION, scoreAssessment, type RiskFactor, type RiskResult, type RiskZone } from './risk.ts'
import {
  dangerSignsToAssessmentValues,
  triageDangerSigns,
  type DangerSignReport,
  type ImmediateSign,
  type TriageResult,
} from './danger-signs.ts'
import { escalates } from './escalation.ts'
import { DANGER_SIGN_NAMES, FACTOR_SENTENCES, TELEGRAM_ESCALATION } from './labels.ts'

/** The WHO danger-sign list this file applies. Bump if the list changes. */
export const DANGER_SIGN_RULES_VERSION = 'who-ds-2016'

/**
 * rules_version on a patient-recorded assessment: the point table and the
 * danger-sign list together, because both decided the zone.
 */
export const PATIENT_REPORT_RULES_VERSION = `${RULES_VERSION}+${DANGER_SIGN_RULES_VERSION}`

export interface HomeBloodPressure {
  systolic: number
  diastolic: number
}

/** Which of the fixed replies she gets. Never 'fine' — there is no such reply. */
export type ReplyLevel = 'immediate' | 'prompt' | 'none'

export type PatientFactor = RiskFactor | ImmediateSign

export interface PatientReportDecision {
  triage: TriageResult
  /** The point table's verdict on what she measured and reported. */
  risk: RiskResult
  zone: RiskZone
  /** Point-table factors, then immediate signs, in their fixed orders. */
  firedFactors: PatientFactor[]
  escalate: boolean
  /**
   * A reading is always stored. So is any report that escalates, because an
   * escalation must point at an assessment (001_schema.sql). A report with
   * neither writes no assessment: there is nothing measured to record.
   */
  writesAssessment: boolean
  reply: ReplyLevel
}

export function decidePatientReport(
  signs: DangerSignReport,
  bp: HomeBloodPressure | null,
): PatientReportDecision {
  const triage = triageDangerSigns(signs)

  // Only inputs that go on the row, so the row reproduces this score.
  const risk = scoreAssessment({
    bp_systolic: bp?.systolic ?? null,
    bp_diastolic: bp?.diastolic ?? null,
    antepartum_bleeding: signs.vaginal_bleeding ?? null,
  })

  const zone: RiskZone = triage.immediate.length > 0 ? 'qizil' : risk.zone
  const escalate = escalates(zone)

  return {
    triage,
    risk,
    zone,
    firedFactors: [...risk.firedFactors, ...triage.immediate],
    escalate,
    writesAssessment: bp !== null || escalate,
    reply: escalate ? 'immediate' : triage.level,
  }
}

/**
 * The assessments row for a patient report. recorded_by = 'patient' is what
 * keeps a home reading distinguishable from a clinic one forever after.
 */
export function patientAssessmentRow(
  pregnancyId: string,
  signs: DangerSignReport,
  bp: HomeBloodPressure | null,
  decision: PatientReportDecision,
  extractedJson: unknown,
): Record<string, unknown> {
  return {
    pregnancy_id: pregnancyId,
    bp_systolic: bp?.systolic ?? null,
    bp_diastolic: bp?.diastolic ?? null,
    ...dangerSignsToAssessmentValues(signs),
    risk_score: decision.risk.score,
    risk_zone: decision.zone,
    fired_factors: decision.firedFactors,
    rules_version: PATIENT_REPORT_RULES_VERSION,
    extracted_json: extractedJson ?? null,
    // She wrote it and nobody edited it before it was stored.
    corrected_by_human: false,
    recorded_by: 'patient',
  }
}

/** The Uzbek reason a doctor reads at the top of the escalation. */
export function patientEscalationReason(
  decision: PatientReportDecision,
  bp: HomeBloodPressure | null,
): string {
  const parts: string[] = []

  if (decision.triage.immediate.length > 0) {
    const names = decision.triage.immediate.map((sign) => DANGER_SIGN_NAMES[sign])
    parts.push(`${TELEGRAM_ESCALATION.signs} ${names.join(', ')}.`)
  }

  if (bp !== null) {
    parts.push(`${TELEGRAM_ESCALATION.homeBp} ${bp.systolic}/${bp.diastolic}.`)
  }

  for (const factor of decision.risk.firedFactors) {
    parts.push(FACTOR_SENTENCES[factor])
  }

  return parts.join(' ')
}
