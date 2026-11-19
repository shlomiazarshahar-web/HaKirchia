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
  /** Font height of its first lines (headings are bigger) */
  size?: number
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
      out.push({ ref: { page, para: own++ }, text: b.text, boxes: [{ ...b.box, page }], size: b.size })
    })
  })
  return out
}

// ---------------------------------------------------------------------------
// The original's structure: where chapters start, and scene breaks (round 6, asked by שלומי)
// ---------------------------------------------------------------------------

/** A scene break drawn with signs: "***", "* * *", a single "*", "⁂", "#", "~", "❧"… (a short line of signs only) */
const SIGN_BREAK_RE = /^[\s*•·∗✱⁂#~◆◇❖✦✧❧☙✻✽❦§°○●◦⸙＊]+$/u
export function isSignSceneBreak(text: string): boolean {
  const t = text.trim()
  return !!t && t.length <= 20 && SIGN_BREAK_RE.test(t)
}

/** A picture on a page of the PDF (a small ornament between paragraphs may be a scene break) */
export interface PdfImage {
  page: number
  box: Box
}

type Matrix = [number, number, number, number, number, number]
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5]
]

/** The drawing-instruction codes of pdf.js that matter here (pdfjs.OPS) */
export type OpCodes = Record<string, number>

/**
 * Where pictures are drawn on a page, from its drawing instructions (pdf.js operator list): the
 * current transformation is followed through save/restore and forms, and each picture fills the
 * unit square under it. `view` is the page's box [x0, y0, x1, y1].
 */
export function imagesFromOperators(fnArray: number[], argsArray: unknown[], O: OpCodes, view: number[], page: number): PdfImage[] {
  const paints = new Set(['paintImageXObject', 'paintInlineImageXObject', 'paintImageMaskXObject', 'paintImageXObjectRepeat', 'paintInlineImageXObjectGroup', 'paintImageMaskXObjectGroup'].map((k) => O[k]).filter((v) => typeof v === 'number'))
  const [x0, y0, , y1] = view
  const pageH = y1 - y0
  const out: PdfImage[] = []
  let ctm: Matrix = [1, 0, 0, 1, 0, 0]
  const stack: Matrix[] = []
  fnArray.forEach((fn, i) => {
    const args = argsArray[i] as unknown[] | null
    if (fn === O.save) stack.push(ctm)
    else if (fn === O.restore) ctm = stack.pop() ?? ctm
    else if (fn === O.transform && Array.isArray(args) && args.length === 6) ctm = mul(ctm, args as Matrix)
    else if (fn === O.paintFormXObjectBegin) {
      stack.push(ctm)
      const m = args?.[0] as Matrix | null
      if (Array.isArray(m) && m.length === 6) ctm = mul(ctm, m)
    } else if (fn === O.paintFormXObjectEnd) ctm = stack.pop() ?? ctm
    else if (paints.has(fn)) {
      const pts = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1]
      ].map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4] - x0, ctm[1] * x + ctm[3] * y + ctm[5] - y0])
      const xs = pts.map((q) => q[0])
      const ys = pts.map((q) => q[1])
      out.push({ page, box: { x: Math.min(...xs), y: pageH - Math.max(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) } })
    }
  })
  return out
}

/** A scene break in the original */
export interface SceneMark {
  page: number
  /** Where on the page, from the top, in PDF units */
  y: number
  /** Index (in the paragraph list) of the last paragraph before the break; -1 = before the first */
  after: number
  kind: 'signs' | 'image'
}

export interface SourceStructure {
  /** The paragraphs to match with the translation: without scene-break lines, a chapter heading of two lines as one */
  paras: SourcePara[]
  /** Scene breaks drawn with signs (images are added later, see imageScenes) */
  scenes: SceneMark[]
  /** Indices in `paras` of the paragraphs that look like the start of a chapter */
  chapters: number[]
}

const CHAPTER_WORD_RE =
  /^(chapter|chap\.|part|book|prologue|epilogue|interlude|afterword|foreword|פרק|פרולוג|אפילוג|חלק|глава|часть|пролог|эпилог|kapitel|teil|chapitre|partie|prologue|capítulo|capitulo|parte|capitolo|hoofdstuk|rozdział|kapitola)(\s|$|[.:\-–—])/iu
