// Split screen (feature 6): panes side by side. Since round 11 they are arranged like Blender's
// areas: any pane can be split again, beside or below, and every border can be dragged. The
// arrangement is a tree (PaneNode); `panes` stays the flat list of what each pane shows, in tree order. Pure functions, no React, so they can be
// tested and reused by later pane screens (the translation screen of feature 12 adds 'pdf' and
// 'translate' contents; background materials of feature 11 add 'material').

import type { Book } from './types'

/**
 * 'alt': an alternative draft (feature 35), written next to its chapter.
 * 'pdf': the original of the chapter being translated (feature 12); it follows the chapter in focus.
 * 'web': Google Translate inside the app (feature 13).
 */
export type PaneContent =
  | { kind: 'chapter'; id: string }
  | { kind: 'master' }
  | { kind: 'alt'; id: string }
  | { kind: 'pdf' }
  | { kind: 'web' }
  /** a background page (feature 11) */
  | { kind: 'material'; id: string }
  /** the glossary of terms and names (feature 20) */
  | { kind: 'glossary' }
  /** writing review with Claude (feature 19), as a pane since round 11 */
  | { kind: 'review' }

/** Kinds that are shown at most once on the screen */
const SINGLE = new Set(['master', 'pdf', 'web', 'glossary', 'review'])
const KINDS = ['chapter', 'master', 'alt', 'pdf', 'web', 'material', 'glossary', 'review']

export interface Pane {
  /** Stable id, so moving a pane does not reload its editor */
  key: string
  content: PaneContent
}

/**
 * How the panes are arranged. 'h': side by side (the first one at the start side, the right in
 * RTL); 'v': one above the other. Sizes are fractions of the split that add up to 1.
 */
export type PaneNode = { t: 'leaf'; key: string } | { t: 'split'; dir: 'h' | 'v'; kids: PaneNode[]; sizes: number[] }

export interface PaneLayout {
  panes: Pane[]
  /** Legacy (before round 11): one width per pane in a single row. Kept in step for old readers. */
  widths: number[]
  /** The arrangement; missing in layouts saved before round 11 (then: one row by `widths`) */
  tree?: PaneNode
}

export const MAX_PANES = 6
/** A pane may not be dragged smaller than this part of the split it is in */
export const MIN_SIZE = 0.12
/** dataTransfer type set by the binder when a chapter is dragged, so it can be dropped on a pane */
export const CHAPTER_DRAG_TYPE = 'application/x-hakirchia-chapter'
/** dataTransfer type set by the binder when a background page is dragged */
export const MATERIAL_DRAG_TYPE = 'application/x-hakirchia-material'
/** Narrowest a pane may be dragged, as a fraction of the screen */
export const MIN_WIDTH = 0.2

let counter = 0
export const newPaneKey = (): string => `p${Date.now().toString(36)}${(counter++).toString(36)}`

const idOf = (c: PaneContent): string | undefined => ('id' in c ? c.id : undefined)
const same = (a: PaneContent, b: PaneContent) => a.kind === b.kind && idOf(a) === idOf(b)

export const evenWidths = (n: number): number[] => Array.from({ length: n }, () => 1 / n)

function fixWidths(widths: number[] | undefined, n: number): number[] {
  if (!widths || widths.length !== n || widths.some((w) => !(w > 0))) return evenWidths(n)
  const sum = widths.reduce((a, b) => a + b, 0)
  return widths.map((w) => w / sum)
}

// ---------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------

export function leafKeys(n: PaneNode): string[] {
  return n.t === 'leaf' ? [n.key] : n.kids.flatMap(leafKeys)
}

const row = (keys: string[], sizes?: number[]): PaneNode =>
  keys.length === 1 ? { t: 'leaf', key: keys[0] } : { t: 'split', dir: 'h', kids: keys.map((key) => ({ t: 'leaf', key }) as PaneNode), sizes: fixWidths(sizes, keys.length) }

/** Drops leaves not in `keep`, merges what is left (a split of one becomes that one) */
function prune(n: PaneNode, keep: Set<string>): PaneNode | null {
  if (n.t === 'leaf') return keep.has(n.key) ? n : null
  const kids: PaneNode[] = []
  const sizes: number[] = []
  n.kids.forEach((k, i) => {
    const p = prune(k, keep)
    if (!p) return
    // a split inside a split of the same direction is flattened into it
    if (p.t === 'split' && p.dir === n.dir) {
      p.kids.forEach((kk, j) => {
        kids.push(kk)
        sizes.push((n.sizes[i] ?? 0) * p.sizes[j])
      })
    } else {
      kids.push(p)
      sizes.push(n.sizes[i] ?? 0)
    }
  })
  if (!kids.length) return null
  if (kids.length === 1) return kids[0]
  return { t: 'split', dir: n.dir, kids, sizes: fixWidths(sizes, kids.length) }
}

