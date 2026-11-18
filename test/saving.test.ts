import { describe, expect, it } from 'vitest'
import { writeFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'
import JSZip from 'jszip'
import { docToDocx, docxToDoc } from '../src/shared/docx'
import { diffTexts, diffWords } from '../src/shared/diff'
import { cleanDrawerText, drawerWorthy, sceneRange } from '../src/shared/drafts'
import type { PMNode } from '../src/shared/types'

const P = (...content: PMNode[]): PMNode => ({ type: 'paragraph', attrs: { dir: 'rtl', textAlign: null }, content })
const T = (text: string): PMNode => ({ type: 'text', text })
const FN = (text: string): PMNode => ({ type: 'footnote', attrs: { text } })

describe('footnotes in Word files (feature 15)', () => {
  const doc: PMNode = { type: 'doc', content: [P(T('נועה ירדה לנמל'), FN('הנמל של חיפה, 1947.'), T(' בבוקר.')), P(T('שורה שנייה'), FN('הערה בשתי\nשורות'))] }

  it('round trip keeps the notes in place', async () => {
    const bytes = await docToDocx(doc, 'פרק')
    const back = await docxToDoc(bytes)
    expect(back.warnings).toEqual([])
    expect(back.doc).toEqual(doc)
  })

  it('writes real Word footnotes', async () => {
    const zip = await JSZip.loadAsync(await docToDocx(doc, 'פרק'))
    const fx = await zip.file('word/footnotes.xml')!.async('string')
    expect(fx).toContain('w:id="1"')
    expect(fx).toContain('הנמל של חיפה, 1947.')
    expect(await zip.file('word/_rels/document.xml.rels')!.async('string')).toContain('footnotes.xml')
    expect(await zip.file('[Content_Types].xml')!.async('string')).toContain('footnotes+xml')
    expect(await zip.file('word/document.xml')!.async('string')).toContain('<w:footnoteReference w:id="2"/>')
  })

  it('a chapter without notes has no footnotes part', async () => {
    const zip = await JSZip.loadAsync(await docToDocx({ type: 'doc', content: [P(T('א'))] }, 'פרק'))
    expect(zip.file('word/footnotes.xml')).toBeNull()
    expect(await zip.file('word/settings.xml')!.async('string')).not.toContain('footnotePr')
  })

  const hasSoffice = (() => {
    try {
      execFileSync('soffice', ['--version'], { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  })()
  it.skipIf(!hasSoffice)('LibreOffice reads the footnotes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kirchia-fn-'))
    const file = join(dir, 'ch.docx')
    writeFileSync(file, await docToDocx(doc, 'כותרת'))
    // converting back to docx through LibreOffice keeps the footnotes only if it understood them
    execFileSync('soffice', ['--headless', '--convert-to', 'docx:MS Word 2007 XML', '--outdir', join(dir, 'out'), file], { stdio: 'ignore', timeout: 90000 })
    const back = await docxToDoc(new Uint8Array(require('fs').readFileSync(join(dir, 'out', 'ch.docx'))))
    const notes: string[] = []
    const walk = (n: PMNode) => (n.type === 'footnote' ? notes.push(String(n.attrs?.text)) : (n.content ?? []).forEach(walk))
    walk(back.doc)
    expect(notes).toEqual(['הנמל של חיפה, 1947.', 'הערה בשתי\nשורות'])
  }, 120000)
})

describe('comparing texts (features 14, 35)', () => {
  it('marks words inside an edited paragraph', () => {
    const r = diffWords('הים היה שקט באותו בוקר', 'הים היה סוער באותו ערב')
    expect(r.pieces).toEqual([
      { kind: 'same', text: 'הים היה ' },
      { kind: 'removed', text: 'שקט' },
      { kind: 'added', text: 'סוער' },
      { kind: 'same', text: ' באותו ' },
      { kind: 'removed', text: 'בוקר' },
      { kind: 'added', text: 'ערב' }
    ])
    expect(r.added).toBe(2)
    expect(r.removed).toBe(2)
  })

  it('finds added, removed and changed paragraphs', () => {
    const r = diffTexts(['פתיחה', 'הים היה שקט באותו בוקר', 'פסקה שנמחקה לגמרי מכאן', 'סוף'], ['פתיחה', 'הים היה סוער באותו בוקר', 'סוף', 'פסקה חדשה'])
    expect(r.paragraphs.map((p) => p.kind)).toEqual(['same', 'changed', 'removed', 'same', 'added'])
  })

  it('identical texts have no changes', () => {
    const r = diffTexts(['א ב', 'ג'], ['א ב', 'ג'])
    expect(r.added + r.removed).toBe(0)
  })

  it('handles long chapters quickly', () => {
    const a = Array.from({ length: 800 }, (_, i) => `פסקה מספר ${i} עם כמה מילים בתוכה`)
    const b = [...a]
    b[400] = 'פסקה מספר 400 עם מילים אחרות בתוכה'
    const t = Date.now()
    const r = diffTexts(a, b)
    expect(Date.now() - t).toBeLessThan(1000)
    expect(r.paragraphs.filter((p) => p.kind !== 'same')).toHaveLength(1)
  })
})

describe('drawer and alternative drafts (features 27, 35)', () => {
  it('keeps only cut text, or deleted text of a few words', () => {
    expect(drawerWorthy('מילה', 'cut')).toBe(true)
    expect(drawerWorthy('  ', 'cut')).toBe(false)
    expect(drawerWorthy('שתי מילים', 'delete')).toBe(false)
    expect(drawerWorthy('ארבע מילים שלמות כאן', 'delete')).toBe(true)
  })
  it('cleans the preview text', () => {
    expect(cleanDrawerText('  שורה\n\n\nעוד   שורה ')).toBe('שורה\nעוד שורה')
  })
  it('finds the paragraphs of a scene', () => {
    const paras = ['פתיחה', 'עוד', '* * *', 'סצנה שנייה', 'המשך', '* * *', 'שלישית']
    expect(sceneRange(paras, 0)).toEqual({ start: 0, end: 2 })
    expect(sceneRange(paras, 1)).toEqual({ start: 3, end: 5 })
    expect(sceneRange(paras, 2)).toEqual({ start: 6, end: 7 })
    expect(sceneRange(paras, 3)).toBeNull()
  })
})
