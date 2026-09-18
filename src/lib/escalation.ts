/**
 * ONA — when an assessment escalates, and the row that records it.
 *
 * ONE RULE FOR BOTH CHANNELS: a red row escalates, whatever made it red. The
 * midwife's form (source 'clinic') and the patient's Telegram (source
 * 'telegram', via src/lib/patient-report.ts) both ask `escalates`, so the doctor
 * queue holds every red assessment and not only the ones that came in by phone.
 *
 * The escalation is the application's second explicit insert after the
 * assessment — deliberately not a trigger; see the escalations block in
 * 001_schema.sql. assessment_id and pregnancy_id come from the same saved row,
 * and the composite foreign key there refuses the insert if they ever disagree.
 *
 * Pure: builds the row, does not write it.
 */

import { CLINIC_ESCALATION_REASON, FACTOR_SENTENCES } from './labels.ts'
import type { RiskResult, RiskZone } from './risk.ts'

export type EscalationSource = 'clinic' | 'telegram'

export interface EscalationRow {
  assessment_id: string
  pregnancy_id: string
  reason: string
  fired_factors: string[]
  source: EscalationSource
}

/** Qizil escalates — including every absolute flag, since each one forces qizil. */
export function escalates(zone: RiskZone): boolean {
  return zone === 'qizil'
}

/** The reason line a doctor reads: where it came from, then each factor as a sentence. */
export function clinicEscalationReason(result: RiskResult): string {
  return [CLINIC_ESCALATION_REASON, ...result.firedFactors.map((f) => FACTOR_SENTENCES[f])].join(' ')
}

/** The escalation for a red assessment saved on the midwife's form. */
export function clinicEscalationRow(
  assessmentId: string,
  pregnancyId: string,
  result: RiskResult,
): EscalationRow {
  return {
    assessment_id: assessmentId,
    pregnancy_id: pregnancyId,
    reason: clinicEscalationReason(result),
    fired_factors: [...result.firedFactors],
    source: 'clinic',
  }
}
