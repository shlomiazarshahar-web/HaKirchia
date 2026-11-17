// Saving and drafts round in the window: the drawer of cut text (feature 27) and private notes
// (feature 15), shared by every editor on screen.
import { useSyncExternalStore } from 'react'
import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { ReplaceStep, ReplaceAroundStep } from '@tiptap/pm/transform'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Fragment, Slice, type Node as PMDoc } from '@tiptap/pm/model'
import type { DrawerItem, PMNode, PrivateNote } from '@shared/types'
import { cleanDrawerText, drawerWorthy, type DrawerHow } from '@shared/drafts'
import { api } from './api'
import { contextAt, locatePlace } from './editor'
import { editorChapter } from './nav'

/** A tiny store that React components can follow */
function store<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (v: T) => {
      value = v
      listeners.forEach((l) => l())
    },
    use: () =>
      useSyncExternalStore(
        (l) => (listeners.add(l), () => listeners.delete(l)),
        () => value
      )
  }
}

// ---------------------------------------------------------------------------
// The drawer (feature 27)
// ---------------------------------------------------------------------------

const drawer = store<{ bookPath: string; items: DrawerItem[]; auto: boolean }>({ bookPath: '', items: [], auto: true })
export const useDrawer = drawer.use

const AUTO_KEY = 'hakirchia.drawer.auto'
function readAuto(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== '0'
  } catch {
    return true
  }
}

/** A book was opened: its drawer */
export async function loadDrawer(bookPath: string): Promise<void> {
  drawer.set({ bookPath, items: [], auto: readAuto() })
  const r = await api.listDrawer(bookPath)
  if (r.ok && r.value && drawer.get().bookPath === bookPath) drawer.set({ ...drawer.get(), items: r.value })
}

/** Keep cut and deleted text automatically (on by default) */
export function setDrawerAuto(on: boolean): void {
  try {
    localStorage.setItem(AUTO_KEY, on ? '1' : '0')
  } catch {
    /* not remembered */
  }
  drawer.set({ ...drawer.get(), auto: on })
}

/** Puts a piece of text in the drawer of the open book. */
export async function putInDrawer(piece: { text: string; content: PMNode[]; open?: [number, number]; chapterId: string | null; chapterTitle: string; how: DrawerHow }): Promise<DrawerItem | null> {
  const { bookPath } = drawer.get()
  const text = cleanDrawerText(piece.text)
  if (!bookPath || !text) return null
  const item: DrawerItem = { id: crypto.randomUUID(), at: Date.now(), ...piece, text }
  drawer.set({ ...drawer.get(), items: [item, ...drawer.get().items] })
  const r = await api.addToDrawer(bookPath, item)
  if (r.ok && r.value && drawer.get().bookPath === bookPath) drawer.set({ ...drawer.get(), items: r.value })
  return item
}

export async function removeFromDrawer(ids: string[]): Promise<void> {
  const { bookPath } = drawer.get()
  const drop = new Set(ids)
  drawer.set({ ...drawer.get(), items: drawer.get().items.filter((x) => !drop.has(x.id)) })
  if (bookPath) await api.removeFromDrawer(bookPath, ids)
}

/** The selected text of an editor as a drawer piece */
function pieceOf(state: EditorState, from: number, to: number) {
  const slice = state.doc.slice(from, to)
  const json = slice.content.toJSON() as PMNode[] | null
  return { text: state.doc.textBetween(from, to, '\n', ''), content: json ?? [], open: [slice.openStart, slice.openEnd] as [number, number] }
}

/** Moves the selected text of the editor to the drawer (Ctrl+Shift+M or the drawer button). */
export function moveSelectionToDrawer(editor: Editor, chapterTitle: string): boolean {
  const { from, to, empty } = editor.state.selection
  if (empty || !editor.isEditable) return false
  const p = pieceOf(editor.state, from, to)
  if (!p.text.trim()) return false
  void putInDrawer({ ...p, chapterId: editorChapter(editor)?.chapterId ?? null, chapterTitle, how: 'manual' })
  editor.view.dispatch(editor.state.tr.deleteSelection().setMeta('noDrawer', true).scrollIntoView())
  editor.commands.focus()
  return true
}

