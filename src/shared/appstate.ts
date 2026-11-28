// Round 16: the app's state shared by several computers (books list, where you stand in each book,
// writing settings, fonts, the workshop) in one file inside a folder the writer chooses, normally a
// Google Drive folder that every computer sees. Each computer keeps its own copy of everything in
// its settings.json too, so the app works the same when the shared folder is not reachable.
//
// Paths differ between computers (C: on one, G: on another), so the file keeps, for every book,
// the path on each computer by the computer's id. Changing the path on one computer never touches
// the path the other computer uses.
//
// Pure logic only (no disk): the main process reads and writes the file (main/settings.ts).

import type { PaneLayout } from './panes'
import type { Settings } from './types'

export const APP_STATE_FILE = 'מצב הכריכייה.json'
/** Font files added on one computer are copied here, so the others can use them too */
export const SYNC_FONTS_DIR = 'גופנים'

/** Settings that are the same on every computer (simple values, copied as they are) */
export const SHARED_SIMPLE_KEYS = ['theme', 'customFonts', 'typography', 'spellcheck', 'focus', 'askStopNote', 'ai', 'accent', 'sounds', 'dictionary'] as const
type SimpleKey = (typeof SHARED_SIMPLE_KEYS)[number]

export interface SyncedBook {
  id: string
  title: string
  chapterCount: number
  lastOpened: number
  archived?: boolean
  /** The book's folder on each computer, by computer id */
  paths: Record<string, string>
  /** The chapter shown last, the split-screen panes and the translation panes */
  lastChapter?: string
  split?: PaneLayout
  translate?: PaneLayout
}

export interface AppState {
  app: 'hakirchia'
  kind: 'app-state'
  version: 1
  saved: number
  /** The computer that saved last (its name) */
  savedBy: string
  /** The computers that use this file: id → name, last time seen */
  computers: Record<string, { name: string; seen: number }>
  books: SyncedBook[]
  /** The workshop's folder on each computer */
  workshop: { paths: Record<string, string> }
  settings: Partial<Pick<Settings, SimpleKey>>
}

export type RecentEntry = Settings['recent'][number]

