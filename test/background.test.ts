import { describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  buildTermIndex,
  chaptersInStoryOrder,
  checkTerms,
  GROUP_PAD,
  groupAt,
  groupBoxes,
  groupTree,
  ungroup,
  findFlags,
  inconsistencies,
  moveEvent,
  normalizeBackground,
  occurrences,
  skeleton,
  translationGaps,
  type CheckTerm,
  type Material,
  type TimelineEvent
} from '../src/shared/background'

vi.mock('electron', () => ({ shell: { trashItem: async () => undefined } }))
const project = await import('../src/main/project')

const mat = (p: Partial<Material>): Material => ({ id: 'm1', kind: 'character', name: 'נועה', aliases: [], tags: [], fields: [], file: 'דמויות/נועה.docx', attachments: [], at: 0, ...p })
const term = (t: string, more: Partial<CheckTerm> = {}): CheckTerm => ({ id: t, from: 'glossary', term: t, accepted: [], variants: [], ...more })

describe('where a name appears (feature 34)', () => {
  it('finds names with Hebrew prefixes and niqqud, per chapter, with the first place', () => {
    const chapters = [
      { id: 'a', paras: ['שלום', 'ולנועה היה כלב. נוֹעָה צחקה.'] },
      { id: 'b', paras: ['אין כאן כלום'] },
      { id: 'c', paras: ['נועמי אינה נועה? כן, נועה.'] }
    ]
    const occ = occurrences(chapters, ['נועה'])
    expect(occ.map((o) => [o.chapterId, o.count])).toEqual([
      ['a', 2],
      ['c', 2]
    ])
    expect(occ[0].first).toEqual({ para: 1, start: 2, end: 6 })
  })
  it('counts aliases too, without counting the same words twice', () => {
    const occ = occurrences([{ id: 'a', paras: ['נועה ברק הגיעה. ברק חייכה.'] }], ['נועה ברק', 'ברק'])
    expect(occ[0].count).toBe(2)
  })
})

describe('glossary consistency (feature 20)', () => {
  it('skeleton ignores ו and י after the first letter, and niqqud', () => {
    expect(skeleton('דניאל')).toBe(skeleton('דנאל'))
    expect(skeleton('שׁוּלְחָן')).toBe(skeleton('שלחן'))
    expect(skeleton('ויקטור')).toBe('וקטר')
  })
  it('marks full/defective spelling of a term, but not the term itself with a prefix', () => {
    const idx = buildTermIndex([term('דניאל')])
    expect(findFlags('ולדניאל אמר', idx)).toEqual([])
    const f = findFlags('אז דנאל ולדנאל באו', idx)
    expect(f.map((x) => x.spelled)).toEqual(['דנאל', 'דנאל'])
    expect(f[1].start).toBe('אז דנאל ול'.length)
    expect(f[0].why).toBe('spelling')
  })
  it('leaves accepted spellings and short terms alone', () => {
    expect(findFlags('דנאל', buildTermIndex([term('דניאל', { accepted: ['דנאל'] })]))).toEqual([])
    expect(findFlags('דין', buildTermIndex([term('דן')]))).toEqual([])
  })
  it('marks known wrong spellings, also of several words', () => {
    const f = findFlags('הם הגיעו לנמל-חיפה בבוקר', buildTermIndex([term('נמל חיפה', { variants: ['נמל-חיפה'] })]))
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ spelled: 'נמל-חיפה', why: 'variant', term: 'נמל חיפה' })
  })
  it('lists every different spelling with its chapters', () => {
    const chapters = [
      { id: 'a', paras: ['קיושי הלכה', 'קיוושי?'] },
      { id: 'b', paras: ['קיוושי ושוב קיוושי'] }
    ]
    const res = inconsistencies(chapters, [term('קיושי')])
    expect(res).toHaveLength(1)
    expect(res[0]).toMatchObject({ spelled: 'קיוושי', count: 3 })
    expect(res[0].places.map((p) => [p.chapterId, p.count])).toEqual([
      ['a', 1],
      ['b', 2]
    ])
  })
  it('checks the names of characters and places word by word, with their aliases as right forms', () => {
    const terms = checkTerms([], [mat({ name: 'אליהו כהן', aliases: ['אלי'] }), mat({ id: 'r', kind: 'research', name: 'נמל' })])
    expect(terms.map((t) => t.term)).toEqual(['אליהו', 'כהן', 'אלי'])
    expect(inconsistencies([{ id: 'a', paras: ['אלהו בא. אלי גם.'] }], terms).map((i) => i.spelled)).toEqual(['אלהו'])
  })
  it('finds chapters where the original uses a term the translation does not', () => {
    const gaps = translationGaps(
      [
        { id: 'a', paras: ['קיושי הלכה'] },
        { id: 'b', paras: ['האווטאר הלכה'] }
      ],
      { a: ['Kyoshi walked'], b: ['Kyoshi walked. Kyoshi ran.'] },
      [{ id: 'g', term: 'קיושי', original: 'Kyoshi' }]
    )
    expect(gaps).toEqual([{ termId: 'g', term: 'קיושי', original: 'Kyoshi', chapterId: 'b', inSource: 2, inChapter: 0 }])
  })
})

