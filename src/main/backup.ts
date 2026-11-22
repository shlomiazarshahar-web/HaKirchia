// Feature 49: daily dated copies of the book (rules in shared/backup.ts).
//   <backups folder>/<book name>/2026-11-22/...   the whole book folder as it was that day
// Today's copy is brought up to date while the book is open; earlier days never change again.
// Files that did not change since the previous copy are hard links to it (when the disk allows),
// so thirty days of copies take little more room than one.

import { app } from 'electron'
import { promises as fs, existsSync } from 'fs'
import { join, relative, dirname } from 'path'
import { createHash } from 'crypto'
import { getSettings } from './settings'
import * as project from './project'
import { countWords, docText, docxToDoc } from '../shared/docx'
import { MANIFEST, CHAPTERS_DIR } from '../shared/constants'
import {
  BACKUP_EVERY_MS,
  BACKUP_ROOT_NAME,
  dayStamp,
  daysToDelete,
  filesSignature,
  isDayFolder,
  normalizeBackup,
  skipInBackup,
  type BackupChapter,
  type BackupInfo
} from '../shared/backup'

const MARK = '.hakirchia-backup.json'
interface Mark {
  /** The book folder these copies are of */
  source: string
  title: string
  /** day → files signature and time of the copy */
  days: Record<string, { sig: string; at: number }>
}

export const settings = () => normalizeBackup(getSettings().backup)
export const rootDir = () => settings().folder || join(app.getPath('documents'), BACKUP_ROOT_NAME)

interface FileInfo {
  rel: string
  size: number
  mtimeMs: number
}

async function listFiles(base: string): Promise<FileInfo[]> {
  const out: FileInfo[] = []
  const walk = async (dir: string) => {
    for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
      const full = join(dir, ent.name)
      const rel = relative(base, full)
      if (skipInBackup(rel)) continue
      if (ent.isDirectory()) await walk(full)
      else if (ent.isFile()) {
        const st = await fs.stat(full)
        out.push({ rel, size: st.size, mtimeMs: st.mtimeMs })
      }
    }
  }
  await walk(base)
  return out
}

async function readMark(dir: string): Promise<Mark | null> {
  try {
    return JSON.parse(await fs.readFile(join(dir, MARK), 'utf8')) as Mark
  } catch {
    return null
  }
}
const writeMark = (dir: string, m: Mark) => fs.writeFile(join(dir, MARK), JSON.stringify(m, null, 2), 'utf8')

const samePath = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)

/** This book's folder among the backups (found by the book's path, so renaming the book keeps its copies) */
async function findBookDir(bookPath: string): Promise<{ dir: string; mark: Mark } | null> {
  const root = rootDir()
  let names: string[] = []
  try {
    names = await fs.readdir(root)
  } catch {
    return null
  }
  for (const n of names) {
    const mark = await readMark(join(root, n))
    if (mark && samePath(mark.source, bookPath)) return { dir: join(root, n), mark }
  }
  return null
}

async function makeBookDir(bookPath: string, title: string): Promise<{ dir: string; mark: Mark }> {
  const root = rootDir()
  await fs.mkdir(root, { recursive: true })
  const base = project.safeName(title)
  for (let n = 1; ; n++) {
    const dir = join(root, n === 1 ? base : `${base} (${n})`)
    if (existsSync(dir)) continue
    await fs.mkdir(dir, { recursive: true })
    const mark: Mark = { source: bookPath, title, days: {} }
    await writeMark(dir, mark)
    return { dir, mark }
  }
}

let running: Promise<unknown> = Promise.resolve()
/** Called after each copy (or failed copy), so the window can show it */
let onDone: (bookPath: string) => void = () => undefined
export function onBackupDone(fn: (bookPath: string) => void): void {
  onDone = fn
}
const lastError = new Map<string, string>()

/**
 * Brings today's copy of the book up to date. Skips when nothing changed since the latest copy
 * (unless `force`). Returns the day it copied, or null when it skipped.
 */
export function backupNow(bookPath: string, force = false): Promise<string | null> {
  const job = running.catch(() => undefined).then(() => doBackup(bookPath, force))
  running = job
  void job.then(
    (day) => day && onDone(bookPath),
    () => onDone(bookPath)
  )
  return job
}

