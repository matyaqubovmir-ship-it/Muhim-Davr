/**
 * Keeping a lab sheet or card with the record: Storage bucket
 * 'patient-documents' plus a patient_documents row (007).
 *
 * OPTIONAL BY DESIGN. Until 007 is applied there is no bucket and no table;
 * every function here then reports 'not_configured' and nothing else in the
 * app changes — the model can still read a document into the form, and the
 * visit still saves. Keeping the file is never allowed to fail a save.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const DOCUMENT_BUCKET = 'patient-documents'

export interface StoredDocument {
  id: string
  fileName: string
  mediaType: string
  sizeBytes: number
  storagePath: string
  assessmentId: string | null
  usedForExtraction: boolean
  createdAt: Date
}

export type SaveDocumentOutcome =
  | { kind: 'saved' }
  | { kind: 'not_configured' }
  | { kind: 'failed'; message: string }

/** Missing bucket or table: 007 has not been run. */
export function isNotConfigured(error: { message?: string; code?: string; statusCode?: string | number } | null): boolean {
  if (error === null) return false
  const message = (error.message ?? '').toLowerCase()
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    message.includes('bucket not found') ||
    message.includes('could not find the table') ||
    (message.includes('relation') && message.includes('does not exist'))
  )
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

/** Unique and meaningless: no name, no date of birth in a storage path. */
export function storagePathFor(pregnancyId: string, mediaType: string, now: Date = new Date()): string {
  const random = Math.random().toString(36).slice(2, 10)
  return `${pregnancyId}/${now.getTime()}-${random}.${EXTENSIONS[mediaType] ?? 'bin'}`
}

export async function saveDocument(
  client: SupabaseClient,
  args: {
    pregnancyId: string
    assessmentId: string | null
    blob: Blob
    fileName: string
    mediaType: string
    usedForExtraction: boolean
  },
): Promise<SaveDocumentOutcome> {
  try {
    const path = storagePathFor(args.pregnancyId, args.mediaType)
    const upload = await client.storage
      .from(DOCUMENT_BUCKET)
      .upload(path, args.blob, { contentType: args.mediaType, upsert: false })
    if (upload.error) {
      return isNotConfigured(upload.error) ? { kind: 'not_configured' } : { kind: 'failed', message: upload.error.message }
    }
    const { error } = await client.from('patient_documents').insert({
      pregnancy_id: args.pregnancyId,
      assessment_id: args.assessmentId,
      storage_path: path,
      file_name: args.fileName.slice(0, 200),
      media_type: args.mediaType,
      size_bytes: args.blob.size,
      used_for_extraction: args.usedForExtraction,
    })
    if (error) return isNotConfigured(error) ? { kind: 'not_configured' } : { kind: 'failed', message: error.message }
    return { kind: 'saved' }
  } catch (caught) {
    return { kind: 'failed', message: caught instanceof Error ? caught.message : String(caught) }
  }
}

export async function listDocuments(
  client: SupabaseClient,
  pregnancyId: string,
): Promise<StoredDocument[] | 'not_configured'> {
  const { data, error } = await client
    .from('patient_documents')
    .select('id, file_name, media_type, size_bytes, storage_path, assessment_id, used_for_extraction, created_at')
    .eq('pregnancy_id', pregnancyId)
    .order('created_at', { ascending: false })
  if (error) {
    if (isNotConfigured(error)) return 'not_configured'
    throw new Error(error.message)
  }
  return (data ?? []).map((row) => ({
    id: String(row.id),
    fileName: String(row.file_name),
    mediaType: String(row.media_type),
    sizeBytes: Number(row.size_bytes),
    storagePath: String(row.storage_path),
    assessmentId: typeof row.assessment_id === 'string' ? row.assessment_id : null,
    usedForExtraction: row.used_for_extraction === true,
    createdAt: new Date(String(row.created_at)),
  }))
}

/** A link that opens the file for one minute: the bucket is private. */
export async function documentLink(client: SupabaseClient, storagePath: string): Promise<string> {
  const { data, error } = await client.storage.from(DOCUMENT_BUCKET).createSignedUrl(storagePath, 60)
  if (error || !data) throw new Error(error?.message ?? 'no link')
  return data.signedUrl
}
