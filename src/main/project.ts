// A book = a folder on disk:
//   <book folder>/book.hakirchia.json   list of chapters, their order, status and synopsis
//   <book folder>/פרקים/01 - שם הפרק.docx   one Word file per chapter
// File names follow the chapter number and title, and are renamed when chapters move or get renamed.

import { promises as fs, existsSync, watch, type FSWatcher } from 'fs'
import { join, basename } from 'path'
import { randomUUID, createHash } from 'crypto'
import { shell } from 'electron'
import type { Book, Chapter, ChapterStatus, LoadedChapter, PMNode } from '../shared/types'
import { docToDocx, docxToDoc, emptyDoc, isOurFile } from '../shared/docx'

import { MANIFEST, CHAPTERS_DIR } from '../shared/constants'
export { MANIFEST, CHAPTERS_DIR }
const BACKUP_DIR = 'גיבוי קבצים מקוריים'

interface Manifest {
  app: 'hakirchia'
  version: 1
  title: string
  chapters: Chapter[]
}

// One queue per book, so disk operations never overlap (e.g. a save during a rename).
const queues = new Map<string, Promise<unknown>>()
export function serial<T>(bookPath: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(bookPath) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(fn)
  queues.set(bookPath, next)
  return next
}

/** Removes characters Windows does not allow in file names. */
export function safeName(title: string): string {
  const cleaned = title
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 80)
  return cleaned || 'ללא שם'
}

export function desiredFileName(index: number, title: string): string {
  return `${String(index + 1).padStart(2, '0')} - ${safeName(title)}.docx`
}

// What each chapter file looked like the last time the app read or wrote it. Lets the watcher
// below tell a change made outside the app (e.g. in Word) from the app's own saves and renames.
const known = new Map<string, string>()
const fingerprint = (bytes: Uint8Array) => createHash('sha1').update(bytes).digest('hex')
const remember = (bookPath: string, id: string, bytes: Uint8Array) => known.set(`${bookPath}|${id}`, fingerprint(bytes))

const chaptersDir = (bookPath: string) => join(bookPath, CHAPTERS_DIR)
const chapterPath = (bookPath: string, ch: Chapter) => join(chaptersDir(bookPath), ch.file)

async function readManifest(bookPath: string): Promise<Manifest> {
  const raw = await fs.readFile(join(bookPath, MANIFEST), 'utf8')
  const m = JSON.parse(raw) as Manifest
  if (!Array.isArray(m.chapters)) throw new Error('קובץ הספר פגום')
  return m
}

async function writeManifest(bookPath: string, m: Manifest): Promise<void> {
  const file = join(bookPath, MANIFEST)
  const tmp = file + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(m, null, 2), 'utf8')
  await fs.rename(tmp, file)
}

const toBook = (bookPath: string, m: Manifest): Book => ({ path: bookPath, title: m.title, chapters: m.chapters })

export function isBookFolder(folder: string): boolean {
  return existsSync(join(folder, MANIFEST))
}

export async function createBook(parentDir: string, title: string): Promise<Book> {
  const folder = join(parentDir, safeName(title))
  if (existsSync(folder) && (await fs.readdir(folder)).length > 0) {
    throw new Error(`כבר יש תיקייה בשם "${basename(folder)}" במקום הזה. אפשר לבחור שם אחר או מקום אחר.`)
  }
  await fs.mkdir(chaptersDir(folder), { recursive: true })
  const m: Manifest = { app: 'hakirchia', version: 1, title: title.trim() || 'ספר חדש', chapters: [] }
  await writeManifest(folder, m)
  // Start with a first chapter so the writer can begin right away
  await addChapterUnlocked(folder, m, 'פרק 1')
  return toBook(folder, await readManifest(folder))
}

export async function openBook(folder: string): Promise<Book> {
  const m = await readManifest(folder)
  // Keep the list honest if a chapter file was removed outside the app
  await fs.mkdir(chaptersDir(folder), { recursive: true })
  return toBook(folder, m)
}

async function addChapterUnlocked(bookPath: string, m: Manifest, title: string): Promise<Chapter> {
  const ch: Chapter = {
    id: randomUUID(),
    title: title.trim() || 'פרק חדש',
    file: desiredFileName(m.chapters.length, title),
    status: 'draft',
    synopsis: ''
  }
  // Avoid clobbering an existing file with the same name
  let n = 2
  while (existsSync(chapterPath(bookPath, ch))) ch.file = ch.file.replace(/( \(\d+\))?\.docx$/, ` (${n++}).docx`)
  const bytes = await docToDocx(emptyDoc(), ch.title)
  await fs.writeFile(chapterPath(bookPath, ch), bytes)
  remember(bookPath, ch.id, bytes)
  m.chapters.push(ch)
  await writeManifest(bookPath, m)
  return ch
}

