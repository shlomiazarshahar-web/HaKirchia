// Footnotes at the bottom of their page (round 7 feedback). The book is laid out in columns, one
// column per page (the reading view always is; the PDF's print window lays it out the same way
// first). For each page that has note marks, the text on that page is cut where the notes need
// room, the notes are put right after it, pushed down to the bottom of the page, and the rest of
// the text starts on the next page. The reading view and the PDF both use this, so they agree.

export interface PageGeom {
  /** Width and height of a page's text area, and the distance from one column to the next (px) */
  colW: number
  colH: number
  stride: number
}

const BLOCKS = 'p, h1, h2, h3, li'
/** Room left under the notes, so that printing (which rounds line heights a little differently) never pushes them to the next page */
const SLACK = 2
/** The page's text area is laid out a few pixels shorter than it is, so that a printed page never gets one line too many */
export const PAGE_SLACK = 4

/**
 * Places the notes of every page. `flow` is a multicolumn box running right to left whose first
 * column is page `firstPage` (the reading view has an empty column 0). Returns how many notes were placed.
 */
export function placeFootnotes(flow: HTMLElement, geom: PageGeom): number {
  const { colW, colH, stride } = geom
  let placed = 0
  const frame = () => {
    const r = flow.getBoundingClientRect()
    const scale = flow.offsetWidth ? r.width / flow.offsetWidth : 1
    return { r, scale: scale || 1 }
  }
  /** Page (column) and height inside the column of a rectangle on screen */
  const at = (rect: DOMRect, f = frame()) => {
    // columns run to the left from the box's right side; the middle of the rectangle tells which one it is in
    const cx = ((rect.left + rect.right) / 2 - f.r.left) / f.scale
    const page = Math.round((flow.clientWidth - colW / 2 - cx) / stride)
    return { page, top: (rect.top - f.r.top) / f.scale, bottom: (rect.bottom - f.r.top) / f.scale }
  }
  const charRect = (node: Text, i: number): DOMRect | null => {
    const rg = document.createRange()
    rg.setStart(node, i)
    rg.setEnd(node, i + 1)
    const rects = rg.getClientRects()
    return rects.length ? rects[0] : null
  }

  for (let guard = 0; guard < 5000; guard++) {
    const refs = [...flow.querySelectorAll<HTMLElement>('sup.fn[data-note]:not([data-placed])')]
    if (!refs.length) break
    const f = frame()
    const page = at(refs[0].getBoundingClientRect(), f).page
    let group = refs.filter((r) => at(r.getBoundingClientRect(), f).page === page)
    let split: { node: Text; offset: number } | null = null
    /**
     * Where this page's text ends when the notes go under it. Every mark before the cut has its note
     * on this page (at most `limit` of them): a mark that would sit above the cut without its note
     * moves on with its line.
     */
    const plan = (limit: number) => {
      let n = Math.min(limit, group.length)
      let inside = n
      for (let attempt = 0; attempt < 6 && n > 0; attempt++) {
        const probe = notesBox(refs.slice(0, n))
        // measure the notes at the width of a page, in the book's font
        ;(refs[0].closest('section') ?? flow).append(probe)
        const h = probe.offsetHeight
        probe.remove()
        split = findSplit(flow, refs[0], page, colH - h - SLACK, at, charRect)
        // a cut never falls on a note mark: the mark's whole line moves on
        if (split?.node.parentElement?.closest('sup.fn')) split = lineStartBefore(split.node, at(charRect(split.node, 0) ?? new DOMRect()).page, at, charRect) ?? split
        inside = split ? refs.filter((r) => before(r, split!)).length : refs.length
        if (inside > limit) {
          // more marks above the cut than notes allowed here: cut before the first one left out
          const t = firstTextIn(refs[limit])
          const start = t ? lineStartBefore(t, at(refs[limit].getBoundingClientRect()).page, at, charRect) : null
          if (start) split = start
          inside = split ? refs.filter((r) => before(r, split!)).length : refs.length
        }
        if (inside === n) break
        n = Math.min(inside, limit)
      }
      group = refs.slice(0, Math.min(inside, limit))
    }
    plan(refs.length)
    let notes: HTMLElement | null = null
    while (group.length) {
      notes = notesBox(group)
      cutAt(split, notes, flow)
      // the notes may not fit after all (a paragraph kept its lines together, say): move the page's last line on
      for (let tries = 0; tries < 6 && at(notes.getBoundingClientRect()).page !== page; tries++) {
        const last = lastTextBefore(notes, flow)
        const start = last ? lineStartBefore(last.node, page, at, charRect, last.offset) : null
        if (!start || !group.every((r) => before(r, start))) break
        unsplit(notes)
        notes.remove()
        cutAt(start, notes, flow)
      }
      if (at(notes.getBoundingClientRect()).page === page) break
      // still no room (the last line holds a mark): the last mark and its note wait for the next page
      unsplit(notes)
      notes.remove()
      notes = null
      if (group.length > 1) plan(group.length - 1)
      else group = []
    }
    if (!notes) {
      // not even the first mark's line has room above its note: that line starts the next page
      const r = refs[0]
      const text = firstTextIn(r)
      const lineStart = text ? lineStartBefore(text, page, at, charRect) : null
      if (lineStart) cutAt(lineStart, null)
      else (r.closest(BLOCKS) as HTMLElement | null)?.classList.add('fn-cont')
      // safety: the mark has moved; if it did not, give up on it so the loop ends
      if (at(r.getBoundingClientRect()).page === page) r.dataset.placed = 'stuck'
      continue
    }
    group.forEach((r) => (r.dataset.placed = '1'))
    placed += group.length
    // push the notes down to the bottom of the page
    const nb = at(notes.getBoundingClientRect())
    if (nb.page === page) notes.style.marginTop = `${Math.max(0, colH - nb.bottom - SLACK)}px`
  }
  return placed
}