function validTree(n: unknown): n is PaneNode {
  if (!n || typeof n !== 'object') return false
  const r = n as Record<string, unknown>
  if (r.t === 'leaf') return typeof r.key === 'string'
  return r.t === 'split' && (r.dir === 'h' || r.dir === 'v') && Array.isArray(r.kids) && r.kids.length > 0 && r.kids.every(validTree) && Array.isArray(r.sizes)
}

/** The layout's arrangement (built as one row for layouts saved before there was a tree) */
export function treeOf(layout: PaneLayout): PaneNode {
  const keys = layout.panes.map((p) => p.key)
  const t = layout.tree
  if (validTree(t)) {
    const have = leafKeys(t)
    if (have.length === keys.length && keys.every((k) => have.includes(k))) return t
    const pruned = prune(t, new Set(keys))
    if (pruned) {
      const left = leafKeys(pruned)
      const missing = keys.filter((k) => !left.includes(k))
      if (!missing.length) return pruned
    }
  }
  return row(keys, layout.widths)
}

/** A layout with this arrangement: panes put in tree order, legacy widths kept in step */
function withTree(layout: PaneLayout, tree: PaneNode, panes: Pane[] = layout.panes): PaneLayout {
  const by = new Map(panes.map((p) => [p.key, p]))
  const ordered = leafKeys(tree).flatMap((k) => (by.has(k) ? [by.get(k)!] : []))
  const widths = tree.t === 'split' && tree.dir === 'h' && tree.kids.every((k) => k.t === 'leaf') ? [...tree.sizes] : evenWidths(ordered.length)
  return { panes: ordered, widths, tree }
}

function mapLeaf(n: PaneNode, key: string, fn: (leaf: PaneNode, parent: (PaneNode & { t: 'split' }) | null, i: number) => PaneNode, parent: (PaneNode & { t: 'split' }) | null = null, i = 0): PaneNode {
  if (n.t === 'leaf') return n.key === key ? fn(n, parent, i) : n
  const kids = n.kids.map((k, j) => mapLeaf(k, key, fn, n, j))
  return { ...n, kids }
}

/** Puts a new leaf next to `target` (after it), beside ('h') or below ('v') */
function insertBeside(tree: PaneNode, target: string, key: string, dir: 'h' | 'v'): PaneNode {
  const leaf: PaneNode = { t: 'leaf', key }
  // the target's own split already goes this way: the new pane joins it, taking an even share
  const parentOf = (n: PaneNode): (PaneNode & { t: 'split' }) | null => {
    if (n.t === 'leaf') return null
    if (n.kids.some((k) => k.t === 'leaf' && k.key === target)) return n
    for (const k of n.kids) {
      const p = parentOf(k)
      if (p) return p
    }
    return null
  }
  const parent = parentOf(tree)
  if (parent && parent.dir === dir) {
    const at = parent.kids.findIndex((k) => k.t === 'leaf' && k.key === target)
    const m = parent.kids.length + 1
    const sizes = parent.sizes.map((x) => x * (1 - 1 / m))
    sizes.splice(at + 1, 0, 1 / m)
    const kids = [...parent.kids]
    kids.splice(at + 1, 0, leaf)
    const replace = (n: PaneNode): PaneNode => (n === parent ? { ...parent, kids, sizes } : n.t === 'split' ? { ...n, kids: n.kids.map(replace) } : n)
    return replace(tree)
  }
  if (tree.t === 'leaf' && tree.key === target) return { t: 'split', dir, kids: [tree, leaf], sizes: [0.5, 0.5] }
  return mapLeaf(tree, target, (l) => ({ t: 'split', dir, kids: [l, leaf], sizes: [0.5, 0.5] }))
}

/** Splits pane `index` in two: the new pane (showing `content`) goes beside it or below it */
export function splitPane(layout: PaneLayout, index: number, content: PaneContent, dir: 'h' | 'v'): PaneLayout {
  if (layout.panes.length >= MAX_PANES || !layout.panes[index]) return layout
  const key = newPaneKey()
  const tree = insertBeside(treeOf(layout), layout.panes[index].key, key, dir)
  return withTree(layout, tree, [...layout.panes, { key, content }])
}

