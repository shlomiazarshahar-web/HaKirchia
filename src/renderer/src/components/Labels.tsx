// Color labels for chapters (feature 44): the submenu in the chapter's right-click menu, the
// dialog where the writer makes and edits labels, and the small marks shown in the binder and on
// the planning cards.

import { useEffect, useRef, useState } from 'react'
import type { Book, Chapter } from '@shared/types'
import { chapterLabels, LABEL_COLOR_NAMES, LABEL_COLORS, newLabelId, nextLabelColor, type ChapterLabel, type LabelColor } from '@shared/labels'
import { Icon } from './Icons'

/** Colored dots after a chapter's name in the binder (a tooltip names them) */
export function LabelDots({ book, chapter }: { book: Book; chapter: Chapter }) {
  const ls = chapterLabels(chapter.labels, book.labels ?? [])
  if (!ls.length) return null
  return (
    <span className="ldots" title={ls.map((l) => l.name || LABEL_COLOR_NAMES[l.color]).join(', ')} aria-label={`תוויות: ${ls.map((l) => l.name).join(', ')}`}>
      {ls.map((l) => (
        <i key={l.id} className={`ldot lc-${l.color}`} />
      ))}
    </span>
  )
}

/** Chips with the labels' names, for the planning cards */
export function LabelChips({ book, chapter, onClick }: { book: Book; chapter: Chapter; onClick?: (e: React.MouseEvent) => void }) {
  const ls = chapterLabels(chapter.labels, book.labels ?? [])
  if (!ls.length) return null
  return (
    <div className="lchips" onClick={onClick}>
      {ls.map((l) => (
        <span key={l.id} className={`lchip lc-${l.color}`}>
          {l.name || LABEL_COLOR_NAMES[l.color]}
        </span>
      ))}
    </div>
  )
}

/** "תוויות" in the chapter's right-click menu: every label with a check mark, and "manage labels" */
export function LabelsSubmenu({ book, chapter, toRight, onToggle, onManage }: { book: Book; chapter: Chapter; toRight: boolean; onToggle: (labelId: string) => void; onManage: () => void }) {
  const labels = book.labels ?? []
  const on = new Set(chapter.labels ?? [])
  const count = labels.filter((l) => on.has(l.id)).length
  return (
    <div className={`msub${toRight ? ' to-right' : ''}`}>
      <button role="menuitem" aria-haspopup="menu" title="תוויות צבע לפרק: דמות מספרת, קו עלילה, כל מה שתרצו" onClick={labels.length ? undefined : onManage}>
        <Icon name="tag" />
        תוויות{count ? ` (${count})` : ''}
        <span className="grow" />
        <Icon name="chev" size={12} />
      </button>
      <div className="submenu" role="menu" aria-label="תוויות">
        {labels.map((l) => (
          <button key={l.id} role="menuitemcheckbox" aria-checked={on.has(l.id)} onClick={() => onToggle(l.id)}>
            <span className="lcheck">{on.has(l.id) && <Icon name="check" size={13} />}</span>
            <i className={`ldot big lc-${l.color}`} />
            {l.name || LABEL_COLOR_NAMES[l.color]}
          </button>
        ))}
        {labels.length > 0 && <div className="msep" />}
        <button role="menuitem" onClick={onManage}>
          <Icon name={labels.length ? 'gear' : 'plus'} />
          {labels.length ? 'עריכת התוויות…' : 'תווית חדשה…'}
        </button>
      </div>
    </div>
  )
}

