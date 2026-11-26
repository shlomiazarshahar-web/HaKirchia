// Round 11, feature 46: translation memory. Every paragraph already translated is a pair: the
// paragraph of the original (by the paragraph sync of the source pane) and the paragraph of the
// chapter in the same place. When the paragraph being translated now repeats something from an
// earlier one (a whole line, or a phrase of a few words), the earlier pair is offered, so the same
// thing is translated the same way. Pure logic; the window builds the pairs (translate.ts).

export interface TmPair {
  chapterId: string
  /** Paragraph index in the chapter (0 = the title), the same as in the original's range */
  k: number
  source: string
  target: string
}

export interface TmMatch {
  pair: TmPair
  /** The repeated words as they are written in the earlier original */
  phrase: string
  /** Where they are in pair.source (character offsets) */
  from: number
  to: number
  words: number
  /** The whole paragraph repeats (not only a phrase of it) */
  whole: boolean
}

interface Tok {
  w: string
  from: number
  to: number
}

const WORD_RE = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu
const MARKS_RE = /[֑-ׇ]/g

/** The words of a text, folded (case, niqqud, curly apostrophes), with where each one is */
export function tmWords(text: string): Tok[] {
  const out: Tok[] = []
  for (const m of text.matchAll(WORD_RE)) {
    const w = m[0].toLowerCase().replace(MARKS_RE, '').replace(/’/g, "'")
    if (w) out.push({ w, from: m.index!, to: m.index! + m[0].length })
  }
  return out
}

/** Phrases shorter than this many words are offered only when they are the whole paragraph */
export const MIN_PHRASE_WORDS = 5
const GRAM = 3

export interface TmIndex {
  pairs: TmPair[]
  words: Tok[][]
  grams: Map<string, number[]>
  wholes: Map<string, number[]>
}

export function buildMemory(pairs: TmPair[]): TmIndex {
  const kept = pairs.filter((p) => p.source.trim() && p.target.trim())
  const words = kept.map((p) => tmWords(p.source))
  const grams = new Map<string, number[]>()
  const wholes = new Map<string, number[]>()
  words.forEach((ws, i) => {
    if (!ws.length) return
    const key = ws.map((t) => t.w).join(' ')
    const list = wholes.get(key) ?? []
    list.push(i)
    wholes.set(key, list)
    const seen = new Set<string>()
    for (let j = 0; j + GRAM <= ws.length; j++) {
      const g = ws
        .slice(j, j + GRAM)
        .map((t) => t.w)
        .join(' ')
      if (seen.has(g)) continue
      seen.add(g)
      const l = grams.get(g) ?? []
      l.push(i)
      grams.set(g, l)
    }
  })
  return { pairs: kept, words, grams, wholes }
}

/** The longest run of words two texts share: where it starts in each, and how long it is */
export function longestRun(a: string[], b: string[]): { i: number; j: number; n: number } {
  let best = { i: 0, j: 0, n: 0 }
  let prev = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0)
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] !== b[j - 1]) continue
      cur[j] = prev[j - 1] + 1
      if (cur[j] > best.n) best = { i: i - cur[j], j: j - cur[j], n: cur[j] }
    }
    prev = cur
  }
  return best
}

function sameTarget(a: string, b: string): boolean {
  return a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim()
}

/**
 * Earlier translations for a paragraph of the original: whole repeats first, then the longest
 * shared phrases. `skip` leaves out pairs (the paragraph itself). The same translation is offered once.
 */
export function findInMemory(index: TmIndex, text: string, opts: { skip?: (p: TmPair) => boolean; max?: number } = {}): TmMatch[] {
  const q = tmWords(text)
  if (!q.length) return []
  const qw = q.map((t) => t.w)
  const found = new Map<number, TmMatch>()
  const wholeKey = qw.join(' ')
  for (const i of index.wholes.get(wholeKey) ?? []) {
    const p = index.pairs[i]
    if (opts.skip?.(p)) continue
    const ws = index.words[i]
    found.set(i, { pair: p, phrase: p.source.slice(ws[0].from, ws[ws.length - 1].to), from: ws[0].from, to: ws[ws.length - 1].to, words: ws.length, whole: true })
  }
  const cands = new Set<number>()
  for (let j = 0; j + GRAM <= qw.length; j++) for (const i of index.grams.get(qw.slice(j, j + GRAM).join(' ')) ?? []) if (!found.has(i)) cands.add(i)
  for (const i of cands) {
    const p = index.pairs[i]
    if (opts.skip?.(p)) continue
    const ws = index.words[i]
    const run = longestRun(
      qw,
      ws.map((t) => t.w)
    )
    if (run.n < MIN_PHRASE_WORDS) continue
    const from = ws[run.j].from
    const to = ws[run.j + run.n - 1].to
    found.set(i, { pair: p, phrase: p.source.slice(from, to), from, to, words: run.n, whole: false })
  }
  const all = [...found.values()].sort((a, b) => Number(b.whole) - Number(a.whole) || b.words - a.words)
  const out: TmMatch[] = []
  for (const m of all) {
    if (out.some((o) => sameTarget(o.pair.target, m.pair.target))) continue
    out.push(m)
    if (out.length >= (opts.max ?? 4)) break
  }
  return out
}

/**
 * Earlier translations of a phrase the translator marked: every paragraph of the original that has
 * these words in this order (any length, even one word), in book order.
 */
export function findPhrase(index: TmIndex, phrase: string, opts: { skip?: (p: TmPair) => boolean; max?: number } = {}): TmMatch[] {
  const q = tmWords(phrase).map((t) => t.w)
  if (!q.length) return []
  const out: TmMatch[] = []
  index.words.forEach((ws, i) => {
    if (out.length >= (opts.max ?? 6)) return
    const p = index.pairs[i]
    if (opts.skip?.(p)) return
    for (let j = 0; j + q.length <= ws.length; j++) {
      let ok = true
      for (let k = 0; k < q.length && ok; k++) if (ws[j + k].w !== q[k]) ok = false
      if (!ok) continue
      const from = ws[j].from
      const to = ws[j + q.length - 1].to
      if (!out.some((o) => sameTarget(o.pair.target, p.target))) out.push({ pair: p, phrase: p.source.slice(from, to), from, to, words: q.length, whole: q.length === ws.length })
      return
    }
  })
  return out
}

/** Asking Claude which words of the earlier translation render the repeated phrase */
export function phrasePrompt(source: string, phrase: string, target: string): string {
  return [
    'לפניך פסקה מספר מקור ואת התרגום שלה, שכתב המתרגם.',
    `מצא בתרגום את המילים המדויקות שמתרגמות את הביטוי: "${phrase}".`,
    'החזר רק את המילים האלה, כפי שהן כתובות בתרגום, בלי מרכאות ובלי הסבר. אם אין בתרגום מילים כאלה, החזר מקף אחד: -',
    '',
    'המקור:',
    source,
    '',
    'התרגום:',
    target
  ].join('\n')
}
