import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { imageScenes, imagesFromOperators, isSignSceneBreak, linkPages, pageBlocks, sourceStructure, suggestChapter, type PageBlock, type PdfImage, type TextPiece } from '../src/shared/translation'

/** Reads a PDF the way the window does: paragraphs, structure, and pictures */
async function analyze(file: string) {
  const doc = await getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: false }).promise
  const pages: PageBlock[][] = []
  const sizes: { w: number; h: number }[] = []
  const images: PdfImage[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const vp = page.getViewport({ scale: 1 })
    sizes.push({ w: vp.width, h: vp.height })
    const tc = await page.getTextContent()
    const pieces: TextPiece[] = []
    for (const it of tc.items) {
      if (!('str' in it)) continue
      const t = it.transform as number[]
      pieces.push({ str: it.str, x: t[4], y: t[5], w: it.width, h: it.height || Math.hypot(t[2], t[3]), dir: it.dir })
    }
    pages.push(pageBlocks(pieces, vp.width, vp.height))
    const ops = await page.getOperatorList()
    images.push(...imagesFromOperators(ops.fnArray, ops.argsArray, OPS as unknown as Record<string, number>, page.view, n))
  }
  const st = sourceStructure(linkPages(pages, 1), (p) => sizes[p - 1].h)
  return { ...st, images, sizes, pages: doc.numPages }
}

describe('structure of the original', () => {
  it('finds chapter starts: two-line headings, "CHAPTER 2", a roman numeral alone', async () => {
    const st = await analyze(join(__dirname, 'fixtures', 'structure.pdf'))
    const starts = st.chapters.map((i) => st.paras[i].text)
    expect(starts).toEqual(['Chapter One — The Crossing', 'CHAPTER 2', 'III'])
    // the running head and page numbers are not paragraphs
    expect(st.paras.some((p) => /^\d+$/.test(p.text))).toBe(false)
  })

  it('finds scene breaks: "* * *", a single "*", and an ornament picture between paragraphs', async () => {
    const st = await analyze(join(__dirname, 'fixtures', 'structure.pdf'))
    // scene-break lines are not paragraphs (the translation does not count them either)
    expect(st.paras.some((p) => isSignSceneBreak(p.text))).toBe(false)
    expect(st.scenes.map((m) => m.kind)).toEqual(['signs', 'signs'])
    const before = (i: number) => st.paras[i].text.slice(0, 20)
    expect(st.scenes.map((m) => before(m.after))).toEqual(['By the third mile th', 'Miriam read the word'])
    expect(st.images).toHaveLength(1)
    const fromImages = imageScenes(st.images, st.paras, st.chapters, (p) => st.sizes[p - 1], st.pages)
    expect(fromImages.map((m) => before(m.after))).toEqual(['They slept that nigh'])
  })

  it('suggests a chapter: from its heading to the paragraph before the next heading', async () => {
    const st = await analyze(join(__dirname, 'fixtures', 'structure.pdf'))
    const n = st.paras.length
    const [one, two, three] = st.chapters
    // nothing marked yet: the first chapter start (after the title page of the PDF)
    expect(one).toBeGreaterThan(0)
    expect(suggestChapter(st.chapters, n, 0, false)).toEqual({ start: one, end: two - 1 })
    // the next chapter, starting right after the previous one ended
    expect(suggestChapter(st.chapters, n, one, true)).toEqual({ start: one, end: two - 1 })
    // the start was set one paragraph early: it moves to the heading
    expect(suggestChapter(st.chapters, n, two - 1, true)).toEqual({ start: two, end: three - 1 })
    // the last chapter runs to the end
    expect(suggestChapter(st.chapters, n, three, true)).toEqual({ start: three, end: -1 })
    // a start set far from any heading stays where it is
    expect(suggestChapter([0, 50], 60, 20, true)).toEqual({ start: 20, end: 49 })
  })

  it('knows scene-break signs', () => {
    for (const t of ['*', '* * *', '***', '⁂', '#', '~ ~ ~', '❧', ' • • • ']) expect(isSignSceneBreak(t)).toBe(true)
    for (const t of ['', 'A', 'III', '* and then', '—', 'Chapter 1']) expect(isSignSceneBreak(t)).toBe(false)
  })

  it('ignores pictures that repeat on most pages, big pictures and pictures over text', () => {
    const paras = [
      { ref: { page: 1, para: 0 }, text: 'a', boxes: [{ page: 1, x: 50, y: 100, w: 300, h: 40 }] },
      { ref: { page: 1, para: 1 }, text: 'b', boxes: [{ page: 1, x: 50, y: 200, w: 300, h: 40 }] }
    ]
    const size = () => ({ w: 420, h: 595 })
    const img = (page: number, y: number, w = 60, h = 12): PdfImage => ({ page, box: { x: 180, y, w, h } })
    expect(imageScenes([img(1, 160)], paras, [], size, 1).map((m) => m.after)).toEqual([0])
    expect(imageScenes([img(1, 110)], paras, [], size, 1)).toEqual([]) // over text
    expect(imageScenes([img(1, 160, 400, 200)], paras, [], size, 1)).toEqual([]) // big
    const deco = Array.from({ length: 8 }, (_, k) => img(k + 1, 160))
    expect(imageScenes(deco, paras, [], size, 8)).toEqual([]) // on every page: a decoration
  })
})
