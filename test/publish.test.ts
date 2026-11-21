import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { bookCss, bookSections, chapterBodyHtml, fitToLayout, findMarkers, oddPagePlan, printCss, tocEntries, type BookData } from '../src/shared/bookhtml'
import { bookToDocx } from '../src/shared/docx'
import { defaultMatter, elStyle, moveMatter, newMatterPage, normalizePublish } from '../src/shared/publish'
import type { PMNode } from '../src/shared/types'

const p = (text: string, attrs?: Record<string, unknown>): PMNode => ({ type: 'paragraph', ...(attrs ? { attrs } : {}), content: text ? [{ type: 'text', text }] : [] })
const doc = (...content: PMNode[]): PMNode => ({ type: 'doc', content })

function sample(): BookData {
  const publish = normalizePublish(undefined)
  publish.info = { author: 'שלומי', subtitle: 'רומן' }
  publish.matter.push({ ...newMatterPage('dedication'), text: 'לאמא' }, { ...newMatterPage('thanks'), text: 'תודה' })
  return {
    title: 'הנמל',
    chapters: [
      { id: 'a', title: 'פתיחה', doc: doc(p('ראשונה'), p('שנייה'), p('* * *'), p('אחרי'), p('')) },
      { id: 'b', title: 'הים', doc: doc(p('גל', { textAlign: 'center' }), { type: 'paragraph', content: [{ type: 'text', text: 'עם הערה' }, { type: 'footnote', attrs: { text: 'הערה <ראשונה>' } }] }) },
      { id: 'c', title: 'סוף', doc: doc(p('x')) }
    ],
    outline: [
      { type: 'chapter', id: 'a' },
      { type: 'part', id: 'p1', title: 'חלק שני', children: ['b', 'c'] }
    ],
    publish
  }
}

describe('front and back pages, layout settings', () => {
  it('a new book has a title page and a table of contents, with the same ids every time', () => {
    expect(normalizePublish(undefined).matter.map((m) => m.kind)).toEqual(['title', 'toc'])
    expect(normalizePublish(undefined).matter.map((m) => m.id)).toEqual(defaultMatter().map((m) => m.id))
  })
  it('fills in missing settings and keeps values in range', () => {
    const n = normalizePublish({ layout: { fontSize: 99, pageSize: 'nope' } as never })
    expect(n.layout.fontSize).toBe(20)
    expect(n.layout.pageSize).toBe('a5')
    expect(n.layout.chapterNewPage).toBe(true)
  })
  it('moves a page only among the pages on its side', () => {
    const list = [{ ...newMatterPage('title'), id: 't' }, { ...newMatterPage('dedication'), id: 'd' }, { ...newMatterPage('thanks'), id: 'x' }]
    expect(moveMatter(list, 'd', -1).map((m) => m.id)).toEqual(['d', 't', 'x'])
    expect(moveMatter(list, 'x', -1).map((m) => m.id)).toEqual(['t', 'd', 'x'])
  })
})

