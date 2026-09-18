/**
 * Getting a lab sheet or antenatal card from the midwife's phone to the model.
 *
 * PHOTOS ARE RE-DRAWN BEFORE THEY LEAVE THE PHONE. A phone photo is 3–12 MB,
 * which is over the 4.5 MB a serverless request may carry and slow on village
 * data; drawn again at 2000 px on the long edge it is a few hundred kB and
 * still sharp enough to read print. Re-drawing also drops the photo's metadata,
 * which on a phone includes the GPS position of the woman's home.
 *
 * PDFs are sent as they are, so they are capped instead.
 */

export const DOCUMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

/** What the file picker offers. */
export const DOCUMENT_ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf'

/** Base64 grows a file by a third; 3 MB of PDF stays under the endpoint's 4 MB cap. */
export const MAX_PDF_BYTES = 3_000_000
/** A photo this large is not a phone photo. */
export const MAX_IMAGE_BYTES = 30_000_000
export const IMAGE_MAX_EDGE = 2000
const JPEG_QUALITY = 0.85

export type DocumentProblem = 'unsupported_type' | 'too_large' | 'unreadable'

/** The type a file really is, from its MIME type or, when a system leaves that blank, its name. */
export function documentTypeOf(mime: string, name: string): DocumentType | null {
  if ((DOCUMENT_TYPES as readonly string[]).includes(mime)) return mime as DocumentType
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'pdf') return 'application/pdf'
  return null
}

export function checkDocument(mime: string, name: string, bytes: number): DocumentProblem | null {
  const type = documentTypeOf(mime, name)
  if (type === null) return 'unsupported_type'
  if (bytes <= 0) return 'unreadable'
  if (type === 'application/pdf' && bytes > MAX_PDF_BYTES) return 'too_large'
  if (type !== 'application/pdf' && bytes > MAX_IMAGE_BYTES) return 'too_large'
  return null
}

/** The size to draw an image at: the long edge at most IMAGE_MAX_EDGE, never enlarged. */
export function fitWithin(width: number, height: number, maxEdge: number = IMAGE_MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

export interface PreparedDocument {
  mediaType: DocumentType
  /** Base64, no data: prefix — what the endpoint takes. */
  data: string
  /** What is kept with the record, when document storage is set up. */
  blob: Blob
  name: string
  /** For an image: an object URL for the thumbnail. Revoke it when done. */
  previewUrl: string | null
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result)
      resolve(url.slice(url.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(blob)
  })
}

async function redrawImage(file: Blob): Promise<Blob> {
  // from-image: a portrait photo stays portrait, whatever its EXIF says.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (ctx === null) throw new Error('no 2d context')
    // White under a transparent PNG, so text on it stays readable as JPEG.
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encode failed'))), 'image/jpeg', JPEG_QUALITY),
    )
  } finally {
    bitmap.close()
  }
}

/** Browser only. Never throws: a file it cannot use comes back as a problem. */
export async function prepareDocument(file: File): Promise<PreparedDocument | DocumentProblem> {
  const problem = checkDocument(file.type, file.name, file.size)
  if (problem !== null) return problem
  const type = documentTypeOf(file.type, file.name)!
  try {
    if (type === 'application/pdf') {
      return { mediaType: type, data: await toBase64(file), blob: file, name: file.name, previewUrl: null }
    }
    const jpeg = await redrawImage(file)
    return {
      mediaType: 'image/jpeg',
      data: await toBase64(jpeg),
      blob: jpeg,
      name: file.name.replace(/\.[^.]+$/, '') + '.jpg',
      previewUrl: URL.createObjectURL(jpeg),
    }
  } catch {
    return 'unreadable'
  }
}
