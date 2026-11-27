// A book = a folder on disk:
//   <book folder>/book.hakirchia.json   list of chapters, their order, status and synopsis
//   <book folder>/פרקים/01 - שם הפרק.docx   one Word file per chapter
// File names follow the chapter number and title, and are renamed when chapters move or get renamed.

import { promises as fs, existsSync, watch, type FSWatcher } from 'fs'
import { join, basename, extname, dirname } from 'path'
import { randomUUID, createHash } from 'crypto'
import { shell } from 'electron'
import type { StopPoint } from '../shared/stoppoint'
import type { AltDraft, Book, Bookmark, Chapter, ChapterStatus, DrawerItem, LoadedChapter, OutlineNode, PMNode, PrivateNote, Version } from '../shared/types'
import * as drafts from './drafts'
import * as writingLog from './writinglog'
import * as bg from './background'
import { normalizeBackground, type GlossaryEntry, type InspirationGroup, type InspirationImage, type Material, type MaterialKind, type TimelineEvent } from '../shared/background'
import { flatten, normalizeOutline } from '../shared/outline'
import { chapterParagraphCount, chapterParagraphTexts, SOURCES_DIR, type ChapterSource, type SplitItem } from '../shared/translation'
import { SCENE_BREAK_TEXT } from '../shared/scenes'
import { normalizePublish, type PublishSettings } from '../shared/publish'
import { normalizeLabels, type ChapterLabel } from '../shared/labels'
import { countWords, docText, docToDocx, docxToDoc, emptyDoc, isOurFile } from '../shared/docx'

import { MANIFEST, CHAPTERS_DIR } from '../shared/constants'
export { MANIFEST, CHAPTERS_DIR }
const BACKUP_DIR = 'גיבוי קבצים מקוריים'

interface Manifest extends bg.BackgroundManifest {
  app: 'hakirchia'
  version: 1
  title: string
  chapters: Chapter[]
  /** The binder tree with parts. Missing in books made before parts existed. */
  outline?: OutlineNode[]
  /** Where the writer stopped, with the "what next" note (feature 32) */
  stopPoint?: StopPoint
  /** "Come back here" bookmarks (feature 30) */
  bookmarks?: Bookmark[]
  /** Private notes (feature 15) */
  notes?: PrivateNote[]
  /** Alternative drafts (feature 35); their files are in the "טיוטות חלופיות" folder */
  alts?: AltDraft[]
  /** The original of each translated chapter (feature 12); the PDFs are in the "מקור" folder */
  sources?: Record<string, ChapterSource>
  /** Front and back pages and page layout (features 31, 36, 16) */
  publish?: PublishSettings
  /** Color labels for chapters (feature 44) */
  labels?: ChapterLabel[]
}

/** Makes the tree match the chapter list, and puts the chapters in the tree's order. */
function fixup(m: Manifest): void {
  m.outline = normalizeOutline(m.outline, m.chapters)
  const byId = new Map(m.chapters.map((c) => [c.id, c]))
  m.chapters = flatten(m.outline).map((id) => byId.get(id)!)
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
  fixup(m)
  return m
}

async function writeManifest(bookPath: string, m: Manifest): Promise<void> {
  const file = join(bookPath, MANIFEST)
  const tmp = file + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(m, null, 2), 'utf8')
  await fs.rename(tmp, file)
}

const toBook = (bookPath: string, m: Manifest): Book => ({
  path: bookPath,
  title: m.title,
  chapters: m.chapters,
  outline: m.outline ?? [],
  bookmarks: (m.bookmarks ?? []).filter((b) => m.chapters.some((c) => c.id === b.chapterId)),
  notes: (m.notes ?? []).filter((n) => m.chapters.some((c) => c.id === n.chapterId)),
  alts: (m.alts ?? []).filter((a) => m.chapters.some((c) => c.id === a.chapterId)),
  sources: Object.fromEntries(Object.entries(m.sources ?? {}).filter(([id]) => m.chapters.some((c) => c.id === id))),
  publish: normalizePublish(m.publish),
  labels: normalizeLabels(m.labels),
  ...normalizeBackground(m, m.chapters.map((c) => c.id)),
  ...(m.stopPoint && m.chapters.some((c) => c.id === m.stopPoint!.chapterId) ? { stopPoint: m.stopPoint } : {})
})

