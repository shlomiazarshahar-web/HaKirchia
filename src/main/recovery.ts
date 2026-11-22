// Feature 41: crash recovery (see shared/recovery.ts). The files live in the app's own folder on
// this computer (AppData), one small JSON file per document with unsaved typing.

import { app, dialog, type BrowserWindow } from 'electron'
import { promises as fs, existsSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import type { PMNode } from '../shared/types'
import { recoveryKey, tailPreview, RECOVERY_MAX_DAYS, type RecoveryEntry, type RecoveryItem } from '../shared/recovery'
import { countWords, docText, docToDocx, docxToDoc } from '../shared/docx'
import * as project from './project'
import * as workshop from './workshop'

const dir = () => join(app.getPath('userData'), 'recovery')
const discardedDir = () => join(dir(), 'discarded')
/**
 * One file per document and per run of the window (`session`), so text left from an earlier run
 * is never overwritten by new typing in the same chapter before the writer decided what to do with it.
 */
const fileName = (key: string, session: string) => `${createHash('sha1').update(key).digest('hex').slice(0, 20)}-${session.replace(/[^\w-]/g, '').slice(0, 12)}.json`
const fileFor = (name: string) => join(dir(), name)

// Writes and removals of the same document run in the order they were asked for
const queues = new Map<string, Promise<unknown>>()
function inOrder<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const next = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn)
  queues.set(key, next)
  return next
}

export function writeEntry(session: string, e: RecoveryEntry): Promise<void> {
  const name = fileName(recoveryKey(e.kind, e.bookPath, e.id), session)
  return inOrder(name, async () => {
    await fs.mkdir(dir(), { recursive: true })
    const file = fileFor(name)
    await fs.writeFile(file + '.tmp', JSON.stringify({ ...e, at: Date.now() }), 'utf8')
    await fs.rename(file + '.tmp', file)
  })
}

export function clearEntry(session: string, key: string): Promise<void> {
  return clearFile(fileName(key, session))
}
const clearFile = (name: string) => inOrder(name, () => fs.rm(fileFor(name), { force: true }))

type Stored = RecoveryEntry & { name: string }

async function readAll(): Promise<Stored[]> {
  let names: string[] = []
  try {
    names = (await fs.readdir(dir())).filter((n) => n.endsWith('.json'))
  } catch {
    return []
  }
  const out: Stored[] = []
  for (const n of names) {
    try {
      const e = JSON.parse(await fs.readFile(join(dir(), n), 'utf8')) as RecoveryEntry
      if (e && e.doc && e.kind && e.bookPath && e.id) out.push({ ...e, name: n })
    } catch {
      /* a half-written file: the previous one was replaced atomically, so nothing is lost */
    }
  }
  return out
}

const find = async (name: string) => (await readAll()).find((e) => e.name === name)

/** The same text after a trip through Word, so formatting details the file cannot keep don't count as a difference */
async function normal(doc: PMNode): Promise<string> {
  return JSON.stringify((await docxToDoc(await docToDocx(doc, 'x'))).doc)
}

interface Target {
  bookTitle: string
  title: string
  disk: PMNode
}

/** Where the text belongs, and what is there now. Throws (with the reason) when it can't be found. */
async function target(e: RecoveryEntry): Promise<Target> {
  if (e.kind === 'exercise') {
    const w = await workshop.openWorkshop()
    const ex = w.exercises.find((x) => x.id === e.id)
    if (!ex) throw new Error('התרגיל נמחק מהסדנה')
    return { bookTitle: 'סדנה', title: ex.title, disk: (await workshop.loadExercise(e.id)).doc }
  }
  if (!project.isBookFolder(e.bookPath)) throw new Error('תיקיית הספר לא נמצאה כרגע (אולי הכונן לא מחובר, או שהספר הועבר)')
  const book = await project.openBook(e.bookPath)
  if (e.kind === 'chapter') {
    const ch = book.chapters.find((c) => c.id === e.id)
    if (!ch) throw new Error('הפרק נמחק מהספר')
    return { bookTitle: book.title, title: ch.title, disk: (await project.loadChapter(e.bookPath, e.id)).doc }
  }
  if (e.kind === 'alt') {
    const a = book.alts.find((x) => x.id === e.id)
    const ch = a && book.chapters.find((c) => c.id === a.chapterId)
    if (!a || !ch) throw new Error('הטיוטה החלופית נמחקה')
    return { bookTitle: book.title, title: `${ch.title}: ${a.name}`, disk: (await project.loadAlt(e.bookPath, e.id)).doc }
  }
  const m = book.materials.find((x) => x.id === e.id)
  if (!m) throw new Error('דף הרקע נמחק')
  return { bookTitle: book.title, title: m.name, disk: (await project.loadMaterial(e.bookPath, e.id)).doc }
}

