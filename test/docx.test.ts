import { describe, expect, it } from 'vitest'
import { writeFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'
import { docToDocx, docxToDoc, isOurFile, countWords, guessDir, isIndented } from '../src/shared/docx'
import type { PMNode } from '../src/shared/types'

const sample: PMNode = {
  type: 'doc',
  content: [
    { type: 'paragraph', attrs: { dir: 'rtl', textAlign: null }, content: [
      { type: 'text', text: 'מרים קראה ' },
      { type: 'text', text: 'בקול', marks: [{ type: 'bold' }] },
      { type: 'text', text: ', ו', marks: [{ type: 'italic' }, { type: 'underline' }] },
      { type: 'text', text: 'Hello' },
      { type: 'hardBreak' },
      { type: 'text', text: 'שורה\tשנייה & <סימנים>', marks: [{ type: 'textStyle', attrs: { fontFamily: 'David Libre', fontSize: '16pt' } }] }
    ] },
    { type: 'heading', attrs: { level: 2, dir: 'rtl', textAlign: 'center' }, content: [{ type: 'text', text: 'כותרת' }] },
    { type: 'paragraph', attrs: { dir: 'ltr', textAlign: 'justify' }, content: [{ type: 'text', text: 'An English paragraph.' }] },
    { type: 'paragraph', attrs: { dir: 'rtl', textAlign: 'left' }, content: [{ type: 'text', text: 'לשמאל' }] },
    { type: 'paragraph', attrs: { dir: 'rtl', textAlign: null } }
  ]
}

describe('docx round trip', () => {
  it('keeps text, formatting, title and direction', async () => {
    const bytes = await docToDocx(sample, 'פרק 3: מכתבים מחיפה')
    const back = await docxToDoc(bytes)
    expect(back.title).toBe('פרק 3: מכתבים מחיפה')
    expect(back.warnings).toEqual([])
    expect(back.doc).toEqual(sample)
    expect(await isOurFile(bytes)).toBe(true)
  })

  // Needs python-docx and LibreOffice (present on the Linux CI machine)
  const hasTools = (() => {
    try {
      execFileSync('python3', ['-c', 'import docx'], { stdio: 'ignore' })
      execFileSync('soffice', ['--version'], { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  })()
  it.skipIf(!hasTools)('opens in python-docx and LibreOffice (valid Word file)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kirchia-'))
    const file = join(dir, 'ch.docx')
    writeFileSync(file, await docToDocx(sample, 'כותרת הפרק'))
    const out = execFileSync('python3', ['-c', `
import docx,sys
d=docx.Document(sys.argv[1])
print(d.paragraphs[0].style.name)
print(d.paragraphs[1].text)
`, file]).toString()
    expect(out).toContain('Heading 1')
    expect(out).toContain('מרים קראה בקול')
    execFileSync('soffice', [`-env:UserInstallation=file://${dir}/lo-profile`, '--headless', '--convert-to', 'txt:Text', '--outdir', dir, file], { stdio: 'ignore', timeout: 90000 })
  }, 120000)
})

describe('reading Word files we did not write', () => {
  it('handles localized heading styles, inherited bidi and reports images', async () => {
    const JSZip = (await import('jszip')).default
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    const zip = new JSZip()
    zip.file('word/styles.xml', `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="a"><w:name w:val="Normal"/><w:pPr><w:bidi/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/><w:basedOn w:val="a"/></w:style><w:style w:type="paragraph" w:styleId="2"><w:name w:val="heading 2"/><w:basedOn w:val="a"/></w:style></w:styles>`)
    zip.file('word/document.xml', `<w:document xmlns:w="${W}"><w:body>
      <w:p><w:pPr><w:pStyle w:val="1"/></w:pPr><w:r><w:t>הפתיחה</w:t></w:r></w:p>
      <w:p><w:r><w:rPr><w:bCs/></w:rPr><w:t>מודגש</w:t></w:r><w:r><w:t xml:space="preserve"> רגיל</w:t></w:r><w:r><w:drawing/></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="2"/><w:jc w:val="right"/></w:pPr><w:hyperlink><w:r><w:t>קישור</w:t></w:r></w:hyperlink></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>תא</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    </w:body></w:document>`)
    const res = await docxToDoc(await zip.generateAsync({ type: 'uint8array' }))
    expect(res.title).toBe('הפתיחה')
    expect(res.warnings.sort()).toEqual(['טבלה', 'תמונה או אובייקט'].sort())
    expect(res.doc.content![0]).toEqual({ type: 'paragraph', attrs: { dir: 'rtl', textAlign: null }, content: [
      { type: 'text', text: 'מודגש', marks: [{ type: 'bold' }] }, { type: 'text', text: ' רגיל' }] })
    expect(res.doc.content![1]).toMatchObject({ type: 'heading', attrs: { level: 2, dir: 'rtl', textAlign: 'left' } })
    expect(res.doc.content![2].content![0].text).toBe('תא')
    expect(await isOurFile(await zip.generateAsync({ type: 'uint8array' }))).toBe(false)
  })
})

describe('book-style first-line indent', () => {
  const p = (text: string, textAlign: string | null = null): PMNode => ({
    type: 'paragraph',
    attrs: { dir: 'rtl', textAlign },
    content: text ? [{ type: 'text', text }] : undefined
  })
  const h: PMNode = { type: 'heading', attrs: { level: 2, dir: 'rtl', textAlign: null }, content: [{ type: 'text', text: 'כותרת' }] }
  const doc: PMNode = { type: 'doc', content: [p('ראשונה'), p('שנייה'), h, p('אחרי כותרת'), p('מוזחת'), p(''), p('אחרי שורה ריקה'), p('* * *', 'center'), p('אחרי מרכוז'), p('מוזחת שוב')] }
  const expected = [false, true, false, false, true, true, false, false, false, true]

  it('indents a paragraph only when it follows another body paragraph', () => {
    const got = doc.content!.map((n, i) => isIndented(n, doc.content![i - 1]))
    expect(got).toEqual(expected)
  })

  it('writes the indent into the Word file and reads it back unchanged', async () => {
    const JSZip = (await import('jszip')).default
    const bytes = await docToDocx(doc, 'פרק')
    const zip = await JSZip.loadAsync(bytes)
    const styles = await zip.file('word/styles.xml')!.async('string')
    expect(styles).toMatch(/w:styleId="Normal">.*?<w:ind w:firstLine="420"\/>/)
    expect(styles).toMatch(/w:styleId="FirstParagraph">.*?<w:ind w:firstLine="0"\/>/)
    const xml = await zip.file('word/document.xml')!.async('string')
    const paras = xml.split('<w:p>').slice(2) // skip the text before the first paragraph and the chapter title
    const flush = paras.map((x) => x.includes('<w:pStyle w:val="FirstParagraph"/>'))
    const isPara = doc.content!.map((n) => n.type === 'paragraph')
    expect(flush).toEqual(expected.map((ind, i) => isPara[i] && !ind))
    expect((await docxToDoc(bytes)).doc).toEqual(doc)
  })
})

describe('helpers', () => {
  it('counts Hebrew words and guesses direction', () => {
    expect(countWords('שלום לך, עולם — 3 פעמים')).toBe(5)
    expect(guessDir('  "Hello" שלום')).toBe('ltr')
    expect(guessDir('123 שלום')).toBe('rtl')
  })
})
