// Saving and drafts round, on disk:
//   <book>/גרסאות/<chapter id>/versions.json + one Word file per version   (feature 14)
//   <book>/מגירה.json                                                      (feature 27)
//   <book>/טיוטות חלופיות/<name>.docx  (listed in the book's manifest)      (feature 35)
// Every function here runs inside the book's queue (see serial in project.ts).

import { promises as fs, existsSync } from 'fs'
import { join } from 'path'
import { randomUUID, createHash } from 'crypto'
import type { DrawerItem, PMNode, Version } from '../shared/types'
import { countWords, docText, docxToDoc } from '../shared/docx'
import { AUTO_VERSION_MINUTES, DRAWER_MAX_AUTO, MAX_AUTO_VERSIONS } from '../shared/drafts'

export const VERSIONS_DIR = 'גרסאות'
export const DRAWER_FILE = 'מגירה.json'
export const ALTS_DIR = 'טיוטות חלופיות'

interface VersionIndex {
  versions: (Version & { file: string; hash: string })[]
}

const versionsDir = (bookPath: string, chapterId: string) => join(bookPath, VERSIONS_DIR, chapterId)
const hash = (bytes: Uint8Array) => createHash('sha1').update(bytes).digest('hex')

async function writeJson(file: string, data: unknown): Promise<void> {
  const tmp = file + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await fs.rename(tmp, file)
}

async function readIndex(bookPath: string, chapterId: string): Promise<VersionIndex> {
  try {
    const raw = JSON.parse(await fs.readFile(join(versionsDir(bookPath, chapterId), 'versions.json'), 'utf8')) as VersionIndex
    return Array.isArray(raw.versions) ? raw : { versions: [] }
  } catch {
    return { versions: [] }
  }
}

