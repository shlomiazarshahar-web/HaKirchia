// Comparing two texts of a chapter (versions, feature 14; alternative drafts, feature 35).
// First paragraph by paragraph, then word by word inside paragraphs that changed, so even a long
// chapter is compared quickly and the result reads naturally.

export type DiffKind = 'same' | 'added' | 'removed'

/** A piece of text in the comparison. Pieces of one paragraph are in `paragraphs[i]`. */
export interface DiffPiece {
  kind: DiffKind
  text: string
}

export interface DiffParagraph {
  /** 'same': unchanged; 'added'/'removed': the whole paragraph; 'changed': words inside it differ */
  kind: DiffKind | 'changed'
  pieces: DiffPiece[]
}

export interface DiffResult {
  paragraphs: DiffParagraph[]
  /** words added and removed, for a short summary */
  added: number
  removed: number
}

/** Longest common subsequence of two lists, as pairs of indexes. Fine for a few thousand items. */
function lcsPairs<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): [number, number][] {
  // trim the equal start and end first: most edits touch a small part of the text
  let start = 0
  while (start < a.length && start < b.length && eq(a[start], b[start])) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && eq(a[endA - 1], b[endB - 1])) endA--, endB--
  const n = endA - start
  const m = endB - start
  const pairs: [number, number][] = []
  for (let i = 0; i < start; i++) pairs.push([i, i])
  if (n > 0 && m > 0) {
    if (n * m > 25_000_000) {
      // too big to compare finely: treat the middle as replaced
    } else {
      const w = m + 1
      const t = new Uint32Array((n + 1) * w)
      for (let i = n - 1; i >= 0; i--)
        for (let j = m - 1; j >= 0; j--)
          t[i * w + j] = eq(a[start + i], b[start + j]) ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1])
      let i = 0
      let j = 0
      while (i < n && j < m) {
        if (eq(a[start + i], b[start + j])) pairs.push([start + i++, start + j++])
        else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) i++
        else j++
      }
    }
  }
  for (let k = 0; k < a.length - endA; k++) pairs.push([endA + k, endB + k])
  return pairs
}

/** Words and the spaces between them, so joining the pieces gives back the exact text. */
export function tokens(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? []
}

const isWord = (t: string) => /[^\s]/.test(t)
const countW = (ts: string[]) => ts.filter(isWord).length

function push(pieces: DiffPiece[], kind: DiffKind, text: string) {
  if (!text) return
  const last = pieces[pieces.length - 1]
  if (last && last.kind === kind) last.text += text
  else pieces.push({ kind, text })
}

/** Word by word comparison of two paragraphs. */
export function diffWords(oldText: string, newText: string): { pieces: DiffPiece[]; added: number; removed: number } {
  const a = tokens(oldText)
  const b = tokens(newText)
  const pairs = lcsPairs(a, b, (x, y) => x === y)
  const pieces: DiffPiece[] = []
  let i = 0
  let j = 0
  let added = 0
  let removed = 0
  const flush = (ti: number, tj: number) => {
    const del = a.slice(i, ti)
    const ins = b.slice(j, tj)
    removed += countW(del)
    added += countW(ins)
    push(pieces, 'removed', del.join(''))
    push(pieces, 'added', ins.join(''))
  }
  for (const [pi, pj] of pairs) {
    flush(pi, pj)
    push(pieces, 'same', a[pi])
    i = pi + 1
    j = pj + 1
  }
  flush(a.length, b.length)
  return { pieces, added, removed }
}

/** Similar enough to show as one changed paragraph (rather than one removed and one added). */
function similar(a: string, b: string): boolean {
  const wa = new Set(a.split(/\s+/).filter(Boolean))
  const wb = b.split(/\s+/).filter(Boolean)
  if (!wa.size || !wb.length) return false
  const common = wb.filter((w) => wa.has(w)).length
  return common / Math.max(wa.size, wb.length) >= 0.4
}

/** Compares an old text with a new one, each given as a list of paragraphs. */
export function diffTexts(oldParas: string[], newParas: string[]): DiffResult {
  const pairs = lcsPairs(oldParas, newParas, (x, y) => x === y)
  const out: DiffParagraph[] = []
  let added = 0
  let removed = 0
  let i = 0
  let j = 0
  const flush = (ti: number, tj: number) => {
    const dels = oldParas.slice(i, ti)
    const ins = newParas.slice(j, tj)
    // paragraphs that were edited (not replaced) are shown word by word
    let d = 0
    let k = 0
    while (d < dels.length || k < ins.length) {
      if (d < dels.length && k < ins.length && similar(dels[d], ins[k])) {
        const w = diffWords(dels[d], ins[k])
        added += w.added
        removed += w.removed
        out.push({ kind: 'changed', pieces: w.pieces })
        d++, k++
      } else if (d < dels.length && (k >= ins.length || dels.length - d >= ins.length - k)) {
        removed += countW(tokens(dels[d]))
        out.push({ kind: 'removed', pieces: [{ kind: 'removed', text: dels[d++] }] })
      } else {
        added += countW(tokens(ins[k]))
        out.push({ kind: 'added', pieces: [{ kind: 'added', text: ins[k++] }] })
      }
    }
  }
  for (const [pi, pj] of pairs) {
    flush(pi, pj)
    out.push({ kind: 'same', pieces: [{ kind: 'same', text: oldParas[pi] }] })
    i = pi + 1
    j = pj + 1
  }
  flush(oldParas.length, newParas.length)
  return { paragraphs: out, added, removed }
}
