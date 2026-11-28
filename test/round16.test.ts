import { describe, expect, it } from 'vitest'
import { applyChange, emptyState, joinState, normalizeState, resolvePath, viewOf, type AppState } from '../src/shared/appstate'
import type { Settings } from '../src/shared/types'

// Computer A has C:\ and G:\ ; computer B has only G:\ (Google Drive with the same letter) and D:\
const onA = (p: string) => /^[CG]:/.test(p)
const onB = (p: string) => /^[GD]:/.test(p)

const base = (extra: Partial<Settings> = {}): Settings => ({ theme: 'light', recent: [], lastChapter: {}, ...extra })

function aSettings(): Settings {
  return base({
    theme: 'dark',
    accent: 'wine',
    customFonts: [{ family: 'David', file: 'x-david.ttf' }],
    recent: [
      { id: 'drive', path: 'G:\\ספרים\\הנמל', title: 'הנמל', chapterCount: 12, lastOpened: 200 },
      { id: 'local', path: 'C:\\Users\\a\\Documents\\טיוטה', title: 'טיוטה', chapterCount: 3, lastOpened: 100 }
    ],
    lastChapter: { 'G:\\ספרים\\הנמל': 'ch7', 'C:\\Users\\a\\Documents\\טיוטה': 'ch1' },
    workshopPath: 'G:\\ספרים\\סדנה',
    zoom: 1.2
  })
}

