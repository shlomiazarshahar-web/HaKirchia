import { describe, expect, it } from 'vitest'
import { completionsFor, nakdanChunks, niqqudChanges, readNakdan, readSynonyms, suggest, tokensFromVocalized, wordBefore } from '../src/shared/wordtools'
import type { GlossaryEntry, Material } from '../src/shared/background'

const mat = (name: string, aliases: string[] = [], kind: Material['kind'] = 'character'): Material => ({ id: name, kind, name, aliases, tags: [], fields: [], file: '', attachments: [], at: 0 })
const term = (t: string): GlossaryEntry => ({ id: t, term: t, original: '', variants: [], accepted: [], note: '' })

describe('name completion (51)', () => {
  const list = completionsFor([term('אבן־השחר'), term('Moonstone')], [mat('נועה ברק', ['נועה']), mat('נוף', [], 'place'), mat('ירושלים', [], 'place')])

  it('collects names, other names and terms once each', () => {
    expect(list.map((c) => c.text)).toEqual(['נועה ברק', 'נועה', 'נוף', 'ירושלים', 'אבן־השחר', 'Moonstone'])
    expect(list.find((c) => c.text === 'נוף')?.source).toBe('מקום')
  })

  it('finds the word being typed', () => {
    expect(wordBefore('הלכתי עם נו')).toBe('נו')
    expect(wordBefore('אמרה "נוע')).toBe('נוע')
    expect(wordBefore('סוף. ')).toBe('')
  })

  it('offers the shortest match first, after two letters', () => {
    expect(suggest('נ', list)).toBeNull()
    const s = suggest('נוע', list)!
    expect(s.prefix).toBe(0)
    expect(s.items.map((i) => i.text)).toEqual(['נועה', 'נועה ברק'])
  })

  it('keeps Hebrew prefix letters', () => {
    const s = suggest('ולנוע', list)!
    expect(s.prefix).toBe(2)
    expect(s.items[0].text).toBe('נועה')
    expect(suggest('בירו', list)!.items[0].text).toBe('ירושלים')
  })

  it('ignores niqqud and Latin case, and does not offer a name typed in full', () => {
    expect(suggest('נוֹעָ', list)!.items[0].text).toBe('נועה')
    expect(suggest('moon', list)!.items[0].text).toBe('Moonstone')
    expect(suggest('נועה', list)!.items.map((i) => i.text)).toEqual(['נועה ברק'])
    expect(suggest('ירושלים', list)).toBeNull()
  })
})

describe('synonyms (43)', () => {
  it('reads Claude answer and drops repeats and the word itself', () => {
    const json = JSON.stringify({ senses: [{ meaning: 'הליכה', words: [{ w: 'צעד', note: '' }, { w: 'הלך', note: '' }, { w: 'פסע', note: 'ספרותי' }] }, { meaning: 'מוות', words: [{ w: 'צעד', note: '' }, { w: 'נפטר', note: '' }] }, { meaning: 'ריק', words: [] }] })
    expect(readSynonyms(json, 'הלך')).toEqual([
      { meaning: 'הליכה', words: [{ w: 'צעד' }, { w: 'פסע', note: 'ספרותי' }] },
      { meaning: 'מוות', words: [{ w: 'נפטר' }] }
    ])
    expect(readSynonyms('not json', 'x')).toEqual([])
  })
})

describe('automatic niqqud (55)', () => {
  const answer = [
    { word: 'הילד', options: [['הַיֶּלֶד', 'x'], ['הַ|יְלָדִים']] },
    { word: ' ', sep: true, options: [] },
    { word: 'הלך', options: ['הָלַךְ', 'הֹלֵךְ', 'הָלַכְתְּ'] },
    { word: ',', sep: true, options: [] },
    { word: ' ', options: [] },
    { word: 'לבית', options: [{ w: 'לַ|בַּיִת' }, { w: 'לְבֵית' }] },
    { word: '.', options: [] }
  ]

  it('reads the known answer shapes, cleaning | and keeping only readings of the same letters', () => {
    const t = readNakdan(answer)
    expect(t[0]).toEqual({ word: 'הילד', options: ['הַיֶּלֶד'] })
    expect(t[2].options).toEqual(['הָלַךְ', 'הֹלֵךְ'])
    expect(t[5].options).toEqual(['לַבַּיִת', 'לְבֵית'])
    expect(readNakdan({ data: answer.map((a) => ({ nakdan: a })) })[0].options).toEqual(['הַיֶּלֶד'])
    expect(() => readNakdan({ error: 'x' })).toThrow()
  })

  it('places words back in the text, also over niqqud already there', () => {
    const text = 'הילד הָלך, לבית.'
    const ch = niqqudChanges(text, readNakdan(answer))
    expect(ch.map((c) => [text.slice(c.from, c.to), c.text, c.options.length])).toEqual([
      ['הילד', 'הַיֶּלֶד', 1],
      ['הָלך', 'הָלַךְ', 2],
      ['לבית', 'לַבַּיִת', 2]
    ])
  })

  it('cuts long text between paragraphs', () => {
    const p = 'א'.repeat(30) + '\n'
    const chunks = nakdanChunks(p.repeat(5), 70)
    expect(chunks.join('')).toBe(p.repeat(5))
    expect(chunks.every((c) => c.length <= 70)).toBe(true)
  })

  it("reads Claude's niqqud word by word", () => {
    const text = 'שלום עולם, מה נשמע?'
    const tokens = tokensFromVocalized(text, 'שָׁלוֹם עוֹלָם, מַה נִּשְׁמָע?')
    const ch = niqqudChanges(text, tokens)
    expect(ch.map((c) => c.text)).toEqual(['שָׁלוֹם', 'עוֹלָם,', 'מַה', 'נִּשְׁמָע?'])
  })
})
