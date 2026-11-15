// The cork board (לוח שעם): a card per chapter, with its synopsis and status, in reading order.
// Parts show as rows of cards under their title. Dragging a card changes the chapter order
// everywhere (binder, master, file numbers), exactly like dragging in the binder.
//
// Built so later features can hang off it: inspiration images (feature 37) would go in the
// card above the title, and a story-time order (timeline, feature 21) would be another
// value of `Order` that groups the same cards differently.

import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import type { Book, Chapter, ChapterStatus, OutlineNode, PartNode } from '@shared/types'
import { STATUS_LABELS } from '@shared/types'
import { moveNode, updatePart, type DropTarget } from '@shared/outline'
import { api, onDiskChange } from '../api'
import { Icon } from './Icons'
import { RenameField } from './Binder'

interface Props {
  book: Book
  onOpen: (id: string) => void
  onMeta: (id: string, meta: { status?: ChapterStatus; synopsis?: string }) => void
  onOutline: (outline: OutlineNode[]) => void
  onAdd: (partId?: string) => void
  onContextMenu: (ch: Chapter, x: number, y: number) => void
  onPartMenu: (part: PartNode, x: number, y: number) => void
  onWords: (total: number) => void
  /** Chapter or part whose name is being edited (a new chapter starts like this) */
  renamingId: string | null
  onRename: (id: string, title: string) => void
  onStartRename: (id: string | null) => void
}

type Filter = 'all' | ChapterStatus
const STATUSES = Object.keys(STATUS_LABELS) as ChapterStatus[]

/** Consecutive chapters outside parts form one unnamed group; each part is a group with a title. */
type Group = { part: PartNode | null; ids: string[] }
function groups(outline: OutlineNode[]): Group[] {
  const out: Group[] = []
  for (const n of outline) {
    if (n.type === 'part') out.push({ part: n, ids: n.children })
    else if (out.length && !out[out.length - 1].part) out[out.length - 1].ids.push(n.id)
    else out.push({ part: null, ids: [n.id] })
  }
  return out
}

type Over = { id: string; mark: 'before' | 'after' | 'into' }

