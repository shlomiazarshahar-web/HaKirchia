import { describe, expect, it } from 'vitest'
import { backgroundText, costOf, estimateReview, findQuote, findingsSoFar, findingThreadMessages, historyText, HISTORY_ASK, newId, normalizeAi, parseReply, parseReview, partialReply, relevantReviews, REVIEW_SCHEMA, reviewAsText, reviewMessage, splitPrompts, textBlock, titleFromPrompt, DEFAULT_KINDS, MODELS, type Finding, type Review } from '../src/shared/review'

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
    // round 17: cache reads are 5% on Opus 5.5 (2.5% on Fable 5.2); writes 1.25x for 5 minutes, 2x for an hour
    expect(costOf('claude-opus-5-5', 0, 1_000_000, 1_000_000)).toBeCloseTo(20.2)
    expect(costOf('claude-fable-5-2', 0, 0, 1_000_000)).toBeCloseTo(0.2)
    expect(costOf('claude-opus-5-5', 0, 0, 0, 1_000_000, 1_000_000)).toBeCloseTo(5 + 8)
  })
  it('estimates a review honestly (most of it is what Claude writes)', () => {
    // a chapter of about 25,000 characters at "יסודי" on Opus: about 60-70 cents, like real reviews
    const high = estimateReview('claude-opus-5-5', 'high', 25000)
    expect(high).toBeGreaterThan(0.55)
    expect(high).toBeLessThan(0.75)
    expect(estimateReview('claude-opus-5-5', 'medium', 25000)).toBeLessThan(high * 0.7)
    expect(estimateReview('claude-sonnet-5-5', 'high', 25000)).toBeCloseTo(high / 2)
    // a short excerpt gets a short answer
    expect(estimateReview('claude-opus-5-5', 'high', 500)).toBeLessThan(0.2)
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

describe('earlier reviews and conversations about comments', () => {
  const mk = (over: Partial<Review>): Review => ({ id: newId(), at: 1, scope: 'chapter', title: 'פרק', kinds: [], model: 'claude-opus-5-5', summary: '', findings: [], chat: [], usage: { input: 0, output: 0, cost: 0 }, ...over })
  const f = (over: Partial<Finding>): Finding => ({ id: newId(), kind: 'סגנון והרגלים', quote: '', comment: 'הערה', status: 'open', ...over })
  const a = mk({ at: 10, targetId: 'c1', summary: 'פרק טוב', findings: [f({ quote: 'היא הסמיקה', comment: 'תגובת גוף גנרית', status: 'dismissed', decision: 'משאיר, ההסמקה מכוונת', thread: [{ role: 'user', text: 'זה מכוון' }, { role: 'assistant', text: 'מקבל' }] })] })
  const b = mk({ at: 20, targetId: 'c2', summary: 'פרק אחר' })
  const book = mk({ at: 30, scope: 'book', title: 'כל הספר', findings: [f({ chapterId: 'c1', comment: 'על פרק 1' }), f({ chapterId: 'c2', comment: 'על פרק 2' })] })
  const list = [book, b, a]

  it('picks the same chapter and whole-book reviews that talk about it, newest first', () => {
    expect(relevantReviews(list, { scope: 'chapter', targetId: 'c1' }).map((r) => r.at)).toEqual([30, 10])
    expect(relevantReviews(list, { scope: 'book' }).length).toBe(3)
    expect(relevantReviews(list, { scope: 'chapter', targetId: 'c1' }, 30).map((r) => r.at)).toEqual([10])
  })

  it('writes statuses, decisions and the talk, and leaves out other chapters of a whole-book review', () => {
    const t = historyText(relevantReviews(list, { scope: 'chapter', targetId: 'c1' }), { scope: 'chapter', targetId: 'c1' })
    expect(t).toContain('מצב: לא רלוונטי')
    expect(t).toContain('הוחלט: משאיר, ההסמקה מכוונת')
    // round 17: what was decided stands for the talk about it
    expect(t).not.toContain('הכותב: זה מכוון')
    expect(historyText([mk({ findings: [f({ thread: [{ role: 'user', text: 'למה?' }] })] })], { scope: 'chapter' })).toContain('הכותב: למה?')
    expect(t).toContain('על פרק 1')
    expect(t).not.toContain('על פרק 2')
    expect(t.indexOf('כל הספר')).toBeLessThan(t.indexOf('פרק טוב'))
  })

  it('drops the oldest reviews when there is too much', () => {
    const t = historyText([book, a], { scope: 'book' }, () => undefined, 200)
    expect(t).toContain('על פרק 1')
    expect(t).not.toContain('פרק טוב')
  })

  it('sends the history before the text, and asks to respect decisions', () => {
    const m = reviewMessage({ scope: 'chapter', texts: [{ title: 'א', paras: ['טקסט'] }], kinds: [], history: 'היסטוריה' })
    expect(m.context.indexOf('<ביקורות_קודמות>')).toBeLessThan(m.context.indexOf('טקסט'))
    expect(m.ask).toContain(HISTORY_ASK)
    expect(reviewMessage({ scope: 'chapter', texts: [{ title: 'א', paras: ['טקסט'] }], kinds: [] }).ask).not.toContain(HISTORY_ASK)
  })

  it('puts the comment in the first reply and the instructions in the last', () => {
    const msgs = findingThreadMessages(f({ quote: 'ציטוט', comment: 'הבעיה' }), [{ role: 'user', text: 'ראשון' }, { role: 'assistant', text: 'תשובה' }], 'שני')
    expect(msgs.map((x) => x.role)).toEqual(['user', 'assistant', 'user'])
    expect(msgs[0].text).toContain('"ציטוט": הבעיה')
    expect(msgs[0].text).toContain('ראשון')
    expect(msgs[2].text.startsWith('שני')).toBe(true)
    expect(msgs[2].text).toContain('decision')
  })

  it('reads the answer, also while it is being written', () => {
    expect(parseReply('{"reply":"נכון","decision":"משאיר"}')).toEqual({ reply: 'נכון', decision: 'משאיר' })
    expect(parseReply('סתם טקסט')).toEqual({ reply: 'סתם טקסט', decision: '' })
    expect(partialReply('{"reply":"שורה\\nשנייה עם \\"מירכאות')).toBe('שורה\nשנייה עם "מירכאות')
    expect(partialReply('{"reply":"חצי\\')).toBe('חצי')
    expect(partialReply('{"rep')).toBe('')
  })
})
