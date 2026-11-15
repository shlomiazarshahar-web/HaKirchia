// Hebrew text helpers: direction of mixed text, niqqud, and the automatic Hebrew typography
// (quotes, geresh/gershayim, maqaf, dashes, ellipsis). Pure functions, used by the editor and docx.

export type Dir = 'rtl' | 'ltr'

const RTL_CHAR = /[֐-ࣿיִ-﷿ﹰ-﻿]/
const LTR_CHAR = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/
const MARK = /[֑-ׇ]/ // niqqud and cantillation (attach to the letter before)

export const HEBREW_LETTER = 'א-ת'
export const NIQQUD_CLASS = '֑-ׇֽֿׁׂׅׄ'

export interface DirSegment {
  text: string
  rtl: boolean
}

/**
 * Splits mixed Hebrew/English text into pieces by direction, so a Word file gets a run per piece
 * (an English phrase inside a Hebrew paragraph is written as its own left-to-right run, and the
 * other way round). Spaces and punctuation between two words of the "other" direction stay with
 * them; around them they belong to the paragraph's own direction.
 */
export function splitByDirection(text: string, paraRtl: boolean): DirSegment[] {
  const chars = [...text]
  const kind = chars.map((c) => (RTL_CHAR.test(c) && !MARK.test(c) ? 'r' : LTR_CHAR.test(c) ? 'l' : MARK.test(c) ? 'm' : 'n'))
  // niqqud takes the kind of the letter before it
  for (let i = 1; i < kind.length; i++) if (kind[i] === 'm') kind[i] = kind[i - 1] === 'l' ? 'l' : 'r'
  for (let i = 0; i < kind.length; i++) if (kind[i] === 'm') kind[i] = 'r'
  const other = paraRtl ? 'l' : 'r'
  const own = paraRtl ? 'r' : 'l'
  const isOther: boolean[] = new Array(chars.length).fill(false)
  let i = 0
  while (i < chars.length) {
    if (kind[i] !== other) {
      i++
      continue
    }
    // from this strong "other" char to the last "other" char before the next "own" char
    let last = i
    let j = i + 1
    while (j < chars.length && kind[j] !== own) {
      if (kind[j] === other) last = j
      j++
    }
    for (let k = i; k <= last; k++) isOther[k] = true
    i = last + 1
  }
  const out: DirSegment[] = []
  chars.forEach((c, k) => {
    const rtl = isOther[k] ? !paraRtl : paraRtl
    const prev = out[out.length - 1]
    if (prev && prev.rtl === rtl) prev.text += c
    else out.push({ text: c, rtl })
  })
  return out
}

// ---------------------------------------------------------------------------
// Niqqud
// ---------------------------------------------------------------------------

export interface NiqqudMark {
  char: string
  name: string
  /** The key that types it while the niqqud panel is open: the first letter of its name */
  letter: string
}

/**
 * The marks offered in the niqqud panel, in the usual order. With the panel open from the keyboard,
 * the first letter of a mark's name types it (ס → סגול). Marks that share a letter come in turns:
 * pressing the same letter again swaps the mark just typed for the next one (ח → חיריק, ח again → חולם).
 */
export const NIQQUD_MARKS: NiqqudMark[] = [
  { char: '\u05B8', name: 'קמץ', letter: 'ק' },
  { char: '\u05B7', name: 'פתח', letter: 'פ' },
  { char: '\u05B5', name: 'צירה', letter: 'צ' },
  { char: '\u05B6', name: 'סגול', letter: 'ס' },
  { char: '\u05B0', name: 'שווא', letter: 'ש' },
  { char: '\u05B4', name: 'חיריק', letter: 'ח' },
  { char: '\u05B9', name: 'חולם', letter: 'ח' },
  { char: '\u05BB', name: 'קובוץ', letter: 'ק' },
  { char: '\u05BC', name: 'דגש / שורוק', letter: 'ד' },
  { char: '\u05B2', name: 'חטף פתח', letter: 'ח' },
  { char: '\u05B1', name: 'חטף סגול', letter: 'ח' },
  { char: '\u05B3', name: 'חטף קמץ', letter: 'ח' },
  { char: '\u05C1', name: 'שי״ן ימנית', letter: 'ש' },
  { char: '\u05C2', name: 'שי״ן שמאלית', letter: 'ש' },
  { char: '\u05C7', name: 'קמץ קטן', letter: 'ק' },
  { char: '\u05BF', name: 'רפה', letter: 'ר' },
  { char: '\u05BD', name: 'מתג', letter: 'מ' }
]

/** The marks a letter types, in the order that repeated presses go through them. */
export function marksForLetter(letter: string): NiqqudMark[] {
  return NIQQUD_MARKS.filter((m) => m.letter === letter)
}

/** "ח" for the first mark of ח, "חח" for the second, and so on: what to press to get this mark. */
export function keysFor(mark: NiqqudMark): string {
  return mark.letter.repeat(marksForLetter(mark.letter).indexOf(mark) + 1)
}

/** The Hebrew letter on each key of the standard Israeli keyboard, so the panel also works when the
 *  keyboard is switched to English. */
const HEBREW_BY_CODE: Record<string, string> = {
  KeyQ: '/', KeyW: "'", KeyE: 'ק', KeyR: 'ר', KeyT: 'א', KeyY: 'ט', KeyU: 'ו', KeyI: 'ן', KeyO: 'ם', KeyP: 'פ',
  KeyA: 'ש', KeyS: 'ד', KeyD: 'ג', KeyF: 'כ', KeyG: 'ע', KeyH: 'י', KeyJ: 'ח', KeyK: 'ל', KeyL: 'ך', Semicolon: 'ף',
  KeyZ: 'ז', KeyX: 'ס', KeyC: 'ב', KeyV: 'ה', KeyB: 'נ', KeyN: 'מ', KeyM: 'צ', Comma: 'ת', Period: 'ץ'
}

