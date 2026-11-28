// Round 15 "מבט על הספר": plot lines (feature 62), the character appearance map (63), the pace of
// the book (64) and setups & payoffs (65). Pure functions, used by the main process and the window.

import { LABEL_COLORS, type LabelColor } from './labels'

/** A row of the plot-line grid: a story thread or a character (feature 62) */
export interface PlotLine {
  id: string
  name: string
  color: LabelColor
  /** The background page it was made from, when it is a character or place */
  materialId?: string
}

/** The grid's notes: line id → chapter id → what happens to that line in that chapter */
export type PlotNotes = Record<string, Record<string, string>>

/** A place in a chapter: the chapter, and when it was marked in the text, the words and around them */
export interface StoryPlace {
  chapterId: string
  pos?: number
  before?: string
  after?: string
  /** The marked words */
  quote?: string
}

/** Feature 65: a hint planted in one chapter that pays off (or should) in another */
export interface Setup {
  id: string
  /** What the hint is, in the writer's words */
  title: string
  note: string
  plant?: StoryPlace
  payoff?: StoryPlace
  /** When it was added (ms since 1970) */
  at: number
}

export interface OverviewData {
  plotLines: PlotLine[]
  plotNotes: PlotNotes
  setups: Setup[]
}

const str = (v: unknown, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : '')

export function normalizePlotLines(raw: unknown): PlotLine[] {
  const seen = new Set<string>()
  const out: PlotLine[] = []
  for (const x of Array.isArray(raw) ? raw : []) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    if (typeof o.id !== 'string' || !o.id || seen.has(o.id)) continue
    seen.add(o.id)
    const color = (LABEL_COLORS as readonly string[]).includes(o.color as string) ? (o.color as LabelColor) : 'gray'
    out.push({ id: o.id, name: str(o.name, 120), color, ...(typeof o.materialId === 'string' && o.materialId ? { materialId: o.materialId } : {}) })
  }
  return out.slice(0, 60)
}

/** Only notes of lines and chapters that exist, and that are not empty */
export function normalizePlotNotes(raw: unknown, lineIds: string[], chapterIds: string[]): PlotNotes {
  const out: PlotNotes = {}
  if (!raw || typeof raw !== 'object') return out
  const lines = new Set(lineIds)
  const chs = new Set(chapterIds)
  for (const [lid, row] of Object.entries(raw as Record<string, unknown>)) {
    if (!lines.has(lid) || !row || typeof row !== 'object') continue
    const r: Record<string, string> = {}
    for (const [cid, v] of Object.entries(row as Record<string, unknown>)) if (chs.has(cid) && typeof v === 'string' && v.trim()) r[cid] = v.slice(0, 2000)
    if (Object.keys(r).length) out[lid] = r
  }
  return out
}

function normalizePlace(raw: unknown, chs: Set<string>): StoryPlace | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  if (typeof o.chapterId !== 'string' || !chs.has(o.chapterId)) return undefined
  const p: StoryPlace = { chapterId: o.chapterId }
  if (typeof o.pos === 'number' && o.pos >= 0) {
    p.pos = o.pos
    p.before = str(o.before, 200)
    p.after = str(o.after, 200)
  }
  const q = str(o.quote, 400).trim()
  if (q) p.quote = q
  return p
}

/** Setups whose chapters were deleted lose that end (the hint itself stays) */
export function normalizeSetups(raw: unknown, chapterIds: string[]): Setup[] {
  const chs = new Set(chapterIds)
  const seen = new Set<string>()
  const out: Setup[] = []
  for (const x of Array.isArray(raw) ? raw : []) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    if (typeof o.id !== 'string' || !o.id || seen.has(o.id)) continue
    seen.add(o.id)
    const s: Setup = { id: o.id, title: str(o.title, 300), note: str(o.note), at: typeof o.at === 'number' ? o.at : 0 }
    const plant = normalizePlace(o.plant, chs)
    const payoff = normalizePlace(o.payoff, chs)
    if (plant) s.plant = plant
    if (payoff) s.payoff = payoff
    out.push(s)
  }
  return out.slice(0, 500)
}

export function normalizeOverview(raw: { plotLines?: unknown; plotNotes?: unknown; setups?: unknown } | undefined, chapterIds: string[]): OverviewData {
  const plotLines = normalizePlotLines(raw?.plotLines)
  return {
    plotLines,
    plotNotes: normalizePlotNotes(raw?.plotNotes, plotLines.map((l) => l.id), chapterIds),
    setups: normalizeSetups(raw?.setups, chapterIds)
  }
}

