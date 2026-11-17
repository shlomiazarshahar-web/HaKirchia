import { describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { PMNode } from '../src/shared/types'

vi.mock('electron', () => ({ shell: { trashItem: async (p: string) => (await import('fs')).promises.rm(p, { force: true }) } }))
const project = await import('../src/main/project')

const doc = (...paras: string[]): PMNode => ({ type: 'doc', content: paras.map((t) => ({ type: 'paragraph', attrs: { dir: 'rtl', textAlign: null }, content: [{ type: 'text', text: t }] })) })
const texts = (d: PMNode) => (d.content ?? []).map((b) => (b.content ?? []).map((x) => x.text ?? '').join(''))

describe('versions on disk (feature 14)', () => {
  it('keeps a version before the first save, then named versions, and restores them', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hk-v-'))
    const book = await project.createBook(root, 'ספר')
    const id = book.chapters[0].id
    await project.saveChapter(book.path, id, doc('טקסט ראשון'))
    // the very first save keeps the empty chapter as an automatic version
    let list = await project.listVersions(book.path, id)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ auto: true, reason: 'שמירה אוטומטית' })
    // more saves within half an hour: no more automatic versions
    await project.saveChapter(book.path, id, doc('טקסט שני'))
    expect(await project.listVersions(book.path, id)).toHaveLength(1)
    const named = await project.takeVersion(book.path, id, 'לפני שינוי הפתיחה')
    expect(named).toMatchObject({ label: 'לפני שינוי הפתיחה', auto: false, words: 2 })
    // the same text again is not kept twice
    expect((await project.takeVersion(book.path, id, '')).id).toBe(named.id)
    list = await project.listVersions(book.path, id)
    expect(list.map((v) => v.label)).toEqual(['לפני שינוי הפתיחה', ''])
    expect(texts(await project.loadVersion(book.path, id, named.id))).toEqual(['טקסט שני'])
    // the versions are Word files in the book folder
    expect(readdirSync(join(book.path, 'גרסאות', id)).filter((f) => f.endsWith('.docx'))).toHaveLength(2)
    await project.deleteVersion(book.path, id, named.id)
    expect(await project.listVersions(book.path, id)).toHaveLength(1)
  })
})

describe('notes, drawer and alternative drafts on disk (features 15, 27, 35)', () => {
  it('saves notes in the book file and drops them with their chapter', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hk-n-'))
    let book = await project.createBook(root, 'ספר')
    const id = book.chapters[0].id
    await project.setNotes(book.path, [{ id: 'n1', chapterId: id, text: 'לבדוק', at: 1, anchor: { pos: 1, before: '', after: 'א', quote: 'א' } }])
    book = await project.openBook(book.path)
    expect(book.notes).toHaveLength(1)
    book = (await project.addChapter(book.path, 'שני')).book
    book = (await project.deleteChapter(book.path, id)).book
    expect(book.notes).toEqual([])
  })

  it('keeps the drawer in its own file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hk-d-'))
    const book = await project.createBook(root, 'ספר')
    const item = { id: 'd1', text: 'משפט שנחתך', content: [], chapterId: null, chapterTitle: 'פרק 1', at: 1, how: 'cut' as const }
    await project.addToDrawer(book.path, item)
    expect(await project.readDrawer(book.path)).toEqual([item])
    expect(existsSync(join(book.path, 'מגירה.json'))).toBe(true)
    expect(await project.removeFromDrawer(book.path, ['d1'])).toEqual([])
  })

  it('creates, saves, renames and deletes an alternative draft', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hk-a-'))
    const book0 = await project.createBook(root, 'ספר')
    const id = book0.chapters[0].id
    const { book, alt } = await project.createAlt(book0.path, id, 'נוסח 2', doc('פתיחה אחרת'), { index: 1, label: 'סצנה' })
    expect(book.alts).toHaveLength(1)
    expect(alt.scene).toEqual({ index: 1, label: 'סצנה' })
    const file = join(book.path, 'טיוטות חלופיות', alt.file)
    expect(existsSync(file)).toBe(true)
    await project.saveAlt(book.path, alt.id, doc('פתיחה אחרת', 'עוד'))
    expect(texts((await project.loadAlt(book.path, alt.id)).doc)).toEqual(['פתיחה אחרת', 'עוד'])
    // the chapter itself is untouched
    expect(texts((await project.loadChapter(book.path, id)).doc)).toEqual([''])
    expect((await project.renameAlt(book.path, alt.id, 'גרסת הים')).alts[0].name).toBe('גרסת הים')
    expect((await project.deleteAlt(book.path, alt.id)).alts).toEqual([])
    expect(existsSync(file)).toBe(false)
  })
})
