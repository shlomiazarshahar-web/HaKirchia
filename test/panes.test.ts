import { describe, expect, it } from 'vitest'
import { translationLayout, addPane, splitPane, resizeSplit, layoutRects, leafKeys, treeOf, MAX_PANES, closePane, defaultLayout, nextContent, normalizeLayout, resizeBorder, setPaneContent, swapPanes, type PaneLayout } from '../src/shared/panes'
import type { Book, Chapter } from '../src/shared/types'

const ch = (id: string): Chapter => ({ id, title: id, file: `${id}.docx`, status: 'draft', synopsis: '' })
const book = { path: '/b', title: 'B', chapters: ['a', 'b', 'c'].map(ch), outline: [] } as unknown as Book
const kinds = (l: PaneLayout) => l.panes.map((p) => (p.content.kind === 'chapter' ? p.content.id : 'M'))
const sum = (w: number[]) => w.reduce((a, b) => a + b, 0)

describe('panes', () => {
  it('starts with one pane: the chapter being written', () => {
    expect(kinds(defaultLayout(book, 'b'))).toEqual(['b'])
    expect(kinds(defaultLayout(book, 'zz'))).toEqual(['a'])
    expect(kinds(defaultLayout({ ...book, chapters: [] }, null))).toEqual(['M'])
  })

  it('normalizes a saved layout: deleted chapters, a second master', () => {
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
    expect(kinds(n)).toEqual(['M', 'a', 'b', 'c'])
    expect(sum(n.widths)).toBeCloseTo(1)
    expect(n.tree && leafKeys(n.tree)).toEqual(['2', '4', '5', '6'])
    expect(kinds(normalizeLayout(undefined, book, 'a'))).toEqual(['a'])
  })

  it('adds panes (up to MAX_PANES): the next chapters, then the whole book', () => {
    let l = defaultLayout(book, 'b')
    l = addPane(l, nextContent(l, book, 0))
    expect(kinds(l)).toEqual(['b', 'c'])
    l = addPane(l, nextContent(l, book, 1))
    expect(kinds(l)).toEqual(['b', 'c', 'a'])
    expect(l.widths.map((w) => +w.toFixed(3))).toEqual([0.333, 0.333, 0.333])
    expect(nextContent(l, book, 0)).toEqual({ kind: 'master' })
    while (l.panes.length < MAX_PANES) l = addPane(l, { kind: 'chapter', id: 'c' })
    expect(addPane(l, { kind: 'chapter', id: 'c' })).toBe(l)
  })

  it('closes panes but never the last one', () => {
    let l = addPane(addPane(defaultLayout(book, 'a'), { kind: 'chapter', id: 'b' }), { kind: 'master' })
    l = closePane(l, 1)
    expect(kinds(l)).toEqual(['a', 'M'])
    expect(sum(l.widths)).toBeCloseTo(1)
    l = closePane(closePane(l, 0), 0)
    expect(kinds(l)).toEqual(['M'])
  })

  it('changes what a pane shows; the master moves instead of opening twice', () => {
    let l = addPane(addPane(defaultLayout(book, 'a'), { kind: 'chapter', id: 'b' }), { kind: 'master' })
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
    const l = addPane(defaultLayout(book, 'a'), { kind: 'chapter', id: 'b' })
    expect(kinds(swapPanes(l, 0, 1))).toEqual(['b', 'a'])
    expect(resizeBorder([0.5, 0.5], 0, 0.1)).toEqual([0.6, 0.4])
    expect(resizeBorder([0.5, 0.5], 0, 0.9)).toEqual([0.8, 0.19999999999999996])
    expect(resizeBorder([0.4, 0.3, 0.3], 1, -0.5).map((w) => +w.toFixed(2))).toEqual([0.4, 0.2, 0.4])
  })

  it('translation: chapter, PDF and Google Translate, each of the last two at most once', () => {
    const t = translationLayout(book, 'b')
    expect(t.panes.map((p) => p.content)).toEqual([{ kind: 'chapter', id: 'b' }, { kind: 'pdf' }, { kind: 'web' }])
    expect(sum(t.widths)).toBeCloseTo(1)
    const twice: PaneLayout = { panes: [...t.panes.slice(1), { key: 'x', content: { kind: 'pdf' } }], widths: [0.3, 0.3, 0.4] }
    expect(normalizeLayout(twice, book, 'a').panes.map((p) => p.content.kind)).toEqual(['pdf', 'web'])
    // putting the PDF in another pane moves it there (swap), so it is never shown twice
    const swapped = setPaneContent(t, 0, { kind: 'pdf' })
    expect(swapped.panes.map((p) => p.content.kind)).toEqual(['pdf', 'chapter', 'web'])
  })

  it('splits any pane beside or below, Blender style, and closes back', () => {
    let l = translationLayout(book, 'a') // a | pdf | web
    const web = l.panes[2].key
    l = splitPane(l, 2, { kind: 'glossary' }, 'v')
    expect(l.panes.map((p) => p.content.kind)).toEqual(['chapter', 'pdf', 'web', 'glossary'])
    const t = treeOf(l)
    expect(t.t === 'split' && t.dir).toBe('h')
    const col = t.t === 'split' ? t.kids[2] : null
    expect(col?.t === 'split' && col.dir).toBe('v')
    const { rects, borders } = layoutRects(t)
    const r = rects.get(l.panes[3].key)!
    expect(r.y).toBeCloseTo(0.5)
    expect(r.x).toBeCloseTo(0.75)
    expect(borders.filter((b) => b.dir === 'v')).toHaveLength(1)
    // drag the border inside the column
    const t2 = resizeSplit(t, [2], 0, 0.2)
    expect(layoutRects(t2).rects.get(web)!.h).toBeCloseTo(0.7)
    // close the glossary: the column folds back into the row
    l = closePane({ ...l, tree: t2 }, 3)
    expect(treeOf(l).t === 'split' && (treeOf(l) as { kids: unknown[] }).kids.length).toBe(3)
    expect(leafKeys(treeOf(l))).toEqual(l.panes.map((p) => p.key))
  })

  it('swaps panes inside a tree; places keep their sizes', () => {
    let l = splitPane(defaultLayout(book, 'a'), 0, { kind: 'chapter', id: 'b' }, 'v')
    l = splitPane(l, 1, { kind: 'master' }, 'h')
    expect(kinds(l)).toEqual(['a', 'b', 'M'])
    const s = swapPanes(l, 0, 2)
    expect(kinds(s)).toEqual(['M', 'b', 'a'])
    expect(leafKeys(treeOf(s))).toEqual(s.panes.map((p) => p.key))
  })

  it('reads a layout saved before the tree as one row', () => {
    const old: PaneLayout = { panes: [{ key: 'x', content: { kind: 'chapter', id: 'a' } }, { key: 'y', content: { kind: 'pdf' } }], widths: [0.7, 0.3] }
    const t = treeOf(old)
    expect(t.t === 'split' && t.sizes[0]).toBeCloseTo(0.7)
  })
})
