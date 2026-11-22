// Feature 42: importing an existing manuscript from one Word file, split into chapters by its
// headings (or by "פרק …" lines, or by page breaks). Into a new book, or at the end of the open one.

import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import type { Book, PMNode } from '@shared/types'
import { buildChapters, findChapters, guessBookTitle, modeKey, splitOptions, type SplitMode } from '@shared/manuscript'

const modeLabel = (m: SplitMode, count: number) =>
  m.kind === 'heading'
    ? `${m.level === 0 ? 'לפי הסגנון "כותרת ראשית" (Title)' : `לפי "כותרת ${m.level}" (Heading ${m.level})`} · ${count} ${count === 1 ? 'כותרת' : 'כותרות'}`
    : m.kind === 'label'
      ? `לפי שורות שמתחילות ב"פרק" · ${count}`
      : m.kind === 'page'
        ? `לפי מעברי עמוד · ${count} חלקים`
        : 'בלי חלוקה: הכול פרק אחד'

interface Props {
  /** null: a new book; otherwise the chapters are added at the end of this book */
  into: Book | null
  onCancel: () => void
  onDone: (book: Book, notice?: string) => void
}

export function ImportDialog({ into, onCancel, onDone }: Props) {
  const [file, setFile] = useState<{ fileName: string; blocks: PMNode[]; warnings: string[] } | null>(null)
  const [modeId, setModeId] = useState('')
  const [keep, setKeep] = useState<boolean[]>([])
  const [titles, setTitles] = useState<string[]>([])
  const [bookTitle, setBookTitle] = useState('')
  const [parent, setParent] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const picked = useRef(false)

  useEffect(() => {
    if (picked.current) return
    picked.current = true
    void api.defaultFolder().then(setParent)
    void api.pickManuscript().then((r) => {
      if (!r.ok) {
        setErr(r.error ?? 'לא הצלחתי לקרוא את הקובץ')
        return
      }
      if (!r.value) return onCancel()
      setFile(r.value)
      setBookTitle(guessBookTitle(r.value.blocks, r.value.fileName))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const options = useMemo(() => (file ? splitOptions(file.blocks) : []), [file])
  const mode = options.find((o) => modeKey(o.mode) === modeId)?.mode ?? options[0]?.mode
  const chapters = useMemo(() => (file && mode ? findChapters(file.blocks, mode) : []), [file, mode])
  // a new way of splitting starts with every chapter kept and its own name
  useEffect(() => {
    setKeep(chapters.map(() => true))
    setTitles(chapters.map((c) => c.title))
  }, [chapters])

  const count = keep.filter((k, i) => k || i === 0).length
  const words = chapters.reduce((n, c) => n + c.words, 0)

  const submit = async () => {
    if (!file || !mode) return
    const items = buildChapters(file.blocks, mode, chapters, keep, titles)
    setBusy(true)
    setErr(null)
    if (into) {
      const r = await api.importToBook(into.path, items)
      setBusy(false)
      if (!r.ok || !r.value) return setErr(r.error ?? 'הייבוא נכשל')
      return onDone(r.value, r.notice)
    }
    if (!bookTitle.trim()) {
      setBusy(false)
      return setErr('צריך לתת לספר שם')
    }
    const r = await api.importNewBook(parent, bookTitle.trim(), items)
    setBusy(false)
    if (!r.ok || !r.value) return setErr(r.error ?? 'הייבוא נכשל')
    onDone(r.value.book, r.value.notice)
  }

  if (!file)
    return err ? (
      <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
        <div className="dialog" role="alertdialog" aria-label="ייבוא כתב יד">
          <h2>ייבוא כתב יד</h2>
          <div className="err">{err}</div>
          <div className="actions">
            <button className="btn ghost" onClick={onCancel} autoFocus>
              סגירה
            </button>
          </div>
        </div>
      </div>
    ) : null

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form
        className="dialog import"
        role="dialog"
        aria-label="ייבוא כתב יד"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      >
        <h2>ייבוא כתב יד{into ? ` אל "${into.title}"` : ''}</h2>
        <p>
          <span className="mono">{file.fileName}</span> · {words.toLocaleString('he-IL')} מילים. כל פרק יישמר כקובץ Word משלו. הקובץ המקורי לא משתנה.
        </p>
        {file.warnings.length > 0 && (
          <div className="lp-note warn">
            בקובץ יש גם: {file.warnings.join(', ')}. הטקסט עצמו מיובא, אבל את אלה הכריכייה עוד לא יודעת להעביר.
          </div>
        )}
        <label className="field">
          איך לחלק לפרקים
          <select value={mode ? modeKey(mode) : ''} onChange={(e) => setModeId(e.target.value)}>
            {options.map((o) => (
              <option key={modeKey(o.mode)} value={modeKey(o.mode)}>
                {modeLabel(o.mode, o.count)}
              </option>
            ))}
          </select>
        </label>
        <div className="im-list" role="list">
          {chapters.map((c, i) => (
            <div key={`${c.start}`} className={`im-row${keep[i] === false && i > 0 ? ' joined' : ''}`} role="listitem">
              <input
                type="checkbox"
                checked={keep[i] !== false || i === 0}
                disabled={i === 0}
                title={i === 0 ? undefined : 'בלי סימון, הקטע הזה מצטרף לפרק שלפניו'}
                aria-label="פרק נפרד"
                onChange={(e) => setKeep((k) => k.map((v, j) => (j === i ? e.target.checked : v)))}
              />
              <div className="im-main">
                <input
                  className="im-title"
                  value={titles[i] ?? ''}
                  dir="auto"
                  placeholder={`פרק ${i + 1}`}
                  aria-label="שם הפרק"
                  disabled={keep[i] === false && i > 0}
                  onChange={(e) => setTitles((t) => t.map((v, j) => (j === i ? e.target.value : v)))}
                />
                <div className="im-preview">
                  {c.front && <b>לפני הפרק הראשון · </b>}
                  {c.words.toLocaleString('he-IL')} מילים{c.preview ? ` · ${c.preview}` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="lp-note">שם הפרק נלקח מהכותרת. הורדת הסימון מצרפת קטע לפרק שלפניו. אחר כך אפשר לשנות שמות, סדר וחלקים כרגיל.</p>
        {!into && (
          <>
            <label className="field">
              שם הספר
              <input value={bookTitle} dir="auto" onChange={(e) => setBookTitle(e.target.value)} />
            </label>
            <div className="field">
              איפה לשמור
              <div className="pathrow">
                <span className="mono">{parent}</span>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={async () => {
                    const p = await api.chooseFolder('parent')
                    if (p) setParent(p)
                  }}
                >
                  שינוי…
                </button>
              </div>
            </div>
          </>
        )}
        {err && <div className="err">{err}</div>}
        <div className="actions">
          <button type="submit" className="btn" disabled={busy}>
            {busy ? 'מייבא…' : into ? `הוספת ${count === 1 ? 'פרק אחד' : `${count} פרקים`} בסוף הספר` : `יצירת ספר עם ${count === 1 ? 'פרק אחד' : `${count} פרקים`}`}
          </button>
          <button type="button" className="btn ghost" onClick={onCancel}>
            ביטול
          </button>
        </div>
      </form>
    </div>
  )
}
