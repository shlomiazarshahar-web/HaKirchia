import { describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { mkdtempSync, readdirSync, existsSync, writeFileSync, readFileSync, statSync, utimesSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const userData = mkdtempSync(join(tmpdir(), 'hk-ud-'))
const docs = mkdtempSync(join(tmpdir(), 'hk-docs-'))
vi.mock('electron', () => ({
  shell: { trashItem: async () => undefined },
  app: { getPath: (k: string) => (k === 'documents' ? docs : userData) },
  dialog: {}
}))

const { docxBlocks, docxToDoc, docText } = await import('../src/shared/docx')
const ms = await import('../src/shared/manuscript')
const bk = await import('../src/shared/backup')
const project = await import('../src/main/project')
const recovery = await import('../src/main/recovery')
const backup = await import('../src/main/backup')
const { recoveryKey } = await import('../src/shared/recovery')

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const p = (text: string, style?: string, extra = '') => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r>${extra}</w:p>`
async function makeDocx(body: string): Promise<Uint8Array> {
  const z = new JSZip()
  z.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
  z.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`)
  return z.generateAsync({ type: 'uint8array' })
}

describe('manuscript import (feature 42)', () => {
  it('splits by Heading 1, keeps the text before the first chapter, ignores a single Title', async () => {
    const bytes = await makeDocx(
      p('הנמל השקט', 'Title') + p('לאמא') + p('פרק ראשון', 'Heading1') + p('היה היה.') + p('תת כותרת', 'Heading2') + p('עוד.') + p('פרק שני', 'Heading1') + p('', undefined) + p('סוף.')
    )
    const { blocks } = await docxBlocks(bytes, { splitPages: true })
    expect(ms.guessBookTitle(blocks, 'x.docx')).toBe('הנמל השקט')
    const opts = ms.splitOptions(blocks)
    expect(opts[0].mode).toEqual({ kind: 'heading', level: 1 })
    expect(opts.some((o) => o.mode.kind === 'heading' && o.mode.level === 0)).toBe(false) // the book's name, not a chapter
    const chs = ms.findChapters(blocks, opts[0].mode)
    expect(chs.map((c) => c.title)).toEqual(['פתיחה', 'פרק ראשון', 'פרק שני'])
    expect(chs[0].front).toBe(true)
    const items = ms.buildChapters(blocks, opts[0].mode, chs, [true, true, true], chs.map((c) => c.title))
    expect(items.map((i) => i.title)).toEqual(['פתיחה', 'פרק ראשון', 'פרק שני'])
    expect(docText(items[0].doc)).toBe('לאמא') // the book's name is not repeated inside
    // the heading is the chapter's name, not part of its text; Heading 2 stays a heading inside
    expect(docText(items[1].doc)).toBe('היה היה.\nתת כותרת\nעוד.')
    expect(items[1].doc.content![1]).toMatchObject({ type: 'heading', attrs: { level: 2 } })
    // empty lines at the start of a chapter are dropped
    expect(docText(items[2].doc)).toBe('סוף.')
    // joining chapter 3 into chapter 2 keeps its heading inside the text
    const joined = ms.buildChapters(blocks, opts[0].mode, chs, [true, true, false], ['', 'א', 'ב'])
    expect(joined.map((i) => i.title)).toEqual(['פרק 1', 'א'])
    expect(docText(joined[1].doc)).toContain('פרק שני\n\nסוף.')
  })

  it('finds "פרק …" lines and page breaks when there are no heading styles', async () => {
    const br = '<w:r><w:br w:type="page"/></w:r>'
    const bytes = await makeDocx(p('פרק 1') + p('א.', undefined, br) + p('פרק שני: הים') + p('ב.') + p('Chapter IV') + p('ג.'))
    const { blocks } = await docxBlocks(bytes, { splitPages: true })
    const opts = ms.splitOptions(blocks)
    expect(opts[0]).toEqual({ mode: { kind: 'label' }, count: 3 })
    expect(opts.find((o) => o.mode.kind === 'page')?.count).toBe(2)
    expect(ms.findChapters(blocks, { kind: 'label' }).map((c) => c.title)).toEqual(['פרק 1', 'פרק שני: הים', 'Chapter IV'])
    const pages = ms.findChapters(blocks, { kind: 'page' })
    expect(pages.map((c) => c.title)).toEqual(['פרק 1', 'פרק 2'])
    expect(ms.isChapterLabel('פרקים רבים עברו')).toBe(false)
    expect(ms.isChapterLabel('פרק זמן ארוך עבר מאז')).toBe(false)
    expect(ms.isChapterLabel('פרק י״ב')).toBe(true)
    expect(ms.isChapterLabel('פרק א׳ – ההתחלה')).toBe(true)
    expect(ms.isChapterLabel('CHAPTER 12.')).toBe(true)
    // without splitPages a page break stays a line break, as before
    const plain = await docxToDoc(bytes)
    expect(plain.doc.content!.length).toBe(6)
  })

  it('creates a book from the chapters, reusing its first empty chapter', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hk-'))
    const items = [
      { title: 'אחד', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'טקסט אחד' }] }] } },
      { title: 'שתיים', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'טקסט שני' }] }] } }
    ]
    const { book } = await project.createBookFromChapters(root, 'מיובא', items)
    expect(book.chapters.map((c) => c.title)).toEqual(['אחד', 'שתיים'])
    expect(readdirSync(join(book.path, project.CHAPTERS_DIR)).sort()).toEqual(['01 - אחד.docx', '02 - שתיים.docx'])
    const loaded = await project.loadChapter(book.path, book.chapters[1].id)
    expect(docText(loaded.doc)).toBe('טקסט שני')
    // into a book that already has text: added at the end
    const more = await project.importChapters(book.path, [items[0]])
    expect(more.book.chapters.length).toBe(3)
  })
})

