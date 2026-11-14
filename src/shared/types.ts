// Types shared by the main process (disk, docx) and the window (UI).

export type ChapterStatus = 'draft' | 'writing' | 'editing' | 'done'

export interface Chapter {
  id: string
  title: string
  /** File name inside the chapters folder, e.g. "03 - מכתבים מחיפה.docx" */
  file: string
  status: ChapterStatus
  synopsis: string
}

export interface Book {
  /** Absolute path of the book folder */
  path: string
  title: string
  chapters: Chapter[]
}

export interface RecentBook {
  path: string
  title: string
  chapterCount: number
  lastOpened: number
  /** false when the folder no longer exists on disk */
  exists: boolean
}

/** A ProseMirror / TipTap JSON node */
export interface PMMark {
  type: string
  attrs?: Record<string, unknown>
}
export interface PMNode {
  type: string
  attrs?: Record<string, unknown>
  content?: PMNode[]
  text?: string
  marks?: PMMark[]
}

export interface LoadedChapter {
  doc: PMNode
  /** Things in the file that the editor cannot show yet (images, tables...) */
  warnings: string[]
}

export interface OpResult<T> {
  ok: boolean
  value?: T
  error?: string
  /** A non-fatal note to show the user, e.g. "file is open in Word, name kept" */
  notice?: string
}

export type Theme = 'light' | 'dark'

export interface Settings {
  theme: Theme
  recent: { path: string; title: string; chapterCount: number; lastOpened: number }[]
  lastChapter: Record<string, string>
  defaultFolder?: string
}

export const STATUS_LABELS: Record<ChapterStatus, string> = {
  draft: 'טיוטה',
  writing: 'בכתיבה',
  editing: 'בעריכה',
  done: 'גמור'
}
