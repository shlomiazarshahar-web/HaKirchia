import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { appearanceLevel, gapAt, lineGaps, moveItem, nextLineColor, niceMax, normalizeOverview, paceStats, setupState, sortSetups, titleFromQuote, type Setup } from '../src/shared/overview'

vi.mock('electron', () => ({ shell: { trashItem: async () => undefined } }))
const project = await import('../src/main/project')

async function bookWith(n: number) {
  const root = mkdtempSync(join(tmpdir(), 'hk15-'))
  let book = await project.createBook(root, 'ספר')
  for (let i = 2; i <= n; i++) book = (await project.addChapter(book.path, `פרק ${i}`)).book
  return book
}

describe('plot lines (62)', () => {
  it('normalizes lines and drops notes of missing lines/chapters', () => {
    const o = normalizeOverview(
      {
        plotLines: [{ id: 'a', name: 'נועה', color: 'blue' }, { id: 'a', name: 'dup' }, { id: 'b', name: 'הנמל', color: 'nope', materialId: 'm1' }, 5],
        plotNotes: { a: { c1: 'פוגשת', c2: '  ', zz: 'x' }, gone: { c1: 'x' } }
      },
      ['c1', 'c2']
    )
    expect(o.plotLines).toEqual([
      { id: 'a', name: 'נועה', color: 'blue' },
      { id: 'b', name: 'הנמל', color: 'gray', materialId: 'm1' }
    ])
    expect(o.plotNotes).toEqual({ a: { c1: 'פוגשת' } })
    expect(o.setups).toEqual([])
  })

  it('finds a line that disappears for many chapters, not before it starts or after it ends', () => {
    expect(lineGaps([false, true, false, false, false, true, false, false, false, false])).toEqual([{ from: 2, to: 4 }])
    expect(lineGaps([true, false, false, true])).toEqual([])
    expect(lineGaps([true, false, false, true], 2)).toEqual([{ from: 1, to: 2 }])
    const at = gapAt([{ from: 1, to: 2 }], 4)
    expect(at.map((g) => !!g)).toEqual([false, true, true, false])
  })

  it('moves rows and picks unused colors', () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1])
    expect(moveItem([1, 2, 3], 0, 5)).toEqual([1, 2, 3])
    expect(nextLineColor([{ id: 'a', name: '', color: 'red' }])).toBe('orange')
  })

  it('saves lines, notes and setups in the book file; a removed line takes its notes', async () => {
    let book = await bookWith(3)
    const [c1, c2, c3] = book.chapters.map((c) => c.id)
    book = await project.setPlan(book.path, {
      plotLines: [
        { id: 'l1', name: 'אהבה', color: 'red' },
        { id: 'l2', name: 'מלחמה', color: 'blue' }
      ],
      plotNotes: { l1: { [c1]: 'נפגשים' }, l2: { [c3]: 'יריות' } }
    })
    expect(book.plotLines.map((l) => l.name)).toEqual(['אהבה', 'מלחמה'])
    expect(book.plotNotes).toEqual({ l1: { [c1]: 'נפגשים' }, l2: { [c3]: 'יריות' } })
    book = await project.setPlan(book.path, { plotLines: [{ id: 'l2', name: 'מלחמה', color: 'blue' }] })
    expect(book.plotNotes).toEqual({ l2: { [c3]: 'יריות' } })

    book = await project.setPlan(book.path, { setups: [{ id: 's1', title: 'האקדח', note: '', at: 1, plant: { chapterId: c1, pos: 5, before: 'a', after: 'b', quote: 'אקדח על הקיר' }, payoff: { chapterId: c2 } }] })
    expect(book.setups[0].plant?.quote).toBe('אקדח על הקיר')
    // a deleted chapter: the setup stays, without that end; its notes disappear
    await project.deleteChapter(book.path, c2)
    const fresh = await project.openBook(book.path)
    expect(fresh.setups[0].payoff).toBeUndefined()
    expect(fresh.setups[0].plant?.chapterId).toBe(c1)
  })
})

describe('appearances (63) and pace (64)', () => {
  it('shades by count', () => {
    expect([0, 1, 2, 4, 5, 14, 15, 99].map(appearanceLevel)).toEqual([0, 1, 2, 2, 3, 3, 4, 4])
  })
  it('pace statistics skip empty chapters', () => {
    const s = paceStats(['a', 'b', 'c', 'd'], { a: 1000, b: 3000, c: 0 })
    expect(s).toEqual({ total: 4000, average: 2000, longest: { id: 'b', words: 3000 }, shortest: { id: 'a', words: 1000 } })
    expect(paceStats([], {})).toEqual({ total: 0, average: 0, longest: undefined, shortest: undefined })
    expect(niceMax(3400)).toBe(4000)
    expect(niceMax(0)).toBe(1000)
    expect(niceMax(980)).toBe(1000)
  })
})

describe('setups & payoffs (65)', () => {
  const order = new Map([
    ['c1', 0],
    ['c2', 1],
    ['c3', 2]
  ])
  const s = (id: string, plant?: string, payoff?: string): Setup => ({ id, title: id, note: '', at: 0, ...(plant ? { plant: { chapterId: plant } } : {}), ...(payoff ? { payoff: { chapterId: payoff } } : {}) })
  it('knows open, paid and paid-too-early', () => {
    expect(setupState(s('a', 'c1'), order)).toBe('open')
    expect(setupState(s('a', 'c1', 'c3'), order)).toBe('paid')
    expect(setupState(s('a', 'c3', 'c1'), order)).toBe('early')
    expect(setupState(s('a', undefined, 'c2'), order)).toBe('paid')
  })
  it('lists the waiting ones first, in book order', () => {
    const list = [s('paid', 'c1', 'c2'), s('late', 'c3'), s('early', 'c2')]
    expect(sortSetups(list, order).map((x) => x.id)).toEqual(['early', 'late', 'paid'])
  })
  it('makes a short title from marked words', () => {
    expect(titleFromQuote('  אקדח   על הקיר ')).toBe('אקדח על הקיר')
    const long = 'מילה '.repeat(30)
    expect(titleFromQuote(long).length).toBeLessThanOrEqual(60)
    expect(titleFromQuote(long).endsWith('…')).toBe(true)
  })
})
