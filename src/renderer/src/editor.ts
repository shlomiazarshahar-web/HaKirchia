import { Extension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle, FontFamily, FontSize } from '@tiptap/extension-text-style'
import { Placeholder } from '@tiptap/extensions'

/** Each paragraph has a direction: RTL (default) or LTR, saved to Word as w:bidi. */
const ParagraphDirection = Extension.create({
  name: 'paragraphDirection',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          dir: {
            default: 'rtl',
            parseHTML: (el) => (el.getAttribute('dir') === 'ltr' ? 'ltr' : 'rtl'),
            renderHTML: (attrs) => ({ dir: attrs.dir })
          }
        }
      }
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
