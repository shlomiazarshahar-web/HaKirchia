// Translation (features 12, 13, 28). Pure functions, no PDF library and no React, so they can be
// tested: finding the paragraphs of a PDF page from its text pieces, matching them to the chapter's
// paragraphs (for the synced scrolling) and counting how much of a chapter is translated.

import type { PMNode } from './types'
import { isSceneBreak } from './scenes'

// ---------------------------------------------------------------------------
// What is stored in the book: which PDF a chapter translates, and from where to where
// ---------------------------------------------------------------------------

/** A paragraph of the PDF: the page it starts on (from 1) and its number among the paragraphs that start on that page (from 0) */
export interface SourceRef {
  page: number
  para: number
}

/** The original of one chapter (stored per chapter in book.hakirchia.json) */
export interface ChapterSource {
  /** File name inside the book's "מקור" folder */
  pdf: string
  /** First paragraph of the chapter in the PDF; missing = the start of the PDF */
  start?: SourceRef
  /** Last paragraph of the chapter in the PDF; missing = the end of the PDF */
  end?: SourceRef
  /** How many paragraphs the original chapter has (counted when the PDF was last open), for the progress */
  paras?: number
}

export const SOURCES_DIR = 'מקור'

export const compareRefs = (a: SourceRef, b: SourceRef): number => a.page - b.page || a.para - b.para

// ---------------------------------------------------------------------------
// Paragraphs of a PDF page
// ---------------------------------------------------------------------------

/** One piece of text on a PDF page, as the PDF library gives it (PDF units, y up from the bottom) */
export interface TextPiece {
  str: string
  /** Left edge and baseline */
  x: number
  y: number
  w: number
  /** Font height */
  h: number
  dir?: string
}

/** A rectangle on the page, from its top-left corner, in PDF units */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface PageBlock {
  text: string
  box: Box
  /** Font height of the block's lines */
  size: number
  /** Its first line is indented (a new paragraph, also at the top of a page) */
  indented: boolean
  /** Its last line runs to the end of the line (the paragraph may go on to the next page) */
  runsOn: boolean
  /** Right-to-left text */
  rtl: boolean
}

interface Line {
  text: string
  x0: number
  x1: number
  /** Baseline, PDF units from the bottom */
  y: number
  h: number
  rtl: boolean
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}
const quantile = (xs: number[], q: number): number => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * q)))]
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length
/** A page number or running head ("41", "- 41 -", "xii") */
const PAGE_NUMBER = /^[\s\-–—.]*(\d{1,4}|[ivxlcdm]{1,7})[\s\-–—.]*$/i

function toLines(pieces: TextPiece[]): Line[] {
  const items = pieces.filter((p) => p.str.trim() && p.h > 0).sort((a, b) => b.y - a.y || a.x - b.x)
  const groups: TextPiece[][] = []
  for (const it of items) {
    const g = groups[groups.length - 1]
    if (g) {
      const h = Math.max(...g.map((p) => p.h), it.h)
      if (Math.abs(g[0].y - it.y) <= h * 0.5) {
        g.push(it)
        continue
      }
    }
    groups.push([it])
  }
  return groups.map((g) => {
    const rtlCount = g.filter((p) => p.dir === 'rtl' || /[֐-׿؀-ۿ]/.test(p.str)).length
    const rtl = rtlCount * 2 > g.length
    const sorted = [...g].sort((a, b) => (rtl ? b.x - a.x : a.x - b.x))
    let text = ''
    let prev: TextPiece | null = null
    for (const p of sorted) {
      if (prev) {
        const gap = rtl ? prev.x - (p.x + p.w) : p.x - (prev.x + prev.w)
        if (gap > Math.max(p.h, prev.h) * 0.15 && !/\s$/.test(text) && !/^\s/.test(p.str)) text += ' '
      }
      text += p.str
      prev = p
    }
    return {
      text: text.replace(/\s+/g, ' ').trim(),
      x0: Math.min(...g.map((p) => p.x)),
      x1: Math.max(...g.map((p) => p.x + p.w)),
      y: median(g.map((p) => p.y)),
      h: Math.max(...g.map((p) => p.h)),
      rtl
    }
  })
}

