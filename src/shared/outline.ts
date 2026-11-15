// The binder tree (chapters grouped into parts) and the operations on it.
// Pure functions, used by the main process (saving) and the window (drag and drop).

import type { Book, Chapter, OutlineNode, PartNode } from './types'

/** Chapter ids in reading order. */
export function flatten(outline: OutlineNode[]): string[] {
  return outline.flatMap((n) => (n.type === 'part' ? n.children : [n.id]))
}

/**
 * Makes a tree consistent with the chapter list: drops unknown or repeated chapters, keeps empty
 * parts, and adds chapters missing from the tree at the end. A book saved before parts existed
 * has no tree at all, and gets every chapter at the top level.
 */
export function normalizeOutline(outline: unknown, chapters: Chapter[]): OutlineNode[] {
  const known = new Set(chapters.map((c) => c.id))
  const seen = new Set<string>()
  const partIds = new Set<string>()
  const take = (id: unknown): id is string => {
    if (typeof id !== 'string' || !known.has(id) || seen.has(id)) return false
    seen.add(id)
    return true
  }
  const out: OutlineNode[] = []
  for (const n of Array.isArray(outline) ? (outline as { type?: string; id?: unknown; title?: unknown; collapsed?: unknown; children?: unknown }[]) : []) {
    if (!n || typeof n !== 'object') continue
    if (n.type === 'chapter') {
      if (take(n.id)) out.push({ type: 'chapter', id: n.id })
    } else if (n.type === 'part' && typeof n.id === 'string' && !partIds.has(n.id)) {
      const kids: unknown[] = Array.isArray(n.children) ? n.children : []
      partIds.add(n.id)
      const children = kids.filter(take)
      out.push({ type: 'part', id: n.id, title: typeof n.title === 'string' && n.title.trim() ? n.title : 'חלק', collapsed: !!n.collapsed, children })
    }
  }
  for (const c of chapters) if (take(c.id)) out.push({ type: 'chapter', id: c.id })
  return out
}

/** The book with a new tree; chapters are put in the tree's order. */
export function withOutline<B extends Pick<Book, 'chapters' | 'outline'>>(book: B, outline: OutlineNode[]): B {
  const next = normalizeOutline(outline, book.chapters)
  const byId = new Map(book.chapters.map((c) => [c.id, c]))
  return { ...book, outline: next, chapters: flatten(next).map((id) => byId.get(id)!) }
}

export function partOf(outline: OutlineNode[], chapterId: string): PartNode | undefined {
  return outline.find((n): n is PartNode => n.type === 'part' && n.children.includes(chapterId))
}

export const parts = (outline: OutlineNode[]) => outline.filter((n): n is PartNode => n.type === 'part')

export type Dragged = { type: 'chapter' | 'part'; id: string }
export type DropTarget =
  | { kind: 'before' | 'after'; ref: Dragged }
  | { kind: 'into'; partId: string; at: 'start' | 'end' }
  | { kind: 'end' }

const clone = (o: OutlineNode[]): OutlineNode[] => o.map((n) => (n.type === 'part' ? { ...n, children: [...n.children] } : { ...n }))

/** Moves a chapter or a part (with its chapters) in the tree. Returns the same tree if the move makes no sense. */
export function moveNode(outline: OutlineNode[], dragged: Dragged, target: DropTarget): OutlineNode[] {
  if (target.kind !== 'end' && target.kind !== 'into' && target.ref.type === dragged.type && target.ref.id === dragged.id) return outline
  if (dragged.type === 'part' && target.kind === 'into') return outline
  const o = clone(outline)

  // Take the dragged node out
  let node: OutlineNode
  if (dragged.type === 'part') {
    const i = o.findIndex((n) => n.type === 'part' && n.id === dragged.id)
    if (i < 0) return outline
    node = o.splice(i, 1)[0]
  } else {
    const i = o.findIndex((n) => n.type === 'chapter' && n.id === dragged.id)
    if (i >= 0) o.splice(i, 1)
    else {
      const p = partOf(o, dragged.id) as PartNode | undefined
      if (!p) return outline
      p.children.splice(p.children.indexOf(dragged.id), 1)
    }
    node = { type: 'chapter', id: dragged.id }
  }

  if (target.kind === 'end') {
    o.push(node)
    return o
  }
  if (target.kind === 'into') {
    const p = o.find((n): n is PartNode => n.type === 'part' && n.id === target.partId)
    if (!p) return outline
    if (target.at === 'start') p.children.unshift(dragged.id)
    else p.children.push(dragged.id)
    return o
  }

  let ref = target.ref
  let after = target.kind === 'after'
  if (ref.type === 'chapter') {
    const p = partOf(o, ref.id)
    if (p && dragged.type === 'part') {
      // A part cannot go inside another part: place it next to the part instead
      ref = { type: 'part', id: p.id }
      after = true
    } else if (p) {
      const idx = p.children.indexOf(ref.id) + (after ? 1 : 0)
      p.children.splice(idx, 0, dragged.id)
      return o
    }
  }
  const i = o.findIndex((n) => n.type === ref.type && n.id === ref.id)
  if (i < 0) return outline
  o.splice(i + (after ? 1 : 0), 0, node)
  return o
}

/**
 * Starts a new part at a chapter. The new part takes this chapter and the ones after it, up to the
 * next part (or, inside a part, up to that part's end; the old part keeps the chapters before it).
 */
export function startPartAt(outline: OutlineNode[], chapterId: string, part: { id: string; title: string }): OutlineNode[] {
  const o = clone(outline)
  const host = partOf(o, chapterId)
  if (host) {
    const k = host.children.indexOf(chapterId)
    const moved = host.children.splice(k)
    o.splice(o.indexOf(host) + 1, 0, { type: 'part', ...part, children: moved })
    return host.children.length ? o : o.filter((n) => n !== host)
  }
  const i = o.findIndex((n) => n.type === 'chapter' && n.id === chapterId)
  if (i < 0) return outline
  let j = i
  while (j < o.length && o[j].type === 'chapter') j++
  const children = o.slice(i, j).map((n) => n.id)
  o.splice(i, j - i, { type: 'part', ...part, children })
  return o
}

/** Removes a part; its chapters stay, at the top level, in the same place. */
export function ungroupPart(outline: OutlineNode[], partId: string): OutlineNode[] {
  return outline.flatMap((n) => (n.type === 'part' && n.id === partId ? n.children.map((id): OutlineNode => ({ type: 'chapter', id })) : [n]))
}

export function updatePart(outline: OutlineNode[], partId: string, patch: Partial<Pick<PartNode, 'title' | 'collapsed'>>): OutlineNode[] {
  return outline.map((n) => (n.type === 'part' && n.id === partId ? { ...n, ...patch } : n))
}

/** Hebrew ordinal names for new parts: "חלק ראשון", "חלק שני"… */
const ORDINALS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שביעי', 'שמיני', 'תשיעי', 'עשירי']
export function newPartTitle(outline: OutlineNode[]): string {
  const n = parts(outline).length
  return n < ORDINALS.length ? `חלק ${ORDINALS[n]}` : `חלק ${n + 1}`
}