const stampName = (at: number) => {
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

const strip = (v: VersionIndex['versions'][number]): Version => {
  const { file: _f, hash: _h, ...rest } = v
  return rest
}

/** Versions of a chapter, newest first. */
export async function listVersions(bookPath: string, chapterId: string): Promise<Version[]> {
  const idx = await readIndex(bookPath, chapterId)
  return idx.versions.filter((v) => existsSync(join(versionsDir(bookPath, chapterId), v.file))).map(strip).sort((a, b) => b.at - a.at)
}

/**
 * Keeps a copy of the chapter file as it is on disk. Nothing is kept when the newest version is
 * already exactly this text (returns that version instead).
 */
export async function snapshot(
  bookPath: string,
  chapterId: string,
  bytes: Uint8Array,
  opts: { label?: string; auto: boolean; reason?: string }
): Promise<Version> {
  const dir = versionsDir(bookPath, chapterId)
  await fs.mkdir(dir, { recursive: true })
  const idx = await readIndex(bookPath, chapterId)
  const h = hash(bytes)
  const newest = [...idx.versions].sort((a, b) => b.at - a.at)[0]
  if (newest && newest.hash === h && existsSync(join(dir, newest.file))) {
    // the same text: just give it the name, if one was given now
    if (opts.label && !newest.label) {
      newest.label = opts.label
      newest.auto = false
      await writeJson(join(dir, 'versions.json'), idx)
    }
    return strip(newest)
  }
  let words = 0
  try {
    words = countWords(docText((await docxToDoc(bytes)).doc))
  } catch {
    /* unreadable file: kept anyway */
  }
  const at = Date.now()
  const id = randomUUID()
  const file = `${stampName(at)} ${id.slice(0, 6)}.docx`
  await fs.writeFile(join(dir, file), bytes)
  const v = { id, chapterId, at, label: (opts.label ?? '').trim(), auto: opts.auto, ...(opts.reason ? { reason: opts.reason } : {}), words, file, hash: h }
  idx.versions.push(v)
  // automatic versions do not pile up forever; named ones are kept
  const autos = idx.versions.filter((x) => x.auto && !x.label).sort((a, b) => b.at - a.at)
  for (const old of autos.slice(MAX_AUTO_VERSIONS)) {
    idx.versions = idx.versions.filter((x) => x.id !== old.id)
    await fs.rm(join(dir, old.file), { force: true })
  }
  await writeJson(join(dir, 'versions.json'), idx)
  return strip(v)
}

/**
 * Called before a chapter file is overwritten by a save: keeps the text as it was, at most once
 * every AUTO_VERSION_MINUTES, so a bad edit can always be undone from the versions list.
 */
export async function autoSnapshotBeforeSave(bookPath: string, chapterId: string, oldBytes: Uint8Array): Promise<void> {
  const idx = await readIndex(bookPath, chapterId)
  const newest = idx.versions.reduce<number>((m, v) => Math.max(m, v.at), 0)
  if (Date.now() - newest < AUTO_VERSION_MINUTES * 60_000) return
  await snapshot(bookPath, chapterId, oldBytes, { auto: true, reason: 'שמירה אוטומטית' })
}

export async function loadVersion(bookPath: string, chapterId: string, versionId: string): Promise<PMNode> {
  const idx = await readIndex(bookPath, chapterId)
  const v = idx.versions.find((x) => x.id === versionId)
  if (!v) throw new Error('הגרסה לא נמצאה')
  const bytes = new Uint8Array(await fs.readFile(join(versionsDir(bookPath, chapterId), v.file)))
  return (await docxToDoc(bytes)).doc
}

export async function deleteVersion(bookPath: string, chapterId: string, versionId: string): Promise<void> {
  const idx = await readIndex(bookPath, chapterId)
  const v = idx.versions.find((x) => x.id === versionId)
  if (!v) return
  idx.versions = idx.versions.filter((x) => x.id !== versionId)
  await fs.rm(join(versionsDir(bookPath, chapterId), v.file), { force: true })
  await writeJson(join(versionsDir(bookPath, chapterId), 'versions.json'), idx)
}

export async function renameVersion(bookPath: string, chapterId: string, versionId: string, label: string): Promise<void> {
  const idx = await readIndex(bookPath, chapterId)
  const v = idx.versions.find((x) => x.id === versionId)
  if (!v) return
  v.label = label.trim()
  if (v.label) v.auto = false
  await writeJson(join(versionsDir(bookPath, chapterId), 'versions.json'), idx)
}

// ---------------------------------------------------------------------------
// The drawer (feature 27)
// ---------------------------------------------------------------------------

export async function readDrawer(bookPath: string): Promise<DrawerItem[]> {
  try {
    const raw = JSON.parse(await fs.readFile(join(bookPath, DRAWER_FILE), 'utf8'))
    return Array.isArray(raw?.items) ? raw.items : []
  } catch {
    return []
  }
}

async function writeDrawer(bookPath: string, items: DrawerItem[]): Promise<void> {
  await writeJson(join(bookPath, DRAWER_FILE), { app: 'hakirchia', items })
}

export async function addToDrawer(bookPath: string, item: DrawerItem): Promise<DrawerItem[]> {
  let items = [item, ...(await readDrawer(bookPath)).filter((x) => x.id !== item.id)]
  // pieces kept automatically make room after a while; pieces put there on purpose stay
  const autos = items.filter((x) => x.how !== 'manual')
  if (autos.length > DRAWER_MAX_AUTO) {
    const drop = new Set(autos.slice(DRAWER_MAX_AUTO).map((x) => x.id))
    items = items.filter((x) => !drop.has(x.id))
  }
  await writeDrawer(bookPath, items)
  return items
}

export async function removeFromDrawer(bookPath: string, ids: string[]): Promise<DrawerItem[]> {
  const drop = new Set(ids)
  const items = (await readDrawer(bookPath)).filter((x) => !drop.has(x.id))
  await writeDrawer(bookPath, items)
  return items
}
