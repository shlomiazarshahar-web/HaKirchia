// Navigation round (features 24, 29, 30, 33): what the editors share for finding text, scenes,
// bookmarks and jumping to a place in any chapter.
import { useSyncExternalStore } from 'react'
import { Extension, InputRule, getSchema, type Editor } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMDoc } from '@tiptap/pm/model'
import type { Bookmark, PMNode } from '@shared/types'
import { findInText, type SearchOptions } from '@shared/search'
import { isSceneBreak, scenesOf, SCENE_BREAK_TEXT } from '@shared/scenes'
import { centerCursor, contextAt, editorExtensions, locatePlace } from './editor'
import { api } from './api'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    sceneBreak: {
      /** Puts a scene break ("* * *", centered) at the cursor and continues writing below it */
      insertSceneBreak: () => ReturnType
      /** Moves the cursor to the start of the next (1) or previous (-1) scene */
      goToScene: (dir: 1 | -1) => ReturnType
    }
  }
}

// ---------------------------------------------------------------------------
// Every chapter editor on screen, so a jump or a replace can reach the one showing a chapter
// ---------------------------------------------------------------------------

const editors = new Map<string, Set<Editor>>()
const chapterOf = new WeakMap<Editor, { bookPath: string; chapterId: string }>()

let editorsVersion = 0
const editorListeners = new Set<() => void>()
const editorsChanged = () => {
  editorsVersion++
  editorListeners.forEach((l) => l())
}
/** Changes whenever an editor opens or closes (to re-read editorsFor) */
export function useEditorsVersion(): number {
  return useSyncExternalStore(
    (l) => (editorListeners.add(l), () => editorListeners.delete(l)),
    () => editorsVersion
  )
}

export function registerEditor(bookPath: string, chapterId: string, e: Editor): () => void {
  const key = `${bookPath}|${chapterId}`
  if (!editors.has(key)) editors.set(key, new Set())
  editors.get(key)!.add(e)
  chapterOf.set(e, { bookPath, chapterId })
  editorsChanged()
  return () => {
    editors.get(key)?.delete(e)
    editorsChanged()
  }
}
export function editorsFor(bookPath: string, chapterId: string): Editor[] {
  return [...(editors.get(`${bookPath}|${chapterId}`) ?? [])].filter((e) => !e.isDestroyed)
}
export function editorChapter(e: Editor | null): { bookPath: string; chapterId: string } | undefined {
  return e ? chapterOf.get(e) : undefined
}
function allEditors(bookPath?: string): Editor[] {
  const out: Editor[] = []
  for (const [k, set] of editors) if (!bookPath || k.startsWith(bookPath + '|')) for (const e of set) if (!e.isDestroyed) out.push(e)
  return out
}
/** Tells the plugins of the editors that something they show changed (search, bookmarks, glossary) */
export function poke(key: PluginKey, bookPath?: string) {
  for (const e of allEditors(bookPath)) e.view.dispatch(e.state.tr.setMeta(key, true).setMeta('addToHistory', false))
}

// ---------------------------------------------------------------------------
// Paragraphs of a chapter, with their positions
// ---------------------------------------------------------------------------

export interface Block {
  /** Position right before the paragraph; its text starts at pos + 1 */
  pos: number
  text: string
}

export function textBlocks(doc: PMDoc): Block[] {
  const out: Block[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    out.push({ pos, text: node.textBetween(0, node.content.size, undefined, '￼') })
    return false
  })
  return out
}

/**
 * Text for Claude's writing review (round 13 fix): each footnote's number becomes a mark like [^1]
 * in its paragraph, and the notes' own text is returned in order, to be sent after the chapter.
 * (In textBlocks a footnote is a placeholder character, which the review used to see as a strange sign.)
 * With from/to, only that part of the document (a selection).
 */
