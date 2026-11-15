import { describe, expect, it } from 'vitest'
import { DEFAULT_TYPOGRAPHY, doubleQuoteFor, singleQuoteFor, splitByDirection, stripNiqqud } from '../src/shared/hebrew'
import { docToDocx, docxToDoc } from '../src/shared/docx'
import JSZip from 'jszip'

const T = DEFAULT_TYPOGRAPHY

describe('splitByDirection', () => {
  it('keeps plain Hebrew as one piece', () => {
    expect(splitByDirection('שלום עולם, מה נשמע?', true)).toEqual([{ text: 'שלום עולם, מה נשמע?', rtl: true }])
  })
  it('gives an English phrase inside Hebrew its own piece, spaces around it stay Hebrew', () => {
    expect(splitByDirection('הוא קרא את New York Times אתמול.', true)).toEqual([
      { text: 'הוא קרא את ', rtl: true },
      { text: 'New York Times', rtl: false },
      { text: ' אתמול.', rtl: true }
    ])
  })
  it('handles Hebrew inside an English paragraph', () => {
    expect(splitByDirection('The word שָׁלוֹם means peace', false)).toEqual([
      { text: 'The word ', rtl: false },
      { text: 'שָׁלוֹם', rtl: true },
      { text: ' means peace', rtl: false }
    ])
  })
  it('numbers alone stay with the paragraph', () => {
    expect(splitByDirection('בשנת 1948 קמה', true)).toEqual([{ text: 'בשנת 1948 קמה', rtl: true }])
  })
})

describe('niqqud', () => {
  it('strips niqqud but keeps maqaf and gershayim', () => {
    expect(stripNiqqud('בְּרֵאשִׁית בֵּית־סֵפֶר צה״ל')).toBe('בראשית בית־ספר צה״ל')
  })
})

describe('Hebrew quotes', () => {
  it('opens and closes book-style quotes', () => {
    expect(doubleQuoteFor('הוא אמר ', true, T)).toBe('”')
    expect(doubleQuoteFor('הוא אמר ”שלום', true, T)).toBe('”')
  })
  it('academy style opens low', () => {
    expect(doubleQuoteFor('', true, { ...T, quotes: 'academy' })).toBe('„')
    expect(doubleQuoteFor('„שלום', true, { ...T, quotes: 'academy' })).toBe('”')
  })
  it('a " inside a Hebrew word is gershayim', () => {
    expect(doubleQuoteFor('שירתתי בצה', true, T)).toBe('״')
    expect(doubleQuoteFor('שנת תשפ', true, T)).toBe('״')
  })
  it('English paragraphs get English quotes', () => {
    expect(doubleQuoteFor('He said ', false, T)).toBe('“')
    expect(doubleQuoteFor('He said “hi', false, T)).toBe('”')
  })
  it('off leaves the quote alone', () => {
    expect(doubleQuoteFor('אמר ', true, { ...T, quotes: 'off', geresh: false })).toBeNull()
  })
  it('geresh after a Hebrew letter, apostrophe after English', () => {
    expect(singleQuoteFor('ג', T)).toBe('׳')
    expect(singleQuoteFor('don', T)).toBe('’')
    expect(singleQuoteFor('אמר ', T)).toBeNull()
  })
})

describe('mixed text in Word files', () => {
  it('writes a run per direction and reads back one text', async () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { dir: 'rtl', textAlign: null }, content: [{ type: 'text', text: 'קראתי את Harry Potter בלילה' }] }]
    }
    const bytes = await docToDocx(doc, 'פרק')
    const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string')
    expect(xml).toContain('<w:r><w:t xml:space="preserve">Harry Potter</w:t></w:r>')
    expect(xml).toContain('<w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">קראתי את </w:t>')
    expect((await docxToDoc(bytes)).doc).toEqual(doc)
  })
})
