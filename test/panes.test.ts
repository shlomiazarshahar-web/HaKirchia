import { describe, expect, it } from 'vitest'
import { addPane, closePane, defaultLayout, nextContent, normalizeLayout, resizeBorder, setPaneContent, swapPanes, type PaneLayout } from '../src/shared/panes'
import type { Book, Chapter } from '../src/shared/types'

const ch = (id: string): Chapter => ({ id, title: id, file: `${id}.docx`, status: 'draft', synopsis: '' })
const book = { path: '/b', title: 'B', chapters: ['a', 'b', 'c'].map(ch), outline: [] } as unknown as Book
const kinds = (l: PaneLayout) => l.panes.map((p) => (p.content.kind === 'chapter' ? p.content.id : 'M'))
const sum = (w: number[]) => w.reduce((a, b) => a + b, 0)

describe('panes', () => {
  it('starts with the active chapter next to the following one', () => {
    expect(kinds(defaultLayout(book, 'b'))).toEqual(['b', 'c'])
    expect(kinds(defaultLayout(book, 'c'))).toEqual(['c', 'b'])
    expect(kinds(defaultLayout({ ...book, chapters: [ch('a')] }, 'a'))).toEqual(['a', 'M'])
    expect(kinds(defaultLayout({ ...book, chapters: [] }, null))).toEqual(['M'])
  })

  it('normalizes a saved layout: deleted chapters, a second master, more than 3 panes', () => {
    const saved: PaneLayout = {
      panes: [
        { key: '1', content: { kind: 'chapter', id: 'gone' } },
        { key: '2', content: { kind: 'master' } },
        { key: '3', content: { kind: 'master' } },
        { key: '4', content: { kind: 'chapter', id: 'a' } },
        { key: '5', content: { kind: 'chapter', id: 'b' } },
        { key: '6', content: { kind: 'chapter', id: 'c' } }
      ],
      widths: [0.1, 0.3, 0.1, 0.1, 0.4, 0.0]
    }
    const n = normalizeLayout(saved, book, 'a')
    expect(kinds(n)).toEqual(['M', 'a', 'b'])
    expect(n.widths[0]).toBeCloseTo(0.375)
    expect(sum(n.widths)).toBeCloseTo(1)
    expect(kinds(normalizeLayout(undefined, book, 'a'))).toEqual(['a', 'b'])
  })

  it('adds up to three panes, the master first', () => {
    let l = defaultLayout(book, 'a')
    l = addPane(l, nextContent(l, book))
    expect(kinds(l)).toEqual(['a', 'b', 'M'])
    expect(l.widths.map((w) => +w.toFixed(3))).toEqual([0.333, 0.333, 0.333])
    expect(addPane(l, { kind: 'chapter', id: 'c' })).toBe(l)
    expect(nextContent(l, book)).toEqual({ kind: 'chapter', id: 'c' })
  })

  it('closes panes but never the last one', () => {
    let l = addPane(defaultLayout(book, 'a'), { kind: 'master' })
    l = closePane(l, 1)
    expect(kinds(l)).toEqual(['a', 'M'])
    expect(sum(l.widths)).toBeCloseTo(1)
    l = closePane(closePane(l, 0), 0)
    expect(kinds(l)).toEqual(['M'])
  })

  it('changes what a pane shows; the master moves instead of opening twice', () => {
    let l = addPane(defaultLayout(book, 'a'), { kind: 'master' })
    l = setPaneContent(l, 0, { kind: 'chapter', id: 'c' })
    expect(kinds(l)).toEqual(['c', 'b', 'M'])
    const keys = l.panes.map((p) => p.key)
    l = setPaneContent(l, 0, { kind: 'master' })
    expect(kinds(l)).toEqual(['M', 'b', 'c'])
    expect(l.panes.map((p) => p.key)).toEqual([keys[2], keys[1], keys[0]])
    // the same chapter may be open twice (e.g. its start and its end)
    expect(kinds(setPaneContent(l, 0, { kind: 'chapter', id: 'b' }))).toEqual(['b', 'b', 'c'])
  })

  it('swaps panes and drags borders within limits', () => {
    const l = defaultLayout(book, 'a')
    expect(kinds(swapPanes(l, 0, 1))).toEqual(['b', 'a'])
    expect(resizeBorder([0.5, 0.5], 0, 0.1)).toEqual([0.6, 0.4])
    expect(resizeBorder([0.5, 0.5], 0, 0.9)).toEqual([0.8, 0.19999999999999996])
    expect(resizeBorder([0.4, 0.3, 0.3], 1, -0.5).map((w) => +w.toFixed(2))).toEqual([0.4, 0.2, 0.4])
  })
})
