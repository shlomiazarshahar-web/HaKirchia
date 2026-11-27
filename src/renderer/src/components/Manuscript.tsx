// Feature 45: the manuscript for publishers. One click makes a plain Word file in the format
// publishers ask for (A4, a common font, double spacing, page numbers, author and title at the top
// of each page, each chapter on a new page). The few choices here are kept in the book.

import { useState } from 'react'
import type { Book } from '@shared/types'
import { MANUSCRIPT_FONTS, type ManuscriptSettings, type PublishSettings } from '@shared/publish'
import { usePrefs } from '../prefs'

const SIGNS = ['#', '* * *', '***', '⁂']

export function ManuscriptDialog({ book, onCancel, onExport }: { book: Book; onCancel: () => void; onExport: (p: PublishSettings) => void }) {
  const [ms, setMs] = useState<ManuscriptSettings>(book.publish.manuscript)
  const [author, setAuthor] = useState(book.publish.info.author)
  const prefs = usePrefs()
  const fonts = [...MANUSCRIPT_FONTS, ...prefs.customFonts.map((f) => f.family).filter((f) => !MANUSCRIPT_FONTS.includes(f))]
  const set = (p: Partial<ManuscriptSettings>) => setMs({ ...ms, ...p })
  const left = book.chapters.filter((c) => c.noExport).length
  const go = () => onExport({ ...book.publish, info: { ...book.publish.info, author: author.trim() }, manuscript: ms })

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form
        className="dialog ms-dialog"
        role="dialog"
        aria-label="כתב יד להוצאה"
        onSubmit={(e) => {
          e.preventDefault()
          go()
        }}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      >
        <h2>כתב יד להוצאה</h2>
        <p>קובץ Word פשוט בפורמט שהוצאות מבקשות: A4, שוליים רגילים, כל פרק בעמוד חדש, מספרי עמודים בתחתית. עמודי הפתיחה, העימוד והקישוטים של הספר לא נכנסים.</p>
        <label className="field">
          שם הכותב (לעמוד השער ולראש כל עמוד)
          <input value={author} dir="auto" onChange={(e) => setAuthor(e.target.value)} placeholder="השם שלך" />
        </label>
        <div className="ms-row">
          <label className="field">
            גופן
            <select value={ms.font} onChange={(e) => set({ font: e.target.value })} style={{ fontFamily: ms.font }}>
              {!fonts.includes(ms.font) && <option value={ms.font}>{ms.font}</option>}
              {fonts.map((f) => (
                <option key={f} value={f} style={{ fontFamily: f }}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            גודל
            <select value={String(ms.fontSize)} onChange={(e) => set({ fontSize: Number(e.target.value) })}>
              {[11, 12, 13, 14].map((n) => (
                <option key={n} value={String(n)}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            רווח בין שורות
            <select value={String(ms.lineSpacing)} onChange={(e) => set({ lineSpacing: Number(e.target.value) })}>
              <option value="2">כפול</option>
              <option value="1.5">שורה וחצי</option>
            </select>
          </label>
          <label className="field">
            מעבר סצנה
            <select value={ms.sceneSign} onChange={(e) => set({ sceneSign: e.target.value })}>
              {SIGNS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="set-row">
          <input type="checkbox" checked={ms.header} onChange={(e) => set({ header: e.target.checked })} />
          <span>שם הכותב ושם הספר בראש כל עמוד</span>
        </label>
        <label className="set-row">
          <input type="checkbox" checked={ms.cover} onChange={(e) => set({ cover: e.target.checked })} />
          <span>עמוד שער: שם הספר, שם הכותב ומספר המילים בקירוב</span>
        </label>
        {ms.cover && (
          <label className="field">
            פרטי קשר לעמוד השער (לא חובה)
            <textarea value={ms.contact} dir="auto" rows={3} onChange={(e) => set({ contact: e.target.value })} placeholder={'טלפון\nדוא״ל'} />
          </label>
        )}
        {left > 0 && <p>{left === 1 ? 'פרק אחד מסומן "לא בייצוא" ולא ייכנס.' : `${left} פרקים מסומנים "לא בייצוא" ולא ייכנסו.`}</p>}
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onCancel}>
            ביטול
          </button>
          <button type="submit" className="btn">
            ייצוא ל־Word
          </button>
        </div>
      </form>
    </div>
  )
}
