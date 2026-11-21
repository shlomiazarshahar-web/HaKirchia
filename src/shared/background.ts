// Background materials round (round 7): pages for characters, places and research (feature 11), the
// glossary of terms and names (20), where a name appears in the book (34), inspiration images (37)
// and the story timeline (21). Pure logic only, so it can be tested and used on both sides.
//
// On disk, inside the book folder:
//   חומרי רקע/דמויות/<name>.docx, חומרי רקע/מקומות/…, חומרי רקע/מחקר/…   free text of each page (Word files)
//   חומרי רקע/קבצים/…                                                files attached to pages (research PDFs etc.)
//   השראה/…                                                          inspiration images
// Everything else (names, fields, glossary, timeline, which image belongs where) is in the book's manifest.

import { NIQQUD_CLASS } from './hebrew'
import { findInText, type SearchOptions } from './search'

export type MaterialKind = 'character' | 'place' | 'research'
export const MATERIAL_KINDS: MaterialKind[] = ['character', 'place', 'research']
/** Group names in the binder, and folder names on disk */
export const KIND_LABEL: Record<MaterialKind, string> = { character: 'דמויות', place: 'מקומות', research: 'מחקר' }
export const KIND_ONE: Record<MaterialKind, string> = { character: 'דמות', place: 'מקום', research: 'דף מחקר' }
export const KIND_NEW: Record<MaterialKind, string> = { character: 'דמות חדשה', place: 'מקום חדש', research: 'דף מחקר חדש' }
export const KIND_ICON: Record<MaterialKind, string> = { character: 'person', place: 'place', research: 'research' }
/** Fields a new page starts with (the writer can rename, remove or add) */
export const DEFAULT_FIELDS: Record<MaterialKind, string[]> = {
  character: ['גיל', 'מראה', 'מה היא רוצה', 'קשרים'],
  place: ['איפה', 'תקופה', 'איך זה נראה'],
  research: ['מקור']
}

export const MATERIALS_DIR = 'חומרי רקע'
export const ATTACH_DIR = 'קבצים'
export const IMAGES_DIR = 'השראה'

export interface MaterialField {
  label: string
  value: string
}

/** A background page (feature 11). Its free text is a Word file of its own. */
export interface Material {
  id: string
  kind: MaterialKind
  name: string
  /** Other names the text uses for it (a nickname, a surname): "where it appears" finds these too */
  aliases: string[]
  /** Short labels, e.g. "דמות ראשית" */
  tags: string[]
  fields: MaterialField[]
  /** Its name in the original language (books in translation) */
  original?: string
  /** Path of its Word file inside the "חומרי רקע" folder, e.g. "דמויות/נועה ברק.docx" */
  file: string
  /** Attached files (in "חומרי רקע/קבצים"), opened with their Windows program */
  attachments: string[]
  at: number
}

/** A glossary entry (feature 20): how a term or name is written in the book, and its original */
export interface GlossaryEntry {
  id: string
  /** As it should be written in the book */
  term: string
  /** In the original language (translation); empty when not translating */
  original: string
  /** Other ways it was written by mistake, to be marked in the text */
  variants: string[]
  /** Spellings that look like a mistake but are fine (another word, or an accepted form) */
  accepted: string[]
  note: string
}

/** An inspiration image (feature 37). Belongs to a chapter, a background page, or the board in general. */
export interface InspirationImage {
  id: string
  /** File name inside the "השראה" folder */
  file: string
  caption: string
  chapterId?: string
  materialId?: string
  at: number
  /** Place and width on the inspiration canvas (missing until it is placed) */
  x?: number
  y?: number
  w?: number
}

/** A named frame on the inspiration canvas; images inside it move with it */
export interface InspirationGroup {
  id: string
  title: string
  x: number
  y: number
  w: number
  h: number
}

/** An event of the story (feature 21), in story-time order */
export interface TimelineEvent {
  id: string
  /** When it happens, in the writer's words: "אביב 1947", "שלוש שנים קודם" */
  when: string
  title: string
  text: string
  chapterIds: string[]
  materialIds: string[]
}

export interface Background {
  materials: Material[]
  glossary: GlossaryEntry[]
  images: InspirationImage[]
  groups: InspirationGroup[]
  timeline: TimelineEvent[]
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : [])
const num = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v)
const isKind = (k: unknown): k is MaterialKind => MATERIAL_KINDS.includes(k as MaterialKind)