/**
 * Splits a page's text into paragraphs: a new paragraph starts after a bigger gap between lines,
 * at an indented line, after a short last line, or where the font size changes (headings).
 * Page numbers and short running heads at the top or bottom of the page are left out.
 */
export function pageBlocks(pieces: TextPiece[], pageW: number, pageH: number): PageBlock[] {
  let lines = toLines(pieces)
  if (!lines.length) return []
  const gapsAll = lines.slice(1).map((l, i) => lines[i].y - l.y)
  const typicalAll = median(gapsAll.filter((g) => g > 0 && g < 3 * lines[0].h)) || lines[0].h * 1.3
  // Running heads and page numbers: in the top or bottom band, and short or only a number
  lines = lines.filter((l, i) => {
    const top = pageH - (l.y + l.h)
    const inBand = top < pageH * 0.09 || l.y < pageH * 0.09
    if (!inBand) return true
    if (PAGE_NUMBER.test(l.text)) return false
    const before = i > 0 ? lines[i - 1].y - l.y : Infinity
    const after = i < lines.length - 1 ? l.y - lines[i + 1].y : Infinity
    const alone = Math.min(before, after) > typicalAll * 1.8
    return !(alone && words(l.text) <= 8)
  })
  if (!lines.length) return []

  const left = quantile(
    lines.map((l) => l.x0),
    0.1
  )
  const right = quantile(
    lines.map((l) => l.x1),
    0.9
  )
  const width = Math.max(1, right - left)
  const gaps = lines.slice(1).map((l, i) => lines[i].y - l.y)
  const typical = median(gaps.filter((g) => g > 0 && g < 3 * median(lines.map((l) => l.h)))) || median(lines.map((l) => l.h)) * 1.3
  const indented = (l: Line) => (l.rtl ? right - l.x1 : l.x0 - left) > Math.max(l.h * 0.9, width * 0.025)
  const short = (l: Line) => (l.rtl ? l.x0 - left : right - l.x1) > width * 0.15
  const sizeChange = (a: Line, b: Line) => Math.abs(a.h - b.h) > Math.min(a.h, b.h) * 0.2

  const blocks: Line[][] = [[lines[0]]]
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1]
    const b = lines[i]
    const gap = a.y - b.y
    const brk = gap > typical * 1.35 || gap < 0 || indented(b) || short(a) || sizeChange(a, b)
    if (brk) blocks.push([b])
    else blocks[blocks.length - 1].push(b)
  }
  void pageW
  return blocks.map((ls) => {
    const x0 = Math.min(...ls.map((l) => l.x0))
    const x1 = Math.max(...ls.map((l) => l.x1))
    const topY = ls[0].y + ls[0].h * 0.85
    const bottomY = ls[ls.length - 1].y - ls[ls.length - 1].h * 0.25
    const rtl = ls.filter((l) => l.rtl).length * 2 > ls.length
    let text = ''
    for (const l of ls) {
      if (text.endsWith('-') && /^\p{Ll}/u.test(l.text)) text = text.slice(0, -1) + l.text
      else text += (text ? ' ' : '') + l.text
    }
    return {
      text,
      box: { x: x0, y: pageH - topY, w: x1 - x0, h: topY - bottomY },
      size: median(ls.map((l) => l.h)),
      indented: indented(ls[0]),
      runsOn: !short(ls[ls.length - 1]) && !/[.!?…:"”’»)]$/.test(ls[ls.length - 1].text),
      rtl
    }
  })
}

/** A paragraph of the original. A paragraph that goes on to the next page has a box on each page. */
export interface SourcePara {
  ref: SourceRef
  text: string
  boxes: (Box & { page: number })[]
}

/**
 * Puts the pages' blocks together into the PDF's paragraphs. A block at the top of a page that is
 * not indented, right after a block that ran to the end of the line, continues that paragraph.
 * `pages[i]` is page `first + i`.
 */