export function reviewParas(doc: PMDoc, from = 0, to = doc.content.size): { paras: string[]; notes: string[] } {
  const paras: string[] = []
  const notes: string[] = []
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true
    let s = ''
    node.forEach((child, off) => {
      const a = pos + 1 + off
      const b = a + child.nodeSize
      if (b <= from || a >= to) return
      if (child.isText) s += (child.text ?? '').slice(Math.max(0, from - a), Math.min(child.nodeSize, to - a))
      else if (child.type.name === 'footnote') {
        notes.push(String(child.attrs.text ?? '').trim())
        s += `[^${notes.length}]`
      } else if (child.type.name === 'hardBreak') s += '\n'
    })
    paras.push(s)
    return false
  })
  return { paras, notes }
}

/** The editor's document model, for chapters that are not open on screen (find and replace) */
let schema: ReturnType<typeof getSchema> | null = null
export function docFromJSON(json: PMNode): PMDoc {
  schema ??= getSchema(editorExtensions)
  return schema.nodeFromJSON(json)
}

// ---------------------------------------------------------------------------
// Jumping to a place in a chapter
// ---------------------------------------------------------------------------

/** A place: an exact position (with an optional end, to select it), or a remembered place (with the text around it) */
export interface JumpTarget {
  pos: number
  to?: number
  before?: string
  after?: string
  /** false: show it, but leave the keyboard where it is (moving through search results) */
  focus?: boolean
}

export function applyJump(editor: Editor, t: JumpTarget): void {
  const size = editor.state.doc.content.size
  const clamp = (p: number) => Math.max(1, Math.min(size - 1, p))
  const at = clamp(t.before !== undefined || t.after !== undefined ? locatePlace(editor.state.doc, { pos: t.pos, before: t.before ?? '', after: t.after ?? '' }) : t.pos)
  const to = t.to !== undefined ? clamp(at + (t.to - t.pos)) : at
  if (t.focus === false) {
    editor.commands.setTextSelection({ from: at, to })
    const ch = editorChapter(editor)
    if (ch) setCurrentHit({ ...ch, from: at, to })
  } else editor.chain().focus().setTextSelection({ from: at, to }).run()
  requestAnimationFrame(() => !editor.isDestroyed && centerCursor(editor.view, true, at))
}

let pendingJump: { bookPath: string; chapterId: string; t: JumpTarget } | null = null
/** The chapter is about to open: its editor goes to this place as soon as it has loaded. */
export function setPendingJump(bookPath: string, chapterId: string, t: JumpTarget | null): void {
  pendingJump = t ? { bookPath, chapterId, t } : null
}
export function takePendingJump(bookPath: string, chapterId: string): JumpTarget | null {
  if (!pendingJump || pendingJump.bookPath !== bookPath || pendingJump.chapterId !== chapterId) return null
  const t = pendingJump.t
  pendingJump = null
  return t
}

// ---------------------------------------------------------------------------
// Scenes (feature 29)
// ---------------------------------------------------------------------------

export interface SceneItem {
  label: string
  /** Where the scene's text starts */
  pos: number
}

export function scenesIn(doc: PMDoc): SceneItem[] {
  const blocks = textBlocks(doc)
  return scenesOf(blocks.map((b) => b.text)).map((s) => ({ label: s.label, pos: blocks[s.block].pos + 1 }))
}

/** Index of the scene the position is in */
export function sceneAt(scenes: SceneItem[], pos: number): number {
  let i = 0
  for (let k = 0; k < scenes.length; k++) if (scenes[k].pos <= pos + 1) i = k
  return i
}

const sceneKey = new PluginKey('sceneBreaks')

function breakDecorations(doc: PMDoc): DecorationSet {
  const decos: Decoration[] = []
  doc.forEach((node, pos) => {
    if (node.isTextblock && isSceneBreak(node.textContent)) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'scene-break' }))
  })
  return DecorationSet.create(doc, decos)
}