describe('crash recovery (feature 41)', () => {
  it('offers text from an earlier run, not from this one, and restores it keeping a version', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hk-'))
    const book = await project.createBook(root, 'שחזור')
    const id = book.chapters[0].id
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'מילים שלא נשמרו בזמן' }] }] }
    await recovery.writeEntry('oldrun', { kind: 'chapter', bookPath: book.path, id, doc, at: Date.now() })
    expect(await recovery.listEntries('oldrun')).toEqual([]) // its own run: not left over
    const list = await recovery.listEntries('newrun')
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ kind: 'chapter', title: 'פרק 1', bookTitle: 'שחזור', words: 4, diskWords: 0 })
    // new typing in the same chapter (this run) does not replace what was left
    await recovery.writeEntry('newrun', { kind: 'chapter', bookPath: book.path, id, doc: { type: 'doc', content: [] }, at: Date.now() })
    await recovery.clearEntry('newrun', recoveryKey('chapter', book.path, id))
    await recovery.restoreEntry(list[0].key)
    expect(docText((await project.loadChapter(book.path, id)).doc)).toBe('מילים שלא נשמרו בזמן')
    const versions = await project.listVersions(book.path, id)
    expect(versions.some((v) => v.label === 'לפני שחזור טקסט שלא נשמר')).toBe(true)
    expect(await recovery.listEntries('third')).toEqual([])
  })

  it('quietly drops text that is already in the file, and reports a missing book', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hk-'))
    const book = await project.createBook(root, 'שמור')
    const id = book.chapters[0].id
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'כבר בקובץ' }] }] }
    await project.saveChapter(book.path, id, doc)
    await recovery.writeEntry('r1', { kind: 'chapter', bookPath: book.path, id, doc, at: Date.now() })
    await recovery.writeEntry('r1', { kind: 'chapter', bookPath: join(root, 'אין כזה'), id: 'x', doc, at: Date.now() })
    const list = await recovery.listEntries('r2')
    expect(list).toHaveLength(1)
    expect(list[0].missing).toMatch(/תיקיית הספר לא נמצאה/)
    await recovery.discardEntry(list[0].key)
    expect(await recovery.listEntries('r2')).toEqual([])
  })
})

