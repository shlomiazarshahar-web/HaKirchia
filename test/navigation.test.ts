import { describe, expect, it } from 'vitest'
import { DEFAULT_SEARCH, findInText, snippet, type SearchOptions } from '../src/shared/search'
import { isSceneBreak, scenesOf, firstWords } from '../src/shared/scenes'
import { rankItems } from '../src/shared/quickopen'

const opts = (o: Partial<SearchOptions> = {}): SearchOptions => ({ ...DEFAULT_SEARCH, ...o })
const found = (text: string, q: string, o: Partial<SearchOptions> = {}) => findInText(text, q, opts(o)).map((m) => text.slice(m.start, m.end))

describe('findInText', () => {
  it('finds every occurrence', () => {
    expect(found('דני הלך. דני חזר.', 'דני')).toEqual(['דני', 'דני'])
  })
  it('ignores niqqud in the text and in the query, and returns the text with its niqqud', () => {
    expect(found('שָׁלוֹם לְךָ', 'שלום')).toEqual(['שָׁלוֹם'])
    expect(found('שלום לך', 'שָׁלוֹם')).toEqual(['שלום'])
  })
  it('can respect niqqud', () => {
    expect(found('שָׁלוֹם', 'שלום', { ignoreNiqqud: false })).toEqual([])
  })
  it('whole word: not inside a longer word', () => {
    expect(found('דניאל ודני', 'דני', { wholeWord: true, prefixes: false })).toEqual([])
    expect(found('דניאל דני', 'דני', { wholeWord: true, prefixes: false })).toEqual(['דני'])
  })
  it('whole word with Hebrew prefixes: finds ולדני but replaces only the name', () => {
    const t = 'ולדני, הדני, דניאל, ודני.'
    expect(found(t, 'דני', { wholeWord: true })).toEqual(['דני', 'דני', 'דני'])
    const ms = findInText(t, 'דני', opts({ wholeWord: true }))
    expect(t.slice(0, ms[0].start)).toBe('ול')
  })
  it('ignores case for Latin letters unless asked', () => {
    expect(found('Tel Aviv, tel aviv', 'tel aviv')).toHaveLength(2)
    expect(found('Tel Aviv, tel aviv', 'tel aviv', { matchCase: true })).toHaveLength(1)
  })
  it('treats regex characters as plain text', () => {
    expect(found('a.b axb (c)', 'a.b')).toEqual(['a.b'])
    expect(found('a.b axb (c)', '(c)')).toEqual(['(c)'])
  })
  it('an empty query finds nothing', () => {
    expect(found('abc', '  ')).toEqual([])
  })
  it('makes a short snippet around a match', () => {
    const t = 'אחת שתיים שלוש ארבע חמש שש שבע שמונה תשע עשר אחת עשרה שתים עשרה'
    const m = findInText(t, 'שמונה', opts())[0]
    const s = snippet(t, m, 12)
    expect(s.match).toBe('שמונה')
    expect(s.before.startsWith('…')).toBe(true)
  })
})

describe('scenes', () => {
  it('recognizes break signs', () => {
    for (const t of ['* * *', '***', ' *  *  * ', '⁂', '#', '• • •']) expect(isSceneBreak(t)).toBe(true)
    for (const t of ['*', '**', 'דני * * *', '', '#1']) expect(isSceneBreak(t)).toBe(false)
  })
  it('splits a chapter into scenes', () => {
    const s = scenesOf(['פתיחה של הפרק', 'עוד', '* * *', '', 'סצנה שנייה מתחילה כאן', '***', 'שלישית'])
    expect(s.map((x) => x.block)).toEqual([0, 3, 6])
    expect(s[1].label).toBe('סצנה שנייה מתחילה כאן')
  })
  it('does not make empty scenes', () => {
    expect(scenesOf(['* * *', 'א', '* * *', '* * *', 'ב', '* * *']).map((x) => x.block)).toEqual([1, 4])
    expect(scenesOf([])).toEqual([])
  })
  it('shortens labels', () => {
    expect(firstWords('אחת שתיים שלוש ארבע חמש שש שבע')).toBe('אחת שתיים שלוש ארבע חמש שש…')
  })
})

describe('quick jump', () => {
  const items = [
    { id: '1', label: 'מכתבים מחיפה', extra: 'פרק 1' },
    { id: '2', label: 'הנמל', extra: 'פרק 2' },
    { id: '3', label: 'חיפה בלילה', extra: 'פרק 3' }
  ]
  it('ranks a match at the start above a match inside', () => {
    expect(rankItems(items, 'חיפה').map((i) => i.id)).toEqual(['3', '1'])
  })
  it('matches by chapter number', () => {
    expect(rankItems(items, 'פרק 2').map((i) => i.id)[0]).toBe('2')
  })
  it('matches letters in order and ignores niqqud', () => {
    expect(rankItems(items, 'מכחי').map((i) => i.id)).toEqual(['1'])
    expect(rankItems(items, 'הַנָּמָל').map((i) => i.id)).toEqual(['2'])
  })
  it('shows everything for an empty query', () => {
    expect(rankItems(items, '')).toHaveLength(3)
  })
})