/** Puts a scene break at the selection, inside an existing transaction. Returns where writing continues. */
function putBreak(state: EditorState, tr: Transaction): void {
  const para = state.schema.nodes.paragraph
  const brk = para.create({ textAlign: 'center' }, state.schema.text(SCENE_BREAK_TEXT))
  if (!tr.selection.empty) tr.deleteSelection()
  const $p = tr.selection.$from
  const blk = $p.parent
  let sel: number
  if (!blk.isTextblock) return
  if (blk.content.size === 0) {
    tr.replaceWith($p.before(), $p.after(), [brk, para.create()])
    sel = $p.before() + brk.nodeSize + 1
  } else if ($p.parentOffset === blk.content.size) {
    const at = $p.after()
    tr.insert(at, [brk, para.create()])
    sel = at + brk.nodeSize + 1
  } else if ($p.parentOffset === 0) {
    const at = $p.before()
    tr.insert(at, brk)
    sel = at + brk.nodeSize + 1
  } else {
    tr.split($p.pos)
    const at = tr.selection.$from.before()
    tr.insert(at, brk)
    sel = at + brk.nodeSize + 1
  }
  tr.setSelection(TextSelection.create(tr.doc, sel)).scrollIntoView()
}

export const SceneBreaks = Extension.create({
  name: 'sceneBreak',
  addCommands() {
    return {
      insertSceneBreak:
        () =>
        ({ state, tr, dispatch }) => {
          if (!state.selection.$from.parent.isTextblock) return false
          if (dispatch) putBreak(state, tr)
          return true
        },
      goToScene:
        (dir) =>
        ({ state, tr, dispatch, view }) => {
          const scenes = scenesIn(state.doc)
          if (scenes.length < 2) return false
          const i = sceneAt(scenes, state.selection.head)
          const atStart = state.selection.head <= scenes[i].pos
          const j = dir === 1 ? i + 1 : atStart ? i - 1 : i
          if (j < 0 || j >= scenes.length) return false
          if (dispatch) {
            tr.setSelection(TextSelection.create(tr.doc, scenes[j].pos))
            requestAnimationFrame(() => centerCursor(view, true))
          }
          return true
        }
    }
  },
  addKeyboardShortcuts() {
    return {
      'Mod-Shift-Enter': () => this.editor.commands.insertSceneBreak(),
      'Alt-PageDown': () => this.editor.commands.goToScene(1) || true,
      'Alt-PageUp': () => this.editor.commands.goToScene(-1) || true
    }
  },
  addInputRules() {
    return [
      // *** typed alone in a paragraph becomes a scene break (Backspace right after brings back the stars)
      new InputRule({
        find: /^\s*\*\s*\*\s*\*$/,
        handler: ({ state, range }) => {
          const $f = state.doc.resolve(range.from)
          if ($f.parent.type.name !== 'paragraph' || range.to !== $f.end()) return null
          const tr = state.tr
          const para = state.schema.nodes.paragraph
          const brk = para.create({ ...$f.parent.attrs, textAlign: 'center' }, state.schema.text(SCENE_BREAK_TEXT))
          const start = $f.before()
          tr.replaceWith(start, $f.after(), [brk, para.create({ dir: $f.parent.attrs.dir })])
          tr.setSelection(TextSelection.create(tr.doc, start + brk.nodeSize + 1))
        }
      })
    ]
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: sceneKey,
        state: {
          init: (_, state) => breakDecorations(state.doc),
          apply: (tr, old) => (tr.docChanged ? breakDecorations(tr.doc) : old)
        },
        props: { decorations: (state) => sceneKey.getState(state) }
      })
    ]
  }
})

// ---------------------------------------------------------------------------
// Find: matches highlighted in every open editor (feature 24)
// ---------------------------------------------------------------------------

export interface DocMatch {
  from: number
  to: number
  /** the paragraph's text and the match inside it, for the list of results */
  text: string
  start: number
  end: number
}

export function findInDoc(doc: PMDoc, query: string, opts: SearchOptions): DocMatch[] {
  const out: DocMatch[] = []
  for (const b of textBlocks(doc)) {
    for (const m of findInText(b.text, query, opts)) out.push({ from: b.pos + 1 + m.start, to: b.pos + 1 + m.end, text: b.text, start: m.start, end: m.end })
  }
  return out
}

let highlight: { query: string; opts: SearchOptions } | null = null
let hit: { bookPath: string; chapterId: string; from: number; to: number } | null = null
const searchKey = new PluginKey('searchHighlight')