const NUMBER_ALONE_RE = /^(?:[ivxlcdm]{1,8}|\d{1,3})[.:)]?$/i
const NUMBER_FIRST_RE = /^(?:[ivxlcdm]{1,8}|\d{1,3})[.:)]?\s+\S/i
const SPELLED_RE = /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty)(\b|[-\s])/i

/** Body text size: the usual size of the longer paragraphs */
function bodySize(paras: SourcePara[]): number {
  const sizes = paras.filter((p) => p.size && wordsIn(p.text) >= 12).map((p) => p.size!)
  return median(sizes.length ? sizes : paras.filter((p) => p.size).map((p) => p.size!)) || 10
}
const wordsIn = (s: string) => s.split(/\s+/).filter(Boolean).length

/**
 * Finds the structure of the original: removes scene-break lines from the paragraphs (the
 * translation does not count them either), joins a two-line chapter heading ("Chapter 3" and its
 * name, both big) into one paragraph, and finds where chapters seem to start. `pageH` gives each
 * page's height (index 0 = page 1).
 */
export function sourceStructure(all: SourcePara[], pageH: (page: number) => number): SourceStructure {
  const body = bodySize(all)
  const big = (p: SourcePara, k = 1.25) => (p.size ?? body) >= body * k
  const paras: SourcePara[] = []
  const scenes: SceneMark[] = []
  for (const p of all) {
    if (isSignSceneBreak(p.text)) {
      scenes.push({ page: p.boxes[0].page, y: p.boxes[0].y + p.boxes[0].h / 2, after: paras.length - 1, kind: 'signs' })
      continue
    }
    const prev = paras[paras.length - 1]
    if (prev && big(prev) && big(p) && prev.boxes.length === 1 && prev.boxes[0].page === p.boxes[0].page && wordsIn(prev.text) <= 8 && wordsIn(p.text) <= 12 && looksLikeChapterLabel(prev.text)) {
      paras[paras.length - 1] = { ...prev, text: `${prev.text} — ${p.text}`, boxes: [...prev.boxes, ...p.boxes] }
      continue
    }
    paras.push({ ...p })
  }
  const score = (i: number): number => {
    const p = paras[i]
    const t = p.text.trim()
    const words = wordsIn(t)
    let s = 0
    const label = looksLikeChapterLabel(t)
    if (CHAPTER_WORD_RE.test(t)) s += 3
    else if (NUMBER_ALONE_RE.test(t)) s += 3
    else if (NUMBER_FIRST_RE.test(t) && words <= 10) s += 1
    if (words > 14 && !label) return 0
    if (big(p, 1.3)) s += 2
    else if (big(p, 1.12)) s += 1
    const b = p.boxes[0]
    const firstOnPage = p.ref.para === 0 || !paras[i - 1] || paras[i - 1].boxes[paras[i - 1].boxes.length - 1].page !== b.page
    if (firstOnPage && b.y > pageH(b.page) * 0.18) s += 1 // starts low on a fresh page
    if (firstOnPage) s += 1
    return s
  }
  const chapters: number[] = []
  for (let i = 0; i < paras.length; i++) {
    if (score(i) < 4) continue
    // two heading lines in a row (a title page): only the first
    if (chapters.length && chapters[chapters.length - 1] === i - 1) continue
    chapters.push(i)
  }
  // When chapters are numbered or named "Chapter…", a big line without that (a title page, a dedication) is not one
  const labeled = chapters.filter((i) => looksLikeChapterLabel(paras[i].text))
  return { paras, scenes, chapters: labeled.length >= 2 ? labeled : chapters }
}

function looksLikeChapterLabel(t: string): boolean {
  const s = t.trim()
  return CHAPTER_WORD_RE.test(s) || NUMBER_ALONE_RE.test(s) || SPELLED_RE.test(s)
}

/**
 * Small pictures standing alone between paragraphs are scene breaks (an ornament). Pictures that
 * overlap text, big pictures, and a picture that repeats on most pages (a decoration) are not.
 */
