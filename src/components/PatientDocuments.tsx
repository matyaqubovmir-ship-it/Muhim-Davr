import { useCallback, useEffect, useRef, useState } from 'react'
import { DOCUMENT_ACCEPT, formatBytes, prepareDocument } from '../lib/document-file'
import { documentLink, listDocuments, saveDocument, type StoredDocument } from '../lib/documents'
import { DOCUMENT_UI } from '../lib/labels'
import { formatMoment } from '../lib/patient-detail'
import { getAuthedSupabase } from '../lib/supabase'
import { Button } from './Button'
import { FileIcon, PlusIcon, SparkleIcon } from './Icons'

/**
 * Lab sheets and cards kept with this pregnancy (007). Opening one asks
 * Storage for a one-minute link: the bucket is private, and a link copied out
 * of the browser stops working almost at once.
 */
export function PatientDocuments({ pregnancyId }: { pregnancyId: string }) {
  const [docs, setDocs] = useState<StoredDocument[] | 'not_configured' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    getAuthedSupabase()
      .then((client) => listDocuments(client, pregnancyId))
      .then((next) => {
        setDocs(next)
        setError(null)
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)))
  }, [pregnancyId])

  useEffect(() => {
    load()
  }, [load])

  async function add(file: File | undefined) {
    if (file === undefined) return
    setError(null)
    setAdding(true)
    try {
      const prepared = await prepareDocument(file)
      if (typeof prepared === 'string') {
        setError(prepared === 'unsupported_type' ? DOCUMENT_UI.unsupported : prepared === 'too_large' ? DOCUMENT_UI.tooLarge : DOCUMENT_UI.unreadable)
        return
      }
      if (prepared.previewUrl) URL.revokeObjectURL(prepared.previewUrl)
      const client = await getAuthedSupabase()
      const outcome = await saveDocument(client, {
        pregnancyId,
        assessmentId: null,
        blob: prepared.blob,
        fileName: prepared.name,
        mediaType: prepared.mediaType,
        usedForExtraction: false,
      })
      if (outcome.kind === 'not_configured') setDocs('not_configured')
      else if (outcome.kind === 'failed') setError(`${DOCUMENT_UI.docFailed} (${outcome.message})`)
      else load()
    } finally {
      setAdding(false)
    }
  }

  async function open(doc: StoredDocument) {
    // Opened synchronously so a browser does not treat it as a pop-up.
    const tab = window.open('', '_blank')
    setOpening(doc.id)
    try {
      const url = await documentLink(await getAuthedSupabase(), doc.storagePath)
      if (tab) tab.location.replace(url)
      else window.location.assign(url)
    } catch {
      tab?.close()
      setError(DOCUMENT_UI.openFailed)
    } finally {
      setOpening(null)
    }
  }

  if (docs === 'not_configured') {
    return <p className="rounded-lg border border-border bg-bg p-3 text-sm text-slate-600">{DOCUMENT_UI.notConfigured}</p>
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-text-muted">{DOCUMENT_UI.subtitle}</p>
        <Button size="sm" variant="secondary" icon={<PlusIcon size={15} />} loading={adding} onClick={() => input.current?.click()} className="print:hidden">
          {adding ? DOCUMENT_UI.adding : DOCUMENT_UI.add}
        </Button>
        <input
          ref={input}
          type="file"
          accept={DOCUMENT_ACCEPT}
          className="hidden"
          onChange={(event) => {
            void add(event.target.files?.[0])
            event.target.value = ''
          }}
        />
      </div>

      {error ? (
        <p role="alert" className="mb-2 rounded-lg border border-red-300 bg-red-50 p-2.5 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {docs === null && error === null ? <div className="h-16 animate-pulse rounded-xl border border-border bg-surface" /> : null}

      {Array.isArray(docs) && docs.length === 0 ? <p className="text-sm text-slate-600">{DOCUMENT_UI.empty}</p> : null}

      {Array.isArray(docs) && docs.length > 0 ? (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {docs.map((doc) => (
            <li key={doc.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-bg text-slate-600">
                <FileIcon size={19} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-text-primary">{doc.fileName}</div>
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-text-muted">
                  <span>{formatMoment(doc.createdAt)}</span>
                  <span>{formatBytes(doc.sizeBytes)}</span>
                  {doc.usedForExtraction ? (
                    <span className="inline-flex items-center gap-0.5 font-medium text-violet-700">
                      <SparkleIcon size={11} /> {DOCUMENT_UI.aiRead}
                    </span>
                  ) : null}
                  {doc.assessmentId ? <span>{DOCUMENT_UI.withVisit}</span> : null}
                </div>
              </div>
              <Button size="sm" variant="ghost" loading={opening === doc.id} onClick={() => void open(doc)} className="print:hidden">
                {DOCUMENT_UI.open}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
