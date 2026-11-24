// Round 10, "כלי כתיבה בעברית", the editor's side:
//  - NameCompletion (51): while typing, the rest of a character, place or glossary name appears in
//    grey after the cursor; Tab takes it, ↑/↓ choose another when there are several, Esc hides it.
//  - Synonyms (43): the word under the mouse at a right-click (or at the cursor, Shift+F7) is kept
//    here, and the synonyms panel opens for it.
//  - Automatic niqqud (55): the text of the selection with a map back to the document, and placing
//    the nakdan's words back.
import { useSyncExternalStore } from 'react'
import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import type { Node as PMDoc } from '@tiptap/pm/model'
import { suggest, wordBefore, type Completion, type NiqqudChange } from '@shared/wordtools'
import { getPrefs } from './prefs'
import { api } from './api'

// ---------------------------------------------------------------------------
// Completing names (51)
// ---------------------------------------------------------------------------

let completions: Completion[] = []
/** The open book's names and terms (set whenever the book changes) */
export function setCompletions(list: Completion[]): void {
  completions = list
}

interface AcState {
  /** Where the replaced letters start (after the kept prefix letters) and the cursor */
  from: number
  to: number
  items: Completion[]
  index: number
}

const acKey = new PluginKey<AcState | null>('nameCompletion')

function compute(state: EditorState): AcState | null {
  const sel = state.selection
  if (!sel.empty || !getPrefs().typography.autocomplete || !completions.length) return null
  const $p = sel.$head
  if (!$p.parent.isTextblock || $p.parent.type.spec.code) return null
  // nothing to complete in the middle of a word
  const after = $p.parent.textBetween($p.parentOffset, Math.min($p.parent.content.size, $p.parentOffset + 1), undefined, '￼')
  if (after && /[\p{L}\p{M}\p{N}]/u.test(after)) return null
  const before = $p.parent.textBetween(Math.max(0, $p.parentOffset - 60), $p.parentOffset, undefined, '￼')
  const typed = wordBefore(before)
  const s = suggest(typed, completions)
  if (!s) return null
  return { from: sel.head - typed.length + s.prefix, to: sel.head, items: s.items, index: 0 }
}

function ghost(view: EditorView, st: AcState): HTMLElement {
  const item = st.items[st.index]
  const span = document.createElement('span')
  span.className = 'ac-ghost'
  span.contentEditable = 'false'
  // the letters still to come (typed letters are compared without niqqud, so cut by letters)
  span.textContent = restAfter(item.text, view.state.doc.textBetween(st.from, st.to))
  span.setAttribute('aria-hidden', 'true')
  const box = document.createElement('span')
  box.className = 'ac-box'
  const list = st.items.length > 1 ? st.items : [item]
  for (let i = 0; i < list.length; i++) {
    const row = document.createElement('span')
    row.className = `ac-item${i === st.index ? ' on' : ''}`
    row.textContent = list[i].text
    const src = document.createElement('small')
    src.textContent = list[i].source
    row.appendChild(src)
    row.addEventListener('mousedown', (e) => {
      e.preventDefault()
      accept(view, i)
    })
    box.appendChild(row)
  }
  const hint = document.createElement('span')
  hint.className = 'ac-hint'
  hint.textContent = st.items.length > 1 ? 'Tab להשלמה · ↑↓ בחירה · Esc' : 'Tab להשלמה · Esc'
  box.appendChild(hint)
  span.appendChild(box)
  return span
}

/** What is left of a name after the letters already typed (niqqud in the name is kept) */
export function restAfter(name: string, typed: string): string {
  const letters = typed.replace(/\p{M}/gu, '').length
  let seen = 0
  let i = 0
  while (i < name.length && seen < letters) {
    i++
    while (i < name.length && /\p{M}/u.test(name[i])) i++
    seen++
  }
  return name.slice(i)
}

function accept(view: EditorView, index?: number): boolean {
  const st = acKey.getState(view.state)
  if (!st) return false
  const item = st.items[index ?? st.index]
  const tr = view.state.tr.insertText(item.text, st.from, st.to).setMeta(acKey, 'off')
  view.dispatch(tr)
  view.focus()
  return true
}