/** Puts a drawer piece back at the cursor of an editor */
export function insertFromDrawer(editor: Editor, item: DrawerItem): boolean {
  if (!editor.isEditable || editor.isDestroyed) return false
  try {
    // like pasting it: paragraphs stay paragraphs, a few words join the paragraph at the cursor
    const [openStart, openEnd] = item.open ?? [1, 1]
    const slice = new Slice(Fragment.fromJSON(editor.schema, item.content), openStart, openEnd)
    editor.view.dispatch(editor.state.tr.replaceSelection(slice).setMeta('noDrawer', true).scrollIntoView())
    editor.commands.focus()
    return true
  } catch {
    return editor.chain().focus().insertContent(item.text).run()
  }
}

/**
 * Watches one editor: when selected text is cut (Ctrl+X), or a selection of a few words is deleted or
 * typed over, the text is kept in the drawer first. Undo still works as always.
 */
export function drawerCapture(chapterId: string | null, chapterTitle: () => string) {
  return Extension.create({
    name: 'drawerCapture',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey('drawerCapture'),
          filterTransaction: (tr: Transaction, state: EditorState) => {
            if (!drawer.get().auto || !drawer.get().bookPath) return true
            if (!tr.docChanged || state.selection.empty) return true
            if (tr.getMeta('liveSync') || tr.getMeta('noDrawer') || tr.getMeta('addToHistory') === false || tr.getMeta('history$')) return true
            const ui = tr.getMeta('uiEvent')
            if (ui === 'drop' || ui === 'drag') return true
            const step = tr.steps[0]
            if (!(step instanceof ReplaceStep) && !(step instanceof ReplaceAroundStep)) return true
            const { from, to } = state.selection
            const s = step as unknown as { from: number; to: number }
            if (s.from !== from || s.to !== to) return true
            const how: DrawerHow = ui === 'cut' ? 'cut' : 'delete'
            const p = pieceOf(state, from, to)
            if (!drawerWorthy(p.text, how)) return true
            setTimeout(() => void putInDrawer({ ...p, chapterId, chapterTitle: chapterTitle(), how }), 0)
            return true
          }
        })
      ]
    }
  })
}

// ---------------------------------------------------------------------------
// Private notes (feature 15)
// ---------------------------------------------------------------------------

const notes = store<{ bookPath: string; list: PrivateNote[] }>({ bookPath: '', list: [] })
export const useNotes = notes.use
const notesKey = new PluginKey('privateNotes')
let notesTimer: ReturnType<typeof setTimeout> | null = null
/** The note whose words are marked more strongly (hovered or chosen in the list) */
let activeNote: string | null = null

export function loadNotes(bookPath: string, list: PrivateNote[]): void {
  notes.set({ bookPath, list })
}

function pokeNotes() {
  for (const e of noteEditors) if (!e.isDestroyed) e.view.dispatch(e.state.tr.setMeta(notesKey, true).setMeta('addToHistory', false))
}
const noteEditors = new Set<Editor>()

function setNotes(list: PrivateNote[], persist: 'now' | 'later') {
  const { bookPath } = notes.get()
  notes.set({ bookPath, list })
  pokeNotes()
  if (notesTimer) clearTimeout(notesTimer)
  const save = () => void api.setNotes(bookPath, notes.get().bookPath === bookPath ? notes.get().list : list)
  if (persist === 'now') save()
  else notesTimer = setTimeout(save, 1200)
}

/** A new note: on the selected words of the editor, or about the whole chapter */
export function addNote(chapterId: string, text: string, editor?: Editor | null): PrivateNote {
  let anchor: PrivateNote['anchor']
  if (editor && !editor.isDestroyed && !editor.state.selection.empty) {
    const { from, to } = editor.state.selection
    const quote = editor.state.doc.textBetween(from, to, ' ', '')
    if (quote.trim()) anchor = { ...contextAt(editor.state.doc, from), quote: quote.slice(0, 400) }
  }
  const n: PrivateNote = { id: crypto.randomUUID(), chapterId, text, at: Date.now(), ...(anchor ? { anchor } : {}) }
  setNotes([...notes.get().list, n], 'now')
  return n
}

export function updateNote(id: string, text: string): void {
  setNotes(
    notes.get().list.map((n) => (n.id === id ? { ...n, text } : n)),
    'later'
  )
}

export function removeNote(id: string): void {
  setNotes(
    notes.get().list.filter((n) => n.id !== id),
    'now'
  )
}

export function setActiveNote(id: string | null): void {
  if (activeNote === id) return
  activeNote = id
  pokeNotes()
}

