// Background materials round (round 7), on disk. The book's manifest holds the list of pages, the
// glossary, the timeline and the images; the free text of each page is a Word file in "חומרי רקע",
// attached files are in "חומרי רקע/קבצים" and images in "השראה". Every function here runs inside
// the book's queue (see serial in project.ts) and gets the manifest to change.

import { promises as fs, existsSync } from 'fs'
import { join, basename, extname, dirname } from 'path'
import { randomUUID } from 'crypto'
import { shell } from 'electron'
import type { LoadedChapter, PMNode } from '../shared/types'
import {
  ATTACH_DIR,
  DEFAULT_FIELDS,
  freeName,
  IMAGES_DIR,
  KIND_LABEL,
  KIND_NEW,
  MATERIALS_DIR,
  type GlossaryEntry,
  type InspirationImage,
  type Material,
  type MaterialKind,
  type TimelineEvent
} from '../shared/background'
import { docToDocx, docxToDoc, emptyDoc } from '../shared/docx'

/** The parts of the manifest this file changes */
export interface BackgroundManifest {
  materials?: Material[]
  glossary?: GlossaryEntry[]
  images?: InspirationImage[]
  timeline?: TimelineEvent[]
}

const materialsDir = (bookPath: string) => join(bookPath, MATERIALS_DIR)
export const materialPath = (bookPath: string, m: Pick<Material, 'file'>) => join(materialsDir(bookPath), ...m.file.split('/'))
const attachDir = (bookPath: string) => join(materialsDir(bookPath), ATTACH_DIR)
const imagesDir = (bookPath: string) => join(bookPath, IMAGES_DIR)

function cleanName(title: string): string {
  const cleaned = title
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 80)
  return cleaned || 'ללא שם'
}

async function namesIn(dir: string): Promise<Set<string>> {
  try {
    return new Set(await fs.readdir(dir))
  } catch {
    return new Set()
  }
}

/** A Word-file name for a page in its kind's folder, not taken by another page */
async function fileFor(bookPath: string, m: BackgroundManifest, kind: MaterialKind, name: string, selfId?: string): Promise<string> {
  const dir = join(materialsDir(bookPath), KIND_LABEL[kind])
  const taken = await namesIn(dir)
  for (const o of m.materials ?? []) if (o.id !== selfId && o.kind === kind) taken.add(basename(o.file))
  return `${KIND_LABEL[kind]}/${freeName(cleanName(name), '.docx', taken)}`
}

/** A new background page, with the usual fields of its kind and an empty Word file */
export async function createMaterial(bookPath: string, m: BackgroundManifest, kind: MaterialKind, name?: string): Promise<Material> {
  const title = name?.trim() || KIND_NEW[kind]
  const mat: Material = {
    id: randomUUID(),
    kind,
    name: title,
    aliases: [],
    tags: [],
    fields: DEFAULT_FIELDS[kind].map((label) => ({ label, value: '' })),
    file: await fileFor(bookPath, m, kind, title),
    attachments: [],
    at: Date.now()
  }
  const file = materialPath(bookPath, mat)
  await fs.mkdir(dirname(file), { recursive: true })
  await fs.writeFile(file, await docToDocx(emptyDoc(), title))
  m.materials = [...(m.materials ?? []), mat]
  return mat
}

/**
 * Changes a page's details. A new name renames its Word file too; when the file is open in Word it
 * keeps its old name (nothing is lost, the manifest records the real name).
 */
export async function updateMaterial(bookPath: string, m: BackgroundManifest, id: string, patch: Partial<Omit<Material, 'id' | 'file' | 'kind' | 'at'>>): Promise<string | undefined> {
  const mat = m.materials?.find((x) => x.id === id)
  if (!mat) throw new Error('הדף לא נמצא')
  const oldName = mat.name
  Object.assign(mat, patch)
  mat.name = mat.name.trim() || oldName
  if (patch.original !== undefined && !patch.original.trim()) delete mat.original
  if (mat.name === oldName) return undefined
  const want = await fileFor(bookPath, m, mat.kind, mat.name, mat.id)
  if (want === mat.file) return undefined
  const from = materialPath(bookPath, mat)
  try {
    if (existsSync(from)) await fs.rename(from, materialPath(bookPath, { file: want }))
    mat.file = want
  } catch {
    return `לא הצלחתי לשנות את שם הקובץ של "${mat.name}". כנראה הוא פתוח בתוכנה אחרת (למשל Word). התוכן לא נפגע.`
  }
  return undefined
}

/** Removes a page: its Word file goes to the Recycle Bin; its images stay on the board, unlinked */
export async function deleteMaterial(bookPath: string, m: BackgroundManifest, id: string): Promise<void> {
  const mat = m.materials?.find((x) => x.id === id)
  if (!mat) return
  const file = materialPath(bookPath, mat)
  if (existsSync(file)) await shell.trashItem(file).catch(() => undefined)
  m.materials = (m.materials ?? []).filter((x) => x.id !== id)
  m.images = (m.images ?? []).map((im) => (im.materialId === id ? { ...im, materialId: undefined } : im))
  m.timeline = (m.timeline ?? []).map((e) => ({ ...e, materialIds: e.materialIds.filter((x) => x !== id) }))
}