async function doBackup(bookPath: string, force: boolean): Promise<string | null> {
  try {
    if (!project.isBookFolder(bookPath)) return null
    const book = await project.openBook(bookPath)
    const files = await listFiles(bookPath)
    const sig = createHash('sha1').update(filesSignature(files)).digest('hex')
    const found = (await findBookDir(bookPath)) ?? (await makeBookDir(bookPath, book.title))
    const { dir, mark } = found
    const days = Object.keys(mark.days).filter((d) => isDayFolder(d) && existsSync(join(dir, d))).sort()
    const latest = days[days.length - 1]
    if (!force && latest && mark.days[latest].sig === sig) {
      lastError.delete(bookPath)
      return null
    }
    const today = dayStamp(new Date())
    const target = join(dir, today)
    const partial = target + '.partial'
    await fs.rm(partial, { recursive: true, force: true })
    const prev = latest ? join(dir, latest) : null
    for (const f of files) {
      const src = join(bookPath, f.rel)
      const dst = join(partial, f.rel)
      await fs.mkdir(dirname(dst), { recursive: true })
      // unchanged since the previous copy: link to it instead of copying again
      if (prev) {
        const old = join(prev, f.rel)
        const st = await fs.stat(old).catch(() => null)
        if (st && st.size === f.size && Math.abs(st.mtimeMs - f.mtimeMs) < 2000) {
          try {
            await fs.link(old, dst)
            continue
          } catch {
            /* this disk can't link: copy */
          }
        }
      }
      await fs.copyFile(src, dst)
      await fs.utimes(dst, new Date(), new Date(f.mtimeMs)).catch(() => undefined)
    }
    // today's copy is replaced as a whole, only once the new one is complete
    if (existsSync(target)) await fs.rm(target, { recursive: true, force: true })
    await fs.rename(partial, target)
    mark.days[today] = { sig, at: Date.now() }
    mark.title = book.title
    for (const d of daysToDelete(Object.keys(mark.days).filter((d) => existsSync(join(dir, d))), settings().keep)) {
      await fs.rm(join(dir, d), { recursive: true, force: true })
      delete mark.days[d]
    }
    for (const d of Object.keys(mark.days)) if (!existsSync(join(dir, d))) delete mark.days[d]
    await writeMark(dir, mark)
    lastError.delete(bookPath)
    return today
  } catch (e) {
    lastError.set(bookPath, e instanceof Error ? e.message : String(e))
    throw e
  }
}

export async function backupInfo(bookPath: string): Promise<BackupInfo> {
  const found = await findBookDir(bookPath)
  const days = found
    ? Object.entries(found.mark.days)
        .filter(([d]) => isDayFolder(d) && existsSync(join(found.dir, d)))
        .map(([day, v]) => ({ day, at: v.at, path: join(found.dir, day) }))
        .sort((a, b) => b.day.localeCompare(a.day))
    : []
  const err = lastError.get(bookPath)
  return { settings: settings(), root: rootDir(), dir: found?.dir ?? null, days, ...(err ? { error: err } : {}) }
}

const sha = (b: Uint8Array) => createHash('sha1').update(b).digest('hex')

async function dayFolder(bookPath: string, day: string): Promise<string> {
  const found = await findBookDir(bookPath)
  if (!found || !isDayFolder(day) || !existsSync(join(found.dir, day))) throw new Error('הגיבוי הזה לא נמצא')
  return join(found.dir, day)
}

/** The chapters in one day's copy, each compared with the book as it is now */
export async function backupChapters(bookPath: string, day: string): Promise<BackupChapter[]> {
  const folder = await dayFolder(bookPath, day)
  const old = JSON.parse(await fs.readFile(join(folder, MANIFEST), 'utf8')) as { chapters: { id: string; title: string; file: string }[] }
  const now = await project.openBook(bookPath)
  const out: BackupChapter[] = []
  for (const ch of old.chapters ?? []) {
    const bytes = await fs.readFile(join(folder, CHAPTERS_DIR, ch.file)).catch(() => null)
    if (!bytes) continue
    const cur = now.chapters.find((c) => c.id === ch.id)
    let state: BackupChapter['state'] = 'deleted'
    if (cur) {
      const curBytes = await fs.readFile(join(bookPath, CHAPTERS_DIR, cur.file)).catch(() => null)
      state = curBytes && sha(curBytes) === sha(bytes) ? 'same' : 'changed'
    }
    let words = 0
    try {
      words = countWords(docText((await docxToDoc(new Uint8Array(bytes))).doc))
    } catch {
      /* counted 0 */
    }
    out.push({ id: ch.id, title: cur?.title ?? ch.title, state, words })
  }
  return out
}

/** Brings one chapter back from a day's copy (the text there now is kept as a version first) */
export async function restoreChapter(bookPath: string, day: string, chapterId: string) {
  const folder = await dayFolder(bookPath, day)
  const old = JSON.parse(await fs.readFile(join(folder, MANIFEST), 'utf8')) as { chapters: { id: string; title: string; file: string }[] }
  const ch = old.chapters.find((c) => c.id === chapterId)
  if (!ch) throw new Error('הפרק לא נמצא בגיבוי')
  const bytes = new Uint8Array(await fs.readFile(join(folder, CHAPTERS_DIR, ch.file)))
  const [y, m, d] = day.split('-')
  return project.restoreChapterFile(bookPath, chapterId, ch.title, bytes, `לפני שחזור מהגיבוי של ${Number(d)}.${Number(m)}.${y}`)
}

// The open book is copied a little after it opens, then every half hour while it stays open
let timer: ReturnType<typeof setInterval> | null = null
let first: ReturnType<typeof setTimeout> | null = null
export function watchForBackup(bookPath: string | null): void {
  if (timer) clearInterval(timer)
  if (first) clearTimeout(first)
  timer = first = null
  if (!bookPath) return
  const run = () => {
    if (settings().enabled) void backupNow(bookPath).catch(() => undefined)
  }
  first = setTimeout(run, 15_000)
  timer = setInterval(run, BACKUP_EVERY_MS)
}