describe('daily backups (feature 49)', () => {
  it('pure rules', () => {
    expect(bk.dayStamp(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(bk.daysToDelete(['2026-11-20', '2026-11-22', '2026-11-21', 'x'], 2)).toEqual(['2026-11-20'])
    expect(bk.skipInBackup('ייצוא/ספר.pdf')).toBe(true)
    expect(bk.skipInBackup(join('פרקים', '01 - א.docx.saving'))).toBe(true)
    expect(bk.skipInBackup(join('פרקים', '01 - א.docx'))).toBe(false)
    expect(bk.normalizeBackup({ keep: 0 })).toEqual({ enabled: true, folder: '', keep: 30 })
  })

  it('copies the book once a day, skips when nothing changed, restores a chapter', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hk-'))
    const book = await project.createBook(root, 'מגובה')
    const id = book.chapters[0].id
    await project.saveChapter(book.path, id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'גרסה טובה' }] }] })
    writeFileSync(join(book.path, 'ייצוא.txt'), 'x')
    const day = await backup.backupNow(book.path)
    expect(day).toBe(bk.dayStamp(new Date()))
    const info = await backup.backupInfo(book.path)
    expect(info.days).toHaveLength(1)
    expect(info.dir!.startsWith(join(docs, bk.BACKUP_ROOT_NAME))).toBe(true)
    expect(existsSync(join(info.days[0].path, project.MANIFEST))).toBe(true)
    // nothing changed: no new copy
    expect(await backup.backupNow(book.path)).toBeNull()

    // a mistake: the chapter is emptied; the backup brings it back and keeps the mistake as a version
    await project.saveChapter(book.path, id, { type: 'doc', content: [{ type: 'paragraph' }] })
    const chs = await backup.backupChapters(book.path, day!)
    expect(chs).toMatchObject([{ id, state: 'changed', words: 2 }])
    await backup.restoreChapter(book.path, day!, id)
    expect(docText((await project.loadChapter(book.path, id)).doc)).toBe('גרסה טובה')
    expect((await backup.backupChapters(book.path, day!))[0].state).toBe('same')

    // a deleted chapter comes back as a new one at the end
    const two = (await project.addChapter(book.path, 'שני')).book
    await backup.backupNow(book.path, true)
    const id2 = two.chapters[1].id
    await project.deleteChapter(book.path, id2)
    // deleting the last chapter is saved (it used to come back after reopening the book)
    expect((await project.openBook(book.path)).chapters.map((c) => c.id)).toEqual([id])
    const chs2 = await backup.backupChapters(book.path, day!)
    expect(chs2.find((c) => c.id === id2)?.state).toBe('deleted')
    const r = await backup.restoreChapter(book.path, day!, id2)
    expect(r.book.chapters.map((c) => c.title)).toEqual(['פרק 1', 'שני'])
  })

  it('links unchanged files to the previous copy and keeps only the newest days', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hk-'))
    const book = await project.createBook(root, 'ימים')
    await backup.backupNow(book.path)
    const info = await backup.backupInfo(book.path)
    const dir = info.dir!
    // pretend that copy was made two days ago, and another one three days ago
    const { renameSync, cpSync } = await import('fs')
    const today = bk.dayStamp(new Date())
    const d = (n: number) => bk.dayStamp(new Date(Date.now() - n * 86400_000))
    renameSync(join(dir, today), join(dir, d(2)))
    cpSync(join(dir, d(2)), join(dir, d(3)), { recursive: true })
    const markFile = join(dir, '.hakirchia-backup.json')
    const mark = JSON.parse(readFileSync(markFile, 'utf8'))
    mark.days = { [d(3)]: { sig: 'old', at: 1 }, [d(2)]: { sig: 'old', at: 2 } }
    writeFileSync(markFile, JSON.stringify(mark))
    const f = join(book.path, project.MANIFEST)
    utimesSync(f, new Date(), new Date(Date.now() - 5000))
    await backup.backupNow(book.path)
    const chapter = readdirSync(join(dir, today, project.CHAPTERS_DIR))[0]
    expect(statSync(join(dir, today, project.CHAPTERS_DIR, chapter)).nlink).toBeGreaterThan(1)
    expect((await backup.backupInfo(book.path)).days.map((x) => x.day)).toEqual([today, d(2), d(3)])
  })
})