export async function loadMaterial(bookPath: string, m: BackgroundManifest, id: string): Promise<LoadedChapter> {
  const mat = m.materials?.find((x) => x.id === id)
  if (!mat) throw new Error('הדף לא נמצא')
  const file = materialPath(bookPath, mat)
  if (!existsSync(file)) return { doc: emptyDoc(), warnings: [] }
  const res = await docxToDoc(new Uint8Array(await fs.readFile(file)))
  return { doc: res.doc, warnings: res.warnings }
}

export async function saveMaterial(bookPath: string, m: BackgroundManifest, id: string, doc: PMNode): Promise<void> {
  const mat = m.materials?.find((x) => x.id === id)
  if (!mat) throw new Error('הדף לא נמצא')
  const file = materialPath(bookPath, mat)
  await fs.mkdir(dirname(file), { recursive: true })
  const tmp = file + '.saving'
  await fs.writeFile(tmp, await docToDocx(doc, mat.name))
  try {
    await fs.rename(tmp, file)
  } catch {
    await fs.rm(tmp, { force: true })
    throw new Error('השמירה נכשלה. אם הקובץ פתוח ב-Word, יש לסגור אותו ולנסות שוב.')
  }
}

/** Copies files into a folder of the book under free names (an identical file there is reused). Returns their names. */
async function copyInto(dir: string, paths: string[]): Promise<string[]> {
  await fs.mkdir(dir, { recursive: true })
  const out: string[] = []
  for (const from of paths) {
    const bytes = await fs.readFile(from)
    const ext = extname(from)
    const base = cleanName(basename(from, ext))
    for (let n = 1; ; n++) {
      const name = n === 1 ? `${base}${ext}` : `${base} (${n})${ext}`
      const target = join(dir, name)
      if (!existsSync(target)) {
        await fs.writeFile(target, bytes)
        out.push(name)
        break
      }
      if ((await fs.readFile(target)).equals(bytes)) {
        out.push(name)
        break
      }
    }
  }
  return out
}

/** Attaches files to a page (copied into "חומרי רקע/קבצים") */
export async function attachFiles(bookPath: string, m: BackgroundManifest, id: string, paths: string[]): Promise<void> {
  const mat = m.materials?.find((x) => x.id === id)
  if (!mat) throw new Error('הדף לא נמצא')
  const names = await copyInto(attachDir(bookPath), paths)
  mat.attachments = [...new Set([...mat.attachments, ...names])]
}

/** Detaches a file from a page; the file goes to the Recycle Bin when no other page uses it */
export async function detachFile(bookPath: string, m: BackgroundManifest, id: string, name: string): Promise<void> {
  const mat = m.materials?.find((x) => x.id === id)
  if (!mat) return
  mat.attachments = mat.attachments.filter((a) => a !== name)
  const used = (m.materials ?? []).some((x) => x.attachments.includes(name))
  const file = join(attachDir(bookPath), basename(name))
  if (!used && existsSync(file)) await shell.trashItem(file).catch(() => undefined)
}

export function attachmentPath(bookPath: string, name: string): string {
  if (basename(name) !== name) throw new Error('שם קובץ לא תקין')
  return join(attachDir(bookPath), name)
}

// ---------------------------------------------------------------------------
// Images (feature 37)
// ---------------------------------------------------------------------------

export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif']

/** Adds images (copied into "השראה"), linked to a chapter, a page, or the board in general */
export async function addImages(bookPath: string, m: BackgroundManifest, paths: string[], link: { chapterId?: string; materialId?: string }): Promise<InspirationImage[]> {
  const ok = paths.filter((p) => IMAGE_EXTS.includes(extname(p).slice(1).toLowerCase()))
  if (!ok.length) throw new Error('אפשר להוסיף רק קובצי תמונה (PNG, JPG, GIF, WebP)')
  const names = await copyInto(imagesDir(bookPath), ok)
  const added = names.map((file) => ({
    id: randomUUID(),
    file,
    caption: '',
    ...(link.chapterId ? { chapterId: link.chapterId } : {}),
    ...(link.materialId ? { materialId: link.materialId } : {}),
    at: Date.now()
  }))
  m.images = [...(m.images ?? []), ...added]
  return added
}

/** Saves the list of images (captions, links, order). Images taken off the list go to the Recycle Bin. */
export async function setImages(bookPath: string, m: BackgroundManifest, list: InspirationImage[]): Promise<void> {
  const keep = new Set(list.map((i) => i.file))
  for (const old of m.images ?? []) {
    if (keep.has(old.file)) continue
    const f = join(imagesDir(bookPath), basename(old.file))
    if (existsSync(f)) await shell.trashItem(f).catch(() => undefined)
  }
  m.images = list
}

export async function readImage(bookPath: string, file: string): Promise<Uint8Array> {
  if (basename(file) !== file) throw new Error('שם קובץ לא תקין')
  return new Uint8Array(await fs.readFile(join(imagesDir(bookPath), file)))
}
