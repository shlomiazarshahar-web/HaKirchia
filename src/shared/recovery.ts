// Feature 41: crash recovery. While the writer types, the text that is not yet in its Word file is
// also kept in a small file on the computer's own disk (not in the book folder, which may be on a
// network or Google Drive). A successful save removes it. Whatever is left there when the app
// starts again was never saved, and the app offers to bring it back.

import type { PMNode } from './types'

export type RecoveryKind = 'chapter' | 'alt' | 'material' | 'exercise'

/** What is kept for one document with unsaved typing */
export interface RecoveryEntry {
  kind: RecoveryKind
  /** The book folder (for an exercise: the workshop folder) */
  bookPath: string
  /** The chapter, alternative draft, background page or exercise */
  id: string
  doc: PMNode
  /** When it was last written (ms) */
  at: number
}

/** One unsaved text as the recovery dialog shows it */
export interface RecoveryItem {
  key: string
  kind: RecoveryKind
  bookPath: string
  id: string
  at: number
  bookTitle: string
  /** The chapter's (or page's, draft's, exercise's) name */
  title: string
  /** Words in the unsaved text, and in the file on disk now */
  words: number
  diskWords: number | null
  /** The last words of the unsaved text, to recognise it */
  preview: string
  /** Why it cannot be put back in its place right now (book folder missing, chapter deleted…) */
  missing?: string
}

export const recoveryKey = (kind: RecoveryKind, bookPath: string, id: string) => `${kind}|${bookPath}|${id}`

/** How often typing is written to the recovery file (ms) while the writer keeps typing */
export const RECOVERY_EVERY_MS = 1500

/** Unsaved texts older than this are dropped without asking (days) */
export const RECOVERY_MAX_DAYS = 60

/** The end of a text, for a preview: the last ~`n` characters, cut at a word */
export function tailPreview(text: string, n = 110): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= n) return t
  const cut = t.slice(t.length - n)
  const sp = cut.indexOf(' ')
  return '…' + (sp >= 0 && sp < 30 ? cut.slice(sp + 1) : cut)
}

export const KIND_LABEL: Record<RecoveryKind, string> = {
  chapter: 'פרק',
  alt: 'טיוטה חלופית',
  material: 'דף רקע',
  exercise: 'תרגיל בסדנה'
}