/** The search result being looked at now: marked more strongly than the others */
export function setCurrentHit(h: typeof hit): void {
  if (JSON.stringify(h) === JSON.stringify(hit)) return
  hit = h
  poke(searchKey)
}

/** What the find panel looks for now; every open editor marks it (null: nothing) */
export function setSearchHighlight(h: { query: string; opts: SearchOptions } | null): void {
  if (JSON.stringify(h) === JSON.stringify(highlight)) return
  highlight = h
  if (!h) hit = null
  poke(searchKey)
}

function matchDecorations(doc: PMDoc, bookPath: string, chapterId: string): DecorationSet {
  if (!highlight) return DecorationSet.empty
  const ms = findInDoc(doc, highlight.query, highlight.opts)
  const cur = hit && hit.bookPath === bookPath && hit.chapterId === chapterId ? hit : null
  return DecorationSet.create(
    doc,
    ms.slice(0, 2000).map((m) => Decoration.inline(m.from, m.to, { class: cur && cur.from === m.from && cur.to === m.to ? 'find-hit cur' : 'find-hit' }))
  )
}

/** Marks what the find panel looks for, in one chapter editor */
export function searchHighlight(bookPath: string, chapterId: string) {
  return Extension.create({
    name: 'searchHighlight',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: searchKey,
          state: {
            init: (_, state) => matchDecorations(state.doc, bookPath, chapterId),
            apply: (tr, old) => (tr.getMeta(searchKey) || (tr.docChanged && highlight) ? matchDecorations(tr.doc, bookPath, chapterId) : old)
          },
          props: { decorations: (state) => searchKey.getState(state) }
        })
      ]
    }
  })
}

// ---------------------------------------------------------------------------
// Bookmarks (feature 30): the list of the open book, a flag in the text, kept up to date
// ---------------------------------------------------------------------------

let marks: { bookPath: string; list: Bookmark[] } = { bookPath: '', list: [] }
const markListeners = new Set<() => void>()
const bmKey = new PluginKey('bookmarks')
let persistTimer: ReturnType<typeof setTimeout> | null = null

function setMarks(list: Bookmark[], persist: 'now' | 'later' | false) {
  marks = { ...marks, list }
  markListeners.forEach((l) => l())
  poke(bmKey, marks.bookPath)
  if (!persist) return
  if (persistTimer) clearTimeout(persistTimer)
  const { bookPath } = marks
  const save = () => void api.setBookmarks(bookPath, marks.bookPath === bookPath ? marks.list : list)
  if (persist === 'now') save()
  else persistTimer = setTimeout(save, 1200)
}

/** A book was opened: its bookmarks */
export function loadBookmarks(bookPath: string, list: Bookmark[]): void {
  marks = { bookPath, list }
  markListeners.forEach((l) => l())
}
export function useBookmarks(): Bookmark[] {
  return useSyncExternalStore(
    (l) => (markListeners.add(l), () => markListeners.delete(l)),
    () => marks.list
  )
}
export function getBookmarks(): Bookmark[] {
  return marks.list
}

/** The bookmark exactly at the cursor of this editor, if there is one */
export function bookmarkAt(editor: Editor): Bookmark | undefined {
  const pos = editor.state.selection.head
  const places = bmKey.getState(editor.state) as Map<string, number> | undefined
  if (!places) return undefined
  for (const [id, p] of places) if (p === pos) return marks.list.find((b) => b.id === id)
  return undefined
}

/** Adds a bookmark at the cursor of an editor. Returns it (for naming it right away). */
export function addBookmark(editor: Editor): Bookmark | null {
  const ch = editorChapter(editor)
  if (!ch || ch.bookPath !== marks.bookPath) return null
  const b: Bookmark = { id: crypto.randomUUID(), chapterId: ch.chapterId, ...contextAt(editor.state.doc, editor.state.selection.head), label: '', at: Date.now() }
  setMarks([...marks.list, b], 'now')
  return b
}
export function renameBookmark(id: string, label: string): void {
  setMarks(
    marks.list.map((b) => (b.id === id ? { ...b, label: label.trim() } : b)),
    'now'
  )
}
export function removeBookmark(id: string): void {
  setMarks(
    marks.list.filter((b) => b.id !== id),
    'now'
  )
}

