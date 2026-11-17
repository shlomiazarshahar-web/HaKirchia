// Find and replace in the whole book (feature 24). Pure text matching, used on each paragraph.
// Hebrew-aware: can ignore niqqud, and a "whole word" search can still find the word with the
// one-letter prefixes Hebrew glues to it (ו, ה, ב, כ, ל, מ, ש), so renaming "דני" also finds "ולדני".

import { NIQQUD_CLASS } from './hebrew'

export interface SearchOptions {
  /** Only whole words, not inside a longer word */
  wholeWord: boolean
  /** With wholeWord: also find the word after ו/ה/ב/כ/ל/מ/ש (only the word itself is replaced) */
  prefixes: boolean
  /** אָב finds אב and vice versa */
  ignoreNiqqud: boolean
  /** For Latin letters: A is not a */
  matchCase: boolean
}

export const DEFAULT_SEARCH: SearchOptions = { wholeWord: false, prefixes: true, ignoreNiqqud: true, matchCase: false }

export interface TextMatch {
  start: number
  end: number
}

const NIQQUD_ONE = new RegExp(`[${NIQQUD_CLASS}]`)
const NIQQUD_ALL = new RegExp(`[${NIQQUD_CLASS}]`, 'g')
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const WORD = '\\p{L}\\p{M}\\p{N}'
const PREFIX = '[ובכלמשה]'

/** Builds the regular expression for a query, or null when there is nothing to look for. */
export function buildMatcher(query: string, opts: SearchOptions): RegExp | null {
  let q = opts.ignoreNiqqud ? query.replace(NIQQUD_ALL, '') : query
  if (!q.trim()) return null
  q = escape(q)
  let src = q
  if (opts.wholeWord) {
    const startsHebrew = /^[א-ת]/.test(query.replace(NIQQUD_ALL, ''))
    const before = opts.prefixes && startsHebrew ? `(?<=(?:^|[^${WORD}])(?:${PREFIX}\\p{M}*){0,3})` : `(?<![${WORD}])`
    src = `${before}${q}(?![${WORD}])`
  }
  return new RegExp(src, `gu${opts.matchCase ? '' : 'i'}`)
}

/** Every match of the query in one paragraph's text, as ranges of the original text. */
export function findInText(text: string, query: string, opts: SearchOptions): TextMatch[] {
  const re = buildMatcher(query, opts)
  if (!re) return []
  let hay = text
  let map: number[] | null = null
  if (opts.ignoreNiqqud && NIQQUD_ONE.test(text)) {
    // the text without niqqud, and where each of its characters was in the original
    map = []
    hay = ''
    for (let i = 0; i < text.length; i++) {
      if (NIQQUD_ONE.test(text[i])) continue
      map.push(i)
      hay += text[i]
    }
  }
  const out: TextMatch[] = []
  for (const m of hay.matchAll(re)) {
    if (!m[0].length) continue
    const s = m.index!
    const e = s + m[0].length
    if (!map) {
      out.push({ start: s, end: e })
      continue
    }
    let end = map[e - 1] + 1
    // the niqqud of the last letter belongs to the match
    while (end < text.length && NIQQUD_ONE.test(text[end])) end++
    out.push({ start: map[s], end })
  }
  return out
}

/** A short piece of text around a match, for the list of results. */
export function snippet(text: string, m: TextMatch, radius = 36): { before: string; match: string; after: string } {
  let a = Math.max(0, m.start - radius)
  let b = Math.min(text.length, m.end + radius)
  // do not cut words in the middle, when possible
  if (a > 0) {
    const sp = text.indexOf(' ', a)
    if (sp >= 0 && sp < m.start) a = sp + 1
  }
  if (b < text.length) {
    const sp = text.lastIndexOf(' ', b)
    if (sp > m.end) b = sp
  }
  return {
    before: (a > 0 ? '…' : '') + text.slice(a, m.start).replace(/\s+/g, ' '),
    match: text.slice(m.start, m.end),
    after: text.slice(m.end, b).replace(/\s+/g, ' ') + (b < text.length ? '…' : '')
  }
}
