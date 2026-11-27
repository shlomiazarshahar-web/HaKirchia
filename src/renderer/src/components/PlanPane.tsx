// The plan as a pane next to the writing (feature 67, mockup approved 2026-11-26): what one
// glances at while writing. The chapter cards in a narrow column, or the story timeline, with the
// chapter being written highlighted. The wide views (all the cards, inspiration) stay in the
// planning tab; "פתיחה בתכנון" goes there in the same view.

import { useEffect, useRef, useState, type DragEvent } from 'react'
import type { Chapter, ChapterStatus, OutlineNode, PartNode } from '@shared/types'
import { STATUS_LABELS } from '@shared/types'
import { moveNode, type DropTarget } from '@shared/outline'
import { useBg } from './bgctx'
import { Icon } from './Icons'
import { LabelChips } from './Labels'
import { SynopsisEditor } from './CorkBoard'
import type { PlanMode } from './Plan'

export type PlanPaneMode = 'cards' | 'timeline'

const MODE_KEY = 'hakirchia.planPaneMode'
/** The planning tab's "ליד הכתיבה" button opens the pane in the view it was in */
export function rememberPlanPaneMode(m: PlanPaneMode): void {
  try {
    localStorage.setItem(MODE_KEY, m)
  } catch {
    /* not remembered */
  }
}
function readMode(): PlanPaneMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'timeline' ? 'timeline' : 'cards'
  } catch {
    return 'cards'
  }
}

interface Props {
  /** The chapter being written (in the pane last in focus) */
  activeId: string | null
  onOpenChapter: (id: string) => void
  onOutline: (outline: OutlineNode[]) => void
  onMeta: (id: string, meta: { status?: ChapterStatus; synopsis?: string }) => void
  onContextMenu: (ch: Chapter, x: number, y: number) => void
  onOpenInPlan: (mode: PlanMode) => void
}

/** Consecutive chapters outside parts form one unnamed group; each part is a group with a title */
function groups(outline: OutlineNode[]): { part: PartNode | null; ids: string[] }[] {
  const out: { part: PartNode | null; ids: string[] }[] = []
  for (const n of outline) {
    if (n.type === 'part') out.push({ part: n, ids: n.children })
    else if (out.length && !out[out.length - 1].part) out[out.length - 1].ids.push(n.id)
    else out.push({ part: null, ids: [n.id] })
  }
  return out
}

