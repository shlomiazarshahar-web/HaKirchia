// Types shared by the main process (disk, docx) and the window (UI).
import type { PaneLayout } from './panes'
import type { TypographySettings } from './hebrew'
import type { StopPoint } from './stoppoint'

export type ChapterStatus = 'draft' | 'writing' | 'editing' | 'done'

export interface Chapter {
  id: string
  title: string
  /** File name inside the chapters folder, e.g. "03 - מכתבים מחיפה.docx" */
  file: string
  status: ChapterStatus
  synopsis: string
}

/** A part (חלק) groups consecutive chapters, e.g. "חלק ראשון: הנמל". */
export interface PartNode {
  type: 'part'
  id: string
  title: string
  /** Closed in the binder (does not affect the master) */
  collapsed?: boolean
  /** Chapter ids, in order */
  children: string[]
}
export interface ChapterRef {
  type: 'chapter'
  id: string
}
/** The binder tree: chapters and parts at the top level, chapters inside parts. */
export type OutlineNode = ChapterRef | PartNode

export interface Book {
  /** Absolute path of the book folder */
  path: string
  title: string
  /** All chapters, flat, in reading order (the order of the tree) */
  chapters: Chapter[]
  outline: OutlineNode[]
  /** Where the writer stopped last time, with the "what next" note */
  stopPoint?: StopPoint
  /** "Come back here" bookmarks (feature 30), in the order they were added */
  bookmarks: Bookmark[]
}

/**
 * A "come back here" bookmark (feature 30). Like the stopping point, the place is a position plus
 * the text around it, so it is found again after edits (also edits made in Word).
 */
export interface Bookmark {
  id: string
  chapterId: string
  pos: number
  before: string
  after: string
  /** What to come back for; may be empty (then the text around it is shown) */
  label: string
  /** When it was added (ms since 1970) */
  at: number
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
  /** Split screen panes per book path, as they were last left */
  splitLayout?: Record<string, PaneLayout>
  /** Size of the whole interface (1 = 100%) */
  zoom?: number
  /** Fonts the user added (available in every book) */
  customFonts?: CustomFont[]
  /** Automatic Hebrew typography while typing */
  typography?: TypographySettings
  /** Red underline for spelling mistakes (default on) */
  spellcheck?: boolean
  /** Focused writing mode: what it shows */
  focus?: FocusSettings
  /** Ask "what next?" when closing a book (default on) */
  askStopNote?: boolean
}

export interface FocusSettings {
  /** The line being written stays in the middle of the screen */
  typewriter: boolean
  /** Paragraphs other than the one being written are faded */
  dim: boolean
}

export const DEFAULT_FOCUS: FocusSettings = { typewriter: true, dim: false }

/** A font the user added: installed in Windows, or a font file copied into the app's folder. */
export interface CustomFont {
  family: string
  /** File name inside the app's fonts folder; missing for fonts installed in Windows */
  file?: string
}

export interface SpellStatus {
  enabled: boolean
  /** Languages being checked, e.g. ["he", "en-US"] */
  languages: string[]
  /** Hebrew dictionary could not be downloaded (needs internet the first time) */
  hebrewMissing: boolean
  words: string[]
}

export const STATUS_LABELS: Record<ChapterStatus, string> = {
  draft: 'טיוטה',
  writing: 'בכתיבה',
  editing: 'בעריכה',
  done: 'גמור'
}