export function linkPages(pages: PageBlock[][], first = 1): SourcePara[] {
  const out: SourcePara[] = []
  pages.forEach((blocks, i) => {
    const page = first + i
    let own = 0
    blocks.forEach((b, j) => {
      const prev = out[out.length - 1]
      const prevBlock = j === 0 && i > 0 ? pages[i - 1][pages[i - 1].length - 1] : undefined
      if (j === 0 && prev && prevBlock && prev.boxes[prev.boxes.length - 1].page === page - 1 && prevBlock.runsOn && !b.indented && Math.abs(prevBlock.size - b.size) <= Math.min(prevBlock.size, b.size) * 0.2) {
        prev.text += (prev.text.endsWith('-') ? '' : ' ') + b.text
        prev.boxes.push({ ...b.box, page })
        return
      }
      out.push({ ref: { page, para: own++ }, text: b.text, boxes: [{ ...b.box, page }] })
    })
  })
  return out
}

/** The paragraphs of a chapter in the original: indices [from, to] in `paras` (to < from when empty) */
export function chapterRange(paras: SourcePara[], src: Pick<ChapterSource, 'start' | 'end'> | undefined): [number, number] {
  if (!paras.length) return [0, -1]
  let from = 0
  let to = paras.length - 1
  if (src?.start) {
    const i = paras.findIndex((p) => compareRefs(p.ref, src.start!) >= 0)
    from = i < 0 ? paras.length : i
  }
  if (src?.end) {
    let j = -1
    paras.forEach((p, k) => {
      if (compareRefs(p.ref, src.end!) <= 0) j = k
    })
    to = j
  }
  return [from, to]
}

// ---------------------------------------------------------------------------
// The chapter's side: which paragraphs count, and how much is translated
// ---------------------------------------------------------------------------

/** A top-level paragraph of the chapter counts when it has text and is not a scene break */
export const countsAsParagraph = (text: string): boolean => {
  const t = text.trim()
  return !!t && !isSceneBreak(t)
}

function plain(n: PMNode): string {
  if (typeof n.text === 'string') return n.text
  return (n.content ?? []).map(plain).join(' ')
}

/**
 * Paragraphs of a chapter for matching with the original: the title (always the first one) and
 * every top-level paragraph with text. The title is matched with the first paragraph of the
 * original chapter (usually its heading).
 */
export function chapterParagraphCount(doc: PMNode): number {
  return 1 + (doc.content ?? []).filter((n) => countsAsParagraph(plain(n))).length
}

export interface Progress {
  done: number
  total: number
  /** 0–100, rounded down so a chapter shows 100 only when it is really done */
  percent: number
}

/** How much of a chapter is translated: its paragraphs against the original's (statistics only) */
export function translationProgress(chapterParas: number, sourceParas: number | undefined): Progress | null {
  if (!sourceParas || sourceParas <= 0) return null
  const done = Math.min(chapterParas, sourceParas)
  return { done, total: sourceParas, percent: Math.floor((done / sourceParas) * 100) }
}

/** The whole book: chapters that have an original, added up */
export function bookProgress(items: { chapterParas: number; sourceParas?: number }[]): Progress | null {
  let done = 0
  let total = 0
  for (const it of items) {
    const p = translationProgress(it.chapterParas, it.sourceParas)
    if (!p) continue
    done += p.done
    total += p.total
  }
  return total ? { done, total, percent: Math.floor((done / total) * 100) } : null
}

// ---------------------------------------------------------------------------
// Google Translate (feature 13): an ordinary web page inside the app, no API
// ---------------------------------------------------------------------------

export const GOOGLE_TRANSLATE_HOME = 'https://translate.google.com/?sl=auto&tl=iw&op=translate'
/** Google Translate takes up to 5000 characters at a time */
export const TRANSLATE_MAX = 5000

export function googleTranslateUrl(text: string, from = 'auto', to = 'iw'): string {
  const t = text.replace(/\s+/g, ' ').trim().slice(0, TRANSLATE_MAX)
  return `https://translate.google.com/?sl=${encodeURIComponent(from)}&tl=${encodeURIComponent(to)}&text=${encodeURIComponent(t)}&op=translate`
}

/** Only Google Translate (and Google's sign-in and consent pages it may pass through) opens inside the app */
export function allowedInTranslatePane(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    return /^(translate|consent|accounts)\.google\.(com|com\.[a-z]{2}|co\.[a-z]{2}|[a-z]{2})$/.test(u.hostname)
  } catch {
    return false
  }
}
