import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({ shell: { trashItem: async () => undefined } }))
const project = await import('../src/main/project')
const { CHAPTERS_DIR, MANIFEST } = project

const files = (book: string) => readdirSync(join(book, CHAPTERS_DIR)).sort()

describe('book folder with parts', () => {
  it('keeps files numbered in tree order when chapters move into and out of parts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hk-'))
    let book = await project.createBook(root, 'ספר')
    for (const t of ['שני', 'שלישי']) book = (await project.addChapter(book.path, t)).book
    const [a, b, c] = book.chapters.map((x) => x.id)

    // A part holding the third chapter, placed first
    book = (await project.saveOutline(book.path, [{ type: 'part', id: 'p1', title: 'חלק ראשון', children: [c] }, { type: 'chapter', id: a }, { type: 'chapter', id: b }])).book
    expect(files(book.path)).toEqual(['01 - שלישי.docx', '02 - פרק 1.docx', '03 - שני.docx'])

    // New chapter added at the end of the part: it becomes 02 and the rest move down
    const added = await project.addChapter(book.path, 'חדש', 'p1')
    book = added.book
    expect(book.outline[0]).toMatchObject({ type: 'part', children: [c, added.chapter.id] })
    expect(files(book.path)).toEqual(['01 - שלישי.docx', '02 - חדש.docx', '03 - פרק 1.docx', '04 - שני.docx'])

    // Deleting a chapter in the part renumbers and cleans the tree
    book = (await project.deleteChapter(book.path, c)).book
    expect(book.outline[0]).toMatchObject({ type: 'part', children: [added.chapter.id] })
    expect(book.chapters.map((x) => x.file)).toEqual(['01 - חדש.docx', '02 - פרק 1.docx', '03 - שני.docx'])
  })

  it('opens books saved before parts existed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hk-'))
    const book = await project.createBook(root, 'ישן')
    const m = JSON.parse(readFileSync(join(book.path, MANIFEST), 'utf8'))
    delete m.outline
    writeFileSync(join(book.path, MANIFEST), JSON.stringify(m))
    const opened = await project.openBook(book.path)
    expect(opened.outline).toEqual([{ type: 'chapter', id: opened.chapters[0].id }])
  })
})
