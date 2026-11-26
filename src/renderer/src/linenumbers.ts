// Feature 54: line numbers in the margin of a chapter printed for a beta reader.
//
// The text is laid out at the printed width, then the first character of every line is found
// (by where each word starts on the screen) and a small empty marker is put right after it. The
// marker's number is drawn in the margin by CSS (.ln::before, absolutely placed with no top, so it
// stays on the marker's own line, also on the next page when a paragraph is split by a page break).

/** Characters after which a line may break (besides spaces) */
const BREAK_AFTER = /[\s\-־–—/]/u
/** Combining marks (niqqud) stay with their letter */
const MARK = /\p{M}/u

/** The blocks whose lines are numbered: the chapter's text, not its title, scene breaks or notes */
const NUMBERED = '.bk-chapter > p:not(.empty):not(.scene), .bk-chapter > h2, .bk-chapter > h3'

interface LineStart {
  node: Text
  offset: number
}

/** Where each line of this block starts */
function lineStarts(block: Element): LineStart[] {
  const out: LineStart[] = []
  const range = document.createRange()
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  let lastTop = -Infinity
  let lineH = parseFloat(getComputedStyle(block).lineHeight) || 16
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const t = n.data
    for (let i = 0; i < t.length; i++) {
      // a line can start only at the start of a text piece or after a break character
      if (i > 0 && !BREAK_AFTER.test(t[i - 1])) continue
      if (/\s/.test(t[i]) || MARK.test(t[i])) continue
      range.setStart(n, i)
      range.setEnd(n, i + 1)
      const r = range.getClientRects()[0]
      if (!r || (r.width === 0 && r.height === 0)) continue
      if (r.top > lastTop + lineH * 0.5) {
        out.push({ node: n, offset: i })
        lastTop = r.top
        lineH = Math.max(8, r.height * 0.8)
      }
    }
  }
  return out
}

/** Puts a numbered marker after the first letter (and its niqqud) of every line; returns how many lines */
export function numberLines(root: HTMLElement): number {
  const blocks = [...root.querySelectorAll(NUMBERED)]
  // measure everything first: adding markers does not move text, but measuring once is faster
  const all = blocks.map(lineStarts)
  let n = 0
  all.forEach((starts) => {
    const numbered = starts.map((s) => ({ ...s, n: ++n }))
    // from the end, so earlier offsets stay right after splitting text nodes
    for (let k = numbered.length - 1; k >= 0; k--) {
      const { node, offset } = numbered[k]
      let at = offset + 1
      while (at < node.data.length && MARK.test(node.data[at])) at++
      const rest = node.splitText(at)
      const mark = document.createElement('span')
      mark.className = 'ln'
      mark.dataset.n = String(numbered[k].n)
      rest.before(mark)
    }
  })
  return n
}
