// Round 12 "עיצוב וייצוא": paragraph styles (50), scene break image (48), "not in export" (53),
// the manuscript for publishers (45). The beta reader's line numbers (54) need a browser and are
// checked by hand in the app.
import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { bookCss, bookSections, chapterBodyHtml, editorStyleCss, exportOutline, isEmptyChapter, tocEntries, type BookData } from '../src/shared/bookhtml'
import { bookToDocx, docToDocx, docxToDoc, isIndented, manuscriptToDocx, roughWords } from '../src/shared/docx'
import { DEFAULT_MANUSCRIPT, elStyle, normalizePublish } from '../src/shared/publish'
import type { PMNode } from '../src/shared/types'

const p = (text: string, attrs?: Record<string, unknown>): PMNode => ({ type: 'paragraph', attrs: { dir: 'rtl', textAlign: null, ...attrs }, ...(text ? { content: [{ type: 'text', text }] } : {}) })
const doc = (...content: PMNode[]): PMNode => ({ type: 'doc', content })

describe('paragraph styles (feature 50)', () => {
  const chapter = doc(p('לפני המכתב'), p('יקירתי,', { pstyle: 'letter' }), p('אני כותב לך מהנמל.', { pstyle: 'letter' }), p('אחרי המכתב'), p('עוד פסקה'), p('הכניסה אסורה', { pstyle: 'sign' }))

  it('never indents a styled paragraph, nor the one right after it', () => {
    const c = chapter.content!
    expect(isIndented(c[1], c[0])).toBe(false)
    expect(isIndented(c[2], c[1])).toBe(false)
    expect(isIndented(c[3], c[2])).toBe(false)
    expect(isIndented(c[4], c[3])).toBe(true)
  })

  it('keeps the style through a chapter file (a Word paragraph style)', async () => {
    const bytes = await docToDocx(chapter, 'פרק')
    const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string')
    expect(xml).toContain('<w:pStyle w:val="Letter"/>')
    expect(xml).toContain('<w:pStyle w:val="Sign"/>')
    const styles = await (await JSZip.loadAsync(bytes)).file('word/styles.xml')!.async('string')
    expect(styles).toContain('w:styleId="Letter"')
    expect(styles).toContain('w:styleId="Quote"')
    const back = await docxToDoc(bytes)
    expect(back.doc).toEqual(chapter)
  })

  it("reads Word's own Quote style as a quote", async () => {
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    const zip = new JSZip()
    zip.file('word/styles.xml', `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="a1"><w:name w:val="Intense Quote"/></w:style></w:styles>`)
    zip.file('word/document.xml', `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>פתיחה</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="a1"/></w:pPr><w:r><w:t>ציטוט</w:t></w:r></w:p></w:body></w:document>`)
    const res = await docxToDoc(await zip.generateAsync({ type: 'uint8array' }))
    expect(res.doc.content?.find((b) => b.content?.[0]?.text === 'ציטוט')?.attrs?.pstyle).toBe('quote')
  })

  it('shows the style in the book and the editor, with the look chosen for the whole book', () => {
    const html = chapterBodyHtml(chapter, null)
    expect(html).toContain('class="flush ps ps-letter"')
    expect(html).toContain('class="flush ps ps-sign"')
    const layout = normalizePublish({ layout: { styles: { pLetter: { font: 'David', italic: true } } } as never }).layout
    expect(elStyle(layout, 'pLetter')).toMatchObject({ font: 'David', italic: true })
    const css = bookCss(layout)
    expect(css).toMatch(/\.bk-sec p\.ps-letter \{[^}]*font-family: 'David'[^}]*font-style: italic/)
    expect(css).toMatch(/\.bk-sec p\.ps-letter \{ text-indent: 0 !important; margin-inline: 1\.5em; \}/)
    const ed = editorStyleCss(layout)
    expect(ed).toContain(".prose .ProseMirror p.ps-letter { font-size: 1.000em; font-family: 'David', var(--editor-font)")
    // headings keep the editor's own look until changed
    expect(ed).not.toContain('ProseMirror h2 {')
  })

  it('writes the book look into the exported Word file', async () => {
    const bytes = await bookToDocx([{ kind: 'chapter', title: 'א', doc: chapter }], 'ספר', { pageW: 148, pageH: 210, margin: { top: 18, bottom: 20, side: 17 }, font: 'Frank Ruhl Libre', fontSize: 12, paraStyles: { letter: { font: 'David', size: 11, align: 'start', bold: false, italic: true } } })
    const styles = await (await JSZip.loadAsync(bytes)).file('word/styles.xml')!.async('string')
    expect(styles).toMatch(/w:styleId="Letter">.*?<w:rFonts w:ascii="David".*?<w:i\/>.*?<w:sz w:val="22"\/>/)
  })
})

function book(): BookData {
  return {
    title: 'הנמל',
    chapters: [
      { id: 'a', title: 'פתיחה', doc: doc(p('ראשונה'), p('* * *'), p('אחרי')) },
      { id: 'b', title: 'טיוטה', doc: doc(p('לא לייצוא')), noExport: true },
      { id: 'c', title: 'סוף', doc: doc(p('x')) },
      { id: 'd', title: 'מחוק', doc: doc(p('y')), noExport: true },
      { id: 'e', title: 'מתוכנן', doc: doc(p(''), p('  ')) }
    ],
    outline: [
      { type: 'chapter', id: 'a' },
      { type: 'chapter', id: 'b' },
      { type: 'part', id: 'p1', title: 'חלק שני', children: ['c'] },
      { type: 'part', id: 'p2', title: 'חלק ריק מטיוטות', children: ['d'] },
      { type: 'part', id: 'p3', title: 'חלק ריק', children: [] },
      { type: 'chapter', id: 'e' }
    ],
    publish: normalizePublish(undefined)
  }
}

