// Round 10, "כלי כתיבה בעברית": the pure logic of three writing tools.
//  - Completing names (feature 51): names of characters and places, and glossary terms, offered
//    while typing; Tab takes the suggestion. Hebrew prefixes are kept: ולנו → ולנועה.
//  - Synonyms (feature 43): Claude's answer, read and cleaned.
//  - Automatic niqqud (feature 55): Dicta's Nakdan answer (or Claude's), read word by word, with
//    every reading of a word that has more than one.
import type { GlossaryEntry, Material } from './background'
import { stripNiqqud } from './hebrew'

// ---------------------------------------------------------------------------
// Completing names (51)
// ---------------------------------------------------------------------------

export interface Completion {
  /** As written in the book */
  text: string
  /** Lower case, without niqqud: what typed letters are compared with */
  key: string
  /** Where it comes from, shown next to it: "דמות", "מקום", "מילון" */
  source: string
}

const SOURCE: Record<string, string> = { character: 'דמות', place: 'מקום', research: 'מחקר' }

/** The words a book offers: background page names and their other names, and glossary terms. */
export function completionsFor(glossary: GlossaryEntry[], materials: Material[]): Completion[] {
  const out = new Map<string, Completion>()
  const add = (text: string, source: string) => {
    const t = text.trim().replace(/\s+/g, ' ')
    if (t.length < 2) return
    const key = normalize(t)
    if (!out.has(key)) out.set(key, { text: t, key, source })
  }
  for (const m of materials) {
    const src = SOURCE[m.kind] ?? 'דף רקע'
    add(m.name, src)
    for (const a of m.aliases) add(a, src)
  }
  for (const g of glossary) {
    add(g.term, 'מילון')
    for (const a of g.accepted) add(a, 'מילון')
  }
  return [...out.values()]
}

export function normalize(s: string): string {
  return stripNiqqud(s).toLowerCase()
}

/** The letters a word is made of while it is being typed (Hebrew, Latin, digits, geresh) */
const WORD_CHAR = /[\p{L}\p{M}\p{N}'׳״"]/u
const PREFIX_LETTERS = 'ובכלמשה'

/** The word being typed: the letters right before the cursor (empty after a space). */
export function wordBefore(textBefore: string): string {
  let i = textBefore.length
  while (i > 0 && WORD_CHAR.test(textBefore[i - 1])) i--
  // a quote mark at the start is punctuation, not part of the word
  let w = textBefore.slice(i)
  while (w && /['"׳״]/.test(w[0])) w = w.slice(1)
  return w
}

export interface Suggestion {
  /** How many typed letters at the start are prefix letters (ו, ל...) that stay as they are */
  prefix: number
  /** The matches, best first */
  items: Completion[]
}

/**
 * What to offer for the word being typed. At least 2 letters of the name itself must be typed.
 * The word may start with up to 3 Hebrew prefix letters (וכש...), which are kept.
 * A name already typed in full is not offered again.
 */
export function suggest(typed: string, list: Completion[], max = 6): Suggestion | null {
  if (!typed || !list.length) return null
  const t = normalize(typed)
  const isHeb = /[א-ת]/.test(t[0] ?? '')
  for (let p = 0; p <= (isHeb ? Math.min(3, t.length - 2) : 0); p++) {
    if (p > 0 && !PREFIX_LETTERS.includes(t[p - 1])) break
    const rest = t.slice(p)
    if (rest.length < 2) break
    const items = list
      .filter((c) => c.key.length > rest.length && c.key.startsWith(rest))
      .sort((a, b) => a.key.length - b.key.length || a.key.localeCompare(b.key, 'he'))
      .slice(0, max)
    if (items.length) {
      // the typed prefix count is in the typed text (with niqqud), so count letters there
      return { prefix: prefixLength(typed, p), items }
    }
  }
  return null
}

/** The length in the typed text (which may have niqqud) of its first n letters */
function prefixLength(typed: string, letters: number): number {
  let seen = 0
  let i = 0
  while (i < typed.length && seen < letters) {
    i++
    while (i < typed.length && /\p{M}/u.test(typed[i])) i++
    seen++
  }
  return i
}

// ---------------------------------------------------------------------------
// Synonyms (43)
// ---------------------------------------------------------------------------

export interface SynonymSense {
  /** A few words on this meaning of the word */
  meaning: string
  words: { w: string; note?: string }[]
}

export const SYNONYM_SCHEMA = {
  type: 'object',
  properties: {
    senses: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          meaning: { type: 'string' },
          words: {
            type: 'array',
            items: { type: 'object', properties: { w: { type: 'string' }, note: { type: 'string' } }, required: ['w', 'note'], additionalProperties: false }
          }
        },
        required: ['meaning', 'words'],
        additionalProperties: false
      }
    }
  },
  required: ['senses'],
  additionalProperties: false
} as const