describe('round 16: app state shared between computers', () => {
  it('the first computer writes everything it has', () => {
    const s = joinState(null, aSettings(), 'A', 'מחשב נייח', onA, 1000)
    expect(s.books.map((b) => b.id)).toEqual(['drive', 'local'])
    expect(s.books[0].paths).toEqual({ A: 'G:\\ספרים\\הנמל' })
    expect(s.books[0].lastChapter).toBe('ch7')
    expect(s.settings.theme).toBe('dark')
    expect(s.settings.customFonts?.[0].family).toBe('David')
    expect((s.settings as Record<string, unknown>).zoom).toBeUndefined()
    expect(s.workshop.paths).toEqual({ A: 'G:\\ספרים\\סדנה' })
    expect(s.computers.A.name).toBe('מחשב נייח')
  })

  it('a second computer sees the books: on the shared drive available, on the other computer’s C: greyed out', () => {
    const s = joinState(null, aSettings(), 'A', 'נייח', onA)
    const v = viewOf(s, base({ zoom: 1 }), 'B', onB)
    expect(v.theme).toBe('dark')
    expect(v.zoom).toBe(1) // stays per computer
    const drive = v.recent.find((r) => r.id === 'drive')!
    const local = v.recent.find((r) => r.id === 'local')!
    expect(drive.unavailable).toBeUndefined()
    expect(drive.path).toBe('G:\\ספרים\\הנמל')
    expect(local.unavailable).toBe(true)
    expect(v.lastChapter['G:\\ספרים\\הנמל']).toBe('ch7')
    expect(v.workshopPath).toBe('G:\\ספרים\\סדנה')
    expect(v.workshopUnavailable).toBe(false)
  })

  it('choosing the path again on one computer does not change the other computer’s path', () => {
    let s = joinState(null, aSettings(), 'A', 'נייח', onA)
    const before = viewOf(s, base(), 'B', onB)
    const after: Settings = { ...before, recent: before.recent.map((r) => (r.id === 'local' ? { ...r, path: 'D:\\עותק\\טיוטה', unavailable: undefined } : r)) }
    s = applyChange(s, before, after, 'B', onB)
    const book = s.books.find((b) => b.id === 'local')!
    expect(book.paths).toEqual({ A: 'C:\\Users\\a\\Documents\\טיוטה', B: 'D:\\עותק\\טיוטה' })
    expect(viewOf(s, base(), 'A', onA).recent.find((r) => r.id === 'local')!.path).toBe('C:\\Users\\a\\Documents\\טיוטה')
    expect(viewOf(s, base(), 'B', onB).recent.find((r) => r.id === 'local')!.unavailable).toBeUndefined()
  })

  it('a borrowed path that is missing here is not recorded as this computer’s path', () => {
    let s = joinState(null, aSettings(), 'A', 'נייח', onA)
    const before = viewOf(s, base(), 'B', onB)
    // B archives the greyed-out book: only that changes
    const after: Settings = { ...before, recent: before.recent.map((r) => (r.id === 'local' ? { ...r, archived: true } : r)) }
    s = applyChange(s, before, after, 'B', onB)
    const book = s.books.find((b) => b.id === 'local')!
    expect(book.archived).toBe(true)
    expect(book.paths).toEqual({ A: 'C:\\Users\\a\\Documents\\טיוטה' })
  })

  it('changes made meanwhile on the other computer are kept (only what changed is written)', () => {
    const start = joinState(null, aSettings(), 'A', 'נייח', onA)
    // B read the file, then A changed the accent and added a book
    const bBefore = viewOf(start, base(), 'B', onB)
    const aBefore = viewOf(start, base(), 'A', onA)
    const aAfter: Settings = { ...aBefore, accent: 'navy', recent: [{ id: 'new', path: 'G:\\ספרים\\חדש', title: 'חדש', chapterCount: 1, lastOpened: 300 }, ...aBefore.recent] }
    const fresh = applyChange(start, aBefore, aAfter, 'A', onA)
    // B (not knowing) moves on to chapter 9 in the harbor book and removes nothing
    const bAfter: Settings = { ...bBefore, lastChapter: { ...bBefore.lastChapter, 'G:\\ספרים\\הנמל': 'ch9' } }
    const merged = applyChange(fresh, bBefore, bAfter, 'B', onB)
    expect(merged.settings.accent).toBe('navy')
    expect(merged.books.some((b) => b.id === 'new')).toBe(true)
    expect(merged.books.find((b) => b.id === 'drive')!.lastChapter).toBe('ch9')
  })

  it('removing a book from the list removes it everywhere; a book this computer never saw stays', () => {
    const start = joinState(null, aSettings(), 'A', 'נייח', onA)
    const withNew: AppState = { ...start, books: [...start.books, { id: 'other', title: 'אחר', chapterCount: 1, lastOpened: 1, paths: { C2: 'E:\\x' } }] }
    const before = viewOf(start, base(), 'B', onB)
    const after: Settings = { ...before, recent: before.recent.filter((r) => r.id !== 'local') }
    const s = applyChange(withNew, before, after, 'B', onB)
    expect(s.books.map((b) => b.id).sort()).toEqual(['drive', 'other'])
  })

  it('a book that gets its real id keeps where the writer stood', () => {
    let s = joinState(null, base({ recent: [{ id: 'tmp', path: 'G:\\ב', title: 'ב', chapterCount: 2, lastOpened: 5 }], lastChapter: { 'G:\\ב': 'c2' } }), 'A', 'נייח', onA)
    const before = viewOf(s, base(), 'A', onA)
    const after: Settings = { ...before, recent: [{ id: 'real', prevId: 'tmp', path: 'G:\\ב', title: 'ב', chapterCount: 2, lastOpened: 9 }] }
    s = applyChange(s, before, after, 'A', onA)
    expect(s.books.map((b) => b.id)).toEqual(['real'])
    expect(s.books[0].lastChapter).toBe('c2')
  })

  it('joining an existing file: its settings win, this computer’s own books are added, the same book is matched by id', () => {
    const file = joinState(null, aSettings(), 'A', 'נייח', onA)
    const bLocal = base({
      theme: 'light',
      dictionary: ['שלומי'],
      recent: [
        { id: 'drive', path: 'G:\\ספרים\\הנמל', title: 'הנמל', chapterCount: 12, lastOpened: 500 },
        { id: 'bonly', path: 'D:\\ספר של ב', title: 'ספר של ב', chapterCount: 4, lastOpened: 50 }
      ],
      lastChapter: { 'D:\\ספר של ב': 'x1' }
    })
    const s = joinState({ ...file, settings: { ...file.settings, dictionary: ['נועה'] } }, bLocal, 'B', 'נייד', onB, 2000)
    expect(s.settings.theme).toBe('dark')
    expect(s.settings.dictionary?.sort()).toEqual(['נועה', 'שלומי'].sort())
    expect(s.books.map((b) => b.id).sort()).toEqual(['bonly', 'drive', 'local'])
    const drive = s.books.find((b) => b.id === 'drive')!
    expect(drive.paths).toEqual({ A: 'G:\\ספרים\\הנמל', B: 'G:\\ספרים\\הנמל' })
    expect(drive.lastOpened).toBe(500)
    expect(s.books.find((b) => b.id === 'bonly')!.lastChapter).toBe('x1')
    expect(Object.keys(s.computers).sort()).toEqual(['A', 'B'])
  })

  it('resolvePath prefers this computer’s own folder, then a folder of another computer that is here too', () => {
    expect(resolvePath({ A: 'C:\\a', B: 'D:\\b' }, 'B', onB)).toEqual({ path: 'D:\\b', available: true, borrowed: false })
    expect(resolvePath({ A: 'G:\\a' }, 'B', onB)).toEqual({ path: 'G:\\a', available: true, borrowed: true })
    expect(resolvePath({ A: 'C:\\a' }, 'B', onB)).toEqual({ path: 'C:\\a', available: false, borrowed: false })
  })

  it('reads only a real app-state file', () => {
    expect(() => normalizeState({ hello: 1 })).toThrow()
    const s = normalizeState({ kind: 'app-state', books: [{ id: 'a', title: 'x', paths: { A: 'C:\\x', B: 5 } }, { id: 'a' }, { nope: 1 }], settings: { theme: 'dark', zoom: 3 } })
    expect(s.books).toHaveLength(1)
    expect(s.books[0].paths).toEqual({ A: 'C:\\x' })
    expect(s.settings).toEqual({ theme: 'dark' })
    expect(emptyState().books).toEqual([])
  })
})