/**
 * Makes background data read from a manifest valid. Links to chapters (or pages) that no longer
 * exist are left out, so deleting a chapter never breaks the timeline or the images.
 */
export function normalizeBackground(raw: Partial<Record<keyof Background, unknown>> | undefined, chapterIds: string[]): Background {
  const chapters = new Set(chapterIds)
  const materials: Material[] = (Array.isArray(raw?.materials) ? raw!.materials : [])
    .filter((m: Partial<Material>) => m && typeof m.id === 'string' && isKind(m.kind) && typeof m.file === 'string')
    .map((m: Partial<Material>) => ({
      id: m.id!,
      kind: m.kind!,
      name: str(m.name).trim() || KIND_NEW[m.kind!],
      aliases: strs(m.aliases),
      tags: strs(m.tags),
      fields: (Array.isArray(m.fields) ? m.fields : []).filter((f) => f && typeof f === 'object').map((f) => ({ label: str(f.label), value: str(f.value) })),
      ...(str(m.original).trim() ? { original: str(m.original).trim() } : {}),
      file: m.file!,
      attachments: strs(m.attachments),
      at: typeof m.at === 'number' ? m.at : 0
    }))
  const mats = new Set(materials.map((m) => m.id))
  const glossary: GlossaryEntry[] = (Array.isArray(raw?.glossary) ? raw!.glossary : [])
    .filter((g: Partial<GlossaryEntry>) => g && typeof g.id === 'string')
    .map((g: Partial<GlossaryEntry>) => ({ id: g.id!, term: str(g.term), original: str(g.original), variants: strs(g.variants), accepted: strs(g.accepted), note: str(g.note) }))
  const images: InspirationImage[] = (Array.isArray(raw?.images) ? raw!.images : [])
    .filter((im: Partial<InspirationImage>) => im && typeof im.id === 'string' && typeof im.file === 'string')
    .map((im: Partial<InspirationImage>) => ({
      id: im.id!,
      file: im.file!,
      caption: str(im.caption),
      ...(im.chapterId && chapters.has(im.chapterId) ? { chapterId: im.chapterId } : {}),
      ...(im.materialId && mats.has(im.materialId) ? { materialId: im.materialId } : {}),
      at: typeof im.at === 'number' ? im.at : 0,
      ...(num(im.x) && num(im.y) ? { x: im.x, y: im.y } : {}),
      ...(num(im.w) && im.w! > 0 ? { w: im.w } : {})
    }))
  const groups: InspirationGroup[] = (Array.isArray(raw?.groups) ? raw!.groups : [])
    .filter((g: Partial<InspirationGroup>) => g && typeof g.id === 'string' && num(g.x) && num(g.y) && num(g.w) && num(g.h))
    .map((g: Partial<InspirationGroup>) => ({ id: g.id!, title: str(g.title), x: g.x!, y: g.y!, w: Math.max(80, g.w!), h: Math.max(60, g.h!) }))
  const timeline: TimelineEvent[] = (Array.isArray(raw?.timeline) ? raw!.timeline : [])
    .filter((e: Partial<TimelineEvent>) => e && typeof e.id === 'string')
    .map((e: Partial<TimelineEvent>) => ({
      id: e.id!,
      when: str(e.when),
      title: str(e.title),
      text: str(e.text),
      chapterIds: strs(e.chapterIds).filter((id) => chapters.has(id)),
      materialIds: strs(e.materialIds).filter((id) => mats.has(id))
    }))
  return { materials, glossary, images, groups, timeline }
}

/** Background pages of one kind, by name (the binder lists them like this) */
export function materialsOf(list: Material[], kind: MaterialKind): Material[] {
  return list.filter((m) => m.kind === kind).sort((a, b) => a.name.localeCompare(b.name, 'he'))
}

/** All the names a page is called by in the text */
export function namesOf(m: Pick<Material, 'name' | 'aliases'>): string[] {
  return [...new Set([m.name, ...m.aliases].map((s) => s.trim()).filter(Boolean))]
}

/** Splits "a, b ,c" into ["a", "b", "c"] */
export function splitList(s: string): string[] {
  return [
    ...new Set(
      s
        .split(/[,،\n]/)
        .map((x) => x.trim())
        .filter(Boolean)
    )
  ]
}

