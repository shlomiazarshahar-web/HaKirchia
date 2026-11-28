// The app's settings. Each computer keeps everything in its own settings.json (userData). Round 16:
// when the writer chooses a shared folder (Google Drive), the books list, where they stand in each
// book and the writing settings also live in "מצב הכריכייה.json" in that folder, so every computer
// that points at the same folder works with the same state (see shared/appstate.ts).
import { app } from 'electron'
import { promises as fs, readFileSync, existsSync, statSync, mkdirSync, copyFileSync, readdirSync } from 'fs'
import { join, basename } from 'path'
import { hostname } from 'os'
import { randomUUID } from 'crypto'
import type { Settings } from '../shared/types'
import { APP_STATE_FILE, SYNC_FONTS_DIR, applyChange, joinState, normalizeState, stamp, viewOf, type AppState, type SyncStatus } from '../shared/appstate'

const file = () => join(app.getPath('userData'), 'settings.json')
const DEFAULTS: Settings = { theme: 'light', recent: [], lastChapter: {} }

/** This computer's own copy (also the last state seen from the shared folder) */
let local: Settings | null = null
/** The shared file as last read (null when there is no shared folder, or it cannot be reached) */
let shared: AppState | null = null
let sharedMtime = 0
/** What the app sees: `local`, or the shared state on top of it */
let view: Settings | null = null
/** Changes not yet written to the shared file (also while it cannot be reached) */
let pending: { before: Settings; after: Settings }[] = []
let lastError = ''

const exists = (p: string) => {
  try {
    return !!p && existsSync(p)
  } catch {
    return false
  }
}
const sharedFile = () => (local?.syncFolder ? join(local.syncFolder, APP_STATE_FILE) : '')
const pc = () => local!.pcId!
const pcName = () => local!.pcName || hostname() || 'מחשב'

function readLocal(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(file(), 'utf8')) }
  } catch {
    return { ...DEFAULTS }
  }
}

function readSharedSync(): AppState | null {
  const f = sharedFile()
  if (!f) return null
  try {
    const st = statSync(f)
    const state = normalizeState(JSON.parse(readFileSync(f, 'utf8')))
    sharedMtime = st.mtimeMs
    lastError = ''
    return state
  } catch (e) {
    lastError = exists(local!.syncFolder!) ? (exists(f) ? 'קובץ המצב בתיקייה המשותפת לא נקרא' : '') : 'התיקייה המשותפת לא זמינה במחשב הזה כרגע'
    void e
    return null
  }
}

const clean = (s: Settings): Settings => ({ ...s, recent: s.recent.map(({ prevId: _p, unavailable: _u, ...r }) => r), workshopUnavailable: undefined })

function recompute(): void {
  view = shared ? viewOf(shared, local!, pc(), exists) : local!
}

export function getSettings(): Settings {
  if (view) return view
  local = readLocal()
  if (!local.pcId) {
    local.pcId = randomUUID()
    local.pcName = hostname() || 'מחשב'
    writeLocal()
  }
  shared = readSharedSync()
  recompute()
  return view!
}

let writing = Promise.resolve()
function writeLocal(): void {
  const snapshot = JSON.stringify(clean(local!), null, 2)
  writing = writing.then(() => fs.writeFile(file(), snapshot, 'utf8')).catch(() => undefined)
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const before = getSettings()
  const after: Settings = { ...before, ...patch }
  if (Object.keys(patch).every((k) => JSON.stringify(before[k as keyof Settings]) === JSON.stringify(after[k as keyof Settings]))) return before
  // this computer's copy follows what the app sees (so it works the same without the shared folder)
  local = { ...after, syncFolder: local!.syncFolder, pcId: local!.pcId, pcName: local!.pcName }
  if (local.syncFolder) {
    pending.push({ before, after })
    if (shared) shared = applyChange(shared, before, after, pc(), exists)
    scheduleShared()
  }
  writeLocal()
  recompute()
  return view!
}

// ---------------------------------------------------------------------------
// The shared file
// ---------------------------------------------------------------------------

let timer: ReturnType<typeof setTimeout> | null = null
let sharedWriting: Promise<void> = Promise.resolve()
const SAVE_MS = 1500

function scheduleShared(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void flushShared(), SAVE_MS)
}

async function writeShared(state: AppState): Promise<void> {
  const f = sharedFile()
  const tmp = f + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(state, null, 1), 'utf8')
  await fs.rename(tmp, f)
  sharedMtime = (await fs.stat(f)).mtimeMs
}

/** Reads the file as it is now (another computer may have changed it), puts this computer's changes on top, and writes it */
export function flushShared(): Promise<void> {
  if (timer) clearTimeout(timer)
  timer = null
  sharedWriting = sharedWriting.then(async () => {
    if (!local?.syncFolder || !pending.length) return
    const fresh = readSharedSync()
    if (!fresh) {
      // not reachable now: the changes wait (and the app keeps working from this computer's copy)
      shared = null
      recompute()
      return
    }
    let next = fresh
    for (const c of pending) next = applyChange(next, c.before, c.after, pc(), exists)
    next = stamp(next, pc(), pcName())
    try {
      await writeShared(next)
      pending = []
      shared = next
      lastError = ''
    } catch {
      lastError = 'לא הצלחתי לשמור את קובץ המצב בתיקייה המשותפת'
      shared = next
    }
    recompute()
  })
  return sharedWriting
}

