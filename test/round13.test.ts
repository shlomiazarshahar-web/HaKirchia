import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { chapterLabels, nextLabelColor, normalizeLabels, toggleLabelId } from '../src/shared/labels'
import { accentVars, luminance, normalizeAccent } from '../src/shared/accent'
import { addToLog, lastDays, mergeLog, normalizeLog, summarize } from '../src/shared/writinglog'
import { allowedInMusicPlayer, youtubeEmbed } from '../src/shared/sounds'
import { findQuote, reviewMessage, systemPrompt, textBlock } from '../src/shared/review'
import { normalizeLayout, setPaneContent, splitPane, treeOf, type PaneLayout } from '../src/shared/panes'

vi.mock('electron', () => ({ shell: { trashItem: async () => undefined } }))
const project = await import('../src/main/project')
const writingLog = await import('../src/main/writinglog')

describe('color labels (44)', () => {
  it('normalizes, toggles and keeps the book order', () => {
    const ls = normalizeLabels([{ id: 'a', name: ' נועה ', color: 'blue' }, { id: 'a', name: 'dup' }, { id: 'b', name: 'קו', color: 'nope' }, 7])
    expect(ls).toEqual([
      { id: 'a', name: 'נועה', color: 'blue' },
      { id: 'b', name: 'קו', color: 'yellow' }
    ])
    expect(toggleLabelId(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleLabelId(['a', 'b'], 'a')).toEqual(['b'])
    expect(chapterLabels(['b', 'gone', 'a'], ls).map((l) => l.id)).toEqual(['a', 'b'])
    expect(nextLabelColor(ls)).toBe('red')
  })

  it('saves labels on chapters, and a removed label leaves every chapter', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hk13-'))
    let book = await project.createBook(root, 'ספר')
    const id = book.chapters[0].id
    book = await project.setLabels(book.path, [
      { id: 'n', name: 'נועה מספרת', color: 'purple' },
      { id: 'k', name: 'קו המכתב', color: 'teal' }
    ])
    book = await project.updateChapterMeta(book.path, id, { labels: ['n', 'k', 'unknown'] })
    expect(book.chapters[0].labels).toEqual(['n', 'k'])
    book = await project.setLabels(book.path, [{ id: 'k', name: 'קו המכתב', color: 'teal' }])
    expect(book.labels.map((l) => l.id)).toEqual(['k'])
    expect(book.chapters[0].labels).toEqual(['k'])
    book = await project.updateChapterMeta(book.path, id, { labels: [] })
    expect(book.chapters[0].labels).toBeUndefined()
  })
})

describe('accent color', () => {
  it('keeps the default green as designed and makes other colors readable', () => {
    expect(normalizeAccent(undefined)).toBe('green')
    expect(normalizeAccent('#ABCDEF')).toBe('#abcdef')
    expect(normalizeAccent('javascript')).toBe('green')
    expect(accentVars('green', 'light')).toBeNull()
    const light = accentVars('#ffee88', 'light')!
    expect(luminance(light['--w-accent'])).toBeLessThanOrEqual(0.18) // white text stays readable
    const dark = accentVars('#101030', 'dark')!
    expect(luminance(dark['--w-accent'])).toBeGreaterThanOrEqual(0.22)
    expect(accentVars('burgundy', 'light')!['--w-accent']).toBe('#6b2337')
  })
})

