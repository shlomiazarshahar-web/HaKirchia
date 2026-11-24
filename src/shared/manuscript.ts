// Feature 42: importing an existing manuscript (one long Word file, e.g. a book downloaded from
// Google Docs) and splitting it into chapters. Pure logic; the Word file is read by docxBlocks.

import type { PMNode } from './types'
import { countWords, docText } from './docx'

/** How the manuscript is cut into chapters */
export type SplitMode = { kind: 'heading'; level: number } | { kind: 'label' } | { kind: 'page' } | { kind: 'none' }

export interface ManuscriptChapter {
  /** Index of the first block of this chapter in the manuscript */
  start: number
  /** The chapter's name (the heading's text, or a name given to the text before the first chapter) */
  title: string
  /** True for the text before the first heading (often a title page or a dedication) */
  front?: boolean
  words: number
  /** The first words of the text, to recognise the chapter */
  preview: string
}

/** One chapter ready to be written: its name and its text (without the heading) */
export interface ImportItem {
  title: string
  doc: PMNode
}

const blockText = (b: PMNode) => docText(b).replace(/\s+/g, ' ').trim()

/** A line that names a chapter on its own: "פרק 3", "פרק שלישי: הנמל", "Chapter 12", "CHAPTER IV" */
const HEB_NUMBERS = 'ראשון|שני|שלישי|רביעי|חמישי|שישי|שביעי|שמיני|תשיעי|עשירי|אחרון|אחד|אחת|שניים|שתיים|שלושה|שלוש|ארבעה|ארבע|חמישה|חמש|שישה|שש|שבעה|שבע|שמונה|תשעה|תשע|עשרה|עשר|עשרים|שלושים|ארבעים|חמישים'
// a number, a roman numeral, a Hebrew number word, or Hebrew letters with geresh/gershayim (א׳, י״ב)
const LABEL_RE = new RegExp(`^(פרק|chapter|ch\\.)\\s+([0-9]+|[ivxlcdm]+|${HEB_NUMBERS}|[א-ת]{1,2}['׳]|[א-ת]{1,3}["״][א-ת])(?=[\\s.:\\-–—,]|$)`, 'iu')
export function isChapterLabel(text: string): boolean {
  const t = text.trim()
  return t.length > 0 && t.length <= 80 && LABEL_RE.test(t)
}

/** Heading levels used in the file (0 = the "Title" style), with how many headings of each */
export function headingLevels(blocks: PMNode[]): { level: number; count: number }[] {
  const n = new Map<number, number>()
  for (const b of blocks) if (b.type === 'heading' && blockText(b)) n.set(Number(b.attrs?.level ?? 1), (n.get(Number(b.attrs?.level ?? 1)) ?? 0) + 1)
  return [...n.entries()].sort((a, b) => a[0] - b[0]).map(([level, count]) => ({ level, count }))
}

/** The ways this file can be split, best first. Always ends with 'none' (the whole file as one chapter). */
export function splitOptions(blocks: PMNode[]): { mode: SplitMode; count: number }[] {
  // A "Title" used once is the book's name, not a chapter
  const levels = headingLevels(blocks).filter(({ level, count }) => !(level === 0 && count === 1))
  // a level used at least twice is likely the chapters; Heading 1 before Heading 2 when both are
  const many = levels.filter((l) => l.count >= 2).map(({ level, count }) => ({ mode: { kind: 'heading', level } as SplitMode, count }))
  const once = levels.filter((l) => l.count < 2).map(({ level, count }) => ({ mode: { kind: 'heading', level } as SplitMode, count }))
  const labels = blocks.filter((b) => isChapterLabel(blockText(b))).length
  const pages = blocks.filter((b, i) => i > 0 && b.attrs?.pageBreak).length
  return [
    ...many,
    ...(labels >= 2 ? [{ mode: { kind: 'label' } as SplitMode, count: labels }] : []),
    ...(pages >= 1 ? [{ mode: { kind: 'page' } as SplitMode, count: pages + 1 }] : []),
    ...once,
    { mode: { kind: 'none' }, count: 1 }
  ]
}

export const modeKey = (m: SplitMode) => (m.kind === 'heading' ? `h${m.level}` : m.kind)

/** True when this block starts a chapter in this mode */
function startsChapter(b: PMNode, i: number, mode: SplitMode): boolean {
  if (mode.kind === 'heading') return b.type === 'heading' && Number(b.attrs?.level ?? 1) === mode.level && !!blockText(b)
  if (mode.kind === 'label') return isChapterLabel(blockText(b))
  if (mode.kind === 'page') return i > 0 && !!b.attrs?.pageBreak
  return false
}

