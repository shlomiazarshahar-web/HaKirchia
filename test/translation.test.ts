import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  allowedInTranslatePane,
  bookProgress,
  chapterParagraphCount,
  chapterRange,
  googleTranslateUrl,
  linkPages,
  pageBlocks,
  translationProgress,
  type PageBlock,
  type TextPiece
} from '../src/shared/translation'
import type { PMNode } from '../src/shared/types'

/** Reads the test PDF the way the window does: text pieces per page, then paragraphs */
async function paragraphsOf(file: string) {
  const data = new Uint8Array(readFileSync(file))
  const doc = await getDocument({ data, useSystemFonts: false }).promise
  const pages: PageBlock[][] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const vp = page.getViewport({ scale: 1 })
    const tc = await page.getTextContent()
    const pieces: TextPiece[] = []
    for (const it of tc.items) {
      if (!('str' in it)) continue
      const t = it.transform as number[]
      pieces.push({ str: it.str, x: t[4], y: t[5], w: it.width, h: it.height || Math.hypot(t[2], t[3]), dir: it.dir })
    }
    pages.push(pageBlocks(pieces, vp.width, vp.height))
  }
  return linkPages(pages, 1)
}

describe('paragraphs of a PDF', () => {
  it('finds headings and paragraphs, skips running heads and page numbers, joins a paragraph across pages', async () => {
    const paras = await paragraphsOf(join(__dirname, 'fixtures', 'source.pdf'))
    const starts = paras.map((p) => p.text.slice(0, 18))
    expect(starts).toEqual([
      'III. The Crossing',
      'They left the vill',
      'By the third mile ',
      '"Don\'t look back,"',
      'At noon they reach',
      'Miriam read it alo',
      'They slept that ni',
      'In the morning her',
      'IV. The Other Road',
      'Nobody in the next',
      'Miriam asked at th'
    ])
    // the last paragraph starts on page 1 and goes on to page 2
    const last = paras[paras.length - 1]
    expect(last.ref).toEqual({ page: 1, para: 10 })
    expect(last.boxes.map((b) => b.page)).toEqual([1, 2])
    expect(last.text).toMatch(/answer was the same shrug.*daylight\.$/)
    expect(paras.some((p) => /SALT ROAD|^4[12]$/.test(p.text))).toBe(false)
    // boxes are inside the page, from the top
    for (const p of paras) for (const b of p.boxes) expect(b.y).toBeGreaterThan(0)
  })

  it('a chapter is a range of paragraphs', async () => {
    const paras = await paragraphsOf(join(__dirname, 'fixtures', 'source.pdf'))
    expect(chapterRange(paras, undefined)).toEqual([0, 10])
    expect(chapterRange(paras, { end: { page: 1, para: 7 } })).toEqual([0, 7])
    expect(chapterRange(paras, { start: { page: 1, para: 8 } })).toEqual([8, 10])
    // "right after the previous chapter" may point past the last paragraph of a page
    expect(chapterRange(paras, { start: { page: 1, para: 11 } })).toEqual([11, 10])
    expect(chapterRange([], undefined)).toEqual([0, -1])
  })

  it('splits by indent and gap, also right-to-left text', () => {
    const line = (str: string, x: number, y: number, w: number) => ({ str, x, y, w, h: 10, dir: 'rtl' })
    // right-aligned Hebrew lines; the second paragraph is indented from the right
    const pieces: TextPiece[] = [line('שורה ראשונה של פסקה שמגיעה עד הסוף', 50, 700, 400), line('וסוף הפסקה.', 300, 686, 150), line('פסקה שנייה מוזחת', 50, 672, 380), line('ועוד שורה', 300, 658, 150)]
    const blocks = pageBlocks(pieces, 500, 800)
    expect(blocks.map((b) => b.text)).toEqual(['שורה ראשונה של פסקה שמגיעה עד הסוף וסוף הפסקה.', 'פסקה שנייה מוזחת ועוד שורה'])
    expect(blocks[0].rtl).toBe(true)
  })
})

describe('translation progress', () => {
  const p = (text: string): PMNode => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })
  it('counts the title and the paragraphs with text, not empty lines or scene breaks', () => {
    const doc: PMNode = { type: 'doc', content: [p('א'), p(''), p('* * *'), p('ב'), { type: 'blockquote', content: [p('ג')] }] }
    expect(chapterParagraphCount(doc)).toBe(4)
    expect(chapterParagraphCount({ type: 'doc', content: [] })).toBe(1)
  })
  it('is a statistic: done out of the original, never more than all of it', () => {
    expect(translationProgress(5, 20)).toEqual({ done: 5, total: 20, percent: 25 })
    expect(translationProgress(30, 20)).toEqual({ done: 20, total: 20, percent: 100 })
    expect(translationProgress(19, 20)!.percent).toBe(95)
    expect(translationProgress(3, undefined)).toBeNull()
    expect(bookProgress([{ chapterParas: 10, sourceParas: 10 }, { chapterParas: 1, sourceParas: 30 }, { chapterParas: 5 }])).toEqual({ done: 11, total: 40, percent: 27 })
  })
})

describe('Google Translate pane', () => {
  it('opens the text in Google Translate', () => {
    const u = new URL(googleTranslateUrl('Hello  world\n& more'))
    expect(u.hostname).toBe('translate.google.com')
    expect(u.searchParams.get('text')).toBe('Hello world & more')
    expect(u.searchParams.get('tl')).toBe('iw')
    expect(new URL(googleTranslateUrl('x'.repeat(6000))).searchParams.get('text')!.length).toBe(5000)
  })
  it('lets only Google Translate open inside the app', () => {
    expect(allowedInTranslatePane('https://translate.google.com/?sl=auto')).toBe(true)
    expect(allowedInTranslatePane('https://translate.google.co.il/')).toBe(true)
    expect(allowedInTranslatePane('https://consent.google.com/x')).toBe(true)
    expect(allowedInTranslatePane('http://translate.google.com/')).toBe(false)
    expect(allowedInTranslatePane('https://evil.com/translate.google.com')).toBe(false)
    expect(allowedInTranslatePane('https://translate.google.com.evil.com/')).toBe(false)
    expect(allowedInTranslatePane('file:///c:/x')).toBe(false)
  })
})