/** Where a bookmark is right now in an open editor of its chapter (exact), if one is open */
export function bookmarkPos(editor: Editor, id: string): number | undefined {
  return (bmKey.getState(editor.state) as Map<string, number> | undefined)?.get(id)
}

/**
 * After a chapter was saved: the bookmarks in it may have moved with the text. Their remembered
 * places (position and the text around it) are brought up to date, so they are found next time.
 */
export function refreshBookmarkPlaces(editor: Editor): void {
  const ch = editorChapter(editor)
  if (!ch || ch.bookPath !== marks.bookPath || editor.isDestroyed) return
  const places = bmKey.getState(editor.state) as Map<string, number> | undefined
  if (!places?.size) return
  let changed = false
  const list = marks.list.map((b) => {
    const p = b.chapterId === ch.chapterId ? places.get(b.id) : undefined
    if (p === undefined) return b
    const c = contextAt(editor.state.doc, p)
    if (c.pos === b.pos && c.before === b.before && c.after === b.after) return b
    changed = true
    return { ...b, ...c }
  })
  if (changed) {
    marks = { ...marks, list }
    markListeners.forEach((l) => l())
    setMarks(list, 'later')
  }
}

function locateAll(doc: PMDoc, chapterId: string, keep?: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>()
  for (const b of marks.list) {
    if (b.chapterId !== chapterId) continue
    out.set(b.id, keep?.get(b.id) ?? Math.max(1, Math.min(doc.content.size - 1, locatePlace(doc, b))))
  }
  return out
}

function flag(label: string) {
  return () => {
    const el = document.createElement('span')
    el.className = 'bm-flag'
    el.title = label ? `סימנייה: ${label}` : 'סימנייה: לחזור לכאן'
    el.setAttribute('aria-label', el.title)
    el.contentEditable = 'false'
    return el
  }
}

/** Shows the book's bookmarks inside one chapter editor, and follows them as the text changes. */
export function bookmarkFlags(bookPath: string, chapterId: string) {
  return Extension.create({
    name: 'bookmarkFlags',
    addProseMirrorPlugins() {
      const mine = () => marks.bookPath === bookPath
      return [
        new Plugin({
          key: bmKey,
          state: {
            init: (_, state) => (mine() ? locateAll(state.doc, chapterId) : new Map<string, number>()),
            apply: (tr, old, prev, next) => {
              if (!mine()) return old.size ? new Map<string, number>() : old
              // the whole text was replaced (the same chapter typed in elsewhere, or changed in Word): find them again
              const whole = tr.docChanged && tr.steps.some((s) => (s as unknown as { from: number; to: number }).from === 0 && (s as unknown as { to: number }).to === prev.doc.content.size)
              if (whole) return locateAll(next.doc, chapterId)
              let m = old
              if (tr.docChanged) {
                m = new Map()
                for (const [id, p] of old) m.set(id, tr.mapping.map(p, -1))
              }
              if (tr.getMeta(bmKey)) m = locateAll(next.doc, chapterId, m)
              return m
            }
          },
          props: {
            decorations: (state) => {
              const m = bmKey.getState(state) as Map<string, number>
              if (!m.size) return DecorationSet.empty
              const decos: Decoration[] = []
              for (const [id, p] of m) {
                const b = marks.list.find((x) => x.id === id)
                if (b) decos.push(Decoration.widget(p, flag(b.label), { key: `${id}|${b.label}`, side: -1, ignoreSelection: true }))
              }
              return DecorationSet.create(state.doc, decos)
            }
          }
        })
      ]
    }
  })
}

/** Short text for a bookmark without a name: the words around it */
export function bookmarkText(b: Bookmark): string {
  if (b.label) return b.label
  const before = b.before.split(/\s+/).slice(-3).join(' ')
  const after = b.after.split(/\s+/).slice(0, 3).join(' ')
  return before || after ? `${before}│${after}`.trim() : 'לחזור לכאן'
}