// ---------------------------------------------------------------------------
// Where a name appears (feature 34)
// ---------------------------------------------------------------------------

/** Whole words, with Hebrew one-letter prefixes (ולנועה), ignoring niqqud and Latin case */
export const NAME_SEARCH: SearchOptions = { wholeWord: true, prefixes: true, ignoreNiqqud: true, matchCase: false }

export interface ChapterText {
  id: string
  /** The chapter's paragraphs, in order */
  paras: string[]
}

export interface Occurrence {
  chapterId: string
  count: number
  /** The first match: paragraph index and the range inside it */
  first: { para: number; start: number; end: number }
}

/** In which chapters any of the names appears, how many times, and where first. Chapters in book order. */
export function occurrences(chapters: ChapterText[], names: string[]): Occurrence[] {
  const qs = names.map((n) => n.trim()).filter(Boolean)
  if (!qs.length) return []
  const out: Occurrence[] = []
  for (const ch of chapters) {
    let count = 0
    let first: Occurrence['first'] | null = null
    ch.paras.forEach((text, para) => {
      const hits = matchAll(text, qs)
      count += hits.length
      if (!first && hits.length) first = { para, ...hits[0] }
    })
    if (count && first) out.push({ chapterId: ch.id, count, first })
  }
  return out
}

/** Every match of any of the names in a text, without overlaps, in order */
export function matchAll(text: string, names: string[]): { start: number; end: number }[] {
  const all = names.flatMap((n) => findInText(text, n, NAME_SEARCH))
  all.sort((a, b) => a.start - b.start || b.end - a.end)
  const out: { start: number; end: number }[] = []
  for (const m of all) if (!out.length || m.start >= out[out.length - 1].end) out.push(m)
  return out
}

// ---------------------------------------------------------------------------
// Consistency of terms and names (feature 20)
// ---------------------------------------------------------------------------