describe('timeline (feature 21)', () => {
  const ev = (id: string, chapterIds: string[]): TimelineEvent => ({ id, when: '', title: id, text: '', chapterIds, materialIds: [] })
  it('moves events', () => {
    const l = [ev('1', []), ev('2', []), ev('3', [])]
    expect(moveEvent(l, 2, 0).map((e) => e.id)).toEqual(['3', '1', '2'])
    expect(moveEvent(l, 0, 5)).toBe(l)
  })
  it('shows chapters in story order and marks flashbacks', () => {
    const order = chaptersInStoryOrder([ev('e1', ['c3']), ev('e2', ['c1']), ev('e3', ['c2', 'c3']), ev('e4', ['c4'])], ['c1', 'c2', 'c3', 'c4'])
    expect(order.map((o) => [o.number, o.back])).toEqual([
      [3, false],
      [1, true],
      [2, true],
      [4, false]
    ])
  })
  it('drops links to deleted chapters and pages when reading', () => {
    const bg = normalizeBackground(
      {
        materials: [mat({})],
        timeline: [{ ...ev('e', ['gone', 'c1']), materialIds: ['m1', 'x'] }],
        images: [{ id: 'i', file: 'a.png', caption: '', chapterId: 'gone', at: 0 }]
      },
      ['c1']
    )
    expect(bg.timeline[0].chapterIds).toEqual(['c1'])
    expect(bg.timeline[0].materialIds).toEqual(['m1'])
    expect(bg.images[0].chapterId).toBeUndefined()
  })
})

