/**
 * Local document stash for FSA financial-statement uploads.
 *
 * Users can upload PDF / XLSX / CSV files for a company. Files are
 * stored as base64 in localStorage under `sg4_fsa_docs_<ticker>` with
 * a lightweight metadata index.
 *
 * This is a deliberate MVP — files are kept on the user's device only.
 * A future paid tier can swap this stash for cloud storage without
 * changing any caller; the API below is designed to be drop-in
 * replaceable.
 *
 *   import { listDocs, addDoc, removeDoc, clearDocs, DocRecord } from '@/lib/fsa/uploads'
 *
 * Size cap: 4 MB per file, 16 MB per company (localStorage typical
 * ceilings). Oversized uploads fail with a helpful error so the user
 * knows to either trim the file or wait for the cloud tier.
 */

const STORAGE_PREFIX = 'sg4_fsa_docs_'
const MAX_FILE_BYTES = 4 * 1024 * 1024 // 4 MB per file (base64 expands ~33%)
const MAX_TICKER_BYTES = 16 * 1024 * 1024 // 16 MB per company

export type DocKind = 'pdf' | 'xlsx' | 'xls' | 'csv' | 'other'

export interface DocRecord {
  id: string
  name: string
  kind: DocKind
  sizeBytes: number
  uploadedAt: number // epoch ms
  /** Mime type reported by the browser at upload time. */
  mime: string
  /** Base64-encoded file contents. Can be large. */
  data: string
}

export interface StoredDocIndex {
  ticker: string
  docs: DocRecord[]
  totalBytes: number
}

function kindOf(name: string, mime: string): DocKind {
  const ext = (name.split('.').pop() || '').toLowerCase()
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf'
  if (ext === 'xlsx' || mime.includes('spreadsheetml')) return 'xlsx'
  if (ext === 'xls' || mime === 'application/vnd.ms-excel') return 'xls'
  if (ext === 'csv' || mime === 'text/csv') return 'csv'
  return 'other'
}

function storageKey(ticker: string): string {
  return `${STORAGE_PREFIX}${ticker.toUpperCase()}`
}

function safeJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** List docs for a ticker. Returns an empty index if nothing stored. */
export function listDocs(ticker: string): StoredDocIndex {
  if (typeof window === 'undefined') {
    return { ticker, docs: [], totalBytes: 0 }
  }
  const raw = localStorage.getItem(storageKey(ticker))
  const docs = safeJson<DocRecord[]>(raw, [])
  const totalBytes = docs.reduce((acc, d) => acc + d.sizeBytes, 0)
  return { ticker, docs, totalBytes }
}

function writeDocs(ticker: string, docs: DocRecord[]): void {
  if (typeof window === 'undefined') return
  if (docs.length === 0) {
    localStorage.removeItem(storageKey(ticker))
  } else {
    localStorage.setItem(storageKey(ticker), JSON.stringify(docs))
  }
}

/** Read a `File` as a base64 string (no data URL prefix). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'))
    reader.readAsDataURL(file)
  })
}

export interface AddResult {
  ok: boolean
  error?: string
  record?: DocRecord
}

/** Validate + store a user upload. Returns the stored record on success. */
export async function addDoc(ticker: string, file: File): Promise<AddResult> {
  if (!ticker) return { ok: false, error: 'No ticker provided' }
  if (!file) return { ok: false, error: 'No file provided' }
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      error: `File is ${(file.size / 1024 / 1024).toFixed(1)} MB. Max allowed is ${MAX_FILE_BYTES / 1024 / 1024} MB per file on the local tier — trim it, or upgrade to the cloud tier when available.`,
    }
  }
  const existing = listDocs(ticker)
  if (existing.totalBytes + file.size > MAX_TICKER_BYTES) {
    return {
      ok: false,
      error: `Storage budget exceeded. Ticker ${ticker.toUpperCase()} already has ${(existing.totalBytes / 1024 / 1024).toFixed(1)} MB stored (cap ${MAX_TICKER_BYTES / 1024 / 1024} MB).`,
    }
  }

  let base64: string
  try {
    base64 = await fileToBase64(file)
  } catch (err) {
    return {
      ok: false,
      error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const record: DocRecord = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name,
    kind: kindOf(file.name, file.type),
    sizeBytes: file.size,
    uploadedAt: Date.now(),
    mime: file.type || 'application/octet-stream',
    data: base64,
  }

  try {
    writeDocs(ticker, [...existing.docs, record])
  } catch (err) {
    return {
      ok: false,
      error: `Browser storage full. Clear old docs or upgrade to the cloud tier. (${err instanceof Error ? err.message : String(err)})`,
    }
  }
  return { ok: true, record }
}

/** Delete a single doc by id. */
export function removeDoc(ticker: string, docId: string): boolean {
  const { docs } = listDocs(ticker)
  const filtered = docs.filter((d) => d.id !== docId)
  if (filtered.length === docs.length) return false
  writeDocs(ticker, filtered)
  return true
}

/** Nuke every doc stored for the ticker. */
export function clearDocs(ticker: string): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(storageKey(ticker))
}

/** Trigger a browser download for the stored doc. */
export function downloadDoc(record: DocRecord): void {
  if (typeof window === 'undefined') return
  const byteChars = atob(record.data)
  const bytes = new Uint8Array(byteChars.length)
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i)
  const blob = new Blob([bytes as BlobPart], { type: record.mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = record.name
  a.click()
  URL.revokeObjectURL(url)
}

export const UPLOAD_LIMITS = {
  maxFileBytes: MAX_FILE_BYTES,
  maxTickerBytes: MAX_TICKER_BYTES,
}
