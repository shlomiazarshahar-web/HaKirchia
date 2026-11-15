// Split screen (feature 6): 1–3 panes side by side. Pure functions, no React, so they can be
// tested and reused by later pane screens (the translation screen of feature 12 adds 'pdf' and
// 'translate' contents; background materials of feature 11 add 'material').

import type { Book } from './types'

export type PaneContent = { kind: 'chapter'; id: string } | { kind: 'master' }

export interface Pane {
  /** Stable id, so moving a pane does not reload its editor */
  key: string
  content: PaneContent
}

export interface PaneLayout {
  panes: Pane[]
  /** One width per pane, as fractions that add up to 1 */
  widths: number[]
}

export const MAX_PANES = 3
/** dataTransfer type set by the binder when a chapter is dragged, so it can be dropped on a pane */
export const CHAPTER_DRAG_TYPE = 'application/x-hakirchia-chapter'
/** Narrowest a pane may be dragged, as a fraction of the screen */
export const MIN_WIDTH = 0.2

let counter = 0
export const newPaneKey = (): string => `p${Date.now().toString(36)}${(counter++).toString(36)}`

const same = (a: PaneContent, b: PaneContent) => a.kind === b.kind && (a.kind !== 'chapter' || (b.kind === 'chapter' && a.id === b.id))

export const evenWidths = (n: number): number[] => Array.from({ length: n }, () => 1 / n)

function fixWidths(widths: number[] | undefined, n: number): number[] {
  if (!widths || widths.length !== n || widths.some((w) => !(w > 0))) return evenWidths(n)
  const sum = widths.reduce((a, b) => a + b, 0)
  return widths.map((w) => w / sum)
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
  const keep: number[] = []
  let master = false
  layout.panes.forEach((p, i) => {
    if (keep.length >= MAX_PANES || !p?.content) return
    if (p.content.kind === 'chapter' && !ids.has(p.content.id)) return
    if (p.content.kind === 'master') {
      if (master) return
      master = true
    }
    if (p.content.kind !== 'chapter' && p.content.kind !== 'master') return
    keep.push(i)
  })
  if (!keep.length) return defaultLayout(book, activeId)
  const panes = keep.map((i) => ({ key: layout.panes[i].key || newPaneKey(), content: layout.panes[i].content }))
  const widths = fixWidths(
    keep.map((i) => layout.widths?.[i] ?? 0),
    panes.length
  )
  return { panes, widths }
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

/** Adds a pane after `after` (or at the end). The new pane takes an even share of the width. */
export function addPane(layout: PaneLayout, content: PaneContent, after?: number): PaneLayout {
  if (layout.panes.length >= MAX_PANES) return layout
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
  const widths = fixWidths(
    layout.widths.filter((_, i) => i !== index),
    panes.length
  )
  return { panes, widths }
}

/** Puts something else in a pane. If it is already open in another pane, the two swap places. */
export function setPaneContent(layout: PaneLayout, index: number, content: PaneContent): PaneLayout {
  const cur = layout.panes[index]
  if (!cur || same(cur.content, content)) return layout
  const other = layout.panes.findIndex((p, i) => i !== index && same(p.content, content))
  if (other >= 0 && content.kind === 'master') return swapPanes(layout, index, other)
  const panes = layout.panes.map((p, i) => (i === index ? { ...p, content } : p))
  return { ...layout, panes }
}

/** Swaps two panes (with their widths staying where they are on screen). */
export function swapPanes(layout: PaneLayout, a: number, b: number): PaneLayout {
  if (a === b || !layout.panes[a] || !layout.panes[b]) return layout
  const panes = [...layout.panes]
  ;[panes[a], panes[b]] = [panes[b], panes[a]]
  return { ...layout, panes }
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
