import { describe, expect, it } from 'vitest'
import { backgroundText, costOf, findQuote, findingsSoFar, normalizeAi, parseReview, REVIEW_SCHEMA, reviewAsText, reviewMessage, splitPrompts, textBlock, titleFromPrompt, DEFAULT_KINDS, MODELS } from '../src/shared/review'

describe('findQuote', () => {
  const paras = ['היא חיככה את ידיה זו בזו כשחשבה על הספה.', 'ה"מחר" של יובל: "היא תתחיל לרוץ מחר".', 'שָׁלוֹם   עולם, אמר הדוד.']
  it('finds an exact quote', () => {
    const h = findQuote(paras, 'חיככה את ידיה')!
    expect(h.para).toBe(0)
    expect(paras[0].slice(h.start, h.end)).toBe('חיככה את ידיה')
  })
  it('ignores niqqud, extra spaces and quote styles', () => {
    const h = findQuote(paras, 'שלום עולם')!
    expect(h.para).toBe(2)
    expect(paras[2].slice(h.start, h.end)).toBe('שָׁלוֹם   עולם')
    expect(findQuote(paras, 'ה״מחר״ של יובל')?.para).toBe(1)
  })
  it('strips surrounding quote marks and finds a piece of a shortened quote', () => {
    expect(findQuote(paras, '"כשחשבה על הספה"')?.para).toBe(0)
    expect(findQuote(paras, 'היא חיככה את ידיה… כשחשבה על הספה')?.para).toBe(0)
  })
  it('falls back to the first words when the end differs', () => {
    expect(findQuote(paras, 'היא חיככה את ידיה זו בזו כשחשבה על הכורסה')?.para).toBe(0)
  })
  it('returns null when it is not there', () => {
    expect(findQuote(paras, 'משהו שלא כתוב בכלל בשום מקום')).toBeNull()
  })
})

describe('parseReview', () => {
  const texts = [
    { id: 'a', title: 'פרק 1', paras: ['הגשם ירד על התחנה.'] },
    { id: 'b', title: 'פרק 2', paras: ['הדוד קרץ לה בנבזות.'] }
  ]
  it('turns the JSON answer into findings with chapter ids', () => {
    const json = JSON.stringify({
      summary: 'טוב מאוד',
      findings: [
        { kind: 'מה עובד', quote: 'קרץ לה בנבזות', chapter: '2', comment: 'פרט מצוין', suggestion: '' },
        { kind: 'הגהה', quote: 'הגשם ירד', chapter: '2', comment: 'הפרק שגוי, הציטוט בפרק 1', suggestion: 'יורד' },
        { kind: 'כללי', quote: '', chapter: '', comment: '' }
      ],
      lessons: 'מוטיבים חוזרים',
      next: 'לכתוב עוד סצנה'
    })
    const r = parseReview(json, texts)
    expect(r.summary).toBe('טוב מאוד')
    expect(r.findings).toHaveLength(2)
    expect(r.findings[0]).toMatchObject({ chapterId: 'b', status: 'open', kind: 'מה עובד' })
    expect(r.findings[0].suggestion).toBeUndefined()
    expect(r.findings[1]).toMatchObject({ chapterId: 'a', suggestion: 'יורד' })
    expect(r.lessons).toBe('מוטיבים חוזרים')
    expect(r.next).toBe('לכתוב עוד סצנה')
  })
  it('keeps a non-JSON answer as the summary', () => {
    expect(parseReview('סתם טקסט', texts)).toMatchObject({ summary: 'סתם טקסט', findings: [] })
  })
  it('one text: every finding belongs to it', () => {
    const r = parseReview(JSON.stringify({ summary: '', findings: [{ kind: 'x', quote: 'q', chapter: '', comment: 'c' }] }), [texts[0]])
    expect(r.findings[0].chapterId).toBe('a')
  })
})

