// Writing days (feature 47): how much was written on each day. Display only, never a goal.
// Every save of a chapter adds the change in its word count to that day: `net` (words added minus
// words removed) and `added` (only the saves that added words). Pure logic; the main process keeps
// the numbers in the book's folder (סטטיסטיקה.json).

export interface DayEntry {
  net: number
  added: number
}
export type WritingLog = Record<string, DayEntry>

export const LOG_FILE = 'סטטיסטיקה.json'

/** The local date as YYYY-MM-DD (the day as the writer lives it, not UTC) */
export function dayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function parseDay(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Adds one save's change in words to the day */
export function addToLog(log: WritingLog, day: string, delta: number): WritingLog {
  if (!delta) return log
  const cur = log[day] ?? { net: 0, added: 0 }
  return { ...log, [day]: { net: cur.net + delta, added: cur.added + Math.max(0, delta) } }
}

/** Adds the days of `more` to `log` */
export function mergeLog(log: WritingLog, more: WritingLog): WritingLog {
  const out = { ...log }
  for (const [k, e] of Object.entries(more)) {
    const cur = out[k] ?? { net: 0, added: 0 }
    out[k] = { net: cur.net + e.net, added: cur.added + e.added }
  }
  return out
}

/** The saved file, made safe */
export function normalizeLog(raw: unknown): WritingLog {
  const days = raw && typeof raw === 'object' ? (raw as { days?: unknown }).days : undefined
  const out: WritingLog = {}
  if (!days || typeof days !== 'object') return out
  for (const [k, v] of Object.entries(days as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !v || typeof v !== 'object') continue
    const e = v as Record<string, unknown>
    const net = typeof e.net === 'number' && Number.isFinite(e.net) ? Math.round(e.net) : 0
    const added = typeof e.added === 'number' && Number.isFinite(e.added) ? Math.max(0, Math.round(e.added)) : Math.max(0, net)
    out[k] = { net, added }
  }
  return out
}

/** The last `n` days up to `today` (oldest first), with zero for days without writing */
export function lastDays(log: WritingLog, n: number, today: Date = new Date()): { day: string; net: number; added: number }[] {
  const out: { day: string; net: number; added: number }[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    const k = dayKey(d)
    out.push({ day: k, net: log[k]?.net ?? 0, added: log[k]?.added ?? 0 })
  }
  return out
}

/** A day counts as a writing day when words were added on it */
export const isWritingDay = (e: DayEntry | undefined): boolean => !!e && e.added > 0

export interface LogSummary {
  /** Writing days and net words in the period */
  days: number
  words: number
  /** The day with the most words in the period (net), if any */
  best: { day: string; net: number } | null
}

/** Totals of the days from `from` to `to` (YYYY-MM-DD, both included) */
export function summarize(log: WritingLog, from: string, to: string): LogSummary {
  let days = 0
  let words = 0
  let best: LogSummary['best'] = null
  for (const [k, e] of Object.entries(log)) {
    if (k < from || k > to) continue
    if (isWritingDay(e)) days++
    words += e.net
    if (e.net > 0 && (!best || e.net > best.net)) best = { day: k, net: e.net }
  }
  return { days, words, best }
}