export function imageScenes(images: PdfImage[], paras: SourcePara[], chapters: number[], pageSize: (page: number) => { w: number; h: number }, pages: number): SceneMark[] {
  const sizeKey = (b: Box) => `${Math.round(b.w)}x${Math.round(b.h)}`
  const repeats = new Map<string, Set<number>>()
  for (const im of images) {
    const k = sizeKey(im.box)
    if (!repeats.has(k)) repeats.set(k, new Set())
    repeats.get(k)!.add(im.page)
  }
  const out: SceneMark[] = []
  for (const im of images) {
    const { w, h } = pageSize(im.page)
    const b = im.box
    if (b.w > w * 0.6 || b.h > h * 0.2 || b.w < 4 || b.h < 2) continue
    if (pages >= 6 && (repeats.get(sizeKey(b))?.size ?? 0) > pages * 0.4) continue
    if (b.y < h * 0.06 || b.y + b.h > h * 0.94) continue
    const onPage = paras.flatMap((p, i) => p.boxes.filter((x) => x.page === im.page).map((x) => ({ i, x })))
    if (onPage.some(({ x }) => x.y < b.y + b.h - 1 && x.y + x.h > b.y + 1)) continue // overlaps text
    let after = -1
    for (const { i, x } of onPage) if (x.y + x.h <= b.y + 1) after = Math.max(after, i)
    if (after < 0) {
      // the first thing on its page: after the last paragraph of the pages before
      for (let i = paras.length - 1; i >= 0; i--)
        if (paras[i].boxes[0].page < im.page) {
          after = i
          break
        }
    }
    // an ornament just above or below a chapter heading belongs to the heading
    const next = paras[after + 1]
    if (chapters.includes(after) && paras[after].boxes.some((x) => x.page === im.page)) continue
    if (next && chapters.includes(after + 1) && next.boxes[0].page === im.page) continue
    // the same picture drawn twice
    if (out.some((m) => m.page === im.page && Math.abs(m.y - (b.y + b.h / 2)) < 2)) continue
    out.push({ page: im.page, y: b.y + b.h / 2, after, kind: 'image' })
  }
  return out
}

/** One chapter to create when splitting the book by its original */
export interface SplitItem {
  title: string
  /** The heading in the original, kept as the chapter's synopsis */
  synopsis: string
  start: SourceRef
  /** Missing for the last chapter: to the end of the PDF */
  end?: SourceRef
  /** Scene breaks inside the chapter */
  scenes: number
}

/**
 * The chapters of the original, for splitting the book: each found chapter start up to the paragraph
 * before the next one (what comes before the first, like a title page, is left out).
 */
export function splitPlan(paras: SourcePara[], chapters: number[], scenes: SceneMark[]): (SplitItem & { from: number; to: number; page: number })[] {
  return chapters.map((start, k) => {
    const next = chapters[k + 1]
    const to = next === undefined ? paras.length - 1 : next - 1
    return {
      title: `פרק ${k + 1}`,
      synopsis: paras[start].text,
      start: paras[start].ref,
      ...(next === undefined ? {} : { end: paras[to].ref }),
      scenes: scenes.filter((m) => m.after >= start && m.after < to).length,
      from: start,
      to,
      page: paras[start].boxes[0].page
    }
  })
}

export interface ChapterSuggestion {
  start: number
  /** Last paragraph, or -1 = to the end of the original */
  end: number
}

/**
 * Suggests the chapter's range in the original: the first chapter start at or right after where it
 * starts now, up to the paragraph before the next chapter start. Null when there is nothing to suggest.
 */
export function suggestChapter(chapters: number[], paraCount: number, from: number, startFixed: boolean): ChapterSuggestion | null {
  if (!chapters.length || !paraCount) return null
  let start = chapters.find((c) => c >= from)
  if (start === undefined) return null
  // the chapter's start was set (e.g. right after the previous chapter): move it only a little, to its heading
  if (startFixed && start - from > 3) start = from
  const next = chapters.find((c) => c > start!)
  return { start, end: next === undefined ? -1 : next - 1 }
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
