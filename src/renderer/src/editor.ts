import { Extension, InputRule } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle, FontFamily, FontSize } from '@tiptap/extension-text-style'
import { Placeholder } from '@tiptap/extensions'
import { doubleQuoteFor, GERSHAYIM, MAQAF, NIQQUD_CLASS, singleQuoteFor, stripNiqqud } from '@shared/hebrew'
import { getPrefs } from './prefs'

export type Align = 'right' | 'center' | 'left' | 'justify'
export type Dir = 'rtl' | 'ltr'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    paragraphLayout: {
      /** Aligns every selected paragraph. The paragraph's normal side (right in RTL) is stored as "no alignment". */
      alignParagraphs: (align: Align) => ReturnType
      /** Sets the direction of every selected paragraph (alignment goes back to the normal side). */
      setParagraphDir: (dir: Dir) => ReturnType
    }
    hebrew: {
      /** Removes niqqud from the selected text (or from the whole chapter when nothing is selected) */
      removeNiqqud: () => ReturnType
    }
  }
}

const BLOCKS = ['paragraph', 'heading']

/**
 * Each paragraph has a direction: RTL (default) or LTR, saved to Word as w:bidi.
 * Keyboard shortcuts as in Word:
 *   Ctrl+R / Ctrl+L / Ctrl+E / Ctrl+J  align right / left / center / justify
 *   Ctrl + right Shift                 paragraph right-to-left
 *   Ctrl + left Shift                  paragraph left-to-right
 */
const ParagraphDirection = Extension.create({
  name: 'paragraphDirection',
  addGlobalAttributes() {
    return [
      {
        types: BLOCKS,
        attributes: {
          dir: {
            default: 'rtl',
            parseHTML: (el) => (el.getAttribute('dir') === 'ltr' ? 'ltr' : 'rtl'),
            renderHTML: (attrs) => ({ dir: attrs.dir })
          }
        }
      }
    ]
  },
  addCommands() {
    const each =
      (patch: (attrs: Record<string, unknown>) => Record<string, unknown>) =>
      ({ tr, state, dispatch }: { tr: Transaction; state: EditorState; dispatch?: (tr: Transaction) => void }) => {
        let found = false
        for (const r of state.selection.ranges) {
          state.doc.nodesBetween(r.$from.pos, r.$to.pos, (node, pos) => {
            if (!BLOCKS.includes(node.type.name)) return true
            found = true
            if (dispatch) tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch(node.attrs) })
            return false
          })
        }
        return found
      }
    return {
      alignParagraphs: (align) => each((a) => ({ textAlign: align === (a.dir === 'ltr' ? 'left' : 'right') ? null : align })),
      setParagraphDir: (dir) => each(() => ({ dir, textAlign: null }))
    }
  },
  addKeyboardShortcuts() {
    const align = (a: Align) => () => this.editor.commands.alignParagraphs(a)
    return { 'Mod-r': align('right'), 'Mod-l': align('left'), 'Mod-e': align('center'), 'Mod-j': align('justify') }
  },
  addProseMirrorPlugins() {
    const editor = this.editor
    // Ctrl+Shift alone (no other key in between), decided by which Shift key: right → RTL, left → LTR.
    // Applied when the keys are released, like Word, so Ctrl+Shift+<letter> shortcuts are not affected.
    let shiftSide: Dir | null = null
    let pending: Dir | null = null
    return [
      new Plugin({
        key: new PluginKey('ctrlShiftDirection'),
        props: {
          handleDOMEvents: {
            keydown: (_view, e) => {
              if (e.key === 'Shift') shiftSide = e.code === 'ShiftRight' ? 'rtl' : e.code === 'ShiftLeft' ? 'ltr' : null
              const modOnly = (e.key === 'Shift' || e.key === 'Control') && e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey
              pending = modOnly && shiftSide ? shiftSide : null
              return false
            },
            keyup: (_view, e) => {
              if ((e.key === 'Shift' || e.key === 'Control') && pending && editor.isEditable) {
                editor.commands.setParagraphDir(pending)
              }
              pending = null
              if (e.key === 'Shift') shiftSide = null
              return false
            },
            blur: () => {
              pending = shiftSide = null
              return false
            }
          }
        }
      })
    ]
  }
})

/** Tab types a tab character (as in Word) instead of moving focus out of the editor. */
const TabKey = Extension.create({
  name: 'tabKey',
  addKeyboardShortcuts() {
    return {
      Tab: () => this.editor.commands.insertContent('\t'),
      'Shift-Tab': () => true
    }
  }
})