/** Whether the chapter's first block is its heading (taken out of the text and used as its name) */
const headingIsTitle = (mode: SplitMode) => mode.kind === 'heading' || mode.kind === 'label'

/** The chapters the file splits into in this mode */
export function findChapters(blocks: PMNode[], mode: SplitMode): ManuscriptChapter[] {
  const starts: number[] = []
  blocks.forEach((b, i) => startsChapter(b, i, mode) && starts.push(i))
  const out: ManuscriptChapter[] = []
  const describe = (start: number, end: number, skipFirst: boolean) => {
    const body = blocks.slice(skipFirst ? start + 1 : start, end)
    const text = body.map(blockText).filter(Boolean)
    return { words: countWords(text.join(' ')), preview: text.join(' ').slice(0, 90) }
  }
  // text before the first chapter: kept as a chapter of its own when it has words in it
  const first = starts[0] ?? blocks.length
  if (first > 0) {
    const d = describe(0, first, false)
    // split by page: the first page is simply the first chapter
    const front = !!starts.length && headingIsTitle(mode)
    if (d.words > 0 || !starts.length) out.push({ start: 0, title: front ? 'פתיחה' : mode.kind === 'page' ? 'פרק 1' : '', ...(front ? { front } : {}), ...d })
  }
  starts.forEach((s, k) => {
    const end = starts[k + 1] ?? blocks.length
    const own = headingIsTitle(mode)
    const d = describe(s, end, own)
    const title = own ? blockText(blocks[s]).slice(0, 120) : `פרק ${out.filter((c) => !c.front).length + 1}`
    out.push({ start: s, title, ...d })
  })
  if (!out.length) out.push({ start: 0, title: '', words: 0, preview: '' })
  return out
}

/** Heading levels inside a chapter, as the editor knows them (2 and 3; the chapter's title is level 1) */
function fixBody(body: PMNode[]): PMNode[] {
  const out = body.map((b) => {
    const attrs = { ...(b.attrs ?? {}) }
    delete attrs.pageBreak
    if (b.type === 'heading') return { ...b, attrs: { ...attrs, level: Number(attrs.level ?? 2) <= 2 ? 2 : 3 } }
    return { ...b, attrs }
  })
  // empty lines at the start and the end of a chapter came from the page layout of the long file
  while (out.length && out[0].type === 'paragraph' && !out[0].content?.length) out.shift()
  while (out.length && out[out.length - 1].type === 'paragraph' && !out[out.length - 1].content?.length) out.pop()
  return out.length ? out : [{ type: 'paragraph', attrs: { dir: 'rtl', textAlign: null } }]
}

/**
 * The chapters to create. `keep[i]` false joins chapter i to the one before it (its heading stays
 * in the text as a heading); `titles[i]` replaces its name. An empty name gets "פרק N".
 */
export function buildChapters(blocks: PMNode[], mode: SplitMode, chapters: ManuscriptChapter[], keep: boolean[], titles: string[]): ImportItem[] {
  const items: { title: string; body: PMNode[] }[] = []
  // a single "Title" paragraph is the book's name (it becomes the book's title), not text of a chapter
  const titles0 = blocks.filter((b) => b.type === 'heading' && Number(b.attrs?.level) === 0)
  const bookTitle = titles0.length === 1 ? titles0[0] : null
  chapters.forEach((c, i) => {
    const end = chapters[i + 1]?.start ?? blocks.length
    const own = headingIsTitle(mode) && !c.front && startsChapter(blocks[c.start], c.start, mode)
    if (keep[i] !== false || !items.length) {
      items.push({ title: (titles[i] ?? c.title).trim(), body: blocks.slice(own ? c.start + 1 : c.start, end) })
    } else {
      // joined to the previous chapter: its heading becomes a heading inside the text
      const prev = items[items.length - 1]
      const slice = blocks.slice(c.start, end)
      if (own && slice[0]) slice[0] = { ...slice[0], type: 'heading', attrs: { ...slice[0].attrs, level: 2 } }
      prev.body.push(...slice)
    }
  })
  let n = 0
  return items.map((it) => {
    n++
    return { title: it.title || `פרק ${n}`, doc: { type: 'doc', content: fixBody(it.body.filter((b) => b !== bookTitle)) } }
  })
}

/** The book's name as the file gives it: a "Title" paragraph at the top, else the file's name */
export function guessBookTitle(blocks: PMNode[], fileName: string): string {
  const firstText = blocks.find((b) => blockText(b))
  if (firstText?.type === 'heading' && Number(firstText.attrs?.level) === 0) return blockText(firstText).slice(0, 80)
  return fileName.replace(/\.docx$/i, '').trim()
}
