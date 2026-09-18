/**
 * The bot's side of the extraction step.
 *
 * SAME ENDPOINT, CALLED IN PROCESS. handleExtract is the function api/extract.ts
 * exports and the function the endpoint serves — the Vite dev middleware in
 * vite.config.ts does exactly this, ssrLoadModule then handleExtract, and the
 * Vercel handler in the same file is a thin wrapper over it. Importing it rather
 * than fetching localhost means the bot does not need the web dev server running
 * to answer a woman who is bleeding, which is the correct dependency for the one
 * process in this system that runs unattended.
 *
 * It is the same model and the same key. What differs is the mode:
 * 'danger_signs' asks for the WHO list instead of the full assessment schema,
 * because the woman is describing symptoms, not presenting a clinical record.
 */

import { handleExtract } from '../api/extract.ts'
import { ALL_DANGER_SIGNS, type DangerSignReport } from '../src/lib/danger-signs.ts'
import type { HomeBloodPressure } from '../src/lib/patient-report.ts'

/** What the extraction step gives back, already coerced to three states. */
export interface DangerSignExtraction {
  signs: DangerSignReport
  /** Null unless she gave both numbers. */
  bp: HomeBloodPressure | null
  /** The model's response verbatim, for extracted_json. */
  raw: unknown
}

export type ExtractDangerSigns = (text: string) => Promise<DangerSignExtraction | null>

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Splits the endpoint's fields into signs and a blood pressure reading.
 *
 * Only known sign names are kept, and only the three states the triage rule
 * understands. Anything else is dropped, which leaves that sign "not mentioned".
 *
 * HALF A BLOOD PRESSURE IS DROPPED. assessments_bp_paired in 001_schema.sql
 * rejects a row carrying one number without the other — half a reading is a
 * data-entry error, not a measurement. The raw response still records what she
 * wrote, on patient_reports.extracted_json, so nothing is lost; it simply does
 * not become a scored vital sign. A reading outside the schema's sanity range is
 * dropped for the same reason: a transposed digit is not a measurement either.
 */
export function splitExtraction(fields: Record<string, unknown>): {
  signs: DangerSignReport
  bp: HomeBloodPressure | null
} {
  const signs: DangerSignReport = {}
  for (const sign of ALL_DANGER_SIGNS) {
    const value = fields[sign]
    if (value === true || value === false || value === null) signs[sign] = value
  }

  const systolic = numberOrNull(fields.bp_systolic)
  const diastolic = numberOrNull(fields.bp_diastolic)
  // Same bounds as assessments_bp_sane.
  const plausible =
    systolic !== null &&
    diastolic !== null &&
    systolic >= 50 &&
    systolic <= 300 &&
    diastolic >= 20 &&
    diastolic <= 200

  return {
    signs,
    bp: plausible ? { systolic: Math.round(systolic), diastolic: Math.round(diastolic) } : null,
  }
}

/**
 * How long she waits before being told the message could not be processed.
 * Messages are handled one at a time, so without a ceiling one hung upstream
 * call would hold every other woman's message behind it.
 */
export const EXTRACTION_TIMEOUT_MS = 20_000

/**
 * Returns null on any failure. The caller treats null as "could not process",
 * tells her so, and still records the message — a silent failure that looked
 * like success is the one outcome this path must not produce.
 */
export async function extractDangerSigns(text: string): Promise<DangerSignExtraction | null> {
  let result: { status: number; body: unknown }
  let timer: NodeJS.Timeout | undefined
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timed out')), EXTRACTION_TIMEOUT_MS)
    })
    result = await Promise.race([handleExtract({ text, mode: 'danger_signs' }), timeout])
  } catch (caught) {
    console.error('[bot] extraction failed: ' + String(caught))
    return null
  } finally {
    clearTimeout(timer)
  }

  if (result.status !== 200) {
    console.error('[bot] extraction returned ' + result.status + ': ' + JSON.stringify(result.body))
    return null
  }

  const body = result.body as { fields?: unknown; raw?: unknown }
  if (typeof body.fields !== 'object' || body.fields === null) {
    console.error('[bot] extraction returned no fields')
    return null
  }

  return { ...splitExtraction(body.fields as Record<string, unknown>), raw: body.raw ?? null }
}
