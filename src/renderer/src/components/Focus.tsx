// Comfortable writing (round 2): the focused writing mode bar, and the stopping point
// ("what next?" when closing, and the note shown when the book opens again).

import { useEffect, useRef, useState } from 'react'
import type { Theme } from '@shared/types'
import { stopWhen, type StopPoint } from '@shared/stoppoint'
import { setFocusSettings, usePrefs } from '../prefs'
import { Icon } from './Icons'

const n = (x: number) => x.toLocaleString('he-IL')

/**
 * The only controls in focus mode: a quiet bar at the bottom of the screen that shows up when the
 * mouse moves, and fades away while typing.
 */
export function FocusBar({
  chapterWords,
  bookWords,
  theme,
  onTheme,
  onExit
}: {
  chapterWords: number | null
  bookWords: number
  theme: Theme
  onTheme: () => void
  onExit: () => void
}) {
  const { focus } = usePrefs()
  const [shown, setShown] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const wake = () => {
      setShown(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setShown(false), 2500)
    }
    const hide = () => {
      if (timer.current) clearTimeout(timer.current)
      setShown(false)
    }
    wake()
    window.addEventListener('mousemove', wake)
    window.addEventListener('keydown', hide)
    return () => {
      if (timer.current) clearTimeout(timer.current)
      window.removeEventListener('mousemove', wake)
      window.removeEventListener('keydown', hide)
    }
  }, [])
  return (
    <div className={`focusbar${shown ? ' shown' : ''}`} role="toolbar" aria-label="מצב כתיבה ממוקדת" onMouseEnter={() => timer.current && clearTimeout(timer.current)}>
      {chapterWords !== null && <span className="fb-wc">{n(chapterWords)} מילים בפרק</span>}
      <span className="fb-wc">{n(bookWords)} בספר</span>
      <span className="sep" />
      <label className="fb-toggle" title="השורה שכותבים נשארת באמצע המסך">
        <input type="checkbox" checked={focus.typewriter} onChange={(e) => setFocusSettings({ typewriter: e.target.checked })} />
        מכונת כתיבה
      </label>
      <label className="fb-toggle" title="שאר הפסקאות מעומעמות">
        <input type="checkbox" checked={focus.dim} onChange={(e) => setFocusSettings({ dim: e.target.checked })} />
        עמעום
      </label>
      <button className="ib" title={`${theme === 'light' ? 'מצב כהה' : 'מצב בהיר'} (Ctrl+Shift+ג)`} onClick={onTheme}>
        <Icon name={theme === 'light' ? 'moon' : 'sun'} />
        {theme === 'light' ? 'כהה' : 'בהיר'}
      </button>
      <span className="sep" />
      <button className="ib" title="יציאה ממצב ממוקד (Esc)" onClick={onExit}>
        <Icon name="close" />
        יציאה
      </button>
    </div>
  )
}

/**
 * Closing a book: "what next?". The place of the cursor is saved anyway; the note is optional.
 * Ctrl+Enter saves, Esc goes back to writing (and the book stays open).
 */
export function StopDialog({ previous, closingApp, onDone, onCancel }: { previous?: StopPoint; closingApp: boolean; onDone: (note: string) => void; onCancel: () => void }) {
  const [note, setNote] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        className="dialog stopdlg"
        role="dialog"
        aria-label="נקודת עצירה"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
          if (e.key === 'Enter' && e.ctrlKey) onDone(note.trim())
        }}
      >
        <h2>מה הלאה?</h2>
        <p>פתק קצר לעצמך לפעם הבאה. כשהספר ייפתח שוב, הסמן יחכה בדיוק במקום שבו עצרת, והפתק יופיע לידו.</p>
        <textarea ref={ref} rows={3} dir="auto" value={note} onChange={(e) => setNote(e.target.value)} placeholder="למשל: לכתוב את הפגישה בנמל. נועה עוד לא יודעת על המכתב." />
        {previous?.note && (
          <div className="lp-note">
            הפתק הקודם ({stopWhen(previous.at)}): {previous.note}
          </div>
        )}
        <div className="actions">
          <button className="btn ghost" onClick={onCancel}>
            חזרה לכתיבה
          </button>
          <button className="btn ghost" onClick={() => onDone('')}>
            {closingApp ? 'סגירה בלי פתק' : 'בלי פתק'}
          </button>
          <button className="btn" onClick={() => onDone(note.trim())} disabled={!note.trim()} title="Ctrl+Enter">
            {closingApp ? 'שמירה וסגירה' : 'שמירה'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Shown when the book opens where the writer stopped: the "what next" note from last time. */
export function StopCard({ sp, chapterTitle, onClose }: { sp: StopPoint; chapterTitle: string; onClose: () => void }) {
  return (
    <div className="stopcard" role="status">
      <div className="sc-h">
        <Icon name="pen" />
        <b>עצרת כאן</b>
        <span className="sc-when">
          {stopWhen(sp.at)} · {chapterTitle}
        </span>
        <span className="grow" />
        <button className="ib icon" title="סגירה" aria-label="סגירת הפתק" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className="sc-note" dir="auto">
        {sp.note}
      </div>
    </div>
  )
}