export function addChapter(bookPath: string, title: string): Promise<{ book: Book; chapter: Chapter }> {
  return serial(bookPath, async () => {
    const m = await readManifest(bookPath)
    const chapter = await addChapterUnlocked(bookPath, m, title)
    return { book: toBook(bookPath, m), chapter }
  })
}

/**
 * Renames files so each one matches "NN - title.docx". Files that are locked (open in Word)
 * keep their old name; the manifest always records the real name, so nothing is lost.
 */
async function syncFileNames(bookPath: string, m: Manifest): Promise<string | undefined> {
  const dir = chaptersDir(bookPath)
  const pending = m.chapters
    .map((ch, i) => ({ ch, want: desiredFileName(i, ch.title) }))
    .filter(({ ch, want }) => ch.file !== want)
  if (!pending.length) return undefined
  const locked: string[] = []
  // Phase 1: move to temporary names, so swapping "01 - א" and "02 - ב" never collides
  const moved: { ch: Chapter; tmp: string; want: string }[] = []
  for (const { ch, want } of pending) {
    const tmp = `~${ch.id}.docx`
    try {
      if (existsSync(join(dir, ch.file))) await fs.rename(join(dir, ch.file), join(dir, tmp))
      else await fs.writeFile(join(dir, tmp), await docToDocx(emptyDoc(), ch.title))
      moved.push({ ch, tmp, want })
    } catch {
      locked.push(ch.title)
    }
  }
  // Phase 2: final names
  for (const { ch, tmp, want } of moved) {
    let target = want
    let n = 2
    while (existsSync(join(dir, target))) target = want.replace(/\.docx$/, ` (${n++}).docx`)
    try {
      await fs.rename(join(dir, tmp), join(dir, target))
      ch.file = target
    } catch {
      ch.file = tmp
      locked.push(ch.title)
    }
  }
  await writeManifest(bookPath, m)
  return locked.length
    ? `לא הצלחתי לשנות את שם הקובץ של: ${locked.join(', ')}. כנראה הוא פתוח בתוכנה אחרת (למשל Word). התוכן לא נפגע.`
    : undefined
}

export function renameChapter(bookPath: string, id: string, title: string) {
  return serial(bookPath, async () => {
    const m = await readManifest(bookPath)
    const ch = m.chapters.find((c) => c.id === id)
    if (!ch) throw new Error('הפרק לא נמצא')
    ch.title = title.trim() || ch.title
    // The title is also the first line (Heading 1) inside the Word file
    const notice = await rewriteTitleInFile(bookPath, ch)
    const notice2 = await syncFileNames(bookPath, m)
    return { book: toBook(bookPath, m), notice: notice2 ?? notice }
  })
}

async function rewriteTitleInFile(bookPath: string, ch: Chapter): Promise<string | undefined> {
  const file = chapterPath(bookPath, ch)
  if (!existsSync(file)) return undefined
  const bytes = new Uint8Array(await fs.readFile(file))
  const loaded = await docxToDoc(bytes)
  if (loaded.warnings.length && !(await isOurFile(bytes))) return undefined // don't touch files with content we can't keep
  const out = await docToDocx(loaded.doc, ch.title)
  await fs.writeFile(file, out)
  remember(bookPath, ch.id, out)
  return undefined
}

export function reorderChapters(bookPath: string, ids: string[]) {
  return serial(bookPath, async () => {
    const m = await readManifest(bookPath)
    const byId = new Map(m.chapters.map((c) => [c.id, c]))
    const next = ids.map((id) => byId.get(id)).filter((c): c is Chapter => !!c)
    for (const c of m.chapters) if (!next.includes(c)) next.push(c)
    m.chapters = next
    const notice = await syncFileNames(bookPath, m)
    return { book: toBook(bookPath, m), notice }
  })
}

export function deleteChapter(bookPath: string, id: string) {
  return serial(bookPath, async () => {
    const m = await readManifest(bookPath)
    const ch = m.chapters.find((c) => c.id === id)
    if (!ch) throw new Error('הפרק לא נמצא')
    const file = chapterPath(bookPath, ch)
    if (existsSync(file)) {
      // To the Windows Recycle Bin, so it can be restored from there
      await shell.trashItem(file)
    }
    m.chapters = m.chapters.filter((c) => c.id !== id)
    const notice = await syncFileNames(bookPath, m)
    return { book: toBook(bookPath, m), notice }
  })
}

