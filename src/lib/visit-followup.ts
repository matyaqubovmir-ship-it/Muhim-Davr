/**
 * What happens after a midwife's assessment is saved: the escalation, if it is
 * red, and the visit schedule the reminders are sent from.
 *
 * Both run only after the assessment row exists, and neither can undo it — the
 * assessment is append-only and is already the record. So neither throws: each
 * returns an outcome the result screen shows, and a failure says plainly what
 * did not happen (the doctor was not told; reminders will not go out) instead
 * of being mistaken for a failed save.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { clinicEscalationRow, escalates } from './escalation'
import type { RiskResult, RiskZone } from './risk'
import { formatISODate, generateSchedule, parseISODate, upcomingVisitRows } from './schedule'

/** Everything the result screen needs about a save that succeeded. */
export interface SavedVisit {
  result: RiskResult
  assessmentId: string
  pregnancyId: string
  /** The schedule's anchor, the same one it was stored from. Null when there is none. */
  lmpDate: Date | null
  escalation: EscalationOutcome
  schedule: ScheduleOutcome
}

export type EscalationOutcome =
  | { kind: 'not_needed' }
  | { kind: 'sent' }
  | { kind: 'failed'; message: string }

export type ScheduleOutcome =
  | { kind: 'saved'; planned: number }
  | { kind: 'no_anchor' }
  | { kind: 'failed'; message: string }

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505'

function messageOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}

/**
 * Raises the escalation for a red assessment, exactly as the Telegram path does
 * for a patient's red report — same table, same composite key, source 'clinic'.
 *
 * Safe to call again for the same assessment: escalations allows one live row
 * per assessment, so a retry after a lost response finds the first one there
 * and reports it as sent rather than failing.
 */
export async function raiseClinicEscalation(
  client: SupabaseClient,
  assessmentId: string,
  pregnancyId: string,
  result: RiskResult,
): Promise<EscalationOutcome> {
  if (!escalates(result.zone)) return { kind: 'not_needed' }
  try {
    const { error } = await client
      .from('escalations')
      .insert(clinicEscalationRow(assessmentId, pregnancyId, result))
    if (!error || error.code === UNIQUE_VIOLATION) return { kind: 'sent' }
    return { kind: 'failed', message: error.message }
  } catch (caught) {
    return { kind: 'failed', message: messageOf(caught) }
  }
}

/**
 * pregnancies.lmp_date, or null when it is not recorded. A read that fails is
 * also null: the caller then falls back to the gestational-age estimate, the
 * same anchor this screen used before the recorded date was read at all.
 */
export async function readRecordedLmp(
  client: SupabaseClient,
  pregnancyId: string,
): Promise<Date | null> {
  try {
    const { data, error } = await client
      .from('pregnancies')
      .select('lmp_date')
      .eq('id', pregnancyId)
      .maybeSingle()
    if (error || !data || typeof data.lmp_date !== 'string') return null
    return parseISODate(data.lmp_date)
  } catch {
    return null
  }
}

export interface ScheduleWrite {
  pregnancyId: string
  assessmentId: string
  /** The anchor the screen shows the schedule from. Null means there is none. */
  lmpDate: Date | null
  zone: RiskZone
  today: Date
}

/**
 * Stores the schedule the result screen is about to show, through
 * replace_planned_visits (004_persist_schedule.sql).
 *
 * With no anchor nothing is written at all. That is not the same as writing an
 * empty schedule, which would delete every planned visit this pregnancy has.
 */
export async function saveSchedule(
  client: SupabaseClient,
  { pregnancyId, assessmentId, lmpDate, zone, today }: ScheduleWrite,
): Promise<ScheduleOutcome> {
  if (lmpDate === null) return { kind: 'no_anchor' }

  const schedule = generateSchedule({ lmpDate, currentZone: zone, today })
  try {
    const { data, error } = await client.rpc('replace_planned_visits', {
      p_pregnancy_id: pregnancyId,
      p_today: formatISODate(today),
      p_assessment_id: assessmentId,
      p_visits: upcomingVisitRows(schedule, today),
    })
    if (error) return { kind: 'failed', message: error.message }
    return { kind: 'saved', planned: Number(data) }
  } catch (caught) {
    return { kind: 'failed', message: messageOf(caught) }
  }
}
