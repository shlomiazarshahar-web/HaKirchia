import { describe, expect, it } from 'vitest'
import { buildMemory, findInMemory, findPhrase, longestRun, tmWords, type TmPair } from '../src/shared/trmemory'

const pairs: TmPair[] = [
  { chapterId: 'a', k: 1, source: 'The Avatar is the bridge between the spirit world and ours.', target: 'האווטאר הוא הגשר בין עולם הרוחות לעולמנו.' },
  { chapterId: 'a', k: 2, source: '“Yes, Master Jianzhu.”', target: '"כן, המורה ג\'יאנג׳ו."' },
  { chapterId: 'a', k: 3, source: 'She ran.', target: '' },
  { chapterId: 'b', k: 1, source: 'Nobody believed that the bridge between the spirit world could fall.', target: 'איש לא האמין שהגשר אל עולם הרוחות יכול ליפול.' },
  { chapterId: 'b', k: 2, source: 'Yes, master Jianzhu!', target: '"כן, המורה ג\'יאנג׳ו."' }
]

describe('translation memory (feature 46)', () => {
  it('folds words', () => {
    expect(tmWords('Don’t STOP, now').map((t) => t.w)).toEqual(["don't", 'stop', 'now'])
  })

  it('finds the longest shared run of words', () => {
    expect(longestRun(['a', 'b', 'c', 'd'], ['x', 'b', 'c', 'd', 'y'])).toEqual({ i: 1, j: 1, n: 3 })
  })

  it('offers a whole repeated line first, once per translation', () => {
    const idx = buildMemory(pairs)
    const m = findInMemory(idx, 'Yes, Master Jianzhu.')
    expect(m).toHaveLength(1)
    expect(m[0].whole).toBe(true)
    expect(m[0].pair.target).toContain('כן')
  })

  it('offers a shared phrase of five words or more, with where it is', () => {
    const idx = buildMemory(pairs)
    const m = findInMemory(idx, 'He crossed the bridge between the spirit world at dawn.')
    expect(m.map((x) => x.pair.chapterId)).toEqual(['a', 'b'])
    expect(m[0].phrase).toBe('the bridge between the spirit world')
    expect(pairs[0].source.slice(m[0].from, m[0].to)).toBe(m[0].phrase)
    expect(m[0].words).toBe(6)
  })

  it('ignores short phrases, untranslated pairs and the paragraph itself', () => {
    const idx = buildMemory(pairs)
    expect(findInMemory(idx, 'the spirit world')).toEqual([])
    expect(findInMemory(idx, 'She ran.')).toEqual([])
    expect(findInMemory(idx, pairs[0].source, { skip: (p) => p.chapterId === 'a' && p.k === 1 }).map((x) => x.pair.chapterId)).toEqual(['b'])
  })

  it('finds a marked phrase of any length', () => {
    const idx = buildMemory(pairs)
    const m = findPhrase(idx, 'spirit world')
    expect(m).toHaveLength(2)
    expect(m[1].phrase).toBe('spirit world')
    expect(findPhrase(idx, 'jianzhu')).toHaveLength(1)
  })
})