/** Where the words of a note are in a chapter as it is now (null: the words are gone) */
function locateNote(doc: PMDoc, n: PrivateNote): { from: number; to: number } | null {
  if (!n.anchor) return null
  const at = locatePlace(doc, n.anchor)
  const len = n.anchor.quote.length
  const text = (a: number, b: number) => {
    try {
      return doc.textBetween(a, b, ' ', '')
    } catch {
      return ''
    }
  }
  if (text(at, Math.min(doc.content.size, at + len + 2)).startsWith(n.anchor.quote.slice(0, 30))) {
    // walk to the end of the quote (positions may include paragraph borders)
    let to = at + len
    while (to < doc.content.size && text(at, to).length < len) to++
    return { from: at, to: Math.min(to, doc.content.size) }
  }
  return null
}

/** Where the notes of this editor's chapter are now (by note id) */
export function notePlaces(editor: Editor): Map<string, { from: number; to: number }> {
  return (notesKey.getState(editor.state) as Map<string, { from: number; to: number }> | undefined) ?? new Map()
}

/** Selects the words of a note in an editor */
export function showNote(editor: Editor, id: string): boolean {
  const p = notePlaces(editor).get(id)
  if (!p) return false
  editor.chain().focus().setTextSelection(p).scrollIntoView().run()
  return true
}

/** After a save: the remembered places of this chapter's notes follow the text */
export function refreshNotePlaces(editor: Editor): void {
  const ch = editorChapter(editor)
  if (!ch || ch.bookPath !== notes.get().bookPath || editor.isDestroyed) return
  const places = notePlaces(editor)
  if (!places.size) return
  let changed = false
  const list = notes.get().list.map((n) => {
    const p = n.chapterId === ch.chapterId && n.anchor ? places.get(n.id) : undefined
    if (!p || !n.anchor) return n
    const c = contextAt(editor.state.doc, p.from)
    const quote = editor.state.doc.textBetween(p.from, p.to, ' ', '')
    if (c.pos === n.anchor.pos && c.before === n.anchor.before && quote === n.anchor.quote) return n
    changed = true
    return { ...n, anchor: { ...c, quote: quote || n.anchor.quote } }
  })
  if (changed) setNotes(list, 'later')
}

function locateAllNotes(doc: PMDoc, chapterId: string) {
  const m = new Map<string, { from: number; to: number }>()
  for (const n of notes.get().list) {
    if (n.chapterId !== chapterId) continue
    const p = locateNote(doc, n)
    if (p) m.set(n.id, p)
  }
  return m
}

/** Marks the words that have private notes, in one chapter editor, and follows them as the text changes. */
export function privateNotes(bookPath: string, chapterId: string) {
  return Extension.create({
    name: 'privateNotes',
    onCreate() {
      noteEditors.add(this.editor as Editor)
    },
    onDestroy() {
      noteEditors.delete(this.editor as Editor)
    },
    addProseMirrorPlugins() {
      const mine = () => notes.get().bookPath === bookPath
      return [
        new Plugin({
          key: notesKey,
          state: {
            init: (_, state) => (mine() ? locateAllNotes(state.doc, chapterId) : new Map()),
            apply: (tr, old: Map<string, { from: number; to: number }>, prev, next) => {
              if (!mine()) return old.size ? new Map() : old
              const whole = tr.docChanged && tr.steps.some((s) => (s as unknown as { from: number }).from === 0 && (s as unknown as { to: number }).to === prev.doc.content.size)
              if (whole) return locateAllNotes(next.doc, chapterId)
              let m = old
              if (tr.docChanged) {
                m = new Map()
                for (const [id, p] of old) {
                  const from = tr.mapping.map(p.from, 1)
                  const to = tr.mapping.map(p.to, -1)
                  if (to > from) m.set(id, { from, to })
                }
              }
              if (tr.getMeta(notesKey)) {
                // notes added or removed: keep the places already known, find the new ones
                const fresh = locateAllNotes(next.doc, chapterId)
                const keep = new Map<string, { from: number; to: number }>()
                for (const [id, p] of fresh) keep.set(id, m.get(id) ?? p)
                m = keep
              }
              return m
            }
          },
          props: {
            decorations: (state) => {
              const m = notesKey.getState(state) as Map<string, { from: number; to: number }>
              if (!m.size) return DecorationSet.empty
              const decos: Decoration[] = []
              for (const [id, p] of m) {
                const n = notes.get().list.find((x) => x.id === id)
                if (!n) continue
                decos.push(Decoration.inline(p.from, p.to, { class: id === activeNote ? 'pnote on' : 'pnote', title: `הערה פרטית: ${n.text || '(ריקה)'}` }))
              }
              return DecorationSet.create(state.doc, decos)
            }
          }
        })
      ]
    }
  })
}