export function emptyState(): AppState {
  return { app: 'hakirchia', kind: 'app-state', version: 1, saved: 0, savedBy: '', computers: {}, books: [], workshop: { paths: {} }, settings: {} }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const strMap = (v: unknown): Record<string, string> => (isObj(v) ? Object.fromEntries(Object.entries(v).filter(([, p]) => typeof p === 'string' && p)) as Record<string, string> : {})

/** Reads the file's JSON, keeping only what makes sense. Throws when it is not an app-state file. */
export function normalizeState(raw: unknown): AppState {
  if (!isObj(raw) || raw.kind !== 'app-state') throw new Error('זה לא קובץ מצב של הכריכייה')
  const s = emptyState()
  s.saved = typeof raw.saved === 'number' ? raw.saved : 0
  s.savedBy = typeof raw.savedBy === 'string' ? raw.savedBy : ''
  if (isObj(raw.computers)) {
    for (const [id, c] of Object.entries(raw.computers)) if (isObj(c)) s.computers[id] = { name: String(c.name ?? ''), seen: Number(c.seen) || 0 }
  }
  const seen = new Set<string>()
  for (const b of Array.isArray(raw.books) ? raw.books : []) {
    if (!isObj(b) || typeof b.id !== 'string' || !b.id || seen.has(b.id)) continue
    seen.add(b.id)
    s.books.push({
      id: b.id,
      title: typeof b.title === 'string' ? b.title : 'ספר',
      chapterCount: Number(b.chapterCount) || 0,
      lastOpened: Number(b.lastOpened) || 0,
      ...(b.archived ? { archived: true } : {}),
      paths: strMap(b.paths),
      ...(typeof b.lastChapter === 'string' ? { lastChapter: b.lastChapter } : {}),
      ...(isObj(b.split) ? { split: b.split as unknown as PaneLayout } : {}),
      ...(isObj(b.translate) ? { translate: b.translate as unknown as PaneLayout } : {})
    })
  }
  s.workshop = { paths: strMap(isObj(raw.workshop) ? raw.workshop.paths : undefined) }
  if (isObj(raw.settings)) for (const k of SHARED_SIMPLE_KEYS) if (raw.settings[k] !== undefined) (s.settings as Record<string, unknown>)[k] = raw.settings[k]
  return s
}

/**
 * Which folder to use on this computer: this computer's own path when it is there; otherwise a path
 * another computer uses, if it exists here too (the same Google Drive letter); otherwise nothing is
 * available, and the path shown is this computer's (or another's) so the writer sees what is missing.
 */
export function resolvePath(paths: Record<string, string>, pc: string, exists: (p: string) => boolean): { path: string; available: boolean; borrowed: boolean } {
  const own = paths[pc]
  if (own && exists(own)) return { path: own, available: true, borrowed: false }
  for (const [id, p] of Object.entries(paths)) if (id !== pc && p && p !== own && exists(p)) return { path: p, available: true, borrowed: true }
  return { path: own ?? Object.values(paths)[0] ?? '', available: false, borrowed: false }
}

/** What the rest of the app sees: this computer's own settings, with the shared ones on top */
export function viewOf(state: AppState, local: Settings, pc: string, exists: (p: string) => boolean): Settings {
  const view: Settings = { ...local }
  for (const k of SHARED_SIMPLE_KEYS) {
    const v = state.settings[k]
    if (v !== undefined) (view as unknown as Record<string, unknown>)[k] = v
  }
  const lastChapter: Record<string, string> = {}
  const splitLayout: Record<string, PaneLayout> = {}
  const translateLayout: Record<string, PaneLayout> = {}
  view.recent = state.books.map((b) => {
    const { path, available } = resolvePath(b.paths, pc, exists)
    if (b.lastChapter) lastChapter[path] = b.lastChapter
    if (b.split) splitLayout[path] = b.split
    if (b.translate) translateLayout[path] = b.translate
    return {
      id: b.id,
      path,
      title: b.title,
      chapterCount: b.chapterCount,
      lastOpened: b.lastOpened,
      ...(b.archived ? { archived: true } : {}),
      ...(available ? {} : { unavailable: true })
    }
  })
  view.lastChapter = lastChapter
  view.splitLayout = splitLayout
  view.translateLayout = translateLayout
  const ws = Object.keys(state.workshop.paths).length ? resolvePath(state.workshop.paths, pc, exists) : null
  if (ws) {
    view.workshopPath = ws.path
    view.workshopUnavailable = !ws.available
  } else delete view.workshopUnavailable
  return view
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

let counter = 0
export const newBookId = () => `b${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 8)}`

/**
 * Carries one change of the settings into the shared file's contents. `before` and `after` are what
 * the app saw before and after the change; only what differs between them is written, on top of the
 * file as it is now on disk (`state`), so a change made meanwhile on another computer is kept.
 */
export function applyChange(state: AppState, before: Settings, after: Settings, pc: string, exists: (p: string) => boolean): AppState {
  const next: AppState = { ...state, settings: { ...state.settings }, books: state.books.map((b) => ({ ...b, paths: { ...b.paths } })), workshop: { paths: { ...state.workshop.paths } } }
  for (const k of SHARED_SIMPLE_KEYS) {
    if (!same(before[k], after[k])) {
      if (after[k] === undefined) delete next.settings[k]
      else (next.settings as Record<string, unknown>)[k] = after[k]
    }
  }

  // The books list
  const oldById = new Map(before.recent.filter((r) => r.id).map((r) => [r.id!, r]))
  const newIds = new Set(after.recent.map((r) => r.id).filter(Boolean))
  // A book that got its real id (from its folder) keeps everything it had under the old one
  for (const r of after.recent) {
    if (r.prevId && r.id && r.prevId !== r.id && !next.books.some((b) => b.id === r.id)) {
      const b = next.books.find((x) => x.id === r.prevId)
      if (b) b.id = r.id
    }
  }
  for (const id of oldById.keys()) if (!newIds.has(id)) next.books = next.books.filter((b) => b.id !== id)
  const order: string[] = []
  for (const r of after.recent) {
    const id = r.id ?? next.books.find((b) => b.paths[pc] === r.path)?.id ?? newBookId()
    r.id = id
    order.push(id)
    const old = oldById.get(id)
    let b = next.books.find((x) => x.id === id)
    if (!b) {
      b = { id, title: r.title, chapterCount: r.chapterCount, lastOpened: r.lastOpened, paths: {} }
      next.books.push(b)
    }
    if (!old || !same({ ...old, unavailable: undefined }, { ...r, unavailable: undefined })) {
      b.title = r.title
      b.chapterCount = r.chapterCount
      b.lastOpened = Math.max(b.lastOpened, r.lastOpened)
      if (r.archived) b.archived = true
      else delete b.archived
    }
    // This computer's path: only a folder that is really here (not a path borrowed from another computer that is missing)
    if (r.path && b.paths[pc] !== r.path && (exists(r.path) || !Object.keys(b.paths).length)) b.paths[pc] = r.path
  }
  // Books first in the order this computer has them (most recent first); books only the file knows keep their place at the end
  const rank = new Map(order.map((id, i) => [id, i]))
  next.books.sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9) || b.lastOpened - a.lastOpened)

  // Per-book state, kept in the book's entry (paths differ between computers, ids do not)
  const idOf = (path: string) => after.recent.find((r) => r.path === path)?.id
  const perBook = (field: 'lastChapter' | 'split' | 'translate', b4: Record<string, unknown> | undefined, af: Record<string, unknown> | undefined) => {
    const keys = new Set([...Object.keys(b4 ?? {}), ...Object.keys(af ?? {})])
    for (const path of keys) {
      const v = af?.[path]
      if (same(b4?.[path], v)) continue
      const id = idOf(path)
      const b = id && next.books.find((x) => x.id === id)
      if (!b) continue
      if (v === undefined) delete b[field]
      else (b as unknown as Record<string, unknown>)[field] = v
    }
  }
  perBook('lastChapter', before.lastChapter, after.lastChapter)
  perBook('split', before.splitLayout, after.splitLayout)
  perBook('translate', before.translateLayout, after.translateLayout)

  if (before.workshopPath !== after.workshopPath && after.workshopPath && (exists(after.workshopPath) || !Object.keys(next.workshop.paths).length)) next.workshop.paths[pc] = after.workshopPath
  return next
}

