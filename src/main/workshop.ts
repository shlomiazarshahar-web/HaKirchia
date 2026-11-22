// Reviews kept with the book (feature 19) and the workshop of writing exercises (feature 22), on disk:
//   <book>/ביקורות.json                                   the book's reviews, newest first
//   <workshop>/סדנה.json + <workshop>/תרגילים/<name>.docx  exercises (Word files) and writing prompts
// The workshop folder is next to the books: Documents/הכריכייה/סדנה, unless the writer moved it.

import { app, shell } from 'electron'
import { promises as fs, existsSync } from 'fs'
import { join, basename, extname } from 'path'
import type { LoadedChapter, PMNode } from '../shared/types'
import { countWords, docText, docToDocx, docxToDoc, emptyDoc } from '../shared/docx'
import { backgroundText, EXERCISES_DIR, newId, titleFromPrompt, WORKSHOP_FILE, type BgPage, type Exercise, type ExercisePrompt, type Review, type Workshop } from '../shared/review'
import { getSettings, updateSettings } from './settings'
import * as project from './project'
import { safeName } from './project'

export const REVIEWS_FILE = 'ביקורות.json'

async function writeJson(file: string, data: unknown): Promise<void> {
  const tmp = file + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await fs.rename(tmp, file)
}

// Writes to one file never overlap
const queues = new Map<string, Promise<unknown>>()
function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  queues.set(
    key,
    next.catch(() => undefined)
  )
  return next
}

// ---------------------------------------------------------------------------
// The book's reviews
// ---------------------------------------------------------------------------

export async function readReviews(bookPath: string): Promise<Review[]> {
  try {
    const raw = JSON.parse(await fs.readFile(join(bookPath, REVIEWS_FILE), 'utf8'))
    return Array.isArray(raw?.reviews) ? raw.reviews : []
  } catch {
    return []
  }
}

/** Adds or replaces one review (by id), or removes it (remove = true). Returns the whole list. */
export function putReview(bookPath: string, rv: Review, remove = false): Promise<Review[]> {
  return serial(join(bookPath, REVIEWS_FILE), async () => {
    const list = (await readReviews(bookPath)).filter((x) => x.id !== rv.id)
    const next = remove ? list : [rv, ...list].sort((a, b) => b.at - a.at)
    await writeJson(join(bookPath, REVIEWS_FILE), { app: 'hakirchia', reviews: next })
    return next
  })
}

/** The book's characters, places, research and glossary as text, for "include background" */
export async function bookBackground(bookPath: string): Promise<string> {
  const book = await project.openBook(bookPath)
  const pages: BgPage[] = []
  for (const m of book.materials ?? []) {
    let notes = ''
    try {
      notes = docText((await project.loadMaterial(bookPath, m.id)).doc)
    } catch {
      /* a page that cannot be read is sent without its notes */
    }
    pages.push({ kind: m.kind, name: m.name, aliases: m.aliases, tags: m.tags, fields: m.fields, original: m.original, notes })
  }
  return backgroundText(pages, book.glossary ?? [])
}

// ---------------------------------------------------------------------------
// The workshop
// ---------------------------------------------------------------------------

export function workshopPath(): string {
  const s = getSettings()
  if (s.workshopPath) return s.workshopPath
  const books = s.defaultFolder ?? join(app.getPath('documents'), 'הכריכייה')
  return join(books, 'סדנה')
}

interface WorkshopFile {
  app: 'hakirchia'
  exercises: Exercise[]
  prompts: ExercisePrompt[]
}

async function readFile(dir: string): Promise<WorkshopFile> {
  try {
    const raw = JSON.parse(await fs.readFile(join(dir, WORKSHOP_FILE), 'utf8'))
    return { app: 'hakirchia', exercises: Array.isArray(raw?.exercises) ? raw.exercises : [], prompts: Array.isArray(raw?.prompts) ? raw.prompts : [] }
  } catch {
    return { app: 'hakirchia', exercises: [], prompts: [] }
  }
}

