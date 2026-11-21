// Front and back pages (feature 36): title page, copyright, dedication, motto, table of contents,
// thanks, about the author. They are part of the reading view and of every export, but they are
// not chapters: not counted, not numbered, not in the binder.

import { useEffect, useRef, useState } from 'react'
import type { Book } from '@shared/types'
import { MATTER_KINDS, moveMatter, newMatterPage, type MatterKind, type MatterPage, type PublishSettings } from '@shared/publish'
import { Icon } from './Icons'

interface Props {
  book: Book
  onSave: (p: PublishSettings) => void
  onClose: () => void
  /** The page to show first (from the binder), or 'new' to open the list of kinds */
  startId?: string
  /** Renames the book (and its folder), from the title page */
  onRenameBook?: (title: string) => void
}

const ADDABLE: MatterKind[] = ['title', 'copyright', 'dedication', 'motto', 'toc', 'thanks', 'about', 'other']

export function MatterDialog({ book, onSave, onClose, startId, onRenameBook }: Props) {
  const [info, setInfo] = useState(book.publish.info)
  const [pages, setPages] = useState<MatterPage[]>(book.publish.matter)
  const [sel, setSel] = useState<string | null>(book.publish.matter.find((p) => p.id === startId)?.id ?? book.publish.matter[0]?.id ?? null)
  const [adding, setAdding] = useState(startId === 'new')
  const [title, setTitle] = useState(book.title)
  const first = useRef<HTMLInputElement>(null)
  const page = pages.find((p) => p.id === sel) ?? null
  const changed = title.trim() !== book.title || JSON.stringify(info) !== JSON.stringify(book.publish.info) || JSON.stringify(pages) !== JSON.stringify(book.publish.matter)

  useEffect(() => first.current?.focus(), [sel])

  const patch = (id: string, p: Partial<MatterPage>) => setPages((list) => list.map((m) => (m.id === id ? { ...m, ...p } : m)))
  const add = (kind: MatterKind) => {
    const m = newMatterPage(kind, info)
    // the title page goes first, the contents after the other front pages
    setPages((list) => {
      if (kind === 'title') return [m, ...list]
      if (m.where === 'front') {
        const front = list.filter((x) => x.where === 'front')
        const at = kind !== 'toc' ? front.findIndex((x) => x.kind === 'toc') : -1
        if (at >= 0) front.splice(at, 0, m)
        else front.push(m)
        return [...front, ...list.filter((x) => x.where === 'back')]
      }
      return [...list, m]
    })
    setSel(m.id)
    setAdding(false)
  }
  const remove = (id: string) => {
    const at = pages.findIndex((p) => p.id === id)
    const next = pages.filter((p) => p.id !== id)
    setPages(next)
    setSel(next[Math.min(at, next.length - 1)]?.id ?? null)
  }
  const save = () => {
    if (JSON.stringify(info) !== JSON.stringify(book.publish.info) || JSON.stringify(pages) !== JSON.stringify(book.publish.matter)) onSave({ ...book.publish, info, matter: pages })
    if (title.trim() && title.trim() !== book.title) onRenameBook?.(title.trim())
    onClose()
  }

  const side = (where: 'front' | 'back') => {
    const list = pages.filter((p) => p.where === where)
    return (
      <div className="mx-side">
        <div className="set-sub">{where === 'front' ? 'לפני הפרקים' : 'אחרי הפרקים'}</div>
        {list.length === 0 && <small className="mx-none">אין עמודים</small>}
        {list.map((p, i) => (
          <div key={p.id} className={`mx-item${p.id === sel ? ' on' : ''}`} onClick={() => setSel(p.id)}>
            <span className="mx-name">{p.kind === 'other' || p.kind === 'thanks' || p.kind === 'about' ? p.heading || MATTER_KINDS[p.kind].label : MATTER_KINDS[p.kind].label}</span>
            <button className="ib icon" title="למעלה" aria-label="הזזה למעלה" disabled={i === 0} onClick={(e) => (e.stopPropagation(), setPages((l) => moveMatter(l, p.id, -1)))}>
              <Icon name="up" />
            </button>
            <button className="ib icon" title="למטה" aria-label="הזזה למטה" disabled={i === list.length - 1} onClick={(e) => (e.stopPropagation(), setPages((l) => moveMatter(l, p.id, 1)))}>
              <Icon name="down" />
            </button>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog matter" role="dialog" aria-label="עמודי פתיחה וסיום" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h2>עמודי פתיחה וסיום</h2>
        <p>העמודים האלה נכנסים למצב קריאה ולכל ייצוא (PDF, Word, ePub). הם לא פרקים: לא נספרים ולא ממוספרים.</p>
        <div className="mx-body">
          <div className="mx-list">
            {side('front')}
            <div className="mx-chapters">
              <Icon name="book" /> {book.chapters.length} פרקים
            </div>
            {side('back')}
            <div className="mx-add">
              <button className="btn ghost" onClick={() => setAdding(!adding)} aria-expanded={adding}>
                <Icon name="plus" /> עמוד חדש
              </button>
              {adding && (
                <div className="mx-kinds" role="menu">
                  {ADDABLE.filter((k) => !((k === 'title' || k === 'toc' || k === 'copyright') && pages.some((p) => p.kind === k))).map((k) => (
                    <button key={k} role="menuitem" onClick={() => add(k)}>
                      <b>{MATTER_KINDS[k].label}</b>
                      <small>{MATTER_KINDS[k].hint}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="mx-edit">
            {!page ? (
              <p>בוחרים עמוד מהרשימה, או מוסיפים עמוד חדש.</p>
            ) : (
              <>
                <div className="mx-edit-h">
                  <b>{MATTER_KINDS[page.kind].label}</b>
                  <span className="grow" />
                  {page.kind !== 'title' && (
                    <select value={page.where} aria-label="מיקום העמוד" onChange={(e) => patch(page.id, { where: e.target.value as 'front' | 'back' })}>
                      <option value="front">לפני הפרקים</option>
                      <option value="back">אחרי הפרקים</option>
                    </select>
                  )}
                  <button className="ib danger" title="הסרת העמוד" onClick={() => remove(page.id)}>
                    <Icon name="trash" /> הסרה
                  </button>
                </div>
                {page.kind === 'title' ? (
                  <>
                    <label className="field">
                      שם הספר
                      <input dir="auto" value={title} readOnly={!onRenameBook} title="שינוי השם משנה גם את שם התיקייה של הספר" onChange={(e) => setTitle(e.target.value)} />
                    </label>
                    <label className="field">
                      כותרת משנה
                      <input ref={first} dir="auto" value={info.subtitle} placeholder="למשל: רומן" onChange={(e) => setInfo({ ...info, subtitle: e.target.value })} />
                    </label>
                    <label className="field">
                      שם הכותב
                      <input dir="auto" value={info.author} onChange={(e) => setInfo({ ...info, author: e.target.value })} />
                    </label>
                    <label className="field">
                      שורות נוספות בתחתית השער (לא חובה)
                      <textarea dir="auto" rows={3} value={page.text} placeholder="למשל: שם ההוצאה, עיר ושנה" onChange={(e) => patch(page.id, { text: e.target.value })} />
                    </label>
                  </>
                ) : (
                  <>
                    <label className="field">
                      כותרת בראש העמוד {page.kind === 'dedication' || page.kind === 'motto' || page.kind === 'copyright' ? '(בדרך כלל בלי)' : ''}
                      <input ref={first} dir="auto" value={page.heading} onChange={(e) => patch(page.id, { heading: e.target.value })} />
                    </label>
                    {page.kind === 'toc' ? (
                      <p className="lp-note">תוכן העניינים נבנה לבד מהחלקים והפרקים, עם מספרי העמודים (ב־Word: מתעדכן כשהקובץ נפתח).</p>
                    ) : (
                      <label className="field">
                        הטקסט {page.kind === 'motto' ? '(השורה האחרונה היא המקור)' : ''}
                        <textarea dir="auto" rows={9} value={page.text} onChange={(e) => patch(page.id, { text: e.target.value })} />
                      </label>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={onClose}>
            ביטול
          </button>
          <button className="btn" onClick={save} disabled={!changed}>
            שמירה
          </button>
        </div>
      </div>
    </div>
  )
}