describe('prompts', () => {
  it('builds the context and the ask', () => {
    const { context, ask } = reviewMessage({
      scope: 'chapter',
      texts: [{ id: 'a', title: 'פרק <1>', paras: ['שורה'], source: ['line'] }],
      kinds: [{ name: 'עלילה', prompt: 'מבנה' }],
      question: 'האם הסוף עובד?',
      background: '[דמות] נועה',
      bookTitle: 'ספר'
    })
    expect(context).toContain('<חומרי_רקע>')
    expect(context).toContain('<מקור>\nline\n</מקור>')
    expect(context).toContain('פרק ‹1›')
    expect(ask).toContain('- עלילה: מבנה')
    expect(ask).toContain('האם הסוף עובד?')
  })
  it('numbers chapters when there are several', () => {
    expect(
      textBlock([
        { title: 'א', paras: ['1'] },
        { title: 'ב', paras: ['2'] }
      ])
    ).toContain('<פרק מספר="2" כותרת="ב">')
  })
  it('the schema asks for every field (structured outputs need all required)', () => {
    expect(REVIEW_SCHEMA.required).toEqual(['summary', 'findings', 'lessons', 'next'])
    expect(Object.keys(REVIEW_SCHEMA.properties.findings.items.properties).sort()).toEqual([...REVIEW_SCHEMA.properties.findings.items.required].sort())
  })
  it('review as text for follow-up questions', () => {
    const t = reviewAsText({ summary: 'ס', findings: [{ id: '1', kind: 'הגהה', quote: 'ש', comment: 'ת', suggestion: 'ה', status: 'open' }], next: 'הבא' })
    expect(t).toContain('"ש": ת ← ה')
    expect(t).toContain('מה הייתי עושה עכשיו: הבא')
  })
  it('counts findings while the answer streams', () => {
    expect(findingsSoFar('{"summary":"x","findings":[{"kind":"a","comment":"b"},{"kind":"c","comment":"')).toBe(2)
  })
})

describe('settings and helpers', () => {
  it('never offers Haiku', () => {
    expect(MODELS.some((m) => m.id.includes('haiku'))).toBe(false)
  })
  it('normalizes saved settings', () => {
    expect(normalizeAi({ model: 'claude-haiku-5-5' as never }).model).toBe('claude-opus-5-5')
    expect(normalizeAi(undefined).kinds).toEqual(DEFAULT_KINDS)
    expect(normalizeAi({ kinds: [{ id: '', name: ' ', prompt: '' }, { id: 'x', name: 'שלי', prompt: 'p', on: true }] }).kinds).toEqual([{ id: 'x', name: 'שלי', prompt: 'p', on: true }])
  })
  it('estimates cost', () => {
    expect(costOf('claude-opus-5-5', 1_000_000, 0)).toBeCloseTo(4)
    expect(costOf('claude-opus-5-5', 0, 1_000_000, 1_000_000)).toBeCloseTo(20.4)
  })
  it('splits pasted prompts', () => {
    expect(splitPrompts('1. לכתוב על גשם\n2) דיאלוג בלי תגיות\n\nתיאור מקום\nבלי שמות תואר')).toEqual(['לכתוב על גשם', 'דיאלוג בלי תגיות', 'תיאור מקום בלי שמות תואר'])
  })
  it('titles from prompts', () => {
    expect(titleFromPrompt('כתבו סצנה שבה שתי דמויות מתווכחות על ירושה.')).toBe('כתבו סצנה שבה שתי דמויות מתווכחות')
  })
  it('background text', () => {
    const t = backgroundText([{ kind: 'character', name: 'נועה', aliases: ['נוני'], tags: [], fields: [{ label: 'גיל', value: '30' }], notes: 'גרה בחיפה' }], [{ term: 'אוואטר', original: 'Avatar', variants: ['אווטר'], note: '' }])
    expect(t).toContain('[דמות] נועה (גם: נוני)')
    expect(t).toContain('גיל: 30')
    expect(t).toContain('- אוואטר (במקור: Avatar); כתיב שגוי: אווטר')
  })
})