const toWorkshop = (dir: string, f: WorkshopFile): Workshop => ({ path: dir, exercises: [...f.exercises].sort((a, b) => b.updated - a.updated), prompts: f.prompts })

/** Opens the workshop: reads it, or creates the folder the first time */
export async function openWorkshop(): Promise<Workshop> {
  const dir = workshopPath()
  await fs.mkdir(join(dir, EXERCISES_DIR), { recursive: true })
  return toWorkshop(dir, await readFile(dir))
}

/** Changes something in the workshop file, inside its queue */
function change<T>(fn: (f: WorkshopFile, dir: string) => Promise<T> | T): Promise<{ workshop: Workshop; value: T }> {
  const dir = workshopPath()
  return serial(join(dir, WORKSHOP_FILE), async () => {
    await fs.mkdir(join(dir, EXERCISES_DIR), { recursive: true })
    const f = await readFile(dir)
    const value = await fn(f, dir)
    await writeJson(join(dir, WORKSHOP_FILE), f)
    return { workshop: toWorkshop(dir, f), value }
  })
}

const exPath = (dir: string, ex: Pick<Exercise, 'file'>) => join(dir, EXERCISES_DIR, ex.file)

function freeFile(dir: string, f: WorkshopFile, title: string, except?: string): string {
  const date = new Date()
  const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const base = `${stamp} ${safeName(title) || 'תרגיל'}`
  const taken = new Set(f.exercises.filter((e) => e.id !== except).map((e) => e.file.toLowerCase()))
  for (let i = 1; ; i++) {
    const name = `${base}${i > 1 ? ` (${i})` : ''}.docx`
    if (!taken.has(name.toLowerCase()) && !existsSync(join(dir, EXERCISES_DIR, name))) return name
  }
}

export function createExercise(prompt: string, title?: string, doc?: PMNode, fromPromptId?: string) {
  return change(async (f, dir) => {
    const t = (title ?? '').trim() || (prompt.trim() ? titleFromPrompt(prompt) : 'תרגיל חדש')
    const now = Date.now()
    const body = doc ?? emptyDoc()
    const ex: Exercise = { id: newId(), title: t, prompt: prompt.trim(), file: freeFile(dir, f, t), created: now, updated: now, words: countWords(docText(body)), reviews: [] }
    await fs.writeFile(exPath(dir, ex), await docToDocx(body, t))
    f.exercises.push(ex)
    // a prompt from the list that was written becomes an exercise and leaves the list
    if (fromPromptId) f.prompts = f.prompts.filter((p) => p.id !== fromPromptId)
    return ex
  })
}

export function updateExercise(id: string, patch: Partial<Pick<Exercise, 'title' | 'prompt'>>) {
  return change(async (f, dir) => {
    const ex = f.exercises.find((e) => e.id === id)
    if (!ex) throw new Error('התרגיל לא נמצא')
    if (patch.prompt !== undefined) ex.prompt = patch.prompt
    if (patch.title !== undefined && patch.title.trim() && patch.title.trim() !== ex.title) {
      ex.title = patch.title.trim()
      const file = freeFile(dir, f, ex.title, ex.id)
      try {
        if (existsSync(exPath(dir, ex))) await fs.rename(exPath(dir, ex), join(dir, EXERCISES_DIR, file))
        ex.file = file
      } catch {
        /* the Word file is open somewhere: it keeps its old name */
      }
    }
    ex.updated = Date.now()
  })
}

export function deleteExercise(id: string) {
  return change(async (f, dir) => {
    const ex = f.exercises.find((e) => e.id === id)
    if (!ex) return
    if (existsSync(exPath(dir, ex))) await shell.trashItem(exPath(dir, ex)).catch(() => fs.rm(exPath(dir, ex), { force: true }))
    f.exercises = f.exercises.filter((e) => e.id !== id)
  })
}