/**
 * The first time a computer joins a shared file: the file keeps what it has (the other computer's
 * settings win), and this computer's books that the file does not know yet are added to it.
 * With no file yet, everything this computer has becomes the file.
 */
export function joinState(existing: AppState | null, local: Settings, pc: string, pcName: string, exists: (p: string) => boolean, now = Date.now()): AppState {
  const base = existing ?? emptyState()
  const blank: Settings = { ...local, recent: [], lastChapter: {}, splitLayout: {}, translateLayout: {}, workshopPath: undefined }
  for (const k of SHARED_SIMPLE_KEYS) delete blank[k]
  const before: Settings = existing ? viewOf(existing, { ...local, recent: [] }, pc, exists) : blank
  // Books this computer knows: matched by id, or by being the same folder as a book in the file
  const known = new Map(before.recent.map((r) => [r.id!, r]))
  const after: Settings = { ...before, recent: [...before.recent], lastChapter: { ...before.lastChapter }, splitLayout: { ...before.splitLayout }, translateLayout: { ...before.translateLayout } }
  for (const r of local.recent) {
    const inFile = (x: RecentEntry) => Object.values(base.books.find((b) => b.id === x.id)?.paths ?? {}).includes(r.path)
    const match = (r.id && known.get(r.id)) || before.recent.find((x) => x.path === r.path) || before.recent.find(inFile)
    if (match) {
      // the same book: this computer's path is remembered for it
      const i = after.recent.findIndex((x) => x.id === match.id)
      after.recent[i] = { ...after.recent[i], path: exists(r.path) ? r.path : after.recent[i].path, lastOpened: Math.max(after.recent[i].lastOpened, r.lastOpened) }
      for (const [k, from] of [['lastChapter', local.lastChapter], ['splitLayout', local.splitLayout], ['translateLayout', local.translateLayout]] as const) {
        const rec = after[k] as Record<string, unknown>
        if (from?.[r.path] !== undefined && rec[after.recent[i].path] === undefined) rec[after.recent[i].path] = from[r.path]
      }
    } else {
      after.recent.push({ ...r })
      if (local.lastChapter?.[r.path]) after.lastChapter[r.path] = local.lastChapter[r.path]
      if (local.splitLayout?.[r.path]) after.splitLayout![r.path] = local.splitLayout[r.path]
      if (local.translateLayout?.[r.path]) after.translateLayout![r.path] = local.translateLayout[r.path]
    }
  }
  if (!existing) {
    for (const k of SHARED_SIMPLE_KEYS) if (local[k] !== undefined) (after as unknown as Record<string, unknown>)[k] = local[k]
    after.workshopPath = local.workshopPath
  } else if (local.dictionary?.length) {
    // the personal dictionary: words from both computers
    after.dictionary = [...new Set([...(before.dictionary ?? []), ...local.dictionary])]
  }
  if (!Object.keys(base.workshop.paths).length) after.workshopPath = local.workshopPath
  const next = applyChange(base, before, after, pc, exists)
  next.computers = { ...next.computers, [pc]: { name: pcName, seen: now } }
  return next
}

/** Who saved the file last, and when this computer was last seen */
export function stamp(state: AppState, pc: string, pcName: string, now = Date.now()): AppState {
  return { ...state, saved: now, savedBy: pcName, computers: { ...state.computers, [pc]: { name: pcName, seen: now } } }
}

/** What the settings screen shows about sharing */
export interface SyncStatus {
  folder: string | null
  /** The shared file was read and is up to date */
  connected: boolean
  error: string
  computerName: string
  computers: { name: string; seen: number; me: boolean }[]
  savedAt: number
  savedBy: string
  waiting: number
}
