// Stopping point (feature 32): where the writer stopped, and a note on what comes next.
// The place is kept as a position in the chapter plus the text around it, so it is found again
// even when the chapter was edited in Word in the meantime.

export interface StopPoint {
  chapterId: string
  /** Position of the cursor in the chapter's editor (ProseMirror position) */
  pos: number
  /** Text right before and right after the cursor, to find the spot again */
  before: string
  after: string
  /** "What next" note; may be empty */
  note: string
  /** When it was written (ms since 1970) */
  at: number
}

/** Pieces of the chapter's text with the editor position each one starts at. */
export interface TextPiece {
  text: string
  pos: number
}

/**
 * Finds the stopping point in the chapter as it is now. Looks for the text that was around the
 * cursor; when it appears more than once, takes the place nearest the old position. When it is
 * gone, falls back to the old position (kept inside the chapter).
 */
export function locateStop(pieces: TextPiece[], sp: Pick<StopPoint, 'pos' | 'before' | 'after'>, size: number): number {
  const clamp = (p: number) => Math.max(1, Math.min(size, p))
  // one string, with the editor position of every character
  let text = ''
  const posAt: number[] = []
  for (const p of pieces) {
    for (let i = 0; i < p.text.length; i++) posAt.push(p.pos + i)
    text += p.text
  }
  const endPos = (k: number) => (k < posAt.length ? posAt[k] : posAt.length ? posAt[posAt.length - 1] + 1 : 1)
  const tries: { needle: string; offset: number }[] = []
  if (sp.before || sp.after) tries.push({ needle: sp.before + sp.after, offset: sp.before.length })
  if (sp.before.length >= 8) tries.push({ needle: sp.before, offset: sp.before.length })
  if (sp.after.length >= 8) tries.push({ needle: sp.after, offset: 0 })
  for (const { needle, offset } of tries) {
    let best = -1
    let bestDist = Infinity
    for (let k = text.indexOf(needle); k >= 0; k = text.indexOf(needle, k + 1)) {
      const at = k + offset
      // the cursor sits between characters: after the last char of "before"
      const pos = offset > 0 ? posAt[at - 1] + 1 : endPos(at)
      const d = Math.abs(pos - sp.pos)
      if (d < bestDist) {
        bestDist = d
        best = pos
      }
    }
    if (best >= 0) return clamp(best)
  }
  return clamp(sp.pos)
}

/** A short "when" for the stop note: "היום ב־21:40", "אתמול", or a date. */
export function stopWhen(at: number, now = Date.now()): string {
  const d = new Date(at)
  const n = new Date(now)
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(n) - day(d)) / 86400000)
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (diff === 0) return `היום ב־${time}`
  if (diff === 1) return `אתמול ב־${time}`
  if (diff > 1 && diff < 7) return `לפני ${diff} ימים`
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`
}
