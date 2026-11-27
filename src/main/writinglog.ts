// Writing days (feature 47), the disk side: the numbers live in the book's folder (סטטיסטיקה.json),
// so they travel with the book (Google Drive, another computer). Saves come every few seconds while
// typing, so changes are gathered in memory and written at most every few seconds.

import { promises as fs, existsSync, readFileSync, writeFileSync, renameSync } from 'fs'
import { join } from 'path'
import { addToLog, dayKey, LOG_FILE, mergeLog, normalizeLog, type WritingLog } from '../shared/writinglog'

/** Changes not written yet, per book: a small log of their own */
const pending = new Map<string, WritingLog>()
let timer: ReturnType<typeof setTimeout> | null = null
const FLUSH_MS = 8000

async function readLog(bookPath: string): Promise<WritingLog> {
  const file = join(bookPath, LOG_FILE)
  if (!existsSync(file)) return {}
  try {
    return normalizeLog(JSON.parse(await fs.readFile(file, 'utf8')))
  } catch {
    return {}
  }
}

async function writeLog(bookPath: string, log: WritingLog): Promise<void> {
  const file = join(bookPath, LOG_FILE)
  const tmp = file + '.tmp'
  await fs.writeFile(tmp, JSON.stringify({ app: 'hakirchia', kind: 'writing-days', days: log }, null, 1), 'utf8')
  await fs.rename(tmp, file)
}

/** One save changed the book by `delta` words (today) */
export function record(bookPath: string, delta: number, day = dayKey()): void {
  if (!delta) return
  pending.set(bookPath, addToLog(pending.get(bookPath) ?? {}, day, delta))
  timer ??= setTimeout(() => void flush(), FLUSH_MS)
}

/** Writes what was gathered (also called before the app closes) */
export async function flush(): Promise<void> {
  if (timer) clearTimeout(timer)
  timer = null
  const work = [...pending]
  pending.clear()
  for (const [bookPath, days] of work) {
    try {
      await writeLog(bookPath, mergeLog(await readLog(bookPath), days))
    } catch {
      // the folder is not there right now (a drive disconnected): these numbers are lost, never the text
    }
  }
}

/** The same, right away, as the app quits (nothing may wait then: an update may be installing) */
export function flushSync(): void {
  if (timer) clearTimeout(timer)
  timer = null
  for (const [bookPath, days] of pending) {
    try {
      const file = join(bookPath, LOG_FILE)
      let log: WritingLog = {}
      try {
        if (existsSync(file)) log = normalizeLog(JSON.parse(readFileSync(file, 'utf8')))
      } catch {
        log = {}
      }
      writeFileSync(file + '.tmp', JSON.stringify({ app: 'hakirchia', kind: 'writing-days', days: mergeLog(log, days) }, null, 1), 'utf8')
      renameSync(file + '.tmp', file)
    } catch {
      /* lost numbers, never text */
    }
  }
  pending.clear()
}

/** The whole log, including what was not written to disk yet */
export async function getLog(bookPath: string): Promise<WritingLog> {
  return mergeLog(await readLog(bookPath), pending.get(bookPath) ?? {})
}