export const NameCompletion = Extension.create({
  name: 'nameCompletion',
  // before the Tab key that types a tab character
  priority: 1000,
  addProseMirrorPlugins() {
    return [
      new Plugin<AcState | null>({
        key: acKey,
        state: {
          init: () => null,
          apply: (tr, old, _o, state) => {
            const meta = tr.getMeta(acKey)
            if (meta === 'off') return null
            if (typeof meta === 'number' && old) return { ...old, index: meta }
            // shown while typing; moving the cursor or a click hides it
            if (tr.docChanged && tr.steps.length && !tr.getMeta('history$') && tr.getMeta('uiEvent') !== 'paste') return compute(state)
            if (!old) return null
            if (tr.docChanged || tr.selectionSet) return null
            return old
          }
        },
        props: {
          decorations(state) {
            const st = acKey.getState(state)
            if (!st) return null
            return DecorationSet.create(state.doc, [Decoration.widget(st.to, (view) => ghost(view, st), { side: 1, key: `ac-${st.from}-${st.to}-${st.index}-${st.items.map((i) => i.key).join()}` })])
          },
          handleKeyDown(view, e) {
            const st = acKey.getState(view.state)
            if (!st || e.ctrlKey || e.altKey || e.metaKey) return false
            if (e.key === 'Tab' && !e.shiftKey) return accept(view)
            if (e.key === 'Escape') {
              view.dispatch(view.state.tr.setMeta(acKey, 'off'))
              return true
            }
            if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && st.items.length > 1) {
              const n = st.items.length
              view.dispatch(view.state.tr.setMeta(acKey, (st.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n))
              return true
            }
            return false
          },
          handleDOMEvents: {
            blur: (view) => {
              if (acKey.getState(view.state)) view.dispatch(view.state.tr.setMeta(acKey, 'off'))
              return false
            }
          }
        }
      })
    ]
  }
})

// ---------------------------------------------------------------------------
// Words in the document
// ---------------------------------------------------------------------------

const WORD = /[\p{L}\p{M}\p{N}'׳״"]/u

/** The word at a position (the one the position is in or touches), or null */
export function wordAt(doc: PMDoc, pos: number): { from: number; to: number; text: string } | null {
  const $p = doc.resolve(pos)
  const block = $p.parent
  if (!block.isTextblock) return null
  const text = block.textBetween(0, block.content.size, undefined, '￼')
  const start = $p.start()
  let a = $p.parentOffset
  let b = a
  while (a > 0 && WORD.test(text[a - 1])) a--
  while (b < text.length && WORD.test(text[b])) b++
  // quote marks around a word are not part of it
  while (a < b && /['"׳״]/.test(text[a])) a++
  while (b > a && /['"]/.test(text[b - 1])) b--
  if (a === b) return null
  return { from: start + a, to: start + b, text: text.slice(a, b) }
}

/** The sentence around a word, for its meaning (at most ~200 letters) */
export function sentenceAround(doc: PMDoc, from: number, to: number): string {
  const $p = doc.resolve(from)
  const block = $p.parent
  const text = block.textBetween(0, block.content.size, undefined, ' ')
  const a0 = from - $p.start()
  const b0 = to - $p.start()
  let a = a0
  let b = b0
  while (a > 0 && a0 - a < 160 && !/[.!?…\n]/.test(text[a - 1])) a--
  while (b < text.length && b - b0 < 160 && !/[.!?…\n]/.test(text[b])) b++
  return text.slice(a, Math.min(text.length, b + 1)).trim()
}

// ---------------------------------------------------------------------------
// Synonyms (43)
// ---------------------------------------------------------------------------

export interface SynonymTarget {
  editor: Editor
  from: number
  to: number
  word: string
  sentence: string
}

let lastRightClick: SynonymTarget | null = null
let open: SynonymTarget | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function useSynonymTarget(): SynonymTarget | null {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => open
  )
}
export function closeSynonyms(): void {
  open = null
  emit()
}

/** The word to look up in an editor: the selection when it is one word, else the word at the cursor */
function targetIn(editor: Editor, pos?: number): SynonymTarget | null {
  const { state } = editor
  const sel = state.selection
  let w: { from: number; to: number; text: string } | null = null
  if (!sel.empty && pos === undefined) {
    const t = state.doc.textBetween(sel.from, sel.to, ' ').trim()
    if (t && !/\s/.test(t) && t.length <= 30) w = { from: sel.from, to: sel.to, text: state.doc.textBetween(sel.from, sel.to) }
  }
  if (!w && !sel.empty && pos !== undefined && pos >= sel.from && pos <= sel.to) {
    const t = state.doc.textBetween(sel.from, sel.to)
    if (t.trim() && !/\s/.test(t.trim())) w = { from: sel.from, to: sel.to, text: t }
  }
  w ??= wordAt(state.doc, pos ?? sel.head)
  if (!w || !/\p{L}/u.test(w.text)) return null
  return { editor, from: w.from, to: w.to, word: w.text, sentence: sentenceAround(state.doc, w.from, w.to) }
}

export function openSynonymsAtCursor(editor: Editor): boolean {
  const t = targetIn(editor)
  if (!t) return false
  open = t
  emit()
  return true
}

// The right-click menu offered synonyms for the word that was under the mouse
api.onContextSynonyms(() => {
  if (!lastRightClick || lastRightClick.editor.isDestroyed) return
  open = lastRightClick
  emit()
})

/** Remembers the word under the mouse at a right-click, and Shift+F7 (as in Word) opens synonyms */
export const WordGrab = Extension.create({
  name: 'wordGrab',
  addKeyboardShortcuts() {
    return { 'Shift-F7': () => openSynonymsAtCursor(this.editor) }
  },
  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey('wordGrab'),
        props: {
          handleDOMEvents: {
            contextmenu: (view, e) => {
              const at = view.posAtCoords({ left: e.clientX, top: e.clientY })
              lastRightClick = at && editor.isEditable ? targetIn(editor, at.pos) : null
              api.contextWord(lastRightClick?.word ?? '')
              return false
            }
          }
        }
      })
    ]
  }
})

