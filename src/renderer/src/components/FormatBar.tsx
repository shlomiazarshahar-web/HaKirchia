import { useRef, useState } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { DEFAULT_FONT, DEFAULT_SIZE_PT } from '@shared/docx'
import { EDITOR_FONTS, FONT_SIZES } from '../fonts'
import { Icon } from './Icons'
import type { Align } from '../editor'
import { usePrefs } from '../prefs'
import { FontPanel, NiqqudPanel, Popover } from './HebrewTools'


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

  const { customFonts } = usePrefs()
  const [pop, setPop] = useState<'font' | 'niqqud' | null>(null)
  const fontRef = useRef<HTMLSelectElement>(null)
  const nqRef = useRef<HTMLButtonElement>(null)
  const on = !!editor && !!s?.editable
  const chain = () => editor!.chain().focus()

  const setAlign = (a: Align) => chain().alignParagraphs(a).run()
  const toggleDir = () => chain().setParagraphDir(s?.dir === 'rtl' ? 'ltr' : 'rtl').run()
  const added = customFonts.map((f) => f.family).filter((f) => !EDITOR_FONTS.includes(f))
  const unknown = s && !EDITOR_FONTS.includes(s.font) && !added.includes(s.font) ? s.font : null
  const applyFont = (f: string) => {
    if (f === DEFAULT_FONT) chain().unsetFontFamily().run()
    else chain().setFontFamily(f).run()
  }
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
        ref={fontRef}
        aria-label="גופן"
        style={{ width: 160, fontFamily: s?.font }}
        value={s?.font ?? DEFAULT_FONT}
        onChange={(e) => {
          const f = e.target.value
          if (f === '__add') setPop('font')
          else applyFont(f)
        }}
      >
        {unknown && (
          <option value={unknown} style={{ fontFamily: unknown }}>
            {unknown}
          </option>
        )}
        <optgroup label="מובנים">
          {EDITOR_FONTS.map((f) => (
            <option key={f} value={f} style={{ fontFamily: f }}>
              {f}
            </option>
          ))}
        </optgroup>
        {added.length > 0 && (
          <optgroup label="שהוספתי">
            {added.map((f) => (
              <option key={f} value={f} style={{ fontFamily: `"${f}"` }}>
                {f}
              </option>
            ))}
          </optgroup>
        )}
        <option disabled>──────────</option>
        <option value="__add">הוספת גופן…</option>
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
      <button className="ib icon" title="יישור לימין (Ctrl+R)" aria-pressed={s?.align === 'right'} onClick={() => setAlign('right')}>
        <Icon name="align-r" />
      </button>
      <button className="ib icon" title="מרכוז (Ctrl+E)" aria-pressed={s?.align === 'center'} onClick={() => setAlign('center')}>
        <Icon name="align-c" />
      </button>
      <button className="ib icon" title="יישור לשמאל (Ctrl+L)" aria-pressed={s?.align === 'left'} onClick={() => setAlign('left')}>
        <Icon name="align-l" />
      </button>
      <button className="ib icon" title="יישור לשני הצדדים (Ctrl+J)" aria-pressed={s?.align === 'justify'} onClick={() => setAlign('justify')}>
        <Icon name="align-j" />
      </button>
      <button className="ib" title="כיוון הפסקה. Ctrl+Shift ימני: מימין לשמאל, Ctrl+Shift שמאלי: משמאל לימין" onClick={toggleDir}>
        <Icon name="dir" />
        {s?.dir === 'ltr' ? 'LTR' : 'RTL'}
      </button>
      <span className="sep" />
      <button ref={nqRef} className="ib" title="ניקוד, מקף, גרש וסימני כיוון" aria-pressed={pop === 'niqqud'} onClick={() => setPop(pop === 'niqqud' ? null : 'niqqud')}>
        <span className="nq-btn">נִקּוּד</span>
      </button>
      {pop === 'font' && (
        <Popover anchor={fontRef.current} label="הוספת גופן" width={330} onClose={() => setPop(null)}>
          <FontPanel
            onPick={(f) => {
              setPop(null)
              applyFont(f)
            }}
          />
        </Popover>
      )}
      {pop === 'niqqud' && editor && (
        <Popover anchor={nqRef.current} label="ניקוד" width={318} onClose={() => setPop(null)}>
          <NiqqudPanel editor={editor} />
        </Popover>
      )}
    </div>
  )
}