describe('the book as HTML', () => {
  it('orders front pages, parts, chapters and back pages', () => {
    const s = bookSections(sample())
    expect(s.map((x) => (x.kind === 'matter' ? x.page.kind : x.kind))).toEqual(['title', 'toc', 'dedication', 'chapter', 'part', 'chapter', 'chapter', 'thanks'])
    expect(tocEntries(sample()).map((e) => [e.title, e.level])).toEqual([
      ['פתיחה', 0],
      ['חלק שני', 0],
      ['הים', 1],
      ['סוף', 1]
    ])
  })
  it('leaves out the front and back pages when switched off', () => {
    const d = sample()
    d.publish.layout.matter = false
    expect(bookSections(d).map((x) => x.kind)).toEqual(['chapter', 'part', 'chapter', 'chapter'])
  })
  it('writes paragraphs with the book indent rule, scene breaks, notes at the end, escaped text', () => {
    const s = bookSections(sample())
    const a = s.find((x) => x.id === 'a')!.html
    expect(a).toContain('<p class="flush">ראשונה</p>')
    expect(a).toContain('<p class="ind">שנייה</p>')
    expect(a).toContain('<p class="scene">* * *</p>')
    expect(a).toContain('<p class="flush">אחרי</p>')
    const b = s.find((x) => x.id === 'b')!.html
    expect(b).toContain('style="text-align: center"')
    // notes go to the bottom of their page: the mark carries the note
    expect(b).toMatch(/<sup class="fn" id="c\d+-n1-ref" data-fn="1" data-note="הערה &lt;ראשונה&gt;">1<\/sup>/)
    expect(b).not.toContain('bk-notes')
    const title = s[0].html
    expect(title).toContain('הנמל')
    expect(title).toContain('רומן')
    expect(title).toContain('שלומי')
  })
  it('numbers notes through the whole book, also at the end of chapters', () => {
    const data = sample()
    const fn = (t: string): PMNode => ({ type: 'paragraph', content: [{ type: 'text', text: 'x' }, { type: 'footnote', attrs: { text: t } }] })
    data.chapters[2].doc = doc(fn('שנייה'), fn('שלישית'))
    expect(bookSections(data).find((x) => x.id === 'c')!.html).toContain('data-fn="3"')
    data.publish.layout.notesAt = 'chapter'
    const c = bookSections(data).find((x) => x.id === 'c')!.html
    expect(c).toContain('<ol start="2">')
    expect(c).toMatch(/>3<\/a><\/sup>/)
    expect(bookSections(data, 'epub').find((x) => x.id === 'c')!.html).toContain('>3</a>. שלישית')
  })
  it('fills the table of contents with page numbers when known', () => {
    const s = bookSections(sample(), 'end', { a: 5, p1: 9, b: 11, c: 15 })
    expect(s[1].html).toContain('data-toc="b">11<')
  })
  it('ePub notes are pop-up notes', () => {
    const html = chapterBodyHtml(sample().chapters[1].doc, { prefix: 'c1', notes: [], mode: 'epub' })
    expect(html).toContain('epub:type="noteref"')
  })
  it('styles: page size, running heads per chapter, no numbers on front pages', () => {
    const d = sample()
    const s = bookSections(d)
    const css = printCss(d.publish.layout, s, d.title)
    expect(css).toContain('size: 148mm 210mm')
    expect(css).toMatch(/@page ch3:left \{ @top-center \{ content: "פתיחה"/)
    expect(css).toMatch(/@page matter \{ @bottom-center \{ content: none/)
    expect(bookCss(d.publish.layout)).toContain("font-family: 'Frank Ruhl Libre'")
  })
})

describe('printing: page numbers and empty pages', () => {
  it('finds the hidden markers in the text of the pages', () => {
    expect(findMarkers(['ספר', 'QZQ0QZQ', 'abc QZQ1Q ZQ text QZQ2QZQ', ''])).toEqual({ 0: 2, 1: 3, 2: 3 })
  })
  it('adds an empty page before a chapter that would start on an even page', () => {
    const kinds = [{ kind: 'matter' }, { kind: 'chapter' }, { kind: 'chapter' }, { kind: 'part' }, { kind: 'chapter' }] as const
    // chapter at page 2 → empty page; then everything moves by one
    const plan = oddPagePlan([...kinds], { 0: 1, 1: 2, 2: 6, 3: 9, 4: 10 }, { partPage: true })
    expect(plan.blanks).toEqual([1, 3, 4])
    // the part page starts on 11; its chapter would follow on 12, so it gets an empty page too
    expect(plan.pages).toEqual({ 0: 1, 1: 3, 2: 7, 3: 11, 4: 13 })
  })
})

describe('the book as one Word file', () => {
  it('has every piece, page breaks, a table of contents field and footnotes', async () => {
    const d = sample()
    const bytes = await bookToDocx(
      [
        { kind: 'title', title: d.title, subtitle: 'רומן', author: 'שלומי', extra: [] },
        { kind: 'toc', heading: 'תוכן העניינים', entries: ['פתיחה', 'הים'] },
        { kind: 'matter', heading: '', lines: ['לאמא'], centered: true },
        { kind: 'part', title: 'חלק שני' },
        { kind: 'chapter', title: 'הים', doc: d.chapters[1].doc }
      ],
      d.title,
      { pageW: 148, pageH: 210, margin: { top: 18, bottom: 20, side: 18 }, font: 'David Libre', fontSize: 12 }
    )
    const zip = await JSZip.loadAsync(bytes)
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml.match(/<w:pageBreakBefore\/>/g)?.length).toBe(4)
    expect(xml).toContain('TOC \\o "1-1"')
    expect(xml).toContain('w:val="PartTitle"')
    expect(xml).toContain('<w:pgSz w:w="8391" w:h="11906"/>')
    expect(await zip.file('word/footnotes.xml')!.async('string')).toContain('הערה &lt;ראשונה&gt;')
    expect(await zip.file('word/settings.xml')!.async('string')).toContain('<w:updateFields w:val="true"/>')
    expect(await zip.file('word/styles.xml')!.async('string')).toContain('w:ascii="David Libre"')
  })
})

describe('fitToLayout (imported sizes and fonts follow the layout)', () => {
  const run = (text: string, size?: string, font?: string) => ({ type: 'text', text, marks: [{ type: 'textStyle', attrs: { fontSize: size ?? null, fontFamily: font ?? null } }] })
  const doc = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [run('טקסט רגיל ארוך מאוד שמופיע ברוב הפרק', '11pt', 'Arial'), run('גדול', '22pt', 'Arial')] },
      { type: 'paragraph', content: [run('עוד טקסט רגיל בגופן אחר', '11pt', 'David')] }
    ]
  }
  it('drops the usual size and font, and scales the others', () => {
    const out = fitToLayout(doc as never, { fontSize: 14 })
    const [a, b] = out.content![0].content!
    expect(a.marks).toBeUndefined()
    expect(b.marks![0].attrs).toMatchObject({ fontSize: '28pt', fontFamily: null })
    expect(out.content![1].content![0].marks![0].attrs).toMatchObject({ fontFamily: 'David', fontSize: null })
  })
  it('the body size reaches the reading view', () => {
    const html = bookSections({ title: 'ס', chapters: [{ id: 'c', title: 'פרק', doc: doc as never }], outline: [{ type: 'chapter', id: 'c' }], publish: normalizePublish({ matter: [] }) }).map((s) => s.html).join('')
    expect(html).not.toContain('11pt')
  })
  it('element styles: cleaned when read, and follow the body size when no size was chosen', () => {
    const p = normalizePublish({ layout: { fontSize: 10, styles: { chapterTitle: { size: 999, align: 'bad', font: 'Heebo' }, toc: 'x' } } as never })
    expect(p.layout.styles).toEqual({ chapterTitle: { size: 72, font: 'Heebo' } })
    expect(elStyle(p.layout, 'chapterTitle')).toMatchObject({ size: 72, font: 'Heebo', align: 'center', auto: false })
    expect(elStyle(p.layout, 'partTitle')).toMatchObject({ size: 22, auto: true })
    const css = bookCss({ ...p.layout, styles: { notes: { size: 8 } } })
    expect(css).toContain('.bk-notes, .bk-fnotes { font-size: 8pt')
    expect(bookCss(p.layout, '', true)).toMatch(/\.bk-ch-title \{ font-size: 7\.200em/)
  })
})