describe('background materials on disk (feature 11, 37)', () => {
  it('creates, renames, saves and deletes a page, with its Word file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hk-'))
    let book = await project.createBook(root, 'ספר')
    const c = await project.createMaterial(book.path, 'character')
    book = c.book
    const m = c.value
    expect(m).toMatchObject({ name: 'דמות חדשה', file: 'דמויות/דמות חדשה.docx' })
    expect(m.fields.map((f) => f.label)).toContain('גיל')
    expect(existsSync(join(book.path, 'חומרי רקע', 'דמויות', 'דמות חדשה.docx'))).toBe(true)

    // a second page with the same name gets its own file
    const c2 = await project.createMaterial(book.path, 'character')
    expect(c2.value.file).toBe('דמויות/דמות חדשה (2).docx')

    // renaming renames the file
    book = (await project.updateMaterial(book.path, m.id, { name: 'נועה ברק', aliases: ['נועה'], fields: [{ label: 'גיל', value: '34' }] })).book
    const renamed = book.materials.find((x) => x.id === m.id)!
    expect(renamed.file).toBe('דמויות/נועה ברק.docx')
    expect(existsSync(join(book.path, 'חומרי רקע', 'דמויות', 'נועה ברק.docx'))).toBe(true)
    expect(renamed.fields).toEqual([{ label: 'גיל', value: '34' }])

    // its free text is a Word file
    await project.saveMaterial(book.path, m.id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'מדברת מעט' }] }] })
    const loaded = await project.loadMaterial(book.path, m.id)
    expect(JSON.stringify(loaded.doc)).toContain('מדברת מעט')

    // linked in the timeline and an image, then deleted: the links go, the image stays
    const imgFile = join(root, 'pic.png')
    writeFileSync(imgFile, Buffer.from('89504e470d0a1a0a', 'hex'))
    book = (await project.addImages(book.path, [imgFile], { materialId: m.id })).book
    expect(book.images[0]).toMatchObject({ file: 'pic.png', materialId: m.id })
    expect(existsSync(join(book.path, 'השראה', 'pic.png'))).toBe(true)
    book = (await project.setTimeline(book.path, [{ id: 'e', when: '1947', title: 'פגישה', text: '', chapterIds: [book.chapters[0].id], materialIds: [m.id] }])).book
    book = (await project.deleteMaterial(book.path, m.id)).book
    expect(book.materials.map((x) => x.id)).toEqual([c2.value.id])
    expect(book.images[0].materialId).toBeUndefined()
    expect(book.timeline[0].materialIds).toEqual([])
    expect(book.timeline[0].chapterIds).toHaveLength(1)

    // deleting a chapter unlinks it from the timeline
    book = (await project.deleteChapter(book.path, book.chapters[0].id)).book
    expect(book.timeline[0].chapterIds).toEqual([])
  })

  it('keeps the glossary in the book file, and refuses non-images', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hk-'))
    const book = await project.createBook(root, 'ספר')
    await project.setGlossary(book.path, [{ id: 'g', term: 'קיושי', original: 'Kyoshi', variants: ['קיוושי'], accepted: [], note: '' }])
    const m = JSON.parse(readFileSync(join(book.path, project.MANIFEST), 'utf8'))
    expect(m.glossary[0].term).toBe('קיושי')
    expect((await project.openBook(book.path)).glossary[0].original).toBe('Kyoshi')
    const txt = join(root, 'a.txt')
    writeFileSync(txt, 'x')
    await expect(project.addImages(book.path, [txt], {})).rejects.toThrow()
  })
})

describe('canvas groups', () => {
  const size = () => ({ w: 100, h: 50 })
  const imgs = [
    { id: 'a', file: 'a.png', caption: '', at: 0, x: 0, y: 0, w: 100, groupId: 'g' },
    { id: 'b', file: 'b.png', caption: '', at: 0, x: 300, y: 100, w: 100, groupId: 'h' }
  ]
  const groups = [
    { id: 'g', title: 'G', x: 0, y: 0, w: 10, h: 10 },
    { id: 'h', title: 'H', x: 0, y: 0, w: 10, h: 10, parentId: 'g' },
    { id: 'e', title: 'E', x: 900, y: 900, w: 200, h: 150 }
  ]
  it('a group wraps its images and inner groups; an empty one keeps its box', () => {
    const b = groupBoxes(imgs, groups, size)
    const h = b.get('h')!
    const g = b.get('g')!
    expect(h.x).toBeLessThan(300)
    expect(g.x).toBeLessThanOrEqual(-GROUP_PAD)
    expect(g.x + g.w).toBeGreaterThanOrEqual(h.x + h.w)
    expect(b.get('e')).toEqual({ x: 900, y: 900, w: 200, h: 150 })
    expect(groupAt(groups, b, { x: 350, y: 120 })).toBe('h')
    expect(groupAt(groups, b, { x: 50, y: 20 })).toBe('g')
  })
  it('removing a group hands its members to the group around it', () => {
    const r = ungroup(imgs, groups, 'h')
    expect(r.images.find((i) => i.id === 'b')!.groupId).toBe('g')
    expect(r.groups.map((g) => g.id)).toEqual(['g', 'e'])
    expect([...groupTree(groups, 'g')].sort()).toEqual(['g', 'h'])
  })
  it('a loop of groups is broken when read', () => {
    const bg = normalizeBackground({ groups: [{ id: 'x', title: '', x: 0, y: 0, w: 100, h: 100, parentId: 'y' }, { id: 'y', title: '', x: 0, y: 0, w: 100, h: 100, parentId: 'x' }], images: [{ id: 'i', file: 'f', groupId: 'zz' }] }, [])
    expect(bg.groups.filter((g) => g.parentId).length).toBeLessThan(2)
    expect(bg.images[0].groupId).toBeUndefined()
  })
})