export function synonymPrompt(word: string, sentence: string): string {
  return [
    `מילה מתוך ספר פרוזה בעברית: «${word}»`,
    sentence && sentence !== word ? `המשפט שבו היא מופיעה: «${sentence}»` : '',
    '',
    'תן מילים נרדפות וביטויים חלופיים למילה הזאת, כמו מילון נרדפות טוב.',
    '- חלק לפי משמעויות. המשמעות שמתאימה למשפט קודם. משמעות נוספת רק אם היא באמת קיימת.',
    '- כל חלופה כתובה בדיוק בצורה שתחליף את המילה כפי שהיא כתובה בטקסט: אותה נטייה (מין, מספר, זמן, גוף, סמיכות), ועם אותן אותיות שימוש בתחילתה (ו, ה, ב, כ, ל, מ, ש). אם המילה היא "וכשהלך", החלופה היא "וכשצעד".',
    '- בלי ניקוד, אלא אם המילה עצמה מנוקדת.',
    '- עד 8 חלופות לכל משמעות, מהשכיחה לנדירה. לא לחזור על המילה עצמה.',
    '- note: מילה או שתיים כשיש הבדל חשוב (גבוה, ספרותי, סלנג, ארכאי). אחרת ריק.',
    '- meaning: עד חמש מילים.'
  ]
    .filter((l) => l !== '')
    .join('\n')
}

/** Claude's JSON answer, cleaned: no empty or repeated words, not the word itself */
export function readSynonyms(json: string, word: string): SynonymSense[] {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    const m = json.match(/\{[\s\S]*\}/)
    if (!m) return []
    try {
      data = JSON.parse(m[0])
    } catch {
      return []
    }
  }
  const senses = (data as { senses?: unknown })?.senses
  if (!Array.isArray(senses)) return []
  const self = normalize(word)
  const seen = new Set<string>([self])
  const out: SynonymSense[] = []
  for (const s of senses) {
    if (!s || typeof s !== 'object') continue
    const meaning = String((s as { meaning?: unknown }).meaning ?? '').trim()
    const words: SynonymSense['words'] = []
    for (const x of ((s as { words?: unknown }).words as unknown[]) ?? []) {
      const w = String(typeof x === 'string' ? x : ((x as { w?: unknown })?.w ?? '')).trim()
      const note = typeof x === 'object' && x ? String((x as { note?: unknown }).note ?? '').trim() : ''
      if (!w || seen.has(normalize(w))) continue
      seen.add(normalize(w))
      words.push(note ? { w, note } : { w })
    }
    if (words.length) out.push({ meaning, words })
  }
  return out
}

// ---------------------------------------------------------------------------
// Automatic niqqud (55)
// ---------------------------------------------------------------------------

/** One word (or a run of spaces and punctuation) of the text, with its readings */
export interface NakdanToken {
  /** As it was sent */
  word: string
  /** Its readings with niqqud, the likeliest first; empty for spaces, punctuation, foreign words */
  options: string[]
}

const METEG = 'ֽ'

/** A reading as Dicta writes it: | marks where a prefix ends; meteg is not wanted in prose */
export function cleanOption(o: string): string {
  return o.replace(/\|/g, '').replace(new RegExp(METEG, 'g'), '')
}

function optionText(o: unknown): string {
  if (typeof o === 'string') return o
  if (Array.isArray(o)) return typeof o[0] === 'string' ? o[0] : ''
  if (o && typeof o === 'object') {
    const r = o as Record<string, unknown>
    for (const k of ['w', 'word', 'text', 'menukad']) if (typeof r[k] === 'string') return r[k] as string
  }
  return ''
}

/**
 * Reads Dicta's Nakdan answer. Known shapes: a list of {word, options, sep?}, where an option is a
 * string, or a list whose first item is the string, or {w: string}; or the same list under "data",
 * each item possibly wrapped as {nakdan: {...}}. A reading that does not match its word letter for
 * letter is dropped, so the text itself never changes, only its niqqud.
 */