/**
 * Called when the window comes back to the front: if another computer changed the shared file
 * meanwhile, it is read again. Returns true when something the app shows may have changed.
 */
export async function reloadShared(): Promise<boolean> {
  if (!local?.syncFolder) return false
  await sharedWriting
  const f = sharedFile()
  let mtime = 0
  try {
    mtime = (await fs.stat(f)).mtimeMs
  } catch {
    const was = !!shared
    if (was) {
      shared = null
      lastError = 'התיקייה המשותפת לא זמינה במחשב הזה כרגע'
      recompute()
    }
    return was
  }
  if (shared && mtime === sharedMtime && !pending.length) return false
  const fresh = readSharedSync()
  if (!fresh) return false
  if (pending.length) {
    await flushShared()
  } else {
    shared = fresh
    // this computer's copy follows the shared state
    local = { ...clean(viewOf(fresh, local, pc(), exists)), syncFolder: local.syncFolder, pcId: local.pcId, pcName: local.pcName }
    writeLocal()
    recompute()
  }
  return true
}


export function syncStatus(): SyncStatus {
  getSettings()
  return {
    folder: local!.syncFolder ?? null,
    connected: !!shared,
    error: lastError,
    computerName: pcName(),
    computers: Object.entries(shared?.computers ?? {})
      .map(([id, c]) => ({ name: c.name, seen: c.seen, me: id === pc() }))
      .sort((a, b) => Number(b.me) - Number(a.me) || b.seen - a.seen),
    savedAt: shared?.saved ?? 0,
    savedBy: shared?.savedBy ?? '',
    waiting: pending.length
  }
}

/**
 * Starts sharing through a folder. If the folder already has a state file (made on another
 * computer), it is loaded: its settings win, and books only this computer knows are added to it.
 * Otherwise this computer's state becomes the file.
 */
export async function startSync(folder: string): Promise<SyncStatus> {
  getSettings()
  await flushShared()
  const f = join(folder, APP_STATE_FILE)
  let existing: AppState | null = null
  if (existsSync(f)) existing = normalizeState(JSON.parse(await fs.readFile(f, 'utf8')))
  local = { ...local!, syncFolder: folder }
  const joined = stamp(joinState(existing, clean(view!), pc(), pcName(), exists), pc(), pcName())
  await writeShared(joined)
  shared = joined
  pending = []
  lastError = ''
  local = { ...clean(viewOf(joined, local, pc(), exists)), syncFolder: folder, pcId: local.pcId, pcName: local.pcName }
  writeLocal()
  recompute()
  copyFontsToShared()
  return syncStatus()
}

/** Stops sharing on this computer: it keeps working with its own copy (the file in the folder stays) */
export async function stopSync(): Promise<SyncStatus> {
  await flushShared()
  getSettings()
  local = { ...clean(view!), syncFolder: undefined, pcId: local!.pcId, pcName: local!.pcName }
  shared = null
  pending = []
  lastError = ''
  writeLocal()
  recompute()
  return syncStatus()
}

export function setComputerName(name: string): SyncStatus {
  getSettings()
  local = { ...local!, pcName: name.trim().slice(0, 60) || hostname() }
  writeLocal()
  if (local.syncFolder) {
    pending.push({ before: view!, after: view! })
    scheduleShared()
  }
  return syncStatus()
}

// ---------------------------------------------------------------------------
// Font files: copied into the shared folder, so another computer can use them
// ---------------------------------------------------------------------------

export function sharedFontsDir(): string | null {
  const f = getSettings().syncFolder
  return f && shared ? join(f, SYNC_FONTS_DIR) : null
}

function copyFontsToShared(): void {
  const dir = sharedFontsDir()
  if (!dir) return
  try {
    const mine = join(app.getPath('userData'), 'fonts')
    if (!existsSync(mine)) return
    mkdirSync(dir, { recursive: true })
    for (const name of readdirSync(mine)) {
      const to = join(dir, basename(name))
      if (!existsSync(to)) copyFileSync(join(mine, name), to)
    }
  } catch {
    /* fonts stay on this computer */
  }
}

/** Opening a book puts it first in the list (and takes it out of the archive) */
export function rememberBook(path: string, title: string, chapterCount: number, id?: string): void {
  const s = getSettings()
  const prev = s.recent.find((r) => (id && r.id === id) || r.path === path)
  const others = s.recent.filter((r) => r !== prev && r.path !== path && !(id && r.id === id))
  const entry: Settings['recent'][number] = { path, title, chapterCount, lastOpened: Date.now() }
  const bookId = id ?? prev?.id
  if (bookId) entry.id = bookId
  if (id && prev?.id && prev.id !== id) entry.prevId = prev.id
  // archived books are kept however many there are
  const recent = [entry, ...others.filter((r) => !r.archived)].slice(0, 30).concat(others.filter((r) => r.archived))
  updateSettings({ recent })
}