export function PlanPane(props: Props) {
  const [mode, setModeState] = useState<PlanPaneMode>(readMode)
  const setMode = (m: PlanPaneMode) => {
    setModeState(m)
    try {
      localStorage.setItem(MODE_KEY, m)
    } catch {
      /* not remembered */
    }
  }
  return (
    <div className="planpane">
      <div className="pp-bar">
        <div className="seg" role="tablist" aria-label="מה מוצג בחלון התכנון">
          <button role="tab" aria-selected={mode === 'cards'} onClick={() => setMode('cards')}>
            <Icon name="cards" size={14} />
            כרטיסים
          </button>
          <button role="tab" aria-selected={mode === 'timeline'} onClick={() => setMode('timeline')}>
            <Icon name="timeline" size={14} />
            ציר זמן
          </button>
        </div>
      </div>
      {mode === 'cards' ? <CardList {...props} /> : <EventList {...props} />}
      <div className="pp-foot">
        <span className="pp-hint">{mode === 'cards' ? 'לחיצה כפולה פותחת פרק. גרירה משנה סדר.' : 'האירועים של הפרק הפעיל מודגשים'}</span>
        <span className="grow" />
        <button className="ib pp-open" title="מעבר ללשונית התכנון, באותה תצוגה, על כל הרוחב" onClick={() => props.onOpenInPlan(mode)}>
          פתיחה בתכנון
          <Icon name="jump" size={14} />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cards in a narrow column
// ---------------------------------------------------------------------------

function CardList({ activeId, onOpenChapter, onOutline, onMeta, onContextMenu }: Props) {
  const { book } = useBg()
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<{ id: string; mark: 'before' | 'after' } | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const target = useRef<DropTarget | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const byId = new Map(book.chapters.map((c) => [c.id, c]))
  const number = new Map(book.chapters.map((c, i) => [c.id, i + 1]))

  // the chapter being written comes into view when it changes
  useEffect(() => {
    if (!activeId) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-card="${CSS.escape(activeId)}"]`)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeId])

  const reset = () => {
    setDrag(null)
    setOver(null)
    target.current = null
  }
  const drop = (e: DragEvent) => {
    e.preventDefault()
    if (drag && target.current) {
      const next = moveNode(book.outline, { type: 'chapter', id: drag }, target.current)
      if (JSON.stringify(next) !== JSON.stringify(book.outline)) onOutline(next)
    }
    reset()
  }
  const overCard = (e: DragEvent<HTMLElement>, id: string) => {
    if (!drag) return
    e.preventDefault()
    if (drag === id) return (target.current = null), setOver(null)
    const r = e.currentTarget.getBoundingClientRect()
    const mark = e.clientY < r.top + r.height / 2 ? 'before' : 'after'
    target.current = { kind: mark, ref: { type: 'chapter', id } }
    setOver((o) => (o?.id === id && o.mark === mark ? o : { id, mark }))
  }

  const card = (ch: Chapter) => {
    const here = ch.id === activeId
    const cls = ['pp-card']
    if (here) cls.push('on')
    if (drag === ch.id) cls.push('dragging')
    if (over?.id === ch.id) cls.push(`over-${over.mark}`)
    return (
      <article
        key={ch.id}
        data-card={ch.id}
        className={cls.join(' ')}
        style={{ ['--c' as string]: `var(--s-${ch.status})` }}
        tabIndex={0}
        aria-label={`פרק ${number.get(ch.id)}: ${ch.title}, ${STATUS_LABELS[ch.status]}${here ? ', כותב עכשיו' : ''}`}
        draggable={editing !== ch.id}
        onDragStart={(e) => {
          setDrag(ch.id)
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', ch.id)
        }}
        onDragOver={(e) => overCard(e, ch.id)}
        onDrop={drop}
        onDragEnd={reset}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('textarea, .syn')) return
          onOpenChapter(ch.id)
        }}
        onKeyDown={(e) => e.target === e.currentTarget && e.key === 'Enter' && onOpenChapter(ch.id)}
        onContextMenu={(e) => {
          e.preventDefault()
          onContextMenu(ch, e.clientX, e.clientY)
        }}
      >
        <div className="pp-row">
          <span>פרק {number.get(ch.id)}</span>
          {here && <span className="pp-here">כותב עכשיו</span>}
          <span className="grow" />
          <button
            className="pp-pill"
            style={{ color: `var(--s-${ch.status})` }}
            title="שינוי סטטוס (גם בלחיצה ימנית)"
            onClick={(e) => (e.stopPropagation(), onContextMenu(ch, e.clientX, e.clientY))}
          >
            <i className={`dot st-${ch.status}`} />
            {STATUS_LABELS[ch.status]}
          </button>
        </div>
        <div className="pp-title" dir="auto">
          {ch.title}
        </div>
        <LabelChips book={book} chapter={ch} onClick={(e) => (e.stopPropagation(), onContextMenu(ch, e.clientX, e.clientY))} />
        {editing === ch.id ? (
          <SynopsisEditor
            value={ch.synopsis}
            onDone={(v) => {
              setEditing(null)
              if (v !== null && v !== ch.synopsis) onMeta(ch.id, { synopsis: v })
            }}
          />
        ) : (
          <button className={`syn${ch.synopsis.trim() ? '' : ' empty'}`} dir="auto" title="לחיצה לעריכת התקציר" onClick={() => setEditing(ch.id)}>
            {ch.synopsis.trim() || 'אין עדיין תקציר. לחיצה כאן כדי לכתוב.'}
          </button>
        )}
      </article>
    )
  }

  if (!book.chapters.length) return <div className="pp-list pp-empty">אין עדיין פרקים בספר.</div>
  return (
    <div className="pp-list" ref={listRef} onDragOver={(e) => drag && e.preventDefault()} onDrop={drop}>
      {groups(book.outline).map((g, gi) => (
        <div key={g.part?.id ?? `loose-${gi}`} className="pp-group">
          {g.part ? (
            <div className="pp-part" dir="auto">
              {g.part.title}
            </div>
          ) : (
            gi > 0 && <div className="pp-part loose">מחוץ לחלקים</div>
          )}
          {g.ids.map((id) => byId.get(id)).filter((c): c is Chapter => !!c).map(card)}
          {g.part && !g.ids.length && <div className="pp-empty-part">החלק ריק</div>}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The story timeline (feature 21), read-only here
// ---------------------------------------------------------------------------

function EventList({ activeId, onOpenChapter, onOpenInPlan }: Props) {
  const bg = useBg()
  const { book } = bg
  const listRef = useRef<HTMLDivElement>(null)
  const number = new Map(book.chapters.map((c, i) => [c.id, i + 1]))
  const matById = new Map(book.materials.map((m) => [m.id, m]))
  const list = book.timeline

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('.pp-ev.on')
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeId])

  if (!list.length)
    return (
      <div className="pp-list pp-empty">
        <p>אין עדיין אירועים בציר הזמן של הסיפור.</p>
        <button className="btn ghost" onClick={() => onOpenInPlan('timeline')}>
          הוספת אירועים בלשונית התכנון
        </button>
      </div>
    )
  return (
    <div className="pp-list pp-tl" ref={listRef}>
      {list.map((ev, i) => {
        const on = !!activeId && ev.chapterIds.includes(activeId)
        return (
          <div key={ev.id} className={`pp-ev${on ? ' on' : ''}`}>
            <div className="pp-rail" aria-hidden="true">
              <span className="pp-knot" />
              {i < list.length - 1 && <span className="pp-line" />}
            </div>
            <div className="pp-eb">
              {ev.when && <span className="pp-when" dir="auto">{ev.when}</span>}
              <span className="pp-et" dir="auto">
                {ev.title || 'אירוע בלי שם'}
              </span>
              {on && ev.text.trim() && (
                <span className="pp-ed" dir="auto">
                  {ev.text}
                </span>
              )}
              {(ev.chapterIds.length > 0 || ev.materialIds.length > 0) && (
                <div className="pp-chips">
                  {ev.chapterIds
                    .filter((id) => number.has(id))
                    .map((id) => (
                      <button key={id} className={`pp-chip${id === activeId ? ' on' : ''}`} title="פתיחת הפרק" onClick={() => onOpenChapter(id)}>
                        פרק {number.get(id)}
                        {id === activeId ? ' · כותב עכשיו' : ''}
                      </button>
                    ))}
                  {ev.materialIds
                    .filter((id) => matById.has(id))
                    .map((id) => (
                      <button key={id} className="pp-chip" title="פתיחת דף הרקע" onClick={() => bg.openMaterial(id)}>
                        {matById.get(id)!.name}
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