export function isBookFolder(folder: string): boolean {
  return existsSync(join(folder, MANIFEST))
}

export async function createBook(parentDir: string, title: string): Promise<Book> {
  const folder = join(parentDir, safeName(title))
  if (existsSync(folder) && (await fs.readdir(folder)).length > 0) {
    throw new Error(`כבר יש תיקייה בשם "${basename(folder)}" במקום הזה. אפשר לבחור שם אחר או מקום אחר.`)
  }
  await fs.mkdir(chaptersDir(folder), { recursive: true })
  const m: Manifest = { app: 'hakirchia', version: 1, title: title.trim() || 'ספר חדש', chapters: [], outline: [] }
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

/** Adds a chapter at the end of the book, or at the end of a part. */
async function addChapterUnlocked(bookPath: string, m: Manifest, title: string, partId?: string): Promise<{ chapter: Chapter; notice?: string }> {
  const ch: Chapter = {
    id: randomUUID(),
    title: title.trim() || 'פרק חדש',
    file: '',
    status: 'draft',
    synopsis: ''
  }
  m.chapters.push(ch)
  const part = partId ? m.outline?.find((n) => n.type === 'part' && n.id === partId) : undefined
  if (part && part.type === 'part') part.children.push(ch.id)
  else m.outline?.push({ type: 'chapter', id: ch.id })
  fixup(m)
  ch.file = desiredFileName(m.chapters.indexOf(ch), ch.title)
  // Avoid clobbering an existing file with the same name
  let n = 2
  while (existsSync(chapterPath(bookPath, ch))) ch.file = ch.file.replace(/( \(\d+\))?\.docx$/, ` (${n++}).docx`)
  const bytes = await docToDocx(emptyDoc(), ch.title)
  await fs.writeFile(chapterPath(bookPath, ch), bytes)
  remember(bookPath, ch.id, bytes)
  await writeManifest(bookPath, m)
  // Added in the middle of the book (inside a part): the chapters after it get new numbers
  const notice = await syncFileNames(bookPath, m)
  return { chapter: ch, notice }
}

export function addChapter(bookPath: string, title: string, partId?: string): Promise<{ book: Book; chapter: Chapter; notice?: string }> {
  return serial(bookPath, async () => {
    const m = await readManifest(bookPath)
    const { chapter, notice } = await addChapterUnlocked(bookPath, m, title, partId)
    return { book: toBook(bookPath, m), chapter, notice }
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

/**
 * Saves the binder tree: order of chapters, parts, part names, open/closed parts.
 * When the chapter order changed, the files get new numbers.
 */
export function saveOutline(bookPath: string, outline: OutlineNode[]) {
  return serial(bookPath, async () => {
    const m = await readManifest(bookPath)
    m.outline = outline
    fixup(m)
    await writeManifest(bookPath, m)
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
    // its alternative drafts go to the Recycle Bin with it
    for (const a of (m.alts ?? []).filter((x) => x.chapterId === id)) {
      const f = join(bookPath, drafts.ALTS_DIR, a.file)
      if (existsSync(f)) await shell.trashItem(f).catch(() => undefined)
    }
    m.alts = (m.alts ?? []).filter((x) => x.chapterId !== id)
    m.notes = (m.notes ?? []).filter((x) => x.chapterId !== id)
    // only its link to the original goes: the PDF and the other chapters' ranges stay as they are
    if (m.sources?.[id]) delete m.sources[id]
    m.chapters = m.chapters.filter((c) => c.id !== id)
    fixup(m)
    // saved here too: when the last chapter goes, no file is renamed and syncFileNames writes nothing
    await writeManifest(bookPath, m)
    const notice = await syncFileNames(bookPath, m)
    return { book: toBook(bookPath, m), notice }
  })
}

export function updateChapterMeta(bookPath: string, id: string, meta: { status?: ChapterStatus; synopsis?: string; noExport?: boolean; labels?: string[] }) {
  return serial(bookPath, async () => {
    const m = await readManifest(bookPath)
    const ch = m.chapters.find((c) => c.id === id)
    if (!ch) throw new Error('הפרק לא נמצא')
    if (meta.status) ch.status = meta.status
    if (typeof meta.synopsis === 'string') ch.synopsis = meta.synopsis
    if (meta.noExport === true) ch.noExport = true
    else if (meta.noExport === false) delete ch.noExport
    if (Array.isArray(meta.labels)) {
      const known = new Set(normalizeLabels(m.labels).map((l) => l.id))
      const ids = [...new Set(meta.labels.filter((x) => typeof x === 'string' && known.has(x)))]
      if (ids.length) ch.labels = ids
      else delete ch.labels
    }
    await writeManifest(bookPath, m)
    return toBook(bookPath, m)
  })
}

/** Saves the book's color labels (feature 44); a label that was removed is taken off every chapter. */
export function setLabels(bookPath: string, labels: ChapterLabel[]): Promise<Book> {
  return serial(bookPath, async () => {
    const m = await readManifest(bookPath)
    const list = normalizeLabels(labels)
    const ids = new Set(list.map((l) => l.id))
    if (list.length) m.labels = list
    else delete m.labels
    for (const ch of m.chapters) {
      if (!ch.labels) continue
      ch.labels = ch.labels.filter((x) => ids.has(x))
      if (!ch.labels.length) delete ch.labels
    }
    await writeManifest(bookPath, m)
    return toBook(bookPath, m)
  })
}

/** Remembers where the writer stopped (or forgets it, with null). Saved in the book's own file. */
export function setStopPoint(bookPath: string, sp: StopPoint | null) {
  return serial(bookPath, async () => {
    const m = await readManifest(bookPath)
    if (sp) m.stopPoint = sp
    else delete m.stopPoint
    await writeManifest(bookPath, m)
  })
}

/** Saves the front and back pages, the author and the page layout (features 31, 36, 16). */
export function setPublish(bookPath: string, p: PublishSettings): Promise<Book> {
  return serial(bookPath, async () => {
    const m = await readManifest(bookPath)
    m.publish = normalizePublish(p)
    await writeManifest(bookPath, m)
    return toBook(bookPath, m)
  })
}

/** Everything an export needs: the book and every chapter's text, read from the files. */
export function exportData(bookPath: string): Promise<{ book: Book; docs: Record<string, PMNode> }> {
  return serial(bookPath, async () => {
    const m = await readManifest(bookPath)
    const docs: Record<string, PMNode> = {}
    for (const ch of m.chapters) {
      const file = chapterPath(bookPath, ch)
      docs[ch.id] = existsSync(file) ? (await docxToDoc(new Uint8Array(await fs.readFile(file)))).doc : emptyDoc()
    }
    return { book: toBook(bookPath, m), docs }
  })
}

/** Saves the book's bookmarks (the whole list). */
export function setBookmarks(bookPath: string, list: Bookmark[]) {
  return serial(bookPath, async () => {
    const m = await readManifest(bookPath)
    if (list.length) m.bookmarks = list
    else delete m.bookmarks
    await writeManifest(bookPath, m)
  })
}

/** Saves the book's private notes (the whole list). */
export function setNotes(bookPath: string, list: PrivateNote[]) {
  return serial(bookPath, async () => {
    const m = await readManifest(bookPath)
    if (list.length) m.notes = list
    else delete m.notes
    await writeManifest(bookPath, m)
  })
}

// ---------------------------------------------------------------------------
// Versions (feature 14)
// ---------------------------------------------------------------------------

export function listVersions(bookPath: string, chapterId: string): Promise<Version[]> {
  return serial(bookPath, () => drafts.listVersions(bookPath, chapterId))
}

/** Keeps a copy of the chapter as it is saved on disk now (the window saves pending typing first). */
export function takeVersion(bookPath: string, chapterId: string, label: string, reason?: string): Promise<Version> {
  return serial(bookPath, async () => {
    const m = await readManifest(bookPath)
    const ch = m.chapters.find((c) => c.id === chapterId)
    if (!ch) throw new Error('הפרק לא נמצא')
    const file = chapterPath(bookPath, ch)
    const bytes = existsSync(file) ? new Uint8Array(await fs.readFile(file)) : await docToDocx(emptyDoc(), ch.title)
    return drafts.snapshot(bookPath, chapterId, bytes, { label, auto: !label, reason })
  })
}

export function loadVersion(bookPath: string, chapterId: string, versionId: string): Promise<PMNode> {
  return serial(bookPath, () => drafts.loadVersion(bookPath, chapterId, versionId))
}
export function deleteVersion(bookPath: string, chapterId: string, versionId: string): Promise<void> {
  return serial(bookPath, () => drafts.deleteVersion(bookPath, chapterId, versionId))
}
export function renameVersion(bookPath: string, chapterId: string, versionId: string, label: string): Promise<void> {
  return serial(bookPath, () => drafts.renameVersion(bookPath, chapterId, versionId, label))
}

// ---------------------------------------------------------------------------
// Drawer (feature 27)
// ---------------------------------------------------------------------------

export function readDrawer(bookPath: string): Promise<DrawerItem[]> {
  return serial(bookPath, () => drafts.readDrawer(bookPath))
}
export function addToDrawer(bookPath: string, item: DrawerItem): Promise<DrawerItem[]> {
  return serial(bookPath, () => drafts.addToDrawer(bookPath, item))
}
export function removeFromDrawer(bookPath: string, ids: string[]): Promise<DrawerItem[]> {
  return serial(bookPath, () => drafts.removeFromDrawer(bookPath, ids))
}

// ---------------------------------------------------------------------------
// Alternative drafts (feature 35)
// ---------------------------------------------------------------------------

const altPath = (bookPath: string, a: AltDraft) => join(bookPath, drafts.ALTS_DIR, a.file)
const altTitle = (ch: Chapter, a: AltDraft) => `${ch.title} (טיוטה חלופית: ${a.name})`

/** A new alternative draft of a chapter (or of one scene of it), starting from the given text. */
export function createAlt(bookPath: string, chapterId: string, name: string, doc: PMNode, scene?: AltDraft['scene']): Promise<{ book: Book; alt: AltDraft }> {
  return serial(bookPath, async () => {
    const m = await readManifest(bookPath)
    const ch = m.chapters.find((c) => c.id === chapterId)
    if (!ch) throw new Error('הפרק לא נמצא')
    const id = randomUUID()
    const a: AltDraft = { id, chapterId, name: name.trim() || 'טיוטה חלופית', file: '', at: Date.now(), ...(scene ? { scene } : {}) }
    a.file = `${safeName(ch.title).slice(0, 40)} - ${safeName(a.name).slice(0, 40)} ${id.slice(0, 6)}.docx`
    await fs.mkdir(join(bookPath, drafts.ALTS_DIR), { recursive: true })
    await fs.writeFile(altPath(bookPath, a), await docToDocx(doc, altTitle(ch, a)))
    m.alts = [...(m.alts ?? []), a]
    await writeManifest(bookPath, m)
    return { book: toBook(bookPath, m), alt: a }
  })
}

export function loadAlt(bookPath: string, altId: string): Promise<LoadedChapter> {
  return serial(bookPath, async () => {
    const m = await readManifest(bookPath)
    const a = m.alts?.find((x) => x.id === altId)
    if (!a) throw new Error('הטיוטה החלופית לא נמצאה')
    const file = altPath(bookPath, a)
    if (!existsSync(file)) return { doc: emptyDoc(), warnings: [] }
    const res = await docxToDoc(new Uint8Array(await fs.readFile(file)))
    return { doc: res.doc, warnings: res.warnings }
  })
}

export function saveAlt(bookPath: string, altId: string, doc: PMNode): Promise<void> {
  return serial(bookPath, async () => {
    const m = await readManifest(bookPath)
    const a = m.alts?.find((x) => x.id === altId)
    const ch = a && m.chapters.find((c) => c.id === a.chapterId)
    if (!a || !ch) throw new Error('הטיוטה החלופית לא נמצאה')
    await fs.mkdir(join(bookPath, drafts.ALTS_DIR), { recursive: true })
    const file = altPath(bookPath, a)
    const tmp = file + '.saving'
    await fs.writeFile(tmp, await docToDocx(doc, altTitle(ch, a)))
    try {
      await fs.rename(tmp, file)
    } catch {
      await fs.rm(tmp, { force: true })
      throw new Error('השמירה נכשלה. אם הקובץ פתוח ב-Word, יש לסגור אותו ולנסות שוב.')
    }
  })
}

export function renameAlt(bookPath: string, altId: string, name: string): Promise<Book> {
  return serial(bookPath, async () => {
    const m = await readManifest(bookPath)
    const a = m.alts?.find((x) => x.id === altId)
    if (a && name.trim()) a.name = name.trim()
    await writeManifest(bookPath, m)
    return toBook(bookPath, m)
  })
}

/** Removes an alternative draft; its file goes to the Recycle Bin. */
export function deleteAlt(bookPath: string, altId: string): Promise<Book> {
  return serial(bookPath, async () => {
    const m = await readManifest(bookPath)
    const a = m.alts?.find((x) => x.id === altId)
    if (a) {
      const f = altPath(bookPath, a)
      if (existsSync(f)) await shell.trashItem(f)
      m.alts = (m.alts ?? []).filter((x) => x.id !== altId)
      await writeManifest(bookPath, m)
    }
    return toBook(bookPath, m)
  })
}

/** Words in each chapter (without its title), for the cork board. A missing or unreadable file counts 0. */
export function wordCounts(bookPath: string): Promise<Record<string, number>> {
  return serial(bookPath, async () => {
    const m = await readManifest(bookPath)
    const out: Record<string, number> = {}
    for (const ch of m.chapters) {
      out[ch.id] = 0
      const file = chapterPath(bookPath, ch)
      if (!existsSync(file)) continue
      try {
        const res = await docxToDoc(new Uint8Array(await fs.readFile(file)))
        out[ch.id] = countWords(docText(res.doc))
      } catch {
        // A damaged file shows 0 here; opening the chapter reports the problem
      }
    }
    return out
  })
}

// ---------------------------------------------------------------------------
// Translation (features 12, 28): the originals are PDF files copied into the book's "מקור" folder,
// so the book folder stays complete when it is copied to another computer.
// ---------------------------------------------------------------------------

const sourcesDir = (bookPath: string) => join(bookPath, SOURCES_DIR)

/** PDF files in the book's "מקור" folder, by name */
export async function listSourcePdfs(bookPath: string): Promise<string[]> {
  try {
    const names = await fs.readdir(sourcesDir(bookPath))
    return names.filter((n) => extname(n).toLowerCase() === '.pdf').sort((a, b) => a.localeCompare(b, 'he'))
  } catch {
    return []
  }
}

/** Copies a PDF into the book's "מקור" folder (an identical file already there is reused). Returns its name there. */
export async function addSourcePdf(bookPath: string, from: string, converted?: Uint8Array): Promise<string> {
  await fs.mkdir(sourcesDir(bookPath), { recursive: true })
  // an ePub or Word original arrives already printed to PDF (feature 52); it keeps its own name
  const bytes = converted ? Buffer.from(converted) : await fs.readFile(from)
  const base = basename(from, extname(from))
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${base}.pdf` : `${base} (${n}).pdf`
    const target = join(sourcesDir(bookPath), name)
    if (!existsSync(target)) {
      await fs.writeFile(target, bytes)
      return name
    }
    const there = await fs.readFile(target)
    if (there.equals(bytes)) return name
  }
}

export async function readSourcePdf(bookPath: string, name: string): Promise<Uint8Array> {
  if (basename(name) !== name) throw new Error('שם קובץ לא תקין')
  const file = join(sourcesDir(bookPath), name)
  if (!existsSync(file)) throw new Error(`הקובץ "${name}" לא נמצא בתיקייה "${SOURCES_DIR}" של הספר`)
  return new Uint8Array(await fs.readFile(file))
}

/** Links a chapter to its original, changes its range, or (null) unlinks it. */
export function setSource(bookPath: string, chapterId: string, src: ChapterSource | null): Promise<Book> {
  return serial(bookPath, async () => {
    const m = await readManifest(bookPath)
    if (!m.chapters.some((c) => c.id === chapterId)) throw new Error('הפרק לא נמצא')
    const all = { ...(m.sources ?? {}) }
    if (src) all[chapterId] = src
    else delete all[chapterId]
    if (Object.keys(all).length) m.sources = all
    else delete m.sources
    await writeManifest(bookPath, m)
    return toBook(bookPath, m)
  })
}

/**
 * Splits a translated book into chapters by its original (round 6): one chapter file per chapter
 * found in the PDF, each linked to its range there and opened with its scene breaks ready ("* * *"
 * lines with room to write between them). `reuseId` is an empty chapter that becomes the first one.
 */
export function createChaptersFromSource(bookPath: string, pdf: string, items: SplitItem[], reuseId?: string): Promise<{ book: Book; notice?: string }> {
  return serial(bookPath, async () => {
    const m = await readManifest(bookPath)
    const sources = { ...(m.sources ?? {}) }
    const docFor = (scenes: number): PMNode => {
      const content: PMNode[] = [{ type: 'paragraph' }]
      for (let k = 0; k < scenes; k++) content.push({ type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: SCENE_BREAK_TEXT }] }, { type: 'paragraph' })
      return { type: 'doc', content }
    }
    const write = async (ch: Chapter, it: SplitItem) => {
      const bytes = await docToDocx(docFor(it.scenes), ch.title)
      await fs.writeFile(chapterPath(bookPath, ch), bytes)
      remember(bookPath, ch.id, bytes)
      sources[ch.id] = { pdf, start: it.start, ...(it.end ? { end: it.end } : {}) }
    }
    let rest = items
    const reuse = reuseId ? m.chapters.find((c) => c.id === reuseId) : undefined
    if (reuse && items.length) {
      reuse.title = items[0].title
      if (items[0].synopsis && !reuse.synopsis) reuse.synopsis = items[0].synopsis
      await write(reuse, items[0])
      rest = items.slice(1)
    }
    for (const it of rest) {
      const { chapter } = await addChapterUnlocked(bookPath, m, it.title)
      chapter.synopsis = it.synopsis
      await write(chapter, it)
    }
    m.sources = sources
    await writeManifest(bookPath, m)
    const notice = await syncFileNames(bookPath, m)
    await writeManifest(bookPath, m)
    return { book: toBook(bookPath, m), notice }
  })
}

/** Paragraphs in each chapter (the title counts as one), to compare with the original. */
export function paragraphCounts(bookPath: string): Promise<Record<string, number>> {
  return serial(bookPath, async () => {
    const m = await readManifest(bookPath)
    const out: Record<string, number> = {}
    for (const ch of m.chapters) {
      out[ch.id] = 1
      const file = chapterPath(bookPath, ch)
      if (!existsSync(file)) continue
      try {
        const res = await docxToDoc(new Uint8Array(await fs.readFile(file)))
        out[ch.id] = chapterParagraphCount(res.doc)
      } catch {
        // counted as just the title
      }
    }
    return out
  })
}

/** The paragraphs of the chapters linked to an original, as text (the translation memory, feature 46) */
export function paragraphTexts(bookPath: string): Promise<Record<string, string[]>> {
  return serial(bookPath, async () => {
    const m = await readManifest(bookPath)
    const out: Record<string, string[]> = {}
    for (const ch of m.chapters) {
      if (!m.sources?.[ch.id]) continue
      const file = chapterPath(bookPath, ch)
      if (!existsSync(file)) continue
      try {
        const res = await docxToDoc(new Uint8Array(await fs.readFile(file)))
        out[ch.id] = chapterParagraphTexts(res.doc, ch.title)
      } catch {
        // left out of the memory
      }
    }
    return out
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
    let oldWords = 0
    if (existsSync(file)) {
      const old = new Uint8Array(await fs.readFile(file))
      oldWords = await wordsOf(bookPath, ch.id, old)
      // a version of the text as it was, every so often (feature 14); never stops the save
      await drafts.autoSnapshotBeforeSave(bookPath, ch.id, old).catch(() => undefined)
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
      // feature 47: how many words this save added or removed, for the writing days
      const words = countWords(docText(doc))
      wordCache.set(`${bookPath}|${ch.id}`, { fp: fingerprint(bytes), words })
      writingLog.record(bookPath, words - oldWords)
    } catch (e) {
      await fs.rm(tmp, { force: true })
      throw new Error('השמירה נכשלה. אם הקובץ פתוח ב-Word, יש לסגור אותו ולנסות שוב.')
    }
  })
}

/**
 * Words in a chapter file as it is on disk. The count of the app's own last save is remembered, so the
 * file is read again only when it changed outside the app (Word, a restored version, another computer).
 */
const wordCache = new Map<string, { fp: string; words: number }>()
async function wordsOf(bookPath: string, id: string, bytes: Uint8Array): Promise<number> {
  const fp = fingerprint(bytes)
  const hit = wordCache.get(`${bookPath}|${id}`)
  if (hit && hit.fp === fp) return hit.words
  try {
    const words = countWords(docText((await docxToDoc(bytes)).doc))
    wordCache.set(`${bookPath}|${id}`, { fp, words })
    return words
  } catch {
    return 0
  }
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

// ---------------------------------------------------------------------------
// Background materials round (features 11, 20, 21, 34, 37); see background.ts
// ---------------------------------------------------------------------------

/** Runs a change to the background data in the book's queue, then saves the manifest */
function withManifest<T>(bookPath: string, fn: (m: Manifest) => Promise<T>): Promise<{ book: Book; value: T }> {
  return serial(bookPath, async () => {
    const m = await readManifest(bookPath)
    // keep only valid data, and drop links to chapters that were deleted
    Object.assign(m, normalizeBackground(m, m.chapters.map((c) => c.id)))
    const value = await fn(m)
    await writeManifest(bookPath, m)
    return { book: toBook(bookPath, m), value }
  })
}

export const createMaterial = (bookPath: string, kind: MaterialKind, name?: string) => withManifest(bookPath, (m) => bg.createMaterial(bookPath, m, kind, name))
export const updateMaterial = (bookPath: string, id: string, patch: Partial<Material>) => withManifest(bookPath, (m) => bg.updateMaterial(bookPath, m, id, patch))
export const deleteMaterial = (bookPath: string, id: string) => withManifest(bookPath, (m) => bg.deleteMaterial(bookPath, m, id))
export const attachFiles = (bookPath: string, id: string, paths: string[]) => withManifest(bookPath, (m) => bg.attachFiles(bookPath, m, id, paths))
export const detachFile = (bookPath: string, id: string, name: string) => withManifest(bookPath, (m) => bg.detachFile(bookPath, m, id, name))
export const addImages = (bookPath: string, paths: string[], link: { chapterId?: string; materialId?: string }) => withManifest(bookPath, (m) => bg.addImages(bookPath, m, paths, link))
export const setImages = (bookPath: string, list: InspirationImage[], groups?: InspirationGroup[]) => withManifest(bookPath, (m) => bg.setImages(bookPath, m, list, groups))
export const addImageData = (bookPath: string, bytes: Uint8Array, ext: string, link: { chapterId?: string; materialId?: string }, at?: { x: number; y: number }) =>
  withManifest(bookPath, (m) => bg.addImageData(bookPath, m, bytes, ext, link, at))
export const setGlossary = (bookPath: string, list: GlossaryEntry[]) =>
  withManifest(bookPath, async (m) => {
    m.glossary = list
  })
export const setTimeline = (bookPath: string, list: TimelineEvent[]) =>
  withManifest(bookPath, async (m) => {
    m.timeline = list
  })

export function loadMaterial(bookPath: string, id: string): Promise<LoadedChapter> {
  return serial(bookPath, async () => bg.loadMaterial(bookPath, await readManifest(bookPath), id))
}
export function saveMaterial(bookPath: string, id: string, doc: PMNode): Promise<void> {
  return serial(bookPath, async () => bg.saveMaterial(bookPath, await readManifest(bookPath), id, doc))
}
export const readImage = (bookPath: string, file: string) => bg.readImage(bookPath, file)
export const attachmentPath = bg.attachmentPath
export function materialFilePath(book: Book, id: string): string | null {
  const m = book.materials.find((x) => x.id === id)
  return m ? bg.materialPath(book.path, m) : null
}

/**
 * Renames the book: its title, and its folder to match (when no other folder has that name).
 * Returns the book at its new place, and a notice when the folder kept its name.
 */
export function renameBook(bookPath: string, title: string): Promise<{ book: Book; notice?: string }> {
  return serial(bookPath, async () => {
    const m = await readManifest(bookPath)
    m.title = title.trim() || m.title
    await writeManifest(bookPath, m)
    const want = join(dirname(bookPath), safeName(m.title))
    if (want === bookPath) return { book: toBook(bookPath, m) }
    const sameFolder = want.toLowerCase() === bookPath.toLowerCase()
    if (!sameFolder && existsSync(want)) return { book: toBook(bookPath, m), notice: `השם השתנה, אבל התיקייה נשארה בשמה הקודם: כבר יש תיקייה בשם "${basename(want)}".` }
    stopWatching()
    try {
      if (sameFolder) {
        const tmp = bookPath + '~' + Date.now()
        await fs.rename(bookPath, tmp)
        await fs.rename(tmp, want)
      } else await fs.rename(bookPath, want)
    } catch {
      return { book: toBook(bookPath, m), notice: 'השם השתנה, אבל לא הצלחתי לשנות את שם התיקייה. כנראה קובץ מהספר פתוח בתוכנה אחרת (למשל Word או סייר הקבצים). אפשר לנסות שוב אחר כך.' }
    }
    return { book: toBook(want, m) }
  })
}

// ---------------------------------------------------------------------------
// Round 9: bringing a chapter back from a daily backup (feature 49), and importing a whole
// manuscript split into chapters (feature 42)
// ---------------------------------------------------------------------------

/**
 * Puts a chapter file back as it was in a backup. The text there now is kept first as a version.
 * A chapter that was deleted since comes back as a new chapter at the end of the book.
 */
export function restoreChapterFile(bookPath: string, chapterId: string, title: string, bytes: Uint8Array, label: string): Promise<{ book: Book; chapterId: string; notice?: string }> {
  return serial(bookPath, async () => {
    const m = await readManifest(bookPath)
    let ch = m.chapters.find((c) => c.id === chapterId)
    let notice: string | undefined
    if (ch) {
      const file = chapterPath(bookPath, ch)
      if (existsSync(file)) await drafts.snapshot(bookPath, ch.id, new Uint8Array(await fs.readFile(file)), { label, auto: false })
    } else {
      const added = await addChapterUnlocked(bookPath, m, title)
      ch = added.chapter
      notice = added.notice
    }
    const file = chapterPath(bookPath, ch)
    const tmp = file + '.saving'
    await fs.writeFile(tmp, bytes)
    try {
      await fs.rename(tmp, file)
    } catch {
      await fs.rm(tmp, { force: true })
      throw new Error('השחזור נכשל. אם קובץ הפרק פתוח ב-Word, יש לסגור אותו ולנסות שוב.')
    }
    // the open editors read the file again (it is not "remembered" as the app's own save on purpose)
    known.delete(`${bookPath}|${ch.id}`)
    return { book: toBook(bookPath, m), chapterId: ch.id, notice }
  })
}

/** Adds chapters with their text at the end of the book. An empty book's only, empty chapter is reused for the first one. */
export function importChapters(bookPath: string, items: { title: string; doc: PMNode }[]): Promise<{ book: Book; notice?: string }> {
  return serial(bookPath, async () => {
    const m = await readManifest(bookPath)
    let rest = items
    // a book with one empty chapter (just created): the import takes its place
    if (m.chapters.length === 1 && items.length) {
      const only = m.chapters[0]
      const file = chapterPath(bookPath, only)
      const empty = !existsSync(file) || countWords(docText((await docxToDoc(new Uint8Array(await fs.readFile(file)))).doc)) === 0
      if (empty) {
        only.title = items[0].title.trim() || only.title
        const bytes = await docToDocx(items[0].doc, only.title)
        await fs.writeFile(file, bytes)
        remember(bookPath, only.id, bytes)
        rest = items.slice(1)
      }
    }
    for (const it of rest) {
      const { chapter } = await addChapterUnlocked(bookPath, m, it.title)
      const bytes = await docToDocx(it.doc, chapter.title)
      await fs.writeFile(chapterPath(bookPath, chapter), bytes)
      remember(bookPath, chapter.id, bytes)
    }
    const notice = await syncFileNames(bookPath, m)
    await writeManifest(bookPath, m)
    return { book: toBook(bookPath, m), notice }
  })
}

/** A new book made from an imported manuscript */
export async function createBookFromChapters(parentDir: string, title: string, items: { title: string; doc: PMNode }[]): Promise<{ book: Book; notice?: string }> {
  const book = await createBook(parentDir, title)
  return importChapters(book.path, items)
}
