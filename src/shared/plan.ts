// Round 14 "תכנון מראש": the idea pile (feature 59), the table's own columns (feature 60) and the
// trial chapter order (feature 61). Pure functions, used by the main process and the window.

import type { Chapter, OutlineNode } from './types'
import { normalizeOutline } from './outline'

/** A card in the idea pile: a scene or chapter that has no place in the book yet (feature 59) */
export interface Idea {
  id: string
  title: string
  text: string
  /** When it was added (ms since 1970) */
  at: number
}

/** A column the writer added to the table (feature 60); the values are kept on each chapter */
export interface TableColumn {
  id: string
  name: string
}

export interface PlanData {
  ideas: Idea[]
  tableColumns: TableColumn[]
  /** A chapter order being tried out, not yet applied to the book (feature 61) */
  trialOutline?: OutlineNode[]
}

const str = (v: unknown, max = 20000) => (typeof v === 'string' ? v.slice(0, max) : '')

export function normalizeIdeas(raw: unknown): Idea[] {
  const seen = new Set<string>()
  const out: Idea[] = []
  for (const x of Array.isArray(raw) ? raw : []) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    if (typeof o.id !== 'string' || !o.id || seen.has(o.id)) continue
    seen.add(o.id)
    out.push({ id: o.id, title: str(o.title, 300), text: str(o.text), at: typeof o.at === 'number' ? o.at : 0 })
  }
  return out
}

export function normalizeColumns(raw: unknown): TableColumn[] {
  const seen = new Set<string>()
  const out: TableColumn[] = []
  for (const x of Array.isArray(raw) ? raw : []) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    if (typeof o.id !== 'string' || !o.id || seen.has(o.id)) continue
    seen.add(o.id)
    out.push({ id: o.id, name: str(o.name, 80).trim() || 'עמודה' })
  }
  return out.slice(0, 30)
}

/** The plan fields of a manifest, cleaned: a trial order follows the chapters that exist now. */
export function normalizePlan(raw: { ideas?: unknown; tableColumns?: unknown; trialOutline?: unknown } | undefined, chapters: Chapter[]): PlanData {
  const out: PlanData = { ideas: normalizeIdeas(raw?.ideas), tableColumns: normalizeColumns(raw?.tableColumns) }
  if (Array.isArray(raw?.trialOutline)) out.trialOutline = normalizeOutline(raw.trialOutline, chapters)
  return out
}

/** A chapter's own column values, keeping only columns that exist and values that are not empty */
export function cleanCustom(custom: unknown, columns: TableColumn[]): Record<string, string> | undefined {
  if (!custom || typeof custom !== 'object') return undefined
  const ids = new Set(columns.map((c) => c.id))
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(custom as Record<string, unknown>)) if (ids.has(k) && typeof v === 'string' && v.trim()) out[k] = v.slice(0, 2000)
  return Object.keys(out).length ? out : undefined
}

/** Moves an idea to a new place in the pile */
export function moveIdea(list: Idea[], from: number, to: number): Idea[] {
  if (from === to || from < 0 || from >= list.length) return list
  const next = [...list]
  const [x] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(to, next.length)), 0, x)
  return next
}

/** Same chapters in the same parts in the same order? (then the trial changes nothing) */
export function sameOutline(a: OutlineNode[], b: OutlineNode[]): boolean {
  const key = (o: OutlineNode[]) => JSON.stringify(o.map((n) => (n.type === 'part' ? { p: n.id, t: n.title, c: n.children } : n.id)))
  return key(a) === key(b)
}

// ---------------------------------------------------------------------------
// Table sorting (feature 60)
// ---------------------------------------------------------------------------

const collator = new Intl.Collator('he', { numeric: true, sensitivity: 'base' })

/** Sorts rows by a text or number; empty values always go last. */
export function sortRows<T>(rows: T[], value: (r: T) => string | number | undefined, dir: 1 | -1): T[] {
  return rows
    .map((r, i) => ({ r, i, v: value(r) }))
    .sort((a, b) => {
      const ea = a.v === undefined || a.v === '',
        eb = b.v === undefined || b.v === ''
      if (ea || eb) return ea === eb ? a.i - b.i : ea ? 1 : -1
      const c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : collator.compare(String(a.v), String(b.v))
      return c ? c * dir : a.i - b.i
    })
    .map((x) => x.r)
}