/** Making, renaming, recoloring and removing the book's labels */
export function LabelsDialog({ book, onSave, onClose }: { book: Book; onSave: (labels: ChapterLabel[]) => Promise<void>; onClose: () => void }) {
  const [list, setList] = useState<ChapterLabel[]>(() => (book.labels?.length ? book.labels : []))
  const [picking, setPicking] = useState<string | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  const firstRef = useRef<HTMLInputElement>(null)
  const used = (id: string) => book.chapters.filter((c) => c.labels?.includes(id)).length

  // Esc closes even when the keyboard is not inside the window
  const pickRef = useRef(picking)
  pickRef.current = picking
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && (pickRef.current ? setPicking(null) : onClose())
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  useEffect(() => {
    if (!list.length) add()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function add() {
    const l: ChapterLabel = { id: newLabelId(), name: '', color: nextLabelColor(list) }
    setList((x) => [...x, l])
    setFresh(l.id)
  }
  const patch = (id: string, p: Partial<ChapterLabel>) => setList((x) => x.map((l) => (l.id === id ? { ...l, ...p } : l)))
  const move = (i: number, d: number) =>
    setList((x) => {
      const j = i + d
      if (j < 0 || j >= x.length) return x
      const y = [...x]
      ;[y[i], y[j]] = [y[j], y[i]]
      return y
    })
  const save = async () => {
    // a label left without a name and on no chapter is dropped
    await onSave(list.filter((l) => l.name.trim() || used(l.id)).map((l) => ({ ...l, name: l.name.trim() })))
    onClose()
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="dialog labels-dialog"
        role="dialog"
        aria-label="תוויות צבע לפרקים"
        onSubmit={(e) => (e.preventDefault(), void save())}
        onClick={() => picking && setPicking(null)}
      >
        <h2>תוויות צבע לפרקים</h2>
        <p>למשל הדמות שמספרת את הפרק, או קו עלילה. לכל פרק אפשר לתת כמה תוויות, בלחיצה ימנית על הפרק בעץ או על הכרטיס בתכנון.</p>
        <div className="lrows">
          {list.map((l, i) => (
            <div key={l.id} className="lrow">
              <span className="lswatch-wrap">
                <button type="button" className={`lswatch lc-${l.color}`} aria-label={`צבע: ${LABEL_COLOR_NAMES[l.color]}. לחיצה לשינוי`} title="שינוי הצבע" onClick={(e) => (e.stopPropagation(), setPicking(picking === l.id ? null : l.id))} />
                {picking === l.id && (
                  <span className="lpalette" role="listbox" aria-label="צבע התווית" onClick={(e) => e.stopPropagation()}>
                    {LABEL_COLORS.map((c: LabelColor) => (
                      <button type="button" key={c} role="option" aria-selected={c === l.color} className={`lswatch lc-${c}`} title={LABEL_COLOR_NAMES[c]} aria-label={LABEL_COLOR_NAMES[c]} onClick={() => (patch(l.id, { color: c }), setPicking(null))} />
                    ))}
                  </span>
                )}
              </span>
              <input
                ref={i === 0 ? firstRef : undefined}
                autoFocus={fresh === l.id}
                dir="auto"
                value={l.name}
                placeholder="שם התווית, למשל: נועה מספרת"
                aria-label="שם התווית"
                onChange={(e) => patch(l.id, { name: e.target.value })}
              />
              <small className="lused">{used(l.id) === 1 ? 'פרק אחד' : used(l.id) ? `${used(l.id)} פרקים` : ''}</small>
              <button type="button" className="ib icon" title="למעלה ברשימה" aria-label="למעלה" disabled={i === 0} onClick={() => move(i, -1)}>
                <Icon name="up" />
              </button>
              <button type="button" className="ib icon" title="למטה ברשימה" aria-label="למטה" disabled={i === list.length - 1} onClick={() => move(i, 1)}>
                <Icon name="down" />
              </button>
              <button
                type="button"
                className="ib icon"
                title={used(l.id) ? `מחיקת התווית (היא תוסר מ-${used(l.id)} פרקים)` : 'מחיקת התווית'}
                aria-label="מחיקת התווית"
                onClick={() => setList((x) => x.filter((y) => y.id !== l.id))}
              >
                <Icon name="trash" />
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="btn ghost ladd" onClick={add}>
          <Icon name="plus" /> תווית חדשה
        </button>
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            ביטול
          </button>
          <button type="submit" className="btn">
            שמירה
          </button>
        </div>
      </form>
    </div>
  )
}
