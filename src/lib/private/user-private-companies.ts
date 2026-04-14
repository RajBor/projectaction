/**
 * User-added private companies stash.
 *
 * Lets a user add a private company the editorial dataset does not
 * cover yet, together with source documents (PDF / Excel / Word / CSV)
 * that back the numbers. Stored locally under
 * `sg4_user_private_companies` plus `sg4_user_private_docs_<ID>` for
 * the attached blobs (kept separate so the metadata index stays small).
 *
 * This is intentionally an MVP: the user provides the basic fields, the
 * docs are kept as attachments that a follow-up parser can mine. The
 * existing `src/lib/fsa/uploads.ts` API is the model for file storage.
 */
import type { PrivateCompany } from '@/lib/data/private-companies'

const INDEX_KEY = 'sg4_user_private_companies'
const DOCS_PREFIX = 'sg4_user_private_docs_'
const MAX_FILE_BYTES = 4 * 1024 * 1024 // 4 MB
const MAX_ENTRY_BYTES = 16 * 1024 * 1024 // 16 MB per record (all attached docs)

export type UserDocKind = 'pdf' | 'xlsx' | 'xls' | 'csv' | 'docx' | 'doc' | 'other'

export interface UserDoc {
  id: string
  name: string
  kind: UserDocKind
  mime: string
  sizeBytes: number
  uploadedAt: number
  /** Base64 (no data-URL prefix). */
  data: string
}

export interface UserPrivateCompany extends PrivateCompany {
  /** Unique id generated at creation; stable across sessions. */
  id: string
  /** Epoch ms this record was created. */
  createdAt: number
  /** Lightweight attachment metadata (blobs live under DOCS_PREFIX). */
  attachments: Array<{
    id: string
    name: string
    kind: UserDocKind
    sizeBytes: number
    uploadedAt: number
  }>
  /** Marker — used by the UI to distinguish user entries from editorial ones. */
  userAdded: true
}

function safeJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function docKeyFor(id: string): string {
  return `${DOCS_PREFIX}${id}`
}

function kindOf(name: string, mime: string): UserDocKind {
  const ext = (name.split('.').pop() || '').toLowerCase()
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf'
  if (ext === 'xlsx' || mime.includes('spreadsheetml')) return 'xlsx'
  if (ext === 'xls' || mime === 'application/vnd.ms-excel') return 'xls'
  if (ext === 'csv' || mime === 'text/csv') return 'csv'
  if (ext === 'docx' || mime.includes('wordprocessingml')) return 'docx'
  if (ext === 'doc' || mime === 'application/msword') return 'doc'
  return 'other'
}

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

export function listUserPrivateCompanies(): UserPrivateCompany[] {
  if (typeof window === 'undefined') return []
  return safeJson<UserPrivateCompany[]>(localStorage.getItem(INDEX_KEY), [])
}

function writeIndex(rows: UserPrivateCompany[]): void {
  if (typeof window === 'undefined') return
  if (rows.length === 0) localStorage.removeItem(INDEX_KEY)
  else localStorage.setItem(INDEX_KEY, JSON.stringify(rows))
}

export interface AddUserPrivateCompanyInput {
  name: string
  stage: string
  founded: number
  hq: string
  sec: 'solar' | 'td'
  comp: string[]
  cap: string
  rev_est: number
  ev_est: number
  ebm_est: number
  revg_est: number
  tech: string
  pli: string
  almm: string
  ipo: string
  acqs: number
  acqf: string
  rea: string
  files: File[]
}

export interface AddResult {
  ok: boolean
  error?: string
  record?: UserPrivateCompany
}

export async function addUserPrivateCompany(
  input: AddUserPrivateCompanyInput
): Promise<AddResult> {
  if (!input.name.trim()) return { ok: false, error: 'Company name is required.' }
  if (typeof window === 'undefined') {
    return { ok: false, error: 'Local storage unavailable.' }
  }

  const id = `usr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const createdAt = Date.now()

  // Validate and stage docs first so we fail cleanly before touching
  // the index if a file is too large.
  let totalSize = 0
  const docs: UserDoc[] = []
  for (const file of input.files) {
    if (file.size > MAX_FILE_BYTES) {
      return {
        ok: false,
        error: `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB. Max ${MAX_FILE_BYTES / 1024 / 1024} MB per file.`,
      }
    }
    totalSize += file.size
    if (totalSize > MAX_ENTRY_BYTES) {
      return {
        ok: false,
        error: `Attachments exceed ${MAX_ENTRY_BYTES / 1024 / 1024} MB per record. Trim before uploading.`,
      }
    }
    let base64: string
    try {
      base64 = await fileToBase64(file)
    } catch (err) {
      return {
        ok: false,
        error: `Failed to read "${file.name}": ${err instanceof Error ? err.message : String(err)}`,
      }
    }
    docs.push({
      id: `${id}-${docs.length}`,
      name: file.name,
      kind: kindOf(file.name, file.type),
      mime: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      uploadedAt: createdAt,
      data: base64,
    })
  }

  const record: UserPrivateCompany = {
    id,
    createdAt,
    userAdded: true,
    name: input.name.trim(),
    stage: input.stage || 'Private',
    founded: input.founded || new Date().getFullYear(),
    hq: input.hq || '—',
    sec: input.sec,
    comp: input.comp,
    cap: input.cap || '—',
    rev_est: input.rev_est || 0,
    ev_est: input.ev_est || 0,
    ebm_est: input.ebm_est || 0,
    revg_est: input.revg_est || 0,
    tech: input.tech || '—',
    pli: input.pli || '—',
    almm: input.almm || '—',
    ipo: input.ipo || '—',
    acqs: input.acqs || 5,
    acqf: input.acqf || 'CONSIDER',
    rea: input.rea || '—',
    attachments: docs.map((d) => ({
      id: d.id,
      name: d.name,
      kind: d.kind,
      sizeBytes: d.sizeBytes,
      uploadedAt: d.uploadedAt,
    })),
  }

  try {
    const existing = listUserPrivateCompanies()
    writeIndex([...existing, record])
    if (docs.length > 0) {
      localStorage.setItem(docKeyFor(id), JSON.stringify(docs))
    }
  } catch (err) {
    return {
      ok: false,
      error: `Browser storage full. Remove existing records or trim attachments. (${err instanceof Error ? err.message : String(err)})`,
    }
  }

  return { ok: true, record }
}

export function removeUserPrivateCompany(id: string): boolean {
  const rows = listUserPrivateCompanies()
  const next = rows.filter((r) => r.id !== id)
  if (next.length === rows.length) return false
  writeIndex(next)
  localStorage.removeItem(docKeyFor(id))
  return true
}

export function getUserPrivateDocs(id: string): UserDoc[] {
  if (typeof window === 'undefined') return []
  return safeJson<UserDoc[]>(localStorage.getItem(docKeyFor(id)), [])
}

export const USER_PRIVATE_UPLOAD_LIMITS = {
  maxFileBytes: MAX_FILE_BYTES,
  maxEntryBytes: MAX_ENTRY_BYTES,
}