/**
 * The unsaved texts left from an earlier run. Texts that are already in their files (the same
 * words) and very old ones are cleared quietly; the rest are listed, newest first.
 */
export async function listEntries(session: string): Promise<RecoveryItem[]> {
  const out: RecoveryItem[] = []
  const oldest = Date.now() - RECOVERY_MAX_DAYS * 86400_000
  const mine = `-${session.replace(/[^\w-]/g, '').slice(0, 12)}.json`
  for (const e of await readAll()) {
    const key = e.name
    // typing of this run of the window is not "left over"
    if (key.endsWith(mine)) continue
    if (e.at < oldest) {
      await discardEntry(key)
      continue
    }
    const text = docText(e.doc)
    const item: RecoveryItem = { key, kind: e.kind, bookPath: e.bookPath, id: e.id, at: e.at, bookTitle: '', title: '', words: countWords(text), diskWords: null, preview: tailPreview(text) }
    try {
      const t = await target(e)
      if ((await normal(t.disk)) === (await normal(e.doc))) {
        await clearFile(key)
        continue
      }
      Object.assign(item, { bookTitle: t.bookTitle, title: t.title, diskWords: countWords(docText(t.disk)) })
    } catch (err) {
      item.missing = err instanceof Error ? err.message : String(err)
      item.bookTitle = e.bookPath.split(/[\\/]/).pop() ?? ''
      item.title = text.split('\n').find((l) => l.trim())?.slice(0, 40) ?? ''
    }
    out.push(item)
  }
  return out.sort((a, b) => b.at - a.at)
}

/**
 * Puts the unsaved text back in its file. For a chapter, the text that is in the file now is kept
 * first as a version ("לפני שחזור"), so restoring never loses anything either.
 */
export async function restoreEntry(key: string): Promise<void> {
  const e = await find(key)
  if (!e) return
  await target(e) // throws with the reason when the place is gone
  if (e.kind === 'chapter') {
    await project.takeVersion(e.bookPath, e.id, 'לפני שחזור טקסט שלא נשמר')
    await project.saveChapter(e.bookPath, e.id, e.doc)
  } else if (e.kind === 'alt') await project.saveAlt(e.bookPath, e.id, e.doc)
  else if (e.kind === 'material') await project.saveMaterial(e.bookPath, e.id, e.doc)
  else await workshop.saveExercise(e.id, e.doc)
  await clearFile(key)
}

/** Gives up on an unsaved text. It is kept aside for a while, in case of second thoughts. */
export function discardEntry(key: string): Promise<void> {
  return inOrder(key, async () => {
    const file = fileFor(key)
    if (!existsSync(file)) return
    await fs.mkdir(discardedDir(), { recursive: true })
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    await fs.rename(file, join(discardedDir(), `${stamp} ${file.split(/[\\/]/).pop()}`))
    // what was given up more than a month ago goes for good
    const month = Date.now() - 30 * 86400_000
    for (const n of await fs.readdir(discardedDir()).catch(() => [] as string[])) {
      const f = join(discardedDir(), n)
      const st = await fs.stat(f).catch(() => null)
      if (st && st.mtimeMs < month) await fs.rm(f, { force: true })
    }
  })
}

/** Saves an unsaved text as a Word file of its own, anywhere the writer chooses. Returns its path. */
export async function saveEntryAs(win: BrowserWindow, key: string, name: string): Promise<string | null> {
  const e = await find(key)
  if (!e) return null
  const res = await dialog.showSaveDialog(win, {
    title: 'שמירת הטקסט ששוחזר כקובץ Word',
    defaultPath: join(app.getPath('documents'), `${project.safeName(name || 'טקסט ששוחזר')} (שוחזר).docx`),
    filters: [{ name: 'Word', extensions: ['docx'] }]
  })
  if (res.canceled || !res.filePath) return null
  await fs.writeFile(res.filePath, await docToDocx(e.doc, name || 'טקסט ששוחזר'))
  await clearFile(key)
  return res.filePath
}
