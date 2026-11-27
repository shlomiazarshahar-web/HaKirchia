// Feature 59: the idea pile. A strip at the side of the plan (cards and table) for scenes and
// chapters that have no place in the book yet. An idea is dragged onto the board (or the table)
// when the writer decides where it goes, and becomes a chapter there.

import { useEffect, useRef, useState } from 'react'
import type { Idea } from '@shared/plan'
import { moveIdea } from '@shared/plan'
import { Icon } from './Icons'

/** The drag data type of an idea card (the board and the table accept it) */
export const IDEA_DRAG_TYPE = 'application/x-hakirchia-idea'

const OPEN_KEY = 'hakirchia.ideas.open'

interface Props {
  ideas: Idea[]
  onSave: (list: Idea[]) => void
  /** Makes a chapter of the idea, at the end of the book */
  onToChapter: (id: string) => void
  /** Dropping on the board is possible (not while a trial order is shown) */
  canPlace: boolean
}

export function IdeasPile({ ideas, onSave, onToChapter, canPlace }: Props) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) !== '0'
    } catch {
      return true
    }
  })
  const [fresh, setFresh] = useState<string | null>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const [sure, setSure] = useState<string | null>(null)
  // the field being edited (a new idea starts with its name); otherwise the card is text and can be dragged
  const [editing, setEditing] = useState<{ id: string; field: 'title' | 'text' } | null>(null)
  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, open ? '1' : '0')
    } catch {
      /* not saved, fine */
    }
  }, [open])

  const add = () => {
    const id = crypto.randomUUID()
    setFresh(id)
    setEditing({ id, field: 'title' })
    setOpen(true)
    onSave([{ id, title: '', text: '', at: Date.now() }, ...ideas])
  }
  const patch = (id: string, p: Partial<Idea>) => onSave(ideas.map((x) => (x.id === id ? { ...x, ...p } : x)))

  if (!open)
    return (
      <aside className="ideas closed" aria-label="ערימת רעיונות">
        <button className="ib ideas-open" title="ערימת הרעיונות: סצנות ופרקים שעוד אין להם מקום בספר" onClick={() => setOpen(true)}>
          <Icon name="bulb" size={18} />
          <span className="vt">רעיונות</span>
          {ideas.length > 0 && <span className="cnt">{ideas.length}</span>}
        </button>
      </aside>
    )

  return (
    <aside className="ideas" aria-label="ערימת רעיונות">
      <div className="ideas-head">
        <Icon name="bulb" size={16} />
        <h3>ערימת רעיונות</h3>
        {ideas.length > 0 && <span className="cnt">{ideas.length}</span>}
        <span className="grow" />
        <button className="ib icon" title="רעיון חדש" aria-label="רעיון חדש" onClick={add}>
          <Icon name="plus" />
        </button>
        <button className="ib icon" title="סגירת הערימה (הרעיונות נשמרים)" aria-label="סגירת הערימה" onClick={() => setOpen(false)}>
          <Icon name="close" />
        </button>
      </div>
      {!ideas.length ? (
        <div className="ideas-empty">
          <p>כאן שומרים סצנות ופרקים שעוד אין להם מקום בספר.</p>
          <p>{canPlace ? 'כשמחליטים איפה, גוררים את הכרטיס ללוח או לטבלה, והוא הופך לפרק באותו מקום.' : 'כשמחליטים, הכפתור "לפרק" הופך את הרעיון לפרק בסוף הספר.'}</p>
          <button className="btn ghost" onClick={add}>
            <Icon name="plus" size={14} /> רעיון ראשון
          </button>
        </div>
      ) : (
        <ul className="ideas-list">
          {ideas.map((x, i) => (
            <li
              key={x.id}
              className={`idea${drag === i ? ' dragging' : ''}${over === i && drag !== null && drag !== i ? (drag < i ? ' over-after' : ' over-before') : ''}`}
              draggable={editing?.id !== x.id}
              title={canPlace ? 'גרירה ללוח או לטבלה הופכת את הרעיון לפרק באותו מקום. גרירה בתוך הערימה משנה את הסדר.' : 'גרירה בתוך הערימה משנה את הסדר'}
              onDragStart={(e) => {
                setDrag(i)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData(IDEA_DRAG_TYPE, x.id)
                e.dataTransfer.setData('text/plain', x.title || x.text)
              }}
              onDragEnd={() => (setDrag(null), setOver(null))}
              onDragOver={(e) => {
                if (drag === null) return
                e.preventDefault()
                e.stopPropagation()
                setOver(i)
              }}
              onDrop={(e) => {
                if (drag === null) return
                e.preventDefault()
                e.stopPropagation()
                onSave(moveIdea(ideas, drag, i))
                setDrag(null)
                setOver(null)
              }}
            >
              {editing?.id === x.id && editing.field === 'title' ? (
                <EditField className="idea-title" value={x.title} placeholder="רעיון" label="שם הרעיון" fresh={fresh === x.id} onDone={(title) => (setEditing(null), title !== x.title && patch(x.id, { title }))} />
              ) : (
                <button className={`idea-title${x.title.trim() ? '' : ' empty'}`} dir="auto" title="לחיצה לעריכה" onClick={() => setEditing({ id: x.id, field: 'title' })}>
                  {x.title.trim() || 'רעיון בלי שם'}
                </button>
              )}
              {editing?.id === x.id && editing.field === 'text' ? (
                <EditField multiline className="idea-text" value={x.text} placeholder="מה קורה בו? (לא חובה)" label="פרטי הרעיון" onDone={(text) => (setEditing(null), text !== x.text && patch(x.id, { text }))} />
              ) : (
                <button className={`idea-text${x.text.trim() ? '' : ' empty'}`} dir="auto" title="לחיצה לעריכה" onClick={() => setEditing({ id: x.id, field: 'text' })}>
                  {x.text.trim() || 'מה קורה בו? (לא חובה)'}
                </button>
              )}
              <div className="idea-foot">
                <span className="grip" aria-hidden="true">
                  <Icon name="grip" size={14} />
                </span>
                <span className="grow" />
                <button className="ib" title="הרעיון הופך לפרק חדש בסוף הספר; השם שלו הוא שם הפרק והפרטים הם התקציר" onClick={() => onToChapter(x.id)}>
                  <Icon name="file" size={14} /> לפרק
                </button>
                {sure === x.id ? (
                  <button className="ib danger" onClick={() => (setSure(null), onSave(ideas.filter((y) => y.id !== x.id)))} onBlur={() => setSure(null)} autoFocus>
                    למחוק?
                  </button>
                ) : (
                  <button className="ib icon" title="מחיקת הרעיון" aria-label="מחיקת הרעיון" onClick={() => (x.title.trim() || x.text.trim() ? setSure(x.id) : onSave(ideas.filter((y) => y.id !== x.id)))}>
                    <Icon name="trash" size={14} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {ideas.length > 0 && !canPlace && <p className="ideas-note">בזמן סדר ניסיוני, "לפרק" מוסיף את הפרק בסוף הספר.</p>}
    </aside>
  )
}

/** A field of an idea while it is edited: Enter (in the name) or leaving the box saves, Esc cancels */
function EditField({ value, onDone, multiline, className, placeholder, label, fresh }: { value: string; onDone: (v: string) => void; multiline?: boolean; className: string; placeholder: string; label: string; fresh?: boolean }) {
  const [v, setV] = useState(value)
  const done = useRef(false)
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null)
  useEffect(() => {
    const t = ref.current
    if (!t) return
    t.focus()
    if (!fresh) t.setSelectionRange(t.value.length, t.value.length)
  }, [fresh])
  useEffect(() => {
    const t = ref.current
    if (!t || !multiline) return
    t.style.height = 'auto'
    t.style.height = `${t.scrollHeight}px`
  }, [v, multiline])
  const finish = (out: string) => {
    if (done.current) return
    done.current = true
    onDone(out)
  }
  const common = {
    ref,
    className,
    dir: 'auto',
    value: v,
    placeholder,
    'aria-label': label,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV(e.target.value),
    onBlur: () => finish(v),
    onKeyDown: (e: React.KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Escape') finish(value)
      if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        finish(v)
      }
    }
  }
  return multiline ? <textarea rows={2} {...common} /> : <input {...common} />
}
