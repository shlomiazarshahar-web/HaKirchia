import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { moveIdea, normalizeColumns, normalizeIdeas, normalizePlan, sameOutline, sortRows } from '../src/shared/plan'
import { moveNode } from '../src/shared/outline'
import { CHAPTERS_DIR } from '../src/shared/constants'

vi.mock('electron', () => ({ shell: { trashItem: async () => undefined } }))
const project = await import('../src/main/project')

async function bookWith(n: number) {
  const root = mkdtempSync(join(tmpdir(), 'hk14-'))
  let book = await project.createBook(root, 'ספר')
  for (let i = 2; i <= n; i++) book = (await project.addChapter(book.path, `פרק ${i}`)).book
  return book
}

describe('plan data (59, 60, 61)', () => {
  it('normalizes ideas and columns', () => {
    expect(normalizeIdeas([{ id: 'a', title: 'x', text: 'y', at: 3 }, { id: 'a' }, { title: 'no id' }, 5])).toEqual([{ id: 'a', title: 'x', text: 'y', at: 3 }])
    expect(normalizeColumns([{ id: 'c', name: '  ' }, { id: 'c', name: 'dup' }])).toEqual([{ id: 'c', name: 'עמודה' }])
    expect(moveIdea(normalizeIdeas([{ id: 'a' }, { id: 'b' }, { id: 'c' }]), 0, 2).map((x) => x.id)).toEqual(['b', 'c', 'a'])
  })

  it('a trial order follows the chapters that exist', () => {
    const chapters = [{ id: 'a' }, { id: 'b' }, { id: 'c' }].map((c) => ({ ...c, title: c.id, file: '', status: 'draft' as const, synopsis: '' }))
    const p = normalizePlan({ trialOutline: [{ type: 'chapter', id: 'c' }, { type: 'chapter', id: 'gone' }, { type: 'chapter', id: 'a' }] }, chapters)
    expect(p.trialOutline!.map((n) => n.id)).toEqual(['c', 'a', 'b'])
    expect(normalizePlan({}, chapters).trialOutline).toBeUndefined()
  })

  it('sorts table rows with empty values last', () => {
    const rows = [{ v: 'ב' }, { v: '' }, { v: 'א' }, { v: 'ג' }]
    expect(sortRows(rows, (r) => r.v, 1).map((r) => r.v)).toEqual(['א', 'ב', 'ג', ''])
    expect(sortRows(rows, (r) => r.v, -1).map((r) => r.v)).toEqual(['ג', 'ב', 'א', ''])
    expect(sortRows([{ n: 10 }, { n: 9 }], (r) => r.n, 1).map((r) => r.n)).toEqual([9, 10])
  })

  it('trial order: saved apart, the book unchanged until applied', async () => {
    let book = await bookWith(3)
    const [a, b, c] = book.chapters.map((x) => x.id)
    const trial = moveNode(book.outline, { type: 'chapter', id: c }, { kind: 'before', ref: { type: 'chapter', id: a } })
    book = await project.setPlan(book.path, { trialOutline: trial })
    expect(book.chapters.map((x) => x.id)).toEqual([a, b, c])
    expect(book.trialOutline!.map((n) => n.id)).toEqual([c, a, b])
    expect(sameOutline(book.trialOutline!, book.outline)).toBe(false)
    // a chapter added during the trial joins the trial at the end
    book = (await project.addChapter(book.path, 'חדש')).book
    expect(book.trialOutline!.length).toBe(4)
    book = await project.applyTrialOrder(book.path).then((r) => r.book)
    expect(book.trialOutline).toBeUndefined()
    expect(book.chapters.map((x) => x.id).slice(0, 3)).toEqual([c, a, b])
    expect(readdirSync(join(book.path, CHAPTERS_DIR)).sort()[0]).toBe('01 - פרק 3.docx')
    // cancel
    book = await project.setPlan(book.path, { trialOutline: book.outline })
    book = await project.setPlan(book.path, { trialOutline: null })
    expect(book.trialOutline).toBeUndefined()
  })

  it('an idea becomes a chapter where it was dropped', async () => {
    let book = await bookWith(2)
    const [a, b] = book.chapters.map((x) => x.id)
    book = await project.setPlan(book.path, { ideas: [{ id: 'i1', title: 'הפגישה בנמל', text: 'נועה רואה אותו שוב', at: 1 }, { id: 'i2', title: '', text: 'רעיון בלי שם בכלל כאן', at: 2 }] })
    expect(book.ideas.length).toBe(2)
    const r = await project.ideaToChapter(book.path, 'i1', { kind: 'before', ref: { type: 'chapter', id: b } })
    book = r.book
    expect(book.chapters.map((x) => x.id)).toEqual([a, r.chapterId, b])
    const ch = book.chapters[1]
    expect(ch.title).toBe('הפגישה בנמל')
    expect(ch.synopsis).toBe('נועה רואה אותו שוב')
    expect(ch.file).toBe('02 - הפגישה בנמל.docx')
    expect(book.ideas.map((x) => x.id)).toEqual(['i2'])
    const r2 = await project.ideaToChapter(book.path, 'i2')
    expect(r2.book.chapters.at(-1)!.title).toBe('רעיון בלי שם בכלל כאן')
    expect(r2.book.ideas).toEqual([])
    await expect(project.ideaToChapter(book.path, 'nope')).rejects.toThrow()
  })

  it('custom table columns: values on chapters, removed with the column', async () => {
    let book = await bookWith(1)
    const id = book.chapters[0].id
    book = await project.setPlan(book.path, { tableColumns: [{ id: 'pov', name: 'נקודת מבט' }, { id: 'x', name: 'עוד' }] })
    book = await project.updateChapterMeta(book.path, id, { custom: { pov: 'נועה', x: 'משהו', bad: 'לא' } })
    expect(book.chapters[0].custom).toEqual({ pov: 'נועה', x: 'משהו' })
    book = await project.updateChapterMeta(book.path, id, { custom: { x: '' } })
    expect(book.chapters[0].custom).toEqual({ pov: 'נועה' })
    book = await project.setPlan(book.path, { tableColumns: [{ id: 'x', name: 'עוד' }] })
    expect(book.chapters[0].custom).toBeUndefined()
    expect(book.tableColumns).toEqual([{ id: 'x', name: 'עוד' }])
  })
})