export function updateChapterMeta(bookPath: string, id: string, meta: { status?: ChapterStatus; synopsis?: string }) {
  return serial(bookPath, async () => {
    const m = await readManifest(bookPath)
    const ch = m.chapters.find((c) => c.id === id)
    if (!ch) throw new Error('הפרק לא נמצא')
    if (meta.status) ch.status = meta.status
    if (typeof meta.synopsis === 'string') ch.synopsis = meta.synopsis
    await writeManifest(bookPath, m)
    return toBook(bookPath, m)
  })
}

export function loadChapter(bookPath: string, id: string): Promise<LoadedChapter> {
  return serial(bookPath, async () => {
    const m = await readManifest(bookPath)
    const ch = m.chapters.find((c) => c.id === id)
    if (!ch) throw new Error('הפרק לא נמצא')
    const file = chapterPath(bookPath, ch)
    if (!existsSync(file)) return { doc: emptyDoc(), warnings: ['קובץ הפרק לא נמצא בתיקייה, ייווצר מחדש בשמירה'] }
    const bytes = new Uint8Array(await fs.readFile(file))
    const res = await docxToDoc(bytes)
    remember(bookPath, ch.id, bytes)
    return { doc: res.doc, warnings: res.warnings }
  })
}

export function saveChapter(bookPath: string, id: string, doc: PMNode): Promise<void> {
  return serial(bookPath, async () => {
    const m = await readManifest(bookPath)
    const ch = m.chapters.find((c) => c.id === id)
    if (!ch) throw new Error('הפרק לא נמצא')
    const file = chapterPath(bookPath, ch)
    if (existsSync(file)) {
      const old = new Uint8Array(await fs.readFile(file))
      if (!(await isOurFile(old))) {
        // First save over a file that came from Word: keep the original copy once
        const bdir = join(bookPath, BACKUP_DIR)
        await fs.mkdir(bdir, { recursive: true })
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
        await fs.writeFile(join(bdir, `${stamp} ${ch.file}`), old)
      }
    }
    const bytes = await docToDocx(doc, ch.title)
    const tmp = file + '.saving'
    await fs.writeFile(tmp, bytes)
    try {
      await fs.rename(tmp, file)
      remember(bookPath, ch.id, bytes)
    } catch (e) {
      await fs.rm(tmp, { force: true })
      throw new Error('השמירה נכשלה. אם הקובץ פתוח ב-Word, יש לסגור אותו ולנסות שוב.')
    }
  })
}

export function chapterFilePath(book: Book, id: string): string | null {
  const ch = book.chapters.find((c) => c.id === id)
  return ch ? chapterPath(book.path, ch) : null
}

// ---------------------------------------------------------------------------
// Watching the chapters folder: when a chapter file changes outside the app (edited in Word,
// restored from a backup, synced from another computer), the open editors reload it.
// ---------------------------------------------------------------------------

let watching: { bookPath: string; watcher: FSWatcher; timers: Map<string, ReturnType<typeof setTimeout>> } | null = null

export function stopWatching(): void {
  if (!watching) return
  watching.watcher.close()
  for (const t of watching.timers.values()) clearTimeout(t)
  watching = null
}

export function watchBook(bookPath: string, onChange: (chapterId: string) => void): void {
  if (watching?.bookPath === bookPath) return
  stopWatching()
  try {
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    const watcher = watch(chaptersDir(bookPath), (_event, filename) => {
      const name = typeof filename === 'string' ? basename(filename) : null
      if (!name || !name.endsWith('.docx') || name.startsWith('~')) return
      // Word and the app both write in several steps; wait until the file settles
      const prev = timers.get(name)
      if (prev) clearTimeout(prev)
      timers.set(
        name,
        setTimeout(() => {
          timers.delete(name)
          void checkChanged(bookPath, name).then((id) => id && onChange(id))
        }, 500)
      )
    })
    watcher.on('error', () => stopWatching())
    watching = { bookPath, watcher, timers }
  } catch {
    // Watching is a convenience; without it the master still reloads every time it opens
  }
}

/** Returns the chapter id if this file now differs from what the app last read or wrote. */
export function checkChanged(bookPath: string, fileName: string): Promise<string | null> {
  return serial(bookPath, async () => {
    const m = await readManifest(bookPath)
    const ch = m.chapters.find((c) => c.file === fileName)
    if (!ch) return null
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(await fs.readFile(chapterPath(bookPath, ch)))
    } catch {
      return null // gone or still locked
    }
    const key = `${bookPath}|${ch.id}`
    const fp = fingerprint(bytes)
    if (known.get(key) === fp) return null
    known.set(key, fp)
    return ch.id
  })
}