// ---------------------------------------------------------------------------
// Gaps: a line (or a character) that disappears for many chapters (features 62, 63)
// ---------------------------------------------------------------------------

/** How many chapters in a row without a line counts as "disappeared" */
export const GAP_MIN = 3

export interface Gap {
  /** Index of the first and last chapter without the line (in the order given) */
  from: number
  to: number
}

/**
 * Runs of at least `min` chapters in which the line has nothing, between two chapters where it has.
 * Before its first chapter and after its last one it is not "gone": it has not started, or it ended.
 */
export function lineGaps(present: boolean[], min = GAP_MIN): Gap[] {
  const out: Gap[] = []
  let last = -1
  present.forEach((p, i) => {
    if (!p) return
    if (last >= 0 && i - last - 1 >= min) out.push({ from: last + 1, to: i - 1 })
    last = i
  })
  return out
}

/** For each chapter index: the gap it is in, if any */
export function gapAt(gaps: Gap[], n: number): (Gap | undefined)[] {
  const out: (Gap | undefined)[] = new Array(n).fill(undefined)
  for (const g of gaps) for (let i = g.from; i <= g.to; i++) out[i] = g
  return out
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return list
  const next = [...list]
  const [x] = next.splice(from, 1)
  next.splice(to, 0, x)
  return next
}

/** The next color for a new line: the first one not used yet */
export function nextLineColor(lines: PlotLine[]): LabelColor {
  const used = new Set(lines.map((l) => l.color))
  return LABEL_COLORS.find((c) => !used.has(c) && c !== 'gray') ?? LABEL_COLORS[lines.length % LABEL_COLORS.length]
}

// ---------------------------------------------------------------------------
// The appearance map (feature 63)
// ---------------------------------------------------------------------------

/** How dark a cell is: 0 none, 1 once, 2 a few times, 3 often, 4 a great deal */
export function appearanceLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0
  if (count === 1) return 1
  if (count < 5) return 2
  if (count < 15) return 3
  return 4
}

// ---------------------------------------------------------------------------
// Pace (feature 64): statistics only, no goal
// ---------------------------------------------------------------------------

export interface PaceStats {
  total: number
  average: number
  longest?: { id: string; words: number }
  shortest?: { id: string; words: number }
}

/** Chapters with words only (an empty chapter is not "the shortest") */
export function paceStats(ids: string[], words: Record<string, number>): PaceStats {
  const have = ids.filter((id) => (words[id] ?? 0) > 0)
  const total = have.reduce((n, id) => n + words[id], 0)
  let longest: PaceStats['longest'], shortest: PaceStats['shortest']
  for (const id of have) {
    if (!longest || words[id] > longest.words) longest = { id, words: words[id] }
    if (!shortest || words[id] < shortest.words) shortest = { id, words: words[id] }
  }
  return { total, average: have.length ? Math.round(total / have.length) : 0, longest, shortest }
}

/** A round number a little above the largest value, for the scale of the bars */
export function niceMax(v: number): number {
  if (v <= 0) return 1000
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p
  return 10 * p
}

// ---------------------------------------------------------------------------
// Setups & payoffs (feature 65)
// ---------------------------------------------------------------------------

export type SetupState = 'open' | 'paid' | 'early'

/**
 * open: planted, no payoff yet. paid: pays off later in the book. early: the payoff comes before the
 * plant (or in no chapter order that makes sense), worth a look.
 */
export function setupState(s: Setup, order: Map<string, number>): SetupState {
  if (!s.payoff) return 'open'
  if (s.plant) {
    const a = order.get(s.plant.chapterId) ?? -1
    const b = order.get(s.payoff.chapterId) ?? -1
    if (b < a) return 'early'
  }
  return 'paid'
}

/** Open ones first (in the order they were planted in the book), then the rest by plant chapter */
export function sortSetups(list: Setup[], order: Map<string, number>): Setup[] {
  const rank = (s: Setup) => (setupState(s, order) === 'paid' ? 1 : 0)
  const at = (s: Setup) => (s.plant ? (order.get(s.plant.chapterId) ?? 9999) : 9999)
  return [...list].sort((a, b) => rank(a) - rank(b) || at(a) - at(b) || a.at - b.at)
}

/** A short title for a hint made from marked words */
export function titleFromQuote(q: string): string {
  const t = q.replace(/\s+/g, ' ').trim()
  return t.length > 60 ? t.slice(0, 58).replace(/\s+\S*$/, '') + '…' : t
}