/** The Hebrew letter a key press stands for, whichever keyboard language is on. */
export function hebrewLetterOf(key: string, code: string): string | null {
  if (/^[\u05D0-\u05EA]$/.test(key)) return key
  return HEBREW_BY_CODE[code] ?? null
}

/** Where the typing is in the panel: the letter last pressed and which of its marks it typed. */
export interface NiqqudTurn {
  letter: string
  index: number
}

/**
 * The next step after pressing a letter in the niqqud panel. A new letter types its first mark;
 * the same letter again replaces the mark just typed with the next mark of that letter (a letter
 * with one mark just keeps it, so a double press never stacks the same mark twice).
 * Returns null when the letter types no mark.
 */
export function nextNiqqud(prev: NiqqudTurn | null, letter: string): { turn: NiqqudTurn; mark: NiqqudMark; replace: boolean } | null {
  const marks = marksForLetter(letter)
  if (!marks.length) return null
  if (prev && prev.letter === letter) {
    const index = (prev.index + 1) % marks.length
    return { turn: { letter, index }, mark: marks[index], replace: true }
  }
  return { turn: { letter, index: 0 }, mark: marks[0], replace: false }
}

const NIQQUD_RE = new RegExp(`[${NIQQUD_CLASS}]`, 'g')

/** Removes niqqud and cantillation. Keeps maqaf, geresh, gershayim and sof pasuq. */
export function stripNiqqud(text: string): string {
  return text.replace(NIQQUD_RE, '')
}

export function hasNiqqud(text: string): boolean {
  return new RegExp(`[${NIQQUD_CLASS}]`).test(text)
}

// ---------------------------------------------------------------------------
// Automatic typography
// ---------------------------------------------------------------------------

export type QuoteStyle = 'books' | 'academy' | 'gershayim' | 'off'

export interface TypographySettings {
  /** What " becomes in a Hebrew paragraph */
  quotes: QuoteStyle
  /** ' after a Hebrew letter becomes ׳, and " inside a word (צה"ל) becomes ״ */
  geresh: boolean
  /** a hyphen between two Hebrew words (בית-ספר) becomes a maqaf ־ */
  maqaf: boolean
  /** " - " becomes " – " and "--" becomes "–" */
  dashes: boolean
  /** "..." becomes "…" */
  ellipsis: boolean
}

export const DEFAULT_TYPOGRAPHY: TypographySettings = {
  quotes: 'books',
  geresh: true,
  maqaf: true,
  dashes: true,
  ellipsis: true
}

export const QUOTE_STYLES: { id: QuoteStyle; label: string; sample: string }[] = [
  { id: 'books', label: 'כמו בספרים', sample: '”שלום”' },
  { id: 'academy', label: 'לפי האקדמיה ללשון', sample: '„שלום”' },
  { id: 'gershayim', label: 'גרשיים', sample: '״שלום״' },
  { id: 'off', label: 'בלי שינוי', sample: '"שלום"' }
]

export const GERESH = '׳'
export const GERSHAYIM = '״'
export const MAQAF = '־'

/** Opening and closing quote characters for a paragraph. */
export function quotePair(style: QuoteStyle, rtl: boolean): [string, string] | null {
  if (!rtl) return ['“', '”'] // “English”
  if (style === 'books') return ['”', '”']
  if (style === 'academy') return ['„', '”']
  if (style === 'gershayim') return [GERSHAYIM, GERSHAYIM]
  return null
}

const lastChar = (s: string) => {
  const chars = [...s.replace(NIQQUD_RE, '')]
  return chars[chars.length - 1] ?? ''
}
const isHebrewLetter = (c: string) => /[א-ת]/.test(c)

/** True when the text before the cursor has a quote that was opened and not closed yet. */
function insideQuote(before: string, pair: [string, string]): boolean {
  const [open, close] = pair
  let depth = 0
  for (const c of before) {
    if (open === close) {
      if (c === open) depth = depth ? 0 : 1
    } else if (c === open) depth = 1
    else if (c === close) depth = 0
  }
  return depth > 0
}

/**
 * What a typed " should become, given the paragraph text before the cursor.
 * Returns null to leave the " as typed.
 */
export function doubleQuoteFor(before: string, rtl: boolean, t: TypographySettings): string | null {
  const prev = lastChar(before)
  const pair = quotePair(t.quotes, rtl)
  // inside a Hebrew word: צה"ל, תשפ"ו (unless it closes a quote that is open)
  if (t.geresh && isHebrewLetter(prev) && !(pair && pair[0] !== GERSHAYIM && insideQuote(before, pair))) return GERSHAYIM
  if (!pair) return null
  const atStart = prev === '' || /[\s([{\-–—/]/.test(prev)
  if (atStart) return pair[0]
  return pair[1]
}

/** What a typed ' should become. Returns null to leave it as typed. */
export function singleQuoteFor(before: string, t: TypographySettings): string | null {
  const prev = lastChar(before)
  if (t.geresh && isHebrewLetter(prev)) return GERESH // ג׳ירפה, ז׳אנר, אות ב׳
  if (/[A-Za-z]/.test(prev)) return '’' // don’t
  return null
}