export async function loadExercise(id: string): Promise<LoadedChapter> {
  const dir = workshopPath()
  const ex = (await readFile(dir)).exercises.find((e) => e.id === id)
  if (!ex) throw new Error('התרגיל לא נמצא')
  if (!existsSync(exPath(dir, ex))) return { doc: emptyDoc(), warnings: [] }
  const res = await docxToDoc(new Uint8Array(await fs.readFile(exPath(dir, ex))))
  return { doc: res.doc, warnings: res.warnings }
}

export function saveExercise(id: string, doc: PMNode) {
  return change(async (f, dir) => {
    const ex = f.exercises.find((e) => e.id === id)
    if (!ex) throw new Error('התרגיל לא נמצא')
    const file = exPath(dir, ex)
    const tmp = file + '.saving'
    await fs.writeFile(tmp, await docToDocx(doc, ex.title))
    try {
      await fs.rename(tmp, file)
    } catch {
      await fs.rm(tmp, { force: true })
      throw new Error('השמירה נכשלה. אם הקובץ פתוח ב-Word, יש לסגור אותו ולנסות שוב.')
    }
    ex.words = countWords(docText(doc))
    ex.updated = Date.now()
  })
}

/** Adds or replaces a review of an exercise, or removes it */
export function putExerciseReview(id: string, rv: Review, remove = false) {
  return change((f) => {
    const ex = f.exercises.find((e) => e.id === id)
    if (!ex) throw new Error('התרגיל לא נמצא')
    const list = (ex.reviews ?? []).filter((x) => x.id !== rv.id)
    ex.reviews = remove ? list : [rv, ...list].sort((a, b) => b.at - a.at)
  })
}

export function addPrompts(texts: string[], source: ExercisePrompt['source']) {
  return change((f) => {
    const have = new Set(f.prompts.map((p) => p.text.trim()))
    const now = Date.now()
    const added = texts
      .map((t) => t.trim())
      .filter((t) => t && !have.has(t))
      .map((text, i) => ({ id: newId(), text, source, at: now + i }))
    f.prompts.push(...added)
    return added.length
  })
}

export function removePrompt(id: string) {
  return change((f) => {
    f.prompts = f.prompts.filter((p) => p.id !== id)
  })
}

export function editPrompt(id: string, text: string) {
  return change((f) => {
    const p = f.prompts.find((x) => x.id === id)
    if (p) p.text = text
  })
}

/** Word, text or Markdown files become exercises (exercises written in claude.ai and saved) */
export function importExercises(paths: string[]) {
  return change(async (f, dir) => {
    let n = 0
    for (const from of paths) {
      const ext = extname(from).toLowerCase()
      const title = basename(from, extname(from))
      let doc: PMNode
      if (ext === '.docx') doc = (await docxToDoc(new Uint8Array(await fs.readFile(from)))).doc
      else {
        const text = await fs.readFile(from, 'utf8')
        const paras = text.split(/\r?\n/).map((l) => l.replace(/^#+\s*/, ''))
        doc = { type: 'doc', content: paras.map((p) => ({ type: 'paragraph', attrs: { dir: 'rtl', textAlign: null }, ...(p ? { content: [{ type: 'text', text: p }] } : {}) })) }
      }
      const now = Date.now()
      const ex: Exercise = { id: newId(), title, prompt: '', file: freeFile(dir, f, title), created: now, updated: now, words: countWords(docText(doc)), reviews: [] }
      await fs.writeFile(exPath(dir, ex), await docToDocx(doc, title))
      f.exercises.push(ex)
      n++
    }
    return n
  })
}

export async function moveWorkshop(folder: string): Promise<Workshop> {
  updateSettings({ workshopPath: folder })
  return openWorkshop()
}

export const exerciseFile = async (id: string): Promise<string> => {
  const dir = workshopPath()
  const ex = (await readFile(dir)).exercises.find((e) => e.id === id)
  if (!ex) throw new Error('התרגיל לא נמצא')
  return exPath(dir, ex)
}