const NIQQUD_ALL = new RegExp(`[${NIQQUD_CLASS}]`, 'g')
const stripNiqqud = (s: string) => s.replace(NIQQUD_ALL, '')
const PREFIX_LETTERS = 'ובכלמשה'
const HEBREW_WORD = /^[א-ת][א-ת"'׳״]*$/

/**
 * A Hebrew word without the letters that full and defective spelling (כתיב מלא / חסר) add or drop:
 * ו and י after the first letter. "דניאל" and "דנאל", "שולחן" and "שלחן" have the same skeleton.
 */
export function skeleton(word: string): string {
  const w = stripNiqqud(word).replace(/["'׳״]/g, '')
  return w.slice(0, 1) + w.slice(1).replace(/[וי]/g, '')
}

/** A spelling to check for: the right form, other right forms, and known mistakes */
export interface CheckTerm {
  /** The glossary entry or background page it comes from */
  id: string
  /** 'glossary' or 'material' */
  from: 'glossary' | 'material'
  term: string
  /** Other right spellings (aliases, accepted forms) */
  accepted: string[]
  /** Known wrong spellings, marked wherever they appear */
  variants: string[]
}

/** A place in a paragraph where a term seems to be written differently */
export interface Flag {
  start: number
  end: number
  /** The text as written */
  spelled: string
  termId: string
  term: string
  /** 'variant': a known wrong spelling. 'spelling': full/defective spelling of the term */
  why: 'variant' | 'spelling'
}

export interface TermIndex {
  terms: CheckTerm[]
  /** skeleton → the single-word terms that have it */
  bySkeleton: Map<string, CheckTerm[]>
  /** every right spelling, without niqqud */
  right: Set<string>
}

/** Prepares the terms for fast checking of many paragraphs */
export function buildTermIndex(terms: CheckTerm[]): TermIndex {
  const bySkeleton = new Map<string, CheckTerm[]>()
  const right = new Set<string>()
  for (const t of terms) {
    for (const s of [t.term, ...t.accepted]) right.add(stripNiqqud(s.trim()))
    const w = stripNiqqud(t.term.trim())
    // Spelling slips are looked for only in single Hebrew words long enough not to clash with common words
    if (!HEBREW_WORD.test(w) || w.length < 4) continue
    const sk = skeleton(w).length
    if (sk < 2 || (sk < 3 && w.length < 5)) continue
    const k = skeleton(w)
    bySkeleton.set(k, [...(bySkeleton.get(k) ?? []), t])
  }
  return { terms, bySkeleton, right }
}

const WORD_RE = /[\p{L}\p{M}"'׳״]+/gu

/** Places in one paragraph where a term is written differently */
export function findFlags(text: string, index: TermIndex): Flag[] {
  const out: Flag[] = []
  // known wrong spellings (may be several words)
  for (const t of index.terms) {
    for (const v of t.variants) {
      if (index.right.has(stripNiqqud(v))) continue
      for (const m of findInText(text, v, NAME_SEARCH)) out.push({ start: m.start, end: m.end, spelled: text.slice(m.start, m.end), termId: t.id, term: t.term, why: 'variant' })
    }
  }
  // full / defective spelling of single-word terms
  if (index.bySkeleton.size) {
    for (const m of text.matchAll(WORD_RE)) {
      const raw = m[0].replace(/^["'׳״]+|["'׳״]+$/g, '')
      const word = stripNiqqud(raw)
      if (word.length < 3 || !/^[א-ת]/.test(word)) continue
      const lead = m[0].indexOf(raw)
      let found: { t: CheckTerm; rest: string; k: number } | null = null
      let fine = false
      for (let k = 0; k <= 3 && k < word.length - 2; k++) {
        if (k > 0 && !PREFIX_LETTERS.includes(word[k - 1])) break
        const rest = word.slice(k)
        if (index.right.has(rest)) {
          fine = true
          break
        }
        const ts = index.bySkeleton.get(skeleton(rest))?.filter((t) => rest.length >= stripNiqqud(t.term).length - 2)
        if (ts?.length && !found) found = { t: ts[0], rest, k }
      }
      if (fine || !found) continue
      // the prefix letters are not part of the mistake: mark only the word itself
      const start = (m.index ?? 0) + lead + offsetAfter(raw, found.k)
      const end = (m.index ?? 0) + lead + raw.length
      out.push({ start, end, spelled: text.slice(start, end), termId: found.t.id, term: found.t.term, why: 'spelling' })
    }
  }
  out.sort((a, b) => a.start - b.start)
  return out.filter((f, i) => i === 0 || f.start >= out[i - 1].end)
}

/** Index in `raw` (which may have niqqud) right after its first `letters` letters */
function offsetAfter(raw: string, letters: number): number {
  let seen = 0
  for (let i = 0; i < raw.length; i++) {
    if (seen === letters && !new RegExp(`[${NIQQUD_CLASS}]`).test(raw[i])) return i
    if (!new RegExp(`[${NIQQUD_CLASS}]`).test(raw[i])) seen++
  }
  return raw.length
}

/** One way a term was written differently, with where */
export interface Inconsistency {
  termId: string
  term: string
  spelled: string
  why: Flag['why']
  count: number
  places: Occurrence[]
}

/** Every different spelling of every term in the book, most frequent first */
export function inconsistencies(chapters: ChapterText[], terms: CheckTerm[]): Inconsistency[] {
  const index = buildTermIndex(terms)
  const map = new Map<string, Inconsistency>()
  for (const ch of chapters) {
    ch.paras.forEach((text, para) => {
      for (const f of findFlags(text, index)) {
        const key = `${f.termId}|${stripNiqqud(f.spelled)}`
        let it = map.get(key)
        if (!it) map.set(key, (it = { termId: f.termId, term: f.term, spelled: stripNiqqud(f.spelled), why: f.why, count: 0, places: [] }))
        it.count++
        const place = it.places.find((p) => p.chapterId === ch.id)
        if (place) place.count++
        else it.places.push({ chapterId: ch.id, count: 1, first: { para, start: f.start, end: f.end } })
      }
    })
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.term.localeCompare(b.term, 'he'))
}

/** The terms to check: glossary entries and the names of characters and places */
export function checkTerms(glossary: GlossaryEntry[], materials: Material[]): CheckTerm[] {
  const out: CheckTerm[] = []
  for (const g of glossary) if (g.term.trim()) out.push({ id: g.id, from: 'glossary', term: g.term.trim(), accepted: g.accepted, variants: g.variants })
  for (const m of materials) {
    if (m.kind === 'research') continue
    // each word of a two-word name is checked on its own ("נועה ברק": נועה, ברק)
    const names = namesOf(m)
    const words = [...new Set(names.flatMap((n) => n.split(/\s+/)).filter(Boolean))]
    for (const w of words) out.push({ id: m.id, from: 'material', term: w, accepted: [...names, ...words].filter((x) => x !== w), variants: [] })
  }
  return out
}

// ---------------------------------------------------------------------------
// Translation: terms whose original appears in a chapter's original, but not the chosen translation
// ---------------------------------------------------------------------------

export interface TranslationGap {
  termId: string
  term: string
  original: string
  chapterId: string
  /** times the original appears in the chapter's original */
  inSource: number
  /** times the chosen translation appears in the chapter */
  inChapter: number
}

/**
 * `sources` has the paragraphs of each translated chapter's original. A gap is a chapter whose
 * original uses the term more than its translation does (it may have been translated differently).
 */
export function translationGaps(chapters: ChapterText[], sources: Record<string, string[]>, entries: { id: string; term: string; original: string; accepted?: string[] }[]): TranslationGap[] {
  const out: TranslationGap[] = []
  for (const e of entries) {
    if (!e.original.trim() || !e.term.trim()) continue
    for (const ch of chapters) {
      const src = sources[ch.id]
      if (!src) continue
      const inSource = src.reduce((n, p) => n + matchAll(p, [e.original]).length, 0)
      if (!inSource) continue
      const inChapter = ch.paras.reduce((n, p) => n + matchAll(p, [e.term, ...(e.accepted ?? [])]).length, 0)
      if (inChapter < inSource) out.push({ termId: e.id, term: e.term, original: e.original, chapterId: ch.id, inSource, inChapter })
    }
  }
  return out.sort((a, b) => a.inChapter - b.inChapter || b.inSource - a.inSource)
}

// ---------------------------------------------------------------------------
// Timeline (feature 21)
// ---------------------------------------------------------------------------

/** Moves an event to a new place in story order */
export function moveEvent(list: TimelineEvent[], from: number, to: number): TimelineEvent[] {
  if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return list
  const next = [...list]
  const [e] = next.splice(from, 1)
  next.splice(to, 0, e)
  return next
}

/**
 * The chapters in story-time order (by their first event), for the strip that shows where the
 * book jumps back or forward in time. `jump` is true when a chapter happens before the one that
 * precedes it in this order would suggest by reading order (a flashback).
 */
export function chaptersInStoryOrder(timeline: TimelineEvent[], chapterIds: string[]): { id: string; number: number; back: boolean }[] {
  const seen = new Set<string>()
  const order: string[] = []
  for (const e of timeline) for (const id of e.chapterIds) if (!seen.has(id) && chapterIds.includes(id)) (seen.add(id), order.push(id))
  let prev = 0
  return order.map((id) => {
    const number = chapterIds.indexOf(id) + 1
    const back = number < prev
    prev = Math.max(prev, number)
    return { id, number, back }
  })
}

/** A file name that is not taken yet: "name.ext", "name (2).ext"… */
export function freeName(base: string, ext: string, taken: Set<string>): string {
  const lower = new Set([...taken].map((t) => t.toLowerCase()))
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${base}${ext}` : `${base} (${n})${ext}`
    if (!lower.has(name.toLowerCase())) return name
  }
}

/**
 * Places images that have no place yet on the canvas, in rows under everything already there.
 * `aspect` gives each image's height/width when known.
 */
export function placeNew(images: InspirationImage[], aspect: (file: string) => number, width = 220, gap = 24, perRow = 5): InspirationImage[] {
  const placed = images.filter((i) => i.x !== undefined)
  let top = 0
  for (const i of placed) top = Math.max(top, i.y! + (i.w ?? width) * aspect(i.file))
  let y = placed.length ? top + gap * 2 : 0
  let x = 0
  let rowH = 0
  let n = 0
  return images.map((i) => {
    if (i.x !== undefined) return i
    const w = i.w ?? width
    const out = { ...i, x, y, w }
    rowH = Math.max(rowH, w * aspect(i.file))
    x += w + gap
    if (++n % perRow === 0) {
      x = 0
      y += rowH + gap
      rowH = 0
    }
    return out
  })
}
