/**
 * Client side of the extraction step.
 *
 * The AI path is strictly optional. Every failure here returns a plain "it did
 * not work" — the caller shows one message and leaves the form exactly as it
 * was, fully typeable. Nothing about the typed path depends on this succeeding.
 */

import type { FormFieldName } from './form-fields'
import { getAuthedSupabase } from './supabase'

/** Hard ceiling. A live demo cannot wait longer than this. */
export const EXTRACTION_TIMEOUT_MS = 8000

export type ExtractedFields = Partial<Record<FormFieldName, number | boolean | null>>

export interface ExtractionSuccess {
  ok: true
  /** Only the fields the model actually returned a value for. */
  fields: ExtractedFields
  /** The model's response, verbatim, for extracted_json. */
  raw: unknown
}

export interface ExtractionFailure {
  ok: false
  reason: string
}

export type ExtractionOutcome = ExtractionSuccess | ExtractionFailure

function isFieldValue(value: unknown): value is number | boolean | null {
  return (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
}

/**
 * The session token the endpoint requires (api/extract.ts verifySession). The
 * endpoint spends the Anthropic key, so it only answers the app's own sessions.
 */
async function sessionToken(): Promise<string | null> {
  const client = await getAuthedSupabase()
  const { data } = await client.auth.getSession()
  return data.session?.access_token ?? null
}

/**
 * Sends the note and returns structured values. Never throws: every path
 * resolves, because an exception escaping here would be a failure of the AI
 * step taking the typed path down with it.
 *
 * There is no automatic retry. A retry doubles the wait a midwife is standing
 * through, and she already has a working keyboard.
 */
export async function extractFields(
  text: string,
  getToken: () => Promise<string | null> = sessionToken,
  fetchFn: typeof fetch = fetch,
): Promise<ExtractionOutcome> {
  return postExtraction({ text }, EXTRACTION_TIMEOUT_MS, getToken, fetchFn)
}

/**
 * A photo or PDF of a lab sheet or antenatal card, read by the same endpoint
 * under the same rules: values printed on it, never inferred. Longer ceiling
 * than a typed note — reading a page takes the model longer — and the same
 * fallback: on any failure the form is untouched and she types.
 */
export const DOCUMENT_TIMEOUT_MS = 30_000

export async function extractFromDocument(
  document: { mediaType: string; data: string },
  getToken: () => Promise<string | null> = sessionToken,
  fetchFn: typeof fetch = fetch,
): Promise<ExtractionOutcome> {
  return postExtraction(
    { document: { media_type: document.mediaType, data: document.data } },
    DOCUMENT_TIMEOUT_MS,
    getToken,
    fetchFn,
  )
}

async function postExtraction(
  body: Record<string, unknown>,
  timeoutMs: number,
  getToken: () => Promise<string | null>,
  fetchFn: typeof fetch,
): Promise<ExtractionOutcome> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const token = await getToken()
    if (token === null) return { ok: false, reason: 'no_session' }
    const response = await fetchFn('/api/extract', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!response.ok) {
      return { ok: false, reason: `http_${response.status}` }
    }

    const payload: unknown = await response.json()
    if (typeof payload !== 'object' || payload === null || !('fields' in payload)) {
      return { ok: false, reason: 'malformed_response' }
    }

    const rawFields = (payload as { fields: unknown }).fields
    if (typeof rawFields !== 'object' || rawFields === null) {
      return { ok: false, reason: 'malformed_fields' }
    }

    // Keep only values of a shape the form can hold. Anything unexpected is
    // dropped rather than written into a clinical field.
    const fields: ExtractedFields = {}
    for (const [key, value] of Object.entries(rawFields)) {
      if (isFieldValue(value)) {
        fields[key as FormFieldName] = value
      }
    }

    return { ok: true, fields, raw: (payload as { raw?: unknown }).raw ?? payload }
  } catch (caught) {
    const aborted = caught instanceof DOMException && caught.name === 'AbortError'
    return { ok: false, reason: aborted ? 'timeout' : 'network_error' }
  } finally {
    clearTimeout(timer)
  }
}