// ---------------------------------------------------------------------------
// Automatic niqqud (55)
// ---------------------------------------------------------------------------

/** The text to give niqqud to, and where each of its letters is in the document */
export interface TextMap {
  text: string
  /** Document position of each character of text (newlines between paragraphs: -1) */
  pos: number[]
}

/** The selected text (or the paragraph at the cursor when nothing is selected), paragraph by paragraph */
export function textForNiqqud(state: EditorState): TextMap {
  let { from, to } = state.selection
  if (from === to) {
    const $p = state.selection.$head
    from = $p.start()
    to = $p.end()
  }
  let text = ''
  const pos: number[] = []
  state.doc.nodesBetween(from, to, (node, start) => {
    if (!node.isTextblock) return true
    if (text) {
      text += '\n'
      pos.push(-1)
    }
    node.forEach((child, off) => {
      const p = start + 1 + off
      if (child.isText) {
        const s = child.text!
        for (let i = 0; i < s.length; i++) {
          if (p + i < from || p + i >= to) continue
          text += s[i]
          pos.push(p + i)
        }
      } else if (p >= from && p < to) {
        // a footnote mark and the like: stands between words
        text += ' '
        pos.push(-1)
      }
    })
    return false
  })
  return { text, pos }
}

/** A word that got niqqud and has other readings, followed in the document as it changes */
export interface PlacedWord {
  from: number
  to: number
  text: string
  options: string[]
}

/** Puts the niqqud in, as one step (one Ctrl+Z undoes it). Returns the words with more than one reading. */
export function applyNiqqud(editor: Editor, map: TextMap, changes: NiqqudChange[]): PlacedWord[] {
  const { state } = editor
  let tr = state.tr
  const placed: { from: number; to: number; c: NiqqudChange }[] = []
  for (const c of changes) {
    const from = map.pos[c.from]
    const to = map.pos[c.to - 1] + 1
    if (from < 0 || map.pos[c.to - 1] < 0) continue
    // only inside one text run of the document
    if (to - from !== c.to - c.from) continue
    placed.push({ from, to, c })
  }
  for (let i = placed.length - 1; i >= 0; i--) {
    const { from, to, c } = placed[i]
    if (c.text !== c.old) tr = tr.insertText(c.text, from, to)
  }
  if (tr.docChanged) editor.view.dispatch(tr.setMeta('addToHistory', true))
  return placed
    .filter((p) => p.c.options.length > 1)
    .map((p) => ({ from: tr.mapping.map(p.from, -1), to: tr.mapping.map(p.to, 1), text: p.c.text, options: p.c.options }))
}