export function CorkBoard({ book, onOpen, onMeta, onOutline, onAdd, onContextMenu, onPartMenu, onWords, renamingId, onRename, onStartRename }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const [words, setWords] = useState<Record<string, number>>({})
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<Over | null>(null)
  const target = useRef<DropTarget | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [statusMenu, setStatusMenu] = useState<string | null>(null)

  const byId = new Map(book.chapters.map((c) => [c.id, c]))
  const number = new Map(book.chapters.map((c, i) => [c.id, i + 1]))
  const fileKey = book.chapters.map((c) => c.id + c.file).join('|')

  // Word counts come from the files, so they are right even for chapters changed in Word
  useEffect(() => {
    let alive = true
    const load = () =>
      api.wordCounts(book.path).then((r) => {
        if (alive && r.ok && r.value) setWords(r.value)
      })
    void load()
    const offs = book.chapters.map((c) => onDiskChange(book.path, c.id, load))
    return () => {
      alive = false
      offs.forEach((off) => off())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.path, fileKey])

  const total = book.chapters.reduce((a, c) => a + (words[c.id] ?? 0), 0)
  useEffect(() => onWords(total), [total, onWords])

  const reset = () => {
    setDrag(null)
    setOver(null)
    target.current = null
  }
  const drop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (drag && target.current) {
      const next = moveNode(book.outline, { type: 'chapter', id: drag }, target.current)
      if (JSON.stringify(next) !== JSON.stringify(book.outline)) onOutline(next)
    }
    reset()
  }
  const mark = (o: Over | null, t: DropTarget | null) => {
    target.current = t
    setOver((cur) => (cur?.id === o?.id && cur?.mark === o?.mark ? cur : o))
  }

  /** Over a card: its right half (reading side) drops before it, its left half after it. */
  const overCard = (e: DragEvent<HTMLElement>, id: string) => {
    if (!drag) return
    e.preventDefault()
    e.stopPropagation()
    if (drag === id) return mark(null, null)
    const r = e.currentTarget.getBoundingClientRect()
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl'
    const startSide = rtl ? e.clientX > r.left + r.width / 2 : e.clientX < r.left + r.width / 2
    const kind = startSide ? 'before' : 'after'
    mark({ id, mark: kind }, { kind, ref: { type: 'chapter', id } })
  }
  const overPart = (e: DragEvent<HTMLElement>, part: PartNode, at: 'start' | 'end') => {
    if (!drag) return
    e.preventDefault()
    e.stopPropagation()
    mark({ id: part.id, mark: 'into' }, { kind: 'into', partId: part.id, at })
  }

  const visible = (id: string) => filter === 'all' || byId.get(id)?.status === filter
  const counts = Object.fromEntries(STATUSES.map((s) => [s, book.chapters.filter((c) => c.status === s).length])) as Record<ChapterStatus, number>

  const card = (ch: Chapter) => {
    const cls = ['card']
    if (drag === ch.id) cls.push('dragging')
    if (over?.id === ch.id) cls.push(`over-${over.mark}`)
    const n = words[ch.id]
    return (
      <article
        key={ch.id}
        className={cls.join(' ')}
        style={{ ['--c' as string]: `var(--s-${ch.status})` }}
        tabIndex={0}
        aria-label={`${ch.title}, ${STATUS_LABELS[ch.status]}`}
        title="לחיצה כפולה על הכרטיס פותחת את הפרק לכתיבה. גרירה משנה את הסדר."
        draggable={editing !== ch.id && renamingId !== ch.id}
        onDragStart={(e) => {
          setDrag(ch.id)
          setStatusMenu(null)
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', ch.id)
        }}
        onDragOver={(e) => overCard(e, ch.id)}
        onDrop={drop}
        onDragEnd={reset}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('textarea, input, h4 .title, .syn, .pill, .smenu')) return
          onOpen(ch.id)
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return
          if (e.key === 'Enter') onOpen(ch.id)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          onContextMenu(ch, e.clientX, e.clientY)
        }}
      >
        <div className="num">
          <span>פרק {number.get(ch.id)}</span>
          <span className="wc">{n === undefined ? '' : `${n.toLocaleString('he-IL')} מילים`}</span>
        </div>
        {renamingId === ch.id ? (
          <h4 className="renaming">
            <RenameField
              initial={ch.title}
              label="שם הפרק"
              onDone={(t) => {
                onStartRename(null)
                if (t && t !== ch.title) onRename(ch.id, t)
              }}
            />
          </h4>
        ) : (
          <h4 className="renaming-btn">
            <button className="title" dir="auto" title="לחיצה לשינוי השם" onClick={() => onStartRename(ch.id)}>
              {ch.title}
            </button>
          </h4>
        )}
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
        <div className="cfoot">
          <button
            className="pill"
            style={{ color: `var(--s-${ch.status})` }}
            aria-haspopup="menu"
            aria-expanded={statusMenu === ch.id}
            title="שינוי סטטוס"
            onClick={(e) => {
              e.stopPropagation()
              setStatusMenu(statusMenu === ch.id ? null : ch.id)
            }}
          >
            <i className={`dot st-${ch.status}`} />
            {STATUS_LABELS[ch.status]}
            <Icon name="chev" size={12} />
          </button>
          <span className="grow" />
          <button className="ib icon open" title="פתיחה לכתיבה" aria-label={`פתיחת ${ch.title} לכתיבה`} onClick={() => onOpen(ch.id)}>
            <Icon name="pen" size={14} />
          </button>
        </div>
        {statusMenu === ch.id && (
          <div className="smenu" role="menu" onClick={(e) => e.stopPropagation()}>
            {STATUSES.map((s) => (
              <button
                key={s}
                role="menuitemradio"
                aria-checked={s === ch.status}
                onClick={() => {
                  setStatusMenu(null)
                  if (s !== ch.status) onMeta(ch.id, { status: s })
                }}
              >
                <i className={`dot st-${s}`} />
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        )}
      </article>
    )
  }

  const addCard = (partId?: string, label = 'פרק חדש') => (
    <button key={`add-${partId ?? 'book'}`} className="card add" onClick={() => onAdd(partId)}>
      <Icon name="plus" size={22} />
      <span>{label}</span>
    </button>
  )

  const gs = groups(book.outline)
  const endsWithPart = !gs.length || !!gs[gs.length - 1].part
  const shown = book.chapters.filter((c) => visible(c.id)).length

  return (
    <section className="board" aria-label="לוח שעם" onClick={() => statusMenu && setStatusMenu(null)}>
      <div className="bbar">
        <h2>{book.title} · לוח שעם</h2>
        <div className="fchips" role="group" aria-label="סינון לפי סטטוס">
          <button className="fchip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            הכול <span className="cnt">{book.chapters.length}</span>
          </button>
          {STATUSES.map((s) => (
            <button key={s} className="fchip" aria-pressed={filter === s} onClick={() => setFilter(s)}>
              <i className={`dot st-${s}`} />
              {STATUS_LABELS[s]} <span className="cnt">{counts[s]}</span>
            </button>
          ))}
        </div>
        <span className="grow" />
        <span className="bhint">גרירת כרטיס משנה את סדר הפרקים בכל הספר, גם בעץ ובשמות הקבצים</span>
      </div>

      {book.chapters.length === 0 && filter === 'all' && <div className="cards">{addCard()}</div>}
      {book.chapters.length > 0 && shown === 0 && <div className="bempty-board">אין פרקים בסטטוס "{STATUS_LABELS[filter as ChapterStatus]}".</div>}

      {gs.map((g, gi) => {
        const ids = g.ids.filter(visible)
        const isLast = gi === gs.length - 1
        if (!g.part) {
          if (!ids.length && !(isLast && filter === 'all')) return null
          const cards = (
            <div key={`loose-${gi}`} className="cards">
              {ids.map((id) => card(byId.get(id)!))}
              {isLast && filter === 'all' && addCard()}
            </div>
          )
          // After a part, a short label makes clear these chapters are not in it
          return gi > 0 ? (
            <div key={`loose-${gi}`} className="bgroup-board">
              <div className="cpart loose">מחוץ לחלקים</div>
              {cards}
            </div>
          ) : (
            cards
          )
        }
        const p = g.part
        if (filter !== 'all' && !ids.length) return null
        return (
          <div key={p.id} className="bgroup-board">
            <div
              className={`cpart${over?.id === p.id ? ' over-into' : ''}`}
              onDragOver={(e) => overPart(e, p, 'start')}
              onDrop={drop}
              onContextMenu={(e) => {
                e.preventDefault()
                onPartMenu(p, e.clientX, e.clientY)
              }}
            >
              <Icon name="part" />
              {renamingId === p.id ? (
                <RenameField
                  initial={p.title}
                  label="שם החלק"
                  onDone={(t) => {
                    onStartRename(null)
                    if (t && t !== p.title) onOutline(updatePart(book.outline, p.id, { title: t }))
                  }}
                />
              ) : (
                <span dir="auto" onDoubleClick={() => onStartRename(p.id)}>
                  {p.title}
                </span>
              )}
              <span className="count">{p.children.length}</span>
            </div>
            <div className="cards">
              {ids.map((id) => card(byId.get(id)!))}
              {filter === 'all' && (
                <div
                  className={`card add slot${!p.children.length && over?.id === p.id ? ' over-into' : ''}`}
                  onDragOver={(e) => overPart(e, p, 'end')}
                  onDrop={drop}
                >
                  <button className="addin" onClick={() => onAdd(p.id)}>
                    <Icon name="plus" size={22} />
                    <span>{p.children.length ? 'פרק חדש בחלק' : 'החלק ריק. אפשר לגרור לכאן פרק, או להוסיף פרק חדש'}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )
      })}
      {filter === 'all' && book.chapters.length > 0 && endsWithPart && (
        <div className="cards">
          <div
            className={`card add slot${over?.id === '__end' ? ' over-into' : ''}`}
            onDragOver={(e) => {
              if (!drag) return
              e.preventDefault()
              mark({ id: '__end', mark: 'into' }, { kind: 'end' })
            }}
            onDrop={drop}
          >
            <button className="addin" onClick={() => onAdd()}>
              <Icon name="plus" size={22} />
              <span>פרק חדש מחוץ לחלקים</span>
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

/** Inline synopsis editing: saves on leaving the box or Ctrl+Enter, Esc cancels. */
function SynopsisEditor({ value, onDone }: { value: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(value)
  const ref = useRef<HTMLTextAreaElement>(null)
  const done = useRef(false)
  const finish = (out: string | null) => {
    if (done.current) return
    done.current = true
    onDone(out)
  }
  useEffect(() => {
    const t = ref.current
    if (!t) return
    t.focus()
    t.setSelectionRange(t.value.length, t.value.length)
  }, [])
  useEffect(() => {
    const t = ref.current
    if (!t) return
    t.style.height = 'auto'
    t.style.height = `${t.scrollHeight}px`
  }, [v])
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') finish(null)
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) finish(v)
  }
  return (
    <textarea
      ref={ref}
      className="syn-edit"
      dir="auto"
      value={v}
      placeholder="במה עוסק הפרק?"
      aria-label="תקציר הפרק"
      onChange={(e) => setV(e.target.value)}
      onKeyDown={keys}
      onBlur={() => finish(v)}
    />
  )
}
