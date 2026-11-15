import { describe, expect, it } from 'vitest'
import { flatten, moveNode, normalizeOutline, startPartAt, ungroupPart, withOutline, newPartTitle } from '../src/shared/outline'
import type { Chapter, OutlineNode } from '../src/shared/types'

const ch = (id: string): Chapter => ({ id, title: id, file: `${id}.docx`, status: 'draft', synopsis: '' })
const chapters = ['a', 'b', 'c', 'd', 'e'].map(ch)
const c = (id: string): OutlineNode => ({ type: 'chapter', id })
const part = (id: string, children: string[], collapsed = false): OutlineNode => ({ type: 'part', id, title: id.toUpperCase(), collapsed, children })

describe('normalizeOutline', () => {
  it('builds a flat tree for books saved before parts existed', () => {
    expect(normalizeOutline(undefined, chapters)).toEqual(['a', 'b', 'c', 'd', 'e'].map(c))
  })
  it('drops unknown and repeated chapters, keeps empty parts, appends missing chapters', () => {
    const o = normalizeOutline([c('b'), c('zz'), part('p', ['a', 'b', 'c']), part('q', []), c('a')], chapters)
    expect(o).toEqual([c('b'), part('p', ['a', 'c']), part('q', []), c('d'), c('e')])
  })
  it('withOutline puts chapters in tree order', () => {
    const b = withOutline({ chapters, outline: [] }, [part('p', ['e', 'd']), c('a')])
    expect(b.chapters.map((x) => x.id)).toEqual(['e', 'd', 'a', 'b', 'c'])
  })
})

describe('moveNode', () => {
  const tree = [c('a'), part('p', ['b', 'c']), part('q', ['d']), c('e')]
  it('moves a chapter into a part (start or end)', () => {
    expect(moveNode(tree, { type: 'chapter', id: 'a' }, { kind: 'into', partId: 'q', at: 'start' })).toEqual([part('p', ['b', 'c']), part('q', ['a', 'd']), c('e')])
    expect(flatten(moveNode(tree, { type: 'chapter', id: 'e' }, { kind: 'into', partId: 'p', at: 'end' }))).toEqual(['a', 'b', 'c', 'e', 'd'])
  })
  it('moves a chapter out of a part, before another chapter', () => {
    expect(moveNode(tree, { type: 'chapter', id: 'c' }, { kind: 'before', ref: { type: 'chapter', id: 'a' } })).toEqual([c('c'), c('a'), part('p', ['b']), part('q', ['d']), c('e')])
  })
  it('reorders inside a part and between parts', () => {
    expect(flatten(moveNode(tree, { type: 'chapter', id: 'b' }, { kind: 'after', ref: { type: 'chapter', id: 'c' } }))).toEqual(['a', 'c', 'b', 'd', 'e'])
    const m = moveNode(tree, { type: 'chapter', id: 'b' }, { kind: 'before', ref: { type: 'chapter', id: 'd' } })
    expect(m[2]).toEqual(part('q', ['b', 'd']))
  })
  it('moves a whole part with its chapters', () => {
    expect(flatten(moveNode(tree, { type: 'part', id: 'q' }, { kind: 'before', ref: { type: 'chapter', id: 'a' } }))).toEqual(['d', 'a', 'b', 'c', 'e'])
    expect(moveNode(tree, { type: 'part', id: 'p' }, { kind: 'end' })).toEqual([c('a'), part('q', ['d']), c('e'), part('p', ['b', 'c'])])
  })
  it('never puts a part inside a part', () => {
    const m = moveNode(tree, { type: 'part', id: 'q' }, { kind: 'before', ref: { type: 'chapter', id: 'b' } })
    expect(m).toEqual([c('a'), part('p', ['b', 'c']), part('q', ['d']), c('e')].filter(Boolean))
    expect(moveNode(tree, { type: 'part', id: 'q' }, { kind: 'into', partId: 'p', at: 'end' })).toBe(tree)
  })
  it('moving onto itself changes nothing', () => {
    expect(moveNode(tree, { type: 'chapter', id: 'a' }, { kind: 'after', ref: { type: 'chapter', id: 'a' } })).toBe(tree)
  })
})

describe('parts', () => {
  it('starts a part at a top-level chapter, taking chapters up to the next part', () => {
    const o = startPartAt([c('a'), c('b'), c('c'), part('p', ['d']), c('e')], 'b', { id: 'n', title: 'N' })
    expect(o).toEqual([c('a'), { type: 'part', id: 'n', title: 'N', children: ['b', 'c'] }, part('p', ['d']), c('e')])
  })
  it('splits a part when started inside it', () => {
    const o = startPartAt([part('p', ['a', 'b', 'c'])], 'b', { id: 'n', title: 'N' })
    expect(o).toEqual([part('p', ['a']), { type: 'part', id: 'n', title: 'N', children: ['b', 'c'] }])
  })
  it('ungrouping keeps chapters in place', () => {
    expect(ungroupPart([c('a'), part('p', ['b', 'c']), c('d')], 'p')).toEqual(['a', 'b', 'c', 'd'].map(c))
  })
  it('names new parts in Hebrew order', () => {
    expect(newPartTitle([])).toBe('חלק ראשון')
    expect(newPartTitle([part('p', [])])).toBe('חלק שני')
  })
})
