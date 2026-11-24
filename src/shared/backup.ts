// Feature 49: a dated copy of the whole book every day, in a folder of its own on this computer.
// Google Drive keeps the book folder in sync, but it also syncs deletions and mistakes; these copies
// don't change after their day is over. Pure rules here, the copying is in main/backup.ts.

export interface BackupSettings {
  /** On by default */
  enabled: boolean
  /** Where the copies go; empty = "הכריכייה - גיבויים" in Documents */
  folder: string
  /** How many days (copies) to keep for each book */
  keep: number
}

export const DEFAULT_BACKUP: BackupSettings = { enabled: true, folder: '', keep: 30 }
export const KEEP_CHOICES = [7, 14, 30, 60, 90, 365]
export const BACKUP_ROOT_NAME = 'הכריכייה - גיבויים'

/** How often the open book's copy of today is brought up to date (ms) */
export const BACKUP_EVERY_MS = 30 * 60_000

export function normalizeBackup(b: Partial<BackupSettings> | undefined): BackupSettings {
  const keep = Number(b?.keep)
  return {
    enabled: b?.enabled !== false,
    folder: typeof b?.folder === 'string' ? b.folder : '',
    keep: Number.isFinite(keep) && keep >= 1 ? Math.min(Math.round(keep), 3650) : DEFAULT_BACKUP.keep
  }
}

/** The day's folder name, in local time: 2026-11-22 */
export function dayStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export const isDayFolder = (name: string) => /^\d{4}-\d{2}-\d{2}$/.test(name)

/** Day folders to delete so only the newest `keep` remain */
export function daysToDelete(days: string[], keep: number): string[] {
  const sorted = days.filter(isDayFolder).sort()
  return sorted.slice(0, Math.max(0, sorted.length - keep))
}

/** Files and folders of the book that are not copied: exports (made again any time) and half-written temporary files */
export function skipInBackup(relPath: string): boolean {
  const parts = relPath.split(/[\\/]/)
  const name = parts[parts.length - 1]
  if (parts[0] === 'ייצוא') return true
  if (name.startsWith('~') || name.endsWith('.tmp') || name.endsWith('.saving') || name.endsWith('.partial')) return true
  if (name === 'desktop.ini' || name === 'Thumbs.db' || name === '.DS_Store') return true
  return false
}

/** A fingerprint of the book's files (names, sizes, times) to tell whether anything changed since the last copy */
export function filesSignature(files: { rel: string; size: number; mtimeMs: number }[]): string {
  return files
    .map((f) => `${f.rel}|${f.size}|${Math.round(f.mtimeMs / 1000)}`)
    .sort()
    .join('\n')
}

/** One day's copy, as the backups window shows it */
export interface BackupDay {
  day: string
  /** When it was last brought up to date (ms) */
  at: number
  path: string
}

export interface BackupInfo {
  settings: BackupSettings
  /** The folder all books' copies go to */
  root: string
  /** This book's folder in it (null before the first copy) */
  dir: string | null
  days: BackupDay[]
  /** The last error, when the latest copy failed */
  error?: string
}

/** A chapter in one day's copy, compared with the book as it is now */
export interface BackupChapter {
  id: string
  title: string
  /** same: no change since; changed: the book's file differs; deleted: no longer in the book */
  state: 'same' | 'changed' | 'deleted'
  words: number
}