/** Drags the border after child `index` of the split at `path` (child indexes from the root) */
export function resizeSplit(tree: PaneNode, path: number[], index: number, delta: number): PaneNode {
  if (tree.t === 'leaf') return tree
  if (path.length) {
    const kids = tree.kids.map((k, i) => (i === path[0] ? resizeSplit(k, path.slice(1), index, delta) : k))
    return { ...tree, kids }
  }
  if (index < 0 || index >= tree.sizes.length - 1) return tree
  const pair = tree.sizes[index] + tree.sizes[index + 1]
  const min = Math.min(MIN_SIZE, pair / 2)
  const a = Math.min(pair - min, Math.max(min, tree.sizes[index] + delta))
  const sizes = [...tree.sizes]
  sizes[index] = a
  sizes[index + 1] = pair - a
  return { ...tree, sizes }
}

/** Even sizes for the split at `path` (double-click on a border) */
export function evenSplit(tree: PaneNode, path: number[]): PaneNode {
  if (tree.t === 'leaf') return tree
  if (path.length) return { ...tree, kids: tree.kids.map((k, i) => (i === path[0] ? evenSplit(k, path.slice(1)) : k)) }
  return { ...tree, sizes: evenWidths(tree.kids.length) }
}

export interface Rect {
  /** From the start side (the right in RTL) and from the top, as fractions of the whole area */
  x: number
  y: number
  w: number
  h: number
}
export interface Border extends Rect {
  path: number[]
  index: number
  dir: 'h' | 'v'
  /** Size of the split the border is in, as a fraction of the whole area (along `dir`) */
  span: number
}

/** Where every pane is, and every border that can be dragged */
export function layoutRects(tree: PaneNode): { rects: Map<string, Rect>; borders: Border[] } {
  const rects = new Map<string, Rect>()
  const borders: Border[] = []
  const walk = (n: PaneNode, r: Rect, path: number[]) => {
    if (n.t === 'leaf') return void rects.set(n.key, r)
    let at = 0
    n.kids.forEach((k, i) => {
      const s = n.sizes[i] ?? 1 / n.kids.length
      const kr = n.dir === 'h' ? { x: r.x + at * r.w, y: r.y, w: s * r.w, h: r.h } : { x: r.x, y: r.y + at * r.h, w: r.w, h: s * r.h }
      at += s
      walk(k, kr, [...path, i])
      if (i < n.kids.length - 1) {
        borders.push(
          n.dir === 'h'
            ? { path, index: i, dir: 'h', x: r.x + at * r.w, y: r.y, w: 0, h: r.h, span: r.w }
            : { path, index: i, dir: 'v', x: r.x, y: r.y + at * r.h, w: r.w, h: 0, span: r.h }
        )
      }
    })
  }
  walk(tree, { x: 0, y: 0, w: 1, h: 1 }, [])
  return { rects, borders }
}

/** First screen: one pane with the chapter being written (the writing view as it always was). */
export function defaultLayout(book: Book, activeId: string | null): PaneLayout {
  const ids = book.chapters.map((c) => c.id)
  const first = activeId && ids.includes(activeId) ? activeId : ids[0]
  return { panes: [{ key: newPaneKey(), content: first ? { kind: 'chapter', id: first } : { kind: 'master' } }], widths: [1] }
}

/**
 * Makes a saved (or edited) layout valid for the book as it is now: drops panes of deleted
 * chapters, keeps at most 3 panes and one master, and always leaves at least one pane.
 */
export function normalizeLayout(layout: PaneLayout | undefined, book: Book, activeId: string | null): PaneLayout {
  if (!layout?.panes?.length) return defaultLayout(book, activeId)
  const ids = new Set(book.chapters.map((c) => c.id))
  const alts = new Set((book.alts ?? []).map((a) => a.id))
  const mats = new Set((book.materials ?? []).map((m) => m.id))
  const keep: number[] = []
  const seen = new Set<string>()
  layout.panes.forEach((p, i) => {
    if (keep.length >= MAX_PANES || !p?.content) return
    if (p.content.kind === 'chapter' && !ids.has(p.content.id)) return
    if (p.content.kind === 'alt' && !alts.has(p.content.id)) return
    if (p.content.kind === 'material' && !mats.has(p.content.id)) return
    if (!KINDS.includes(p.content.kind)) return
    if (SINGLE.has(p.content.kind)) {
      if (seen.has(p.content.kind)) return
      seen.add(p.content.kind)
    }
    keep.push(i)
  })
  if (!keep.length) return defaultLayout(book, activeId)
  const panes = keep.map((i) => ({ key: layout.panes[i].key || newPaneKey(), content: layout.panes[i].content }))
  const widths = fixWidths(
    keep.map((i) => layout.widths?.[i] ?? 0),
    panes.length
  )
  return withTree({ panes, widths }, treeOf({ panes, widths, tree: layout.tree }))
}

/**
 * What a new pane shows: the chapter after the one in focus (or before it) that is not on screen
 * yet; if every chapter is open, the whole book.
 */