export function readNakdan(answer: unknown): NakdanToken[] {
  let list: unknown = answer
  if (list && !Array.isArray(list) && typeof list === 'object') {
    const r = list as Record<string, unknown>
    list = r.data ?? r.result ?? r.results ?? r.words
  }
  if (!Array.isArray(list)) throw new Error('תשובה לא צפויה מהנקדן')
  const out: NakdanToken[] = []
  for (let item of list) {
    if (item && typeof item === 'object' && 'nakdan' in (item as object)) item = (item as { nakdan: unknown }).nakdan
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const word = typeof r.word === 'string' ? r.word : ''
    if (!word) continue
    const raw = r.sep ? [] : Array.isArray(r.options) ? r.options : []
    const base = bare(word)
    const options: string[] = []
    for (const o of raw) {
      const t = cleanOption(optionText(o))
      if (t && bare(t) === base && !options.includes(t)) options.push(t)
    }
    out.push({ word, options })
  }
  return out
}

/** The letters alone: no niqqud, no Dicta marks */
function bare(s: string): string {
  return stripNiqqud(s.replace(/\|/g, ''))
}

/** A word with niqqud placed back in the text */
export interface NiqqudChange {
  /** Offset in the text that was sent */
  from: number
  to: number
  /** What is there now */
  old: string
  /** The chosen reading */
  text: string
  /** Every reading (more than one: the writer may want another) */
  options: string[]
}

/**
 * Places each token back in the text that was sent: finds its word from where the last one ended.
 * Words the nakdan has no reading for, or that already read the same, are left out.
 */
export function niqqudChanges(text: string, tokens: NakdanToken[]): NiqqudChange[] {
  const out: NiqqudChange[] = []
  const plain = stripNiqqud(text)
  // offsets in the plain text → offsets in the text (which may already have some niqqud)
  const map: number[] = []
  for (let i = 0; i < text.length; i++) if (stripNiqqud(text[i]) !== '') map.push(i)
  map.push(text.length)
  let at = 0
  for (const t of tokens) {
    const w = stripNiqqud(t.word)
    if (!w.trim()) continue
    const i = plain.indexOf(w, at)
    if (i < 0) continue
    at = i + w.length
    if (!t.options.length) continue
    const from = map[i]
    let to = map[i + w.length]
    // niqqud right after the word's last letter belongs to it
    while (to < text.length && stripNiqqud(text[to]) === '') to++
    const old = text.slice(from, to)
    if (old === t.options[0] && t.options.length < 2) continue
    out.push({ from, to, old, text: t.options[0], options: t.options })
  }
  return out
}

/** The text in pieces Dicta takes at once, cut between paragraphs (or spaces, for a long one) */
export function nakdanChunks(text: string, size = 4000): string[] {
  const out: string[] = []
  let rest = text
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n', size)
    if (cut < size / 2) cut = rest.lastIndexOf(' ', size)
    if (cut <= 0) cut = size
    out.push(rest.slice(0, cut + 1))
    rest = rest.slice(cut + 1)
  }
  if (rest) out.push(rest)
  return out
}

/** Asking Claude for niqqud, when Dicta cannot be reached */
export function claudeNiqqudPrompt(text: string): string {
  return [
    'נקד את הטקסט העברי הבא בניקוד מלא ותקני, לפי ההקשר. אל תשנה אף אות, רווח או סימן פיסוק, ואל תוסיף דבר.',
    'החזר רק את הטקסט המנוקד, בלי הסברים.',
    '',
    text
  ].join('\n')
}

/** Claude's niqqud as tokens, word by word, so it is placed back like Dicta's */
export function tokensFromVocalized(original: string, vocalized: string): NakdanToken[] {
  const words = vocalized.split(/(\s+)/)
  const out: NakdanToken[] = []
  for (const v of words) {
    if (!v) continue
    if (/^\s+$/.test(v)) {
      out.push({ word: v, options: [] })
      continue
    }
    const w = stripNiqqud(v)
    out.push({ word: w, options: /[א-ת]/.test(w) && v !== w ? [v] : [] })
  }
  // if Claude changed the text itself, place nothing rather than something wrong
  return stripNiqqud(original).replace(/\s+/g, ' ').trim() === stripNiqqud(vocalized).replace(/\s+/g, ' ').trim() ? out : out.filter((t) => original.includes(t.word))
}