const L = '[\u05D0-\u05EA]' // a Hebrew letter
const N = `[${NIQQUD_CLASS}]*` // its niqqud, if any

/**
 * Hebrew typography while typing (each rule can be turned off in the settings):
 *   "  → Hebrew quotes, or gershayim inside a word (צה״ל)      '  → geresh after a Hebrew letter (ג׳)
 *   -  between two Hebrew words → maqaf (בית־ספר)              " - " → " – ",  "--" → "–"
 *   ... → …
 * Backspace right after a change brings back what was typed.
 */
const HebrewTypography = Extension.create({
  name: 'hebrewTypography',
  addInputRules() {
    const t = () => getPrefs().typography
    const before = (state: EditorState, pos: number) => {
      const $p = state.doc.resolve(pos)
      return { text: $p.parent.textBetween(0, $p.parentOffset, undefined, '\ufffc'), rtl: $p.parent.attrs.dir !== 'ltr' }
    }
    return [
      new InputRule({
        find: /"$/,
        handler: ({ state, range }) => {
          const b = before(state, range.from)
          const q = doubleQuoteFor(b.text, b.rtl, t())
          if (!q) return null
          state.tr.insertText(q, range.from, range.to)
        }
      }),
      new InputRule({
        find: /'$/,
        handler: ({ state, range }) => {
          const q = singleQuoteFor(before(state, range.from).text, t())
          if (!q) return null
          state.tr.insertText(q, range.from, range.to)
        }
      }),
      // a closing quote right after a Hebrew letter, followed by another letter, was an acronym: צה״ל
      new InputRule({
        find: new RegExp(`${L}${N}([\u201D\u201C])(${L})$`),
        handler: ({ state, range, match }) => {
          if (!t().geresh) return null
          const at = range.from + match[0].lastIndexOf(match[1])
          state.tr.insertText(GERSHAYIM + match[2], at, range.to)
        }
      }),
      new InputRule({
        find: new RegExp(`${L}${N}(-)(${L})$`),
        handler: ({ state, range, match }) => {
          if (!t().maqaf) return null
          const at = range.from + match[0].lastIndexOf('-')
          state.tr.insertText(MAQAF + match[2], at, range.to)
        }
      }),
      new InputRule({
        find: /(^|\s)- $/,
        handler: ({ state, range, match }) => {
          if (!t().dashes) return null
          state.tr.insertText(match[1] + '\u2013 ', range.from, range.to)
        }
      }),
      new InputRule({
        find: /--$/,
        handler: ({ state, range }) => {
          if (!t().dashes) return null
          state.tr.insertText('\u2013', range.from, range.to)
        }
      }),
      new InputRule({
        find: /\.\.\.$/,
        handler: ({ state, range }) => {
          if (!t().ellipsis) return null
          state.tr.insertText('\u2026', range.from, range.to)
        }
      })
    ]
  },
  addCommands() {
    return {
      removeNiqqud:
        () =>
        ({ state, tr, dispatch }) => {
          const { from, to, empty } = state.selection
          const [a, b] = empty ? [0, state.doc.content.size] : [from, to]
          const edits: { from: number; to: number; text: string; marks: readonly import('@tiptap/pm/model').Mark[] }[] = []
          state.doc.nodesBetween(a, b, (node, pos) => {
            if (!node.isText || !node.text) return
            const s = Math.max(a, pos)
            const e = Math.min(b, pos + node.text.length)
            const piece = node.text.slice(s - pos, e - pos)
            const clean = stripNiqqud(piece)
            if (clean !== piece) edits.push({ from: s, to: e, text: clean, marks: node.marks })
          })
          if (!edits.length) return false
          if (dispatch) {
            for (const ed of edits.reverse()) {
              if (ed.text) tr.replaceWith(ed.from, ed.to, state.schema.text(ed.text, ed.marks))
              else tr.delete(ed.from, ed.to)
            }
          }
          return true
        }
    }
  }
})

export const editorExtensions = [
  HebrewTypography,
  TabKey,
  StarterKit.configure({
    heading: { levels: [2, 3] },
    codeBlock: false,
    code: false,
    blockquote: false,
    bulletList: false,
    orderedList: false,
    listItem: false,
    listKeymap: false,
    horizontalRule: false,
    strike: false,
    link: false
  }),
  TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['right', 'center', 'left', 'justify'] }),
  TextStyle,
  FontFamily,
  FontSize,
  ParagraphDirection,
  Placeholder.configure({ placeholder: 'כאן מתחילים לכתוב…' })
]