describe('"not in export" (feature 53) and empty chapters (feature 66)', () => {
  it('knows an empty chapter', () => {
    expect(isEmptyChapter(doc(p(''), p(' ')))).toBe(true)
    expect(isEmptyChapter(doc(p('* * *')))).toBe(false)
    expect(isEmptyChapter(doc({ type: 'paragraph', content: [{ type: 'footnote', attrs: { text: 'x' } }] }))).toBe(false)
  })
  it('leaves the chapter out, and a part whose chapters are all left out', () => {
    const data = book()
    const o = exportOutline(data.outline, data.chapters)
    expect(o.map((n) => n.id)).toEqual(['a', 'p1', 'p3'])
    const s = bookSections(data)
    expect(s.filter((x) => x.kind === 'chapter').map((x) => x.id)).toEqual(['a', 'c'])
    expect(s.some((x) => x.id === 'p2')).toBe(false)
    expect(tocEntries(data).map((e) => e.id)).toEqual(['a', 'p1', 'c', 'p3'])
  })
})

describe('scene break image (feature 48)', () => {
  it('shows the image instead of the sign, and the sign without one', () => {
    const data = book()
    const plain = bookSections(data).find((s) => s.id === 'a')!.html
    expect(plain).toContain('<p class="scene">* * *</p>')
    const withImg = bookSections({ ...data, sceneImage: 'scene.png' }).find((s) => s.id === 'a')!.html
    expect(withImg).toContain('<p class="scene scene-img"><img src="scene.png" alt="* * *"/></p>')
    expect(bookCss({ ...data.publish.layout, sceneImageSize: 3 })).toContain('height: 4.5em')
  })
  it('keeps the setting in the book', () => {
    const l = normalizePublish({ layout: { sceneImage: 'מעבר סצנה.png', sceneImageSize: 99 } as never }).layout
    expect(l.sceneImage).toBe('מעבר סצנה.png')
    expect(l.sceneImageSize).toBe(8)
    expect(normalizePublish(undefined).layout.sceneImage).toBe('')
  })
})

describe('manuscript for publishers (feature 45)', () => {
  const items = [
    { kind: 'chapter' as const, title: 'פרק ראשון', doc: doc(p('מילה '.repeat(40).trim()), p('* * *'), p('אחרי', { pstyle: 'quote' }), { type: 'paragraph', content: [{ type: 'text', text: 'עם הערה' }, { type: 'footnote', attrs: { text: 'הערה' } }] }) },
    { kind: 'part' as const, title: 'חלק ב׳' },
    { kind: 'chapter' as const, title: 'פרק שני', doc: doc(p('סוף')) }
  ]
  const opts = { ...DEFAULT_MANUSCRIPT, title: 'הנמל', author: 'שלומי', contact: ['050-0000000'] }

  it('rounds the word count', () => {
    expect(roughWords(87_432)).toBe(87_000)
    expect(roughWords(4_349)).toBe(4_300)
    expect(roughWords(47)).toBe(50)
  })

  it('is double spaced, with page numbers, a header, a cover and # for scene breaks', async () => {
    const zip = await JSZip.loadAsync(await manuscriptToDocx(items, opts))
    const docXml = await zip.file('word/document.xml')!.async('string')
    const styles = await zip.file('word/styles.xml')!.async('string')
    expect(styles).toContain('w:line="480"')
    expect(styles).toContain('w:ascii="David"')
    expect(styles).toContain('<w:sz w:val="24"/>')
    expect(docXml).toContain('<w:titlePg/>')
    expect(docXml).toContain('r:id="rId10"')
    expect(docXml).toContain('>#</w:t>')
    expect(docXml).not.toContain('* * *')
    expect(docXml).toContain('מאת שלומי')
    expect(docXml).toContain('כ־')
    expect(docXml).toContain('050-0000000')
    expect(docXml).toContain('<w:pStyle w:val="Quote"/>')
    expect(await zip.file('word/footer1.xml')!.async('string')).toContain(' PAGE ')
    expect(await zip.file('word/header1.xml')!.async('string')).toContain('שלומי / הנמל')
    expect(zip.file('word/footnotes.xml')).toBeTruthy()
    const ct = await zip.file('[Content_Types].xml')!.async('string')
    expect(ct).toContain('/word/header1.xml')
    expect(ct).toContain('/word/footnotes.xml')
    const rels = await zip.file('word/_rels/document.xml.rels')!.async('string')
    expect(rels).toContain('footer1.xml')
  })

  const hasTools = (() => {
    try {
      execFileSync('soffice', ['--version'], { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  })()
  it.skipIf(!hasTools)('opens in LibreOffice (valid Word file)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kirchia-ms-'))
    const file = join(dir, 'ms.docx')
    writeFileSync(file, await manuscriptToDocx(items, { ...opts, cover: false, header: false }))
    execFileSync('soffice', [`-env:UserInstallation=file://${dir}/lo-profile`, '--headless', '--convert-to', 'txt:Text (encoded):UTF8', '--outdir', dir, file], { stdio: 'ignore', timeout: 90000 })
    const txt = readFileSync(join(dir, 'ms.txt'), 'utf8')
    expect(txt).toContain('פרק שני')
    expect(txt).toContain('#')
  }, 120000)
})
