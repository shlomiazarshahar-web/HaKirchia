import { describe, expect, it } from 'vitest'
import { locateStop, stopWhen } from '../src/shared/stoppoint'

// "abc def" in one paragraph starting at position 1, "ghi abc" in another starting at 10
const pieces = [
  { text: 'abc def', pos: 1 },
  { text: '\u0000', pos: 0 },
  { text: 'ghi abc', pos: 10 }
]

describe('locateStop', () => {
  it('finds the spot by the text around it', () => {
    // cursor between "abc " and "def"
    expect(locateStop(pieces, { pos: 5, before: 'abc ', after: 'def' }, 20)).toBe(5)
  })
  it('follows the text when the chapter changed before it', () => {
    const moved = [{ text: 'NEW TEXT abc def', pos: 1 }]
    expect(locateStop(moved, { pos: 5, before: 'abc ', after: 'def' }, 30)).toBe(14)
  })
  it('takes the nearest match to the old position', () => {
    expect(locateStop(pieces, { pos: 17, before: 'abc', after: '' }, 20)).toBe(17)
    expect(locateStop(pieces, { pos: 3, before: 'abc', after: '' }, 20)).toBe(4)
  })
  it('falls back to the old position, kept inside the chapter', () => {
    expect(locateStop(pieces, { pos: 8, before: 'zzz', after: 'yyy' }, 20)).toBe(8)
    expect(locateStop(pieces, { pos: 99, before: '', after: '' }, 20)).toBe(20)
  })
  it('works at the very start of a paragraph', () => {
    expect(locateStop(pieces, { pos: 10, before: '', after: 'ghi abc' }, 20)).toBe(10)
  })
})

describe('stopWhen', () => {
  it('says today / yesterday / a date', () => {
    const now = new Date(2026, 10, 15, 22, 0).getTime()
    expect(stopWhen(new Date(2026, 10, 15, 21, 5).getTime(), now)).toBe('היום ב־21:05')
    expect(stopWhen(new Date(2026, 10, 14, 9, 0).getTime(), now)).toBe('אתמול ב־09:00')
    expect(stopWhen(new Date(2026, 9, 1).getTime(), now)).toBe('1.10.2026')
  })
})
