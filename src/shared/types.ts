import type { AiSettings } from './review'
// Types shared by the main process (disk, docx) and the window (UI).
import type { PaneLayout } from './panes'
import type { TypographySettings } from './hebrew'
import type { StopPoint } from './stoppoint'
import type { ChapterSource } from './translation'
import type { PublishSettings } from './publish'
import type { Background } from './background'
import type { BackupSettings } from './backup'
import type { ChapterLabel } from './labels'
import type { Idea, TableColumn } from './plan'

export type ChapterStatus = 'draft' | 'writing' | 'editing' | 'done'

export interface Chapter {
  id: string
  title: string
  /** File name inside the chapters folder, e.g. "03 - מכתבים מחיפה.docx" */
  file: string
  status: ChapterStatus
  synopsis: string
  /** Feature 53: stays in the binder and the master, but is left out of the reading view and every export */
  noExport?: boolean
  /** Feature 44: ids of the book's color labels on this chapter */
  labels?: string[]
  /** Feature 60: values of the table's own columns, by column id */
  custom?: Record<string, string>
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

/** Background pages, glossary, inspiration images and timeline (round 7) are part of the book */
export interface Book extends Background {
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
  /** Private notes (feature 15) */
  notes: PrivateNote[]
  /** Alternative drafts of chapters and scenes (feature 35) */
  alts: AltDraft[]
  /** The original (PDF) of each translated chapter, by chapter id (feature 12) */
  sources: Record<string, ChapterSource>
  /** Front and back pages, author, and page layout for reading and export (features 31, 36, 16) */
  publish: PublishSettings
  /** Color labels the chapters can carry (feature 44), in the writer's order */
  labels: ChapterLabel[]
  /** Feature 59: the idea pile, cards with no place in the book yet */
  ideas: Idea[]
  /** Feature 60: columns the writer added to the table */
  tableColumns: TableColumn[]
  /** Feature 61: a chapter order being tried out; the book itself keeps `outline` until it is applied */
  trialOutline?: OutlineNode[]
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
  /** Put away in the library's archive (not deleted) */
  archived?: boolean
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
  recent: { path: string; title: string; chapterCount: number; lastOpened: number; archived?: boolean }[]
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
  /** The translation screen's panes per book path (feature 12), as they were last left */
  translateLayout?: Record<string, PaneLayout>
  /** Writing review with Claude (feature 19): model, instructions, review kinds. The API key is kept apart, encrypted. */
  ai?: Partial<AiSettings>
  /** The workshop's folder (feature 22), when the writer moved it */
  workshopPath?: string
  /** Auto-update also brings test versions (pre-releases of pull requests); unset = only when running one */
  testUpdates?: boolean
  /** Daily dated copies of each open book (feature 49) */
  backup?: Partial<BackupSettings>
  /** The app's accent color (round 13): a preset id ('green' is the default) or a color like #1a2b3c */
  accent?: string
  /** Feature 56: background sounds and the YouTube player, as last left */
  sounds?: SoundSettings
}

/** Feature 56: music and background sounds while writing */
export interface SoundSettings {
  /** Volume of each built-in sound that is on (0–1), by its id */
  on: Record<string, number>
  /** Volume of all of them together (0–1) */
  master: number
  /** The YouTube link last played, and links played before (newest first) */
  youtube: string
  recentYoutube: string[]
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

// ---------------------------------------------------------------------------
// Saving and drafts (features 14, 15, 27, 35)
// ---------------------------------------------------------------------------

/** A saved copy of a chapter (feature 14). The copy itself is a Word file in the "גרסאות" folder. */
export interface Version {
  id: string
  chapterId: string
  /** When it was taken (ms since 1970) */
  at: number
  /** The writer's name for it; empty for automatic versions */
  label: string
  /** Taken by the app (while writing, before a restore) rather than by the writer */
  auto: boolean
  /** Why the app took it, e.g. "לפני שחזור" */
  reason?: string
  words: number
}

/** A private note (feature 15): never part of the chapter file or an export. */
export interface PrivateNote {
  id: string
  chapterId: string
  text: string
  at: number
  /** The words it is attached to; missing for a note about the whole chapter */
  anchor?: { pos: number; before: string; after: string; quote: string }
}

/** A piece of text that was cut or deleted, kept in the book's drawer (feature 27) */
export interface DrawerItem {
  id: string
  /** Plain text, for the list and for search */
  text: string
  /** The piece with its formatting (editor JSON of the slice content), to put back as it was */
  content: PMNode[]
  /** How open the piece's ends are (ProseMirror slice openStart/openEnd), to put it back like a paste */
  open?: [number, number]
  chapterId: string | null
  chapterTitle: string
  at: number
  how: 'cut' | 'delete' | 'manual'
}

/** An alternative draft of a chapter or of one scene in it (feature 35). A Word file of its own. */
export interface AltDraft {
  id: string
  chapterId: string
  name: string
  /** File name inside the "טיוטות חלופיות" folder */
  file: string
  at: number
  /** Set when the draft is of one scene: which scene, and its first words when it was made */
  scene?: { index: number; label: string }
}