function notesBox(refs: HTMLElement[]): HTMLElement {
  const box = document.createElement('div')
  box.className = 'bk-fnotes'
  box.innerHTML = '<div class="fn-line"></div>'
  for (const r of refs) {
    const p = document.createElement('p')
    const n = document.createElement('span')
    n.className = 'fn-n'
    n.textContent = `${r.dataset.fn}. `
    p.append(n, document.createTextNode(r.dataset.note ?? ''))
    p.dir = 'auto'
    box.append(p)
  }
  return box
}

/** Whether an element comes before a place in the text */
function before(el: HTMLElement, place: { node: Text; offset: number }): boolean {
  const rg = document.createRange()
  rg.setStart(place.node, place.offset)
  rg.setEnd(place.node, place.offset)
  return rg.comparePoint(el, 0) < 0
}

function firstTextIn(el: Node): Text | null {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  return w.nextNode() as Text | null
}

type At = (rect: DOMRect) => { page: number; top: number; bottom: number }
type CharRect = (node: Text, i: number) => DOMRect | null

/** The first character, from `start` on, that is past the cut on its page or on a later page */
function findSplit(flow: HTMLElement, start: HTMLElement, page: number, cut: number, at: At, charRect: CharRect): { node: Text; offset: number } | null {
  const w = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT)
  w.currentNode = start
  const beyond = (node: Text, i: number) => {
    const r = charRect(node, i)
    if (!r || (!r.width && !r.height)) return null
    const a = at(r)
    return a.page > page || (a.page === page && a.bottom > cut + 0.5)
  }
  for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null) {
    if (!n.data.length || n.parentElement?.closest('.bk-fnotes, .pmk')) continue
    const rg = document.createRange()
    rg.selectNodeContents(n)
    const rects = [...rg.getClientRects()]
    if (!rects.length) continue
    const all = rects.map((r) => at(r))
    if (all.every((a) => a.page < page || (a.page === page && a.bottom <= cut + 0.5))) continue
    // somewhere in this text node: the first character past the cut
    let lo = 0
    let hi = n.data.length - 1
    let found = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      let b = beyond(n, mid)
      let k = mid
      // characters without a box (a collapsed space) take the next one's answer
      while (b === null && k < hi) b = beyond(n, ++k)
      if (b) {
        found = mid
        hi = mid - 1
      } else lo = k + 1
    }
    if (found >= 0) return { node: n, offset: found }
  }
  return null
}

/** The start of the line a text node begins on (to move that whole line to the next page) */
function lineStartBefore(text: Text, page: number, at: At, charRect: CharRect, from = 0): { node: Text; offset: number } | null {
  const first = charRect(text, from)
  if (!first) return null
  const top = at(first).top
  // walk back through the same block while the characters are on the same line
  const block = text.parentElement?.closest(BLOCKS)
  if (!block) return null
  const w = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null) nodes.push(n)
  let best: { node: Text; offset: number } = { node: text, offset: from }
  for (let k = nodes.indexOf(text); k >= 0; k--) {
    const n = nodes[k]
    const end = n === text ? from : n.data.length
    for (let i = end - 1; i >= 0; i--) {
      const r = charRect(n, i)
      if (!r) continue
      const a = at(r)
      if (a.page !== page || Math.abs(a.top - top) > 2) return best
      best = { node: n, offset: i }
    }
  }
  return best
}

/**
 * Ends the page at a place in the text: the block is split there (headings move whole), the notes go
 * after the first part, and the rest starts the next page.
 */