describe('writing days (47)', () => {
  it('counts net and added words per day', () => {
    let log = addToLog({}, '2026-11-27', 120)
    log = addToLog(log, '2026-11-27', -20)
    log = addToLog(log, '2026-11-25', 50)
    expect(log['2026-11-27']).toEqual({ net: 100, added: 120 })
    expect(mergeLog(log, { '2026-11-27': { net: 5, added: 5 } })['2026-11-27']).toEqual({ net: 105, added: 125 })
    const days = lastDays(log, 3, new Date(2026, 10, 27))
    expect(days.map((d) => d.net)).toEqual([50, 0, 100])
    expect(summarize(log, '2026-11-25', '2026-11-27')).toEqual({ days: 2, words: 150, best: { day: '2026-11-27', net: 100 } })
    expect(normalizeLog({ days: { bad: 1, '2026-01-01': { net: 3.4 } } })).toEqual({ '2026-01-01': { net: 3, added: 3 } })
  })

  it('every save adds its change in words to today', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hk13-'))
    const book = await project.createBook(root, 'ספר')
    const id = book.chapters[0].id
    const doc = (t: string) => ({ type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'פרק 1' }] }, { type: 'paragraph', content: [{ type: 'text', text: t }] }] })
    await project.saveChapter(book.path, id, doc('אחת שתיים שלוש ארבע'))
    await project.saveChapter(book.path, id, doc('אחת שתיים'))
    await writingLog.flush()
    const log = await writingLog.getLog(book.path)
    const today = Object.values(log)[0]
    expect(today).toEqual({ net: 4, added: 6 })
  })
})

describe('YouTube player (56)', () => {
  it('turns links into the embedded player', () => {
    expect(youtubeEmbed('https://www.youtube.com/watch?v=jfKfPfyJRdk')).toBe('https://www.youtube.com/embed/jfKfPfyJRdk?autoplay=1&loop=1&playlist=jfKfPfyJRdk')
    expect(youtubeEmbed('youtu.be/jfKfPfyJRdk')).toContain('/embed/jfKfPfyJRdk')
    expect(youtubeEmbed('https://www.youtube.com/live/jfKfPfyJRdk?si=x')).toContain('/embed/jfKfPfyJRdk')
    expect(youtubeEmbed('https://www.youtube.com/playlist?list=PL123abc')).toBe('https://www.youtube.com/embed/videoseries?list=PL123abc&autoplay=1')
    expect(youtubeEmbed('https://example.com/watch?v=jfKfPfyJRdk')).toBeNull()
    expect(allowedInMusicPlayer('https://www.youtube.com/embed/x')).toBe(true)
    expect(allowedInMusicPlayer('http://www.youtube.com/')).toBe(false)
    expect(allowedInMusicPlayer('https://evil.com/?youtube.com')).toBe(false)
  })
})

describe('footnotes in the writing review (fix)', () => {
  it('sends footnote marks with the notes after the chapter, and finds quotes over them', () => {
    const texts = [{ title: 'פרק', paras: ['היא הלכה לנמל[^1] בבוקר.'], notes: ['הנמל של חיפה'] }]
    const block = textBlock(texts)
    expect(block).toContain('<הערות_שוליים>\n[^1] הנמל של חיפה\n</הערות_שוליים>')
    expect(reviewMessage({ scope: 'chapter', texts, kinds: [] }).context).toContain('[^1] הנמל של חיפה')
    expect(systemPrompt('x')).toContain('[^1]')
    // the editor's text has a placeholder where the footnote number is
    const hit = findQuote(['היא הלכה לנמל￼ בבוקר.'], 'הלכה לנמל[^1] בבוקר')
    expect(hit).toEqual({ para: 0, start: 4, end: 20 })
  })
})

describe('plan pane (67)', () => {
  const book = { chapters: [{ id: 'a' }], alts: [], materials: [] } as never
  it('is shown at most once and starts narrow', () => {
    const l: PaneLayout = { panes: [{ key: 'k1', content: { kind: 'chapter', id: 'a' } }], widths: [1] }
    const two = splitPane(l, 0, { kind: 'plan' }, 'h', 0.3)
    expect(two.panes.map((p) => p.content.kind)).toEqual(['chapter', 'plan'])
    const t = treeOf(two)
    expect(t.t === 'split' && t.sizes).toEqual([0.7, 0.3])
    const twice = { ...two, panes: [...two.panes, { key: 'k3', content: { kind: 'plan' as const } }] }
    expect(normalizeLayout(twice, book, 'a').panes.filter((p) => p.content.kind === 'plan')).toHaveLength(1)
    expect(setPaneContent(two, 0, { kind: 'plan' }).panes.map((p) => p.content.kind)).toEqual(['plan', 'chapter'])
  })
})
