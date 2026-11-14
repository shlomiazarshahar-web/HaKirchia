import { useEditorState, type Editor } from '@tiptap/react'
import { DEFAULT_FONT, DEFAULT_SIZE_PT } from '@shared/docx'
import { EDITOR_FONTS, FONT_SIZES } from '../fonts'
import { Icon } from './Icons'

type Align = 'right' | 'center' | 'left' | 'justify'

export function FormatBar({ editor }: { editor: Editor | null }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null
      const para = e.isActive('heading') ? 'heading' : 'paragraph'
      const attrs = e.getAttributes(para)
      const dir: 'rtl' | 'ltr' = attrs.dir === 'ltr' ? 'ltr' : 'rtl'
      const align: Align = (attrs.textAlign as Align) ?? (dir === 'rtl' ? 'right' : 'left')
      const ts = e.getAttributes('textStyle')
      return {
        style: e.isActive('heading', { level: 2 }) ? 'h2' : e.isActive('heading', { level: 3 }) ? 'h3' : 'p',
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        underline: e.isActive('underline'),
        font: (ts.fontFamily as string | undefined)?.replace(/["']/g, '').split(',')[0] ?? DEFAULT_FONT,
        size: ts.fontSize ? parseFloat(String(ts.fontSize)) : DEFAULT_SIZE_PT,
        align,
        dir,
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
        editable: e.isEditable
      }
    }
  })

  const on = !!editor && !!s?.editable
  const chain = () => editor!.chain().focus()

  const setAlign = (a: Align) => {
    // In an RTL paragraph "right" is the normal side, so store it as "no alignment"
    const normal = s?.dir === 'rtl' ? 'right' : 'left'
    if (a === normal) chain().unsetTextAlign().run()
    else chain().setTextAlign(a).run()
  }
  const toggleDir = () => {
    const dir = s?.dir === 'rtl' ? 'ltr' : 'rtl'
    chain().updateAttributes('paragraph', { dir, textAlign: null }).updateAttributes('heading', { dir, textAlign: null }).run()
  }
  const fonts = s && !EDITOR_FONTS.includes(s.font) ? [s.font, ...EDITOR_FONTS] : EDITOR_FONTS
  const sizes = s && !FONT_SIZES.includes(s.size) ? [...FONT_SIZES, s.size].sort((a, b) => a - b) : FONT_SIZES

  return (
    <div className={`fmt${on ? '' : ' off'}`} role="toolbar" aria-label="עיצוב טקסט">
      <button className="ib icon" title="ביטול (Ctrl+Z)" disabled={!s?.canUndo} onClick={() => chain().undo().run()}>
        <Icon name="undo" />
      </button>
      <button className="ib icon" title="חזרה (Ctrl+Y)" disabled={!s?.canRedo} onClick={() => chain().redo().run()}>
        <Icon name="redo" />
      </button>
      <span className="sep" />
      <select
        aria-label="סגנון פסקה"
        value={s?.style ?? 'p'}
        onChange={(e) => {
          const v = e.target.value
          if (v === 'p') chain().setParagraph().run()
          else chain().setHeading({ level: v === 'h2' ? 2 : 3 }).run()
        }}
      >
        <option value="p">גוף טקסט</option>
        <option value="h2">כותרת</option>
        <option value="h3">כותרת משנה</option>
      </select>
      <select
        aria-label="גופן"
        style={{ width: 160, fontFamily: s?.font }}
        value={s?.font ?? DEFAULT_FONT}
        onChange={(e) => {
          const f = e.target.value
          if (f === DEFAULT_FONT) chain().unsetFontFamily().run()
          else chain().setFontFamily(f).run()
        }}
      >
        {fonts.map((f) => (
          <option key={f} value={f} style={{ fontFamily: f }}>
            {f}
          </option>
        ))}
      </select>
      <select
        aria-label="גודל"
        style={{ width: 62 }}
        value={s?.size ?? DEFAULT_SIZE_PT}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (n === DEFAULT_SIZE_PT) chain().unsetFontSize().run()
          else chain().setFontSize(`${n}pt`).run()
        }}
      >
        {sizes.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <span className="sep" />
      <button className="ib icon" title="מודגש (Ctrl+B)" aria-pressed={!!s?.bold} onClick={() => chain().toggleBold().run()}>
        <span className="b">ב</span>
      </button>
      <button className="ib icon" title="נטוי (Ctrl+I)" aria-pressed={!!s?.italic} onClick={() => chain().toggleItalic().run()}>
        <span className="i">נ</span>
      </button>
      <button className="ib icon" title="קו תחתון (Ctrl+U)" aria-pressed={!!s?.underline} onClick={() => chain().toggleUnderline().run()}>
        <span className="u">ק</span>
      </button>
      <span className="sep" />
      <button className="ib icon" title="יישור לימין" aria-pressed={s?.align === 'right'} onClick={() => setAlign('right')}>
        <Icon name="align-r" />
      </button>
      <button className="ib icon" title="מרכוז" aria-pressed={s?.align === 'center'} onClick={() => setAlign('center')}>
        <Icon name="align-c" />
      </button>
      <button className="ib icon" title="יישור לשמאל" aria-pressed={s?.align === 'left'} onClick={() => setAlign('left')}>
        <Icon name="align-l" />
      </button>
      <button className="ib icon" title="יישור לשני הצדדים" aria-pressed={s?.align === 'justify'} onClick={() => setAlign('justify')}>
        <Icon name="align-j" />
      </button>
      <button className="ib" title="כיוון הפסקה: ימין לשמאל / שמאל לימין" onClick={toggleDir}>
        <Icon name="dir" />
        {s?.dir === 'ltr' ? 'LTR' : 'RTL'}
      </button>
    </div>
  )
}