function cutAt(place: { node: Text; offset: number } | null, notes: HTMLElement | null, flow?: HTMLElement): void {
  if (!place) {
    // no text after the notes' page: they go after the last text of the book
    if (notes && flow) {
      const last = [...flow.querySelectorAll<HTMLElement>(BLOCKS)].pop()
      if (last) last.after(notes)
      else flow.append(notes)
    }
    return
  }
  const block = place.node.parentElement?.closest(BLOCKS) as HTMLElement | null
  if (!block) return
  const head = /^H[1-3]$/.test(block.tagName)
  // a note mark is never cut in two: a cut inside it goes before it
  const mark = place.node.parentElement?.closest('sup.fn')
  const pre = document.createRange()
  pre.setStart(block, 0)
  if (mark) pre.setEndBefore(mark)
  else pre.setEnd(place.node, place.offset)
  if (head || !pre.toString().trim()) {
    // nothing of the block stays on this page: the whole block starts the next one
    const sec = block.closest('section')
    const inSec = document.createRange()
    if (sec) {
      inSec.setStart(sec, 0)
      inSec.setEnd(block, 0)
    }
    if (sec && !inSec.toString().trim()) {
      // the first thing in its section: the notes end the section before
      let prev = sec.previousElementSibling
      while (prev && prev.tagName !== 'SECTION') prev = prev.previousElementSibling
      if (notes) (prev ?? sec).append(notes)
      if (!sec.matches('.new-page, .bk-matter, .bk-part')) block.classList.add('fn-cont')
      return
    }
    if (notes) block.before(notes)
    block.classList.add('fn-cont')
    return
  }
  const rest = document.createRange()
  if (mark) rest.setStartBefore(mark)
  else rest.setStart(place.node, place.offset)
  rest.setEnd(block, block.childNodes.length)
  const tail = block.cloneNode(false) as HTMLElement
  tail.removeAttribute('id')
  tail.append(rest.extractContents())
  tail.classList.add('fn-cont', 'fn-rest')
  block.classList.add('fn-cut')
  block.after(tail)
  if (notes) block.after(notes)
}

/** The last visible character before an element */
function lastTextBefore(el: Element, flow: HTMLElement): { node: Text; offset: number } | null {
  const w = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT)
  let last: Text | null = null
  for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null) {
    if (el.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) break
    if (n.data.trim() && !n.parentElement?.closest('.bk-fnotes, .pmk')) last = n
  }
  if (!last) return null
  let i = last.data.length - 1
  while (i > 0 && /\s/.test(last.data[i])) i--
  return { node: last, offset: i }
}

/** Undoes a split around a notes box: the rest of the paragraph joins its first part again */
function unsplit(notes: HTMLElement): void {
  const prev = notes.previousElementSibling as HTMLElement | null
  const next = notes.nextElementSibling as HTMLElement | null
  if (next?.classList.contains('fn-cont')) next.classList.remove('fn-cont')
  if (prev?.classList.contains('fn-cut') && next?.classList.contains('fn-rest')) {
    prev.append(...next.childNodes)
    next.remove()
    prev.classList.remove('fn-cut')
    prev.normalize()
  }
}

/**
 * Makes every page start where its column starts, with a forced page break (for printing: the
 * printed pages then hold exactly what the columns held, whatever small differences printing has).
 */
export function fixPageStarts(flow: HTMLElement, geom: PageGeom): void {
  const { colW, stride } = geom
  const f = flow.getBoundingClientRect()
  const scale = flow.offsetWidth ? f.width / flow.offsetWidth || 1 : 1
  const pageOf = (r: DOMRect) => Math.round((flow.clientWidth - colW / 2 - ((r.left + r.right) / 2 - f.left) / scale) / stride)
  const charPage = (n: Text, i: number) => {
    const rg = document.createRange()
    rg.setStart(n, i)
    rg.setEnd(n, i + 1)
    const r = rg.getClientRects()[0]
    return r && (r.width || r.height) ? pageOf(r) : null
  }
  const w = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT)
  let page = -1
  const cuts: { node: Text; offset: number }[] = []
  for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null) {
    if (!n.data.trim() || n.parentElement?.closest('.bk-fnotes, .pmk')) continue
    let first: number | null = null
    for (let i = 0; i < n.data.length && first === null; i++) first = charPage(n, i)
    if (first === null) continue
    if (page < 0) page = first
    if (first > page) {
      cuts.push({ node: n, offset: 0 })
      page = first
    }
    // a page change inside this text: find each one
    for (;;) {
      let last: number | null = null
      for (let i = n.data.length - 1; i >= 0 && last === null; i--) last = charPage(n, i)
      if (last === null || last <= page) break
      let lo = 0
      let hi = n.data.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        let k = mid
        let p = charPage(n, k)
        while (p === null && k < hi) p = charPage(n, ++k)
        if (p !== null && p > page) hi = mid
        else lo = k + 1
      }
      cuts.push({ node: n, offset: lo })
      page = charPage(n, lo) ?? page + 1
      if (page >= last) break
    }
  }
  // cut from the end, so that earlier places stay valid
  for (const c of cuts.reverse()) cutAt(c, null)
}