export function nextContent(layout: PaneLayout, book: Book, focused = 0): PaneContent {
  const open = new Set(layout.panes.flatMap((p) => (p.content.kind === 'chapter' ? [p.content.id] : [])))
  const ids = book.chapters.map((c) => c.id)
  const cur = layout.panes[focused]?.content
  const at = cur?.kind === 'chapter' ? ids.indexOf(cur.id) : -1
  const order = at < 0 ? ids : [...ids.slice(at + 1), ...ids.slice(0, at).reverse()]
  const id = order.find((x) => !open.has(x))
  if (id) return { kind: 'chapter', id }
  if (!layout.panes.some((p) => p.content.kind === 'master')) return { kind: 'master' }
  return ids[0] ? { kind: 'chapter', id: ids[0] } : { kind: 'master' }
}

/**
 * The translation screen (feature 12): the chapter, its original (PDF) and Google Translate side
 * by side. Keeps the chapter that is on screen; the widths can be dragged like any panes.
 */
export function translationLayout(book: Book, activeId: string | null): PaneLayout {
  const ids = book.chapters.map((c) => c.id)
  const id = activeId && ids.includes(activeId) ? activeId : ids[0]
  const panes: Pane[] = []
  if (id) panes.push({ key: newPaneKey(), content: { kind: 'chapter', id } })
  panes.push({ key: newPaneKey(), content: { kind: 'pdf' } }, { key: newPaneKey(), content: { kind: 'web' } })
  const widths = panes.length === 3 ? [0.38, 0.37, 0.25] : evenWidths(panes.length)
  return { panes, widths, tree: row(panes.map((p) => p.key), widths) }
}

/** Adds a pane after `after` (or at the end). The new pane takes an even share of the width. */
export function addPane(layout: PaneLayout, content: PaneContent, after?: number): PaneLayout {
  if (layout.panes.length >= MAX_PANES) return layout
  if (layout.panes.length && layout.tree) return splitPane(layout, after === undefined ? layout.panes.length - 1 : after, content, 'h')
  const at = after === undefined ? layout.panes.length : after + 1
  const n = layout.panes.length + 1
  const share = 1 / n
  const widths = layout.widths.map((w) => w * (1 - share))
  widths.splice(at, 0, share)
  const panes = [...layout.panes]
  panes.splice(at, 0, { key: newPaneKey(), content })
  return { panes, widths }
}

/** Closes a pane; its width goes to its neighbours. The last pane cannot be closed. */
export function closePane(layout: PaneLayout, index: number): PaneLayout {
  if (layout.panes.length <= 1 || index < 0 || index >= layout.panes.length) return layout
  const panes = layout.panes.filter((_, i) => i !== index)
  const tree = prune(treeOf(layout), new Set(panes.map((p) => p.key)))
  if (!tree) return layout
  return withTree(layout, tree, panes)
}

/** Puts something else in a pane. If it is already open in another pane, the two swap places. */
export function setPaneContent(layout: PaneLayout, index: number, content: PaneContent): PaneLayout {
  const cur = layout.panes[index]
  if (!cur || same(cur.content, content)) return layout
  const other = layout.panes.findIndex((p, i) => i !== index && same(p.content, content))
  if (other >= 0 && SINGLE.has(content.kind)) return swapPanes(layout, index, other)
  const panes = layout.panes.map((p, i) => (i === index ? { ...p, content } : p))
  return { ...layout, panes }
}

/** Swaps two panes (with their widths staying where they are on screen). */
export function swapPanes(layout: PaneLayout, a: number, b: number): PaneLayout {
  if (a === b || !layout.panes[a] || !layout.panes[b]) return layout
  // the two panes trade places; the places keep their sizes
  const ka = layout.panes[a].key
  const kb = layout.panes[b].key
  const swap = (n: PaneNode): PaneNode => (n.t === 'leaf' ? { t: 'leaf', key: n.key === ka ? kb : n.key === kb ? ka : n.key } : { ...n, kids: n.kids.map(swap) })
  return withTree(layout, swap(treeOf(layout)))
}

/**
 * Drags the border between pane `index` and pane `index + 1`. `delta` is a fraction of the
 * whole width: positive grows pane `index`. Neither pane gets narrower than MIN_WIDTH.
 */
export function resizeBorder(widths: number[], index: number, delta: number): number[] {
  if (index < 0 || index >= widths.length - 1) return widths
  const pair = widths[index] + widths[index + 1]
  const min = Math.min(MIN_WIDTH, pair / 2)
  const a = Math.min(pair - min, Math.max(min, widths[index] + delta))
  const next = [...widths]
  next[index] = a
  next[index + 1] = pair - a
  return next
}
