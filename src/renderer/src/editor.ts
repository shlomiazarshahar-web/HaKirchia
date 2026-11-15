import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle, FontFamily, FontSize } from '@tiptap/extension-text-style'
import { Placeholder } from '@tiptap/extensions'

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

export const editorExtensions = [
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
