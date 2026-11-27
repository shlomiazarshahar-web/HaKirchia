import { useRef, useState } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { DEFAULT_FONT, DEFAULT_SIZE_PT } from '@shared/docx'
import { isParaStyle, PARA_LABEL, PARA_STYLES, paraKey } from '@shared/publish'
import { EDITOR_FONTS, FONT_SIZES } from '../fonts'
import { Icon } from './Icons'
import type { Align } from '../editor'
import { usePrefs } from '../prefs'
import { FontPanel, NIQQUD_SHORTCUT, NIQQUD_WIDTH, NiqqudPanel, Popover } from './HebrewTools'


export function FormatBar({ editor, onBookmark, onNote, onDrawer }: { editor: Editor | null; onBookmark?: () => void; onNote?: () => void; onDrawer?: () => void }) {
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
        style: e.isActive('heading', { level: 2 }) ? 'h2' : e.isActive('heading', { level: 3 }) ? 'h3' : isParaStyle(attrs.pstyle) ? attrs.pstyle : 'p',
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
        title="סגנון הפסקה. איך כל סגנון נראה נקבע פעם אחת לכל הספר (בסוף הרשימה)"
        onChange={(e) => {
          const v = e.target.value
          if (v === '__edit') {
            // the look of each style, for the whole book (feature 50)
            const key = s?.style === 'h2' || s?.style === 'h3' ? s.style : isParaStyle(s?.style) ? paraKey(s.style) : 'pLetter'
            window.dispatchEvent(new CustomEvent('hakirchia:para-styles', { detail: key }))
          } else if (v === 'p') chain().setParagraph().setParaStyle(null).run()
          else if (isParaStyle(v)) chain().setParagraph().setParaStyle(v).run()
          else chain().setHeading({ level: v === 'h2' ? 2 : 3 }).run()
        }}
      >
        <option value="p">גוף טקסט</option>
        <option value="h2">כותרת</option>
        <option value="h3">כותרת משנה</option>
        <optgroup label="סגנונות לפרוזה">
          {PARA_STYLES.map((p) => (
            <option key={p} value={p}>
              {PARA_LABEL[p]}
            </option>
          ))}
        </optgroup>
        <option disabled>──────────</option>
        <option value="__edit">עיצוב הסגנונות…</option>
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
      <button ref={nqRef} className="ib" title={`ניקוד, מקף, גרש וסימני כיוון (${NIQQUD_SHORTCUT}, ואז האות הראשונה של שם הסימן)`} aria-pressed={pop === 'niqqud'} onClick={() => setPop(pop === 'niqqud' ? null : 'niqqud')}>
        <span className="nq-btn">נִקּוּד</span>
      </button>
      <span className="sep" />
      <button className="ib" title="מעבר סצנה: * * * באמצע השורה (Ctrl+Shift+Enter, או להקליד *** בשורה ריקה). מעבר בין סצנות: Alt+PageDown / Alt+PageUp" onClick={() => chain().insertSceneBreak().run()}>
        <Icon name="scene" />
        סצנה
      </button>
{onBookmark && (
      <button className="ib" title="סימנייה: לחזור לכאן אחר כך (Ctrl+Shift+ל). באותו מקום שוב: הסרה" disabled={!editor} onMouseDown={(e) => e.preventDefault()} onClick={onBookmark}>
        <Icon name="bookmark" />
        סימנייה
      </button>
)}
      <span className="sep" />
      <button className="ib" title="הערת שוליים במקום הסמן; הטקסט שלה נכתב מתחת לפרק (Ctrl+Alt+F, כמו ב-Word). נשמרת כהערת שוליים אמיתית של Word" disabled={!on} onMouseDown={(e) => e.preventDefault()} onClick={() => chain().insertFootnote().run()}>
        <Icon name="footnote" />
        <span className="lbl">הערת שוליים</span>
      </button>
{onNote && onDrawer && (
<>
      <button className="ib" title="הערה פרטית לעצמך, על המילים המסומנות או על הפרק (Ctrl+Alt+M). לא נכנסת לקובץ ולא לייצוא" disabled={!editor} onMouseDown={(e) => e.preventDefault()} onClick={onNote}>
        <Icon name="note" />
        <span className="lbl">הערה</span>
      </button>
      <button className="ib" title="העברת הטקסט המסומן למגירה (Ctrl+Shift+M). בלי סימון: פתיחת המגירה" disabled={!editor} onMouseDown={(e) => e.preventDefault()} onClick={onDrawer}>
        <Icon name="drawer" />
        <span className="lbl">למגירה</span>
      </button>
</>
)}
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
        <Popover anchor={nqRef.current} label="ניקוד" width={NIQQUD_WIDTH} onClose={() => setPop(null)}>
          <NiqqudPanel editor={editor} />
        </Popover>
      )}
    </div>
  )
}
