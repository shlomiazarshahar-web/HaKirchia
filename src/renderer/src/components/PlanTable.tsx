// Feature 60: the table (מתאר). A row per chapter: synopsis, status, labels, words, story time (from
// the timeline), characters (from the background pages, found in the text) and columns of the
// writer's own. Sorting by a column is only a way to look; dragging rows (unsorted) changes the
// order like dragging cards. With a trial order (feature 61) the rows are the trial.

import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { Book, Chapter, ChapterStatus, OutlineNode, PartNode } from '@shared/types'
import { STATUS_LABELS } from '@shared/types'
import { moveNode, type DropTarget } from '@shared/outline'
import { namesOf, occurrences } from '@shared/background'
import { sortRows, type TableColumn } from '@shared/plan'
import { LABEL_COLOR_NAMES, chapterLabels } from '@shared/labels'
import { useBookTexts } from '../background'
import { useWordCounts } from '../wordcounts'
import { Icon } from './Icons'
import { TextInput } from './Background'
import { RenameField } from './Binder'
import { EditField, IDEA_DRAG_TYPE } from './IdeasPile'

type ColKey = 'synopsis' | 'status' | 'labels' | 'words' | 'when' | 'people' | `c:${string}`
const BUILT_IN: [ColKey, string, string][] = [
  ['synopsis', 'תקציר', 'התקציר של הפרק (אותו תקציר שבכרטיס)'],
  ['status', 'סטטוס', ''],
  ['labels', 'תוויות', 'תוויות הצבע של הפרק'],
  ['words', 'מילים', 'מספר המילים בפרק (נתון בלבד)'],
  ['when', 'מתי בעלילה', 'מתי הפרק קורה בסיפור עצמו (למשל "אביב 1947"), לפי האירועים בציר הזמן שקישרתם אליו. נכתב בציר הזמן, לא כאן'],
  ['people', 'דמויות', 'הדמויות מחומרי הרקע שמוזכרות בטקסט של הפרק']
]
const HIDDEN_KEY = 'hakirchia.table.hidden'
const STATUSES = Object.keys(STATUS_LABELS) as ChapterStatus[]
const STATUS_ORDER = Object.fromEntries(STATUSES.map((s, i) => [s, i])) as Record<ChapterStatus, number>

type Sort = { key: 'num' | 'title' | ColKey; dir: 1 | -1 } | null
type Over = { id: string; mark: 'before' | 'after' | 'into' }

interface Props {
  book: Book
  modeSwitch: ReactNode
  barExtra?: ReactNode
  trialFrom?: Map<string, number>
  onOpen: (id: string) => void
  onMeta: (id: string, meta: { status?: ChapterStatus; synopsis?: string; custom?: Record<string, string> }) => void
  onOutline: (outline: OutlineNode[]) => void
  onRename: (id: string, title: string) => void
  onContextMenu: (ch: Chapter, x: number, y: number) => void
  onColumns: (cols: TableColumn[]) => void
  onIdeaDrop?: (ideaId: string, target: DropTarget) => void
}

function loadHidden(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]')
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

export function PlanTable({ book, modeSwitch, barExtra, trialFrom, onOpen, onMeta, onOutline, onRename, onContextMenu, onColumns, onIdeaDrop }: Props) {
  const words = useWordCounts(book)
  const [hidden, setHidden] = useState<Set<string>>(loadHidden)
  const [sort, setSort] = useState<Sort>(null)
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; key: ColKey } | null>(null)
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<Over | null>(null)
  const target = useRef<DropTarget | null>(null)
  const [freshCol, setFreshCol] = useState<string | null>(null)
  const [sureCol, setSureCol] = useState<string | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]))
    } catch {
      /* fine */
    }
  }, [hidden])
  useEffect(() => {
    const end = () => (setOver(null), (target.current = null))
    window.addEventListener('dragend', end)
    return () => window.removeEventListener('dragend', end)
  }, [])

  const cols = book.tableColumns ?? []
  const allCols: [ColKey, string, string][] = [...BUILT_IN, ...cols.map((c): [ColKey, string, string] => [`c:${c.id}`, c.name, 'עמודה שלך'])]
  const shown = allCols.filter(([k]) => !hidden.has(k))
  // a sort on a column that went away (hidden or removed) is dropped
  useEffect(() => {
    if (sort && sort.key !== 'num' && sort.key !== 'title' && !shown.some(([k]) => k === sort.key)) setSort(null)
  }, [sort, shown])

  // Story time: the "when" of every timeline event linked to the chapter, in timeline order
  const when = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const e of book.timeline ?? []) for (const id of e.chapterIds) m.set(id, [...(m.get(id) ?? []), e.when.trim() || e.title.trim()].filter(Boolean))
    return m
  }, [book.timeline])

  // Characters: only computed while the column is shown (it reads every chapter's text)
  const wantPeople = !hidden.has('people')
  const people = usePeople(book, wantPeople)

  const number = new Map(book.chapters.map((c, i) => [c.id, i + 1]))
  const byId = new Map(book.chapters.map((c) => [c.id, c]))

  const value = (ch: Chapter, key: NonNullable<Sort>['key']): string | number | undefined => {
    switch (key) {
      case 'num':
        return number.get(ch.id)
      case 'title':
        return ch.title
      case 'synopsis':
        return ch.synopsis.trim()
      case 'status':
        return STATUS_ORDER[ch.status]
      case 'labels':
        return chapterLabels(ch.labels, book.labels ?? [])
          .map((l) => l.name || LABEL_COLOR_NAMES[l.color])
          .join(', ')
      case 'words':
        return words[ch.id]
      case 'when':
        return when.get(ch.id)?.join('; ')
      case 'people':
        return people.get(ch.id)?.join(', ')
      default:
        return ch.custom?.[key.slice(2)]?.trim()
    }
  }
  const clickHead = (key: NonNullable<Sort>['key']) => setSort((s) => (s?.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null))
  const arrow = (key: NonNullable<Sort>['key']) => (sort?.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '')

  // ---- dragging rows (only in the book's order) ----
  const isIdea = (e: DragEvent) => !!onIdeaDrop && e.dataTransfer.types.includes(IDEA_DRAG_TYPE)
  const mark = (o: Over | null, t: DropTarget | null) => {
    target.current = t
    setOver((cur) => (cur?.id === o?.id && cur?.mark === o?.mark ? cur : o))
  }
  const overRow = (e: DragEvent<HTMLElement>, id: string) => {
    if (sort || (!drag && !isIdea(e))) return
    e.preventDefault()
    if (drag === id) return mark(null, null)
    const r = e.currentTarget.getBoundingClientRect()
    const kind = e.clientY < r.top + r.height / 2 ? 'before' : 'after'
    mark({ id, mark: kind }, { kind, ref: { type: 'chapter', id } })
  }
  const overPart = (e: DragEvent<HTMLElement>, p: PartNode) => {
    if (sort || (!drag && !isIdea(e))) return
    e.preventDefault()
    mark({ id: p.id, mark: 'into' }, { kind: 'into', partId: p.id, at: 'start' })
  }
  const drop = (e: DragEvent) => {
    e.preventDefault()
    if (isIdea(e)) {
      const id = e.dataTransfer.getData(IDEA_DRAG_TYPE)
      if (id && target.current) onIdeaDrop!(id, target.current)
    } else if (drag && target.current) {
      const next = moveNode(book.outline, { type: 'chapter', id: drag }, target.current)
      if (JSON.stringify(next) !== JSON.stringify(book.outline)) onOutline(next)
    }
    setDrag(null)
    mark(null, null)
  }

  const cell = (ch: Chapter, key: ColKey) => {
    switch (key) {
      case 'synopsis':
        return editCell(ch, 'synopsis', ch.synopsis, 'במה עוסק הפרק?', `התקציר של ${ch.title}`, (synopsis) => onMeta(ch.id, { synopsis }))
      case 'status':
        return (
          <label className="t-status" style={{ color: `var(--s-${ch.status})` }}>
            <i className={`dot st-${ch.status}`} />
            <select value={ch.status} aria-label={`הסטטוס של ${ch.title}`} onChange={(e) => onMeta(ch.id, { status: e.target.value as ChapterStatus })}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
        )
      case 'labels': {
        const ls = chapterLabels(ch.labels, book.labels ?? [])
        return (
          <button className="t-labels" title="תוויות: לחיצה פותחת את התפריט של הפרק" onClick={(e) => onContextMenu(ch, e.clientX, e.clientY)}>
            {ls.length ? (
              ls.map((l) => (
                <span key={l.id} className={`lchip lc-${l.color}`}>
                  {l.name || LABEL_COLOR_NAMES[l.color]}
                </span>
              ))
            ) : (
              <span className="t-none">+</span>
            )}
          </button>
        )
      }
      case 'words':
        return <span className="t-num">{words[ch.id] === undefined ? '' : words[ch.id].toLocaleString('he-IL')}</span>
      case 'when': {
        const w = when.get(ch.id)
        return w?.length ? <span className="t-ro" title="מציר הזמן">{w.join(' · ')}</span> : <span className="t-ro t-none" title="אפשר לקשר את הפרק לאירוע בציר הזמן">—</span>
      }
      case 'people': {
        const p = people.get(ch.id)
        return p?.length ? <span className="t-ro">{p.join(', ')}</span> : <span className="t-ro t-none">{people.size || book.materials.some((m) => m.kind === 'character') ? '—' : ''}</span>
      }
      default: {
        const id = key.slice(2)
        return editCell(ch, key, ch.custom?.[id] ?? '', '', `${cols.find((c) => c.id === id)?.name ?? ''} · ${ch.title}`, (v) => onMeta(ch.id, { custom: { ...(ch.custom ?? {}), [id]: v } }))
      }
    }
  }

  /** A cell with text: shown as text (so the whole row can be dragged), a click edits it */
  const editCell = (ch: Chapter, key: ColKey, value: string, placeholder: string, label: string, save: (v: string) => void) =>
    editing?.id === ch.id && editing.key === key ? (
      <EditField multiline className="t-edit" value={value} placeholder={placeholder} label={label} onDone={(v) => (setEditing(null), v !== value && save(v))} />
    ) : (
      <button className={`t-text${value.trim() ? '' : ' empty'}`} dir="auto" title="לחיצה לעריכה" aria-label={label} onClick={() => setEditing({ id: ch.id, key })}>
        {value.trim() || placeholder || ' '}
      </button>
    )

  const row = (ch: Chapter) => {
    const n = number.get(ch.id)!
    const was = trialFrom?.get(ch.id)
    const cls = ['trow']
    if (drag === ch.id) cls.push('dragging')
    if (over?.id === ch.id) cls.push(`over-${over.mark}`)
    return (
      <tr
        key={ch.id}
        className={cls.join(' ')}
        draggable={!sort && renaming !== ch.id && editing?.id !== ch.id}
        title={sort ? undefined : 'גרירת השורה משנה את המקום של הפרק'}
        onDragStart={(e) => {
          setDrag(ch.id)
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', ch.id)
        }}
        onDragEnd={() => (setDrag(null), mark(null, null))}
        onDragOver={(e) => overRow(e, ch.id)}
        onDrop={drop}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest('input, textarea')) return
          e.preventDefault()
          onContextMenu(ch, e.clientX, e.clientY)
        }}
      >
        <td className="col-n">
          <div className="t-n">
          {!sort && (
            <span className="grip" aria-hidden="true">
              <Icon name="grip" size={14} />
            </span>
          )}
          <span>{n}</span>
          {was !== undefined && was !== n && <span className="was" title="המקום שלו בספר עצמו">עכשיו {was}</span>}
          </div>
        </td>
        <td className="col-title">
          {renaming === ch.id ? (
            <RenameField
              initial={ch.title}
              label="שם הפרק"
              onDone={(t) => {
                setRenaming(null)
                if (t && t !== ch.title) onRename(ch.id, t)
              }}
            />
          ) : (
            <span className="t-tw">
              <button className="t-name" dir="auto" title="לחיצה לשינוי השם" onClick={() => setRenaming(ch.id)}>
                {ch.title}
              </button>
              <button className="ib icon open" title="פתיחה לכתיבה" aria-label={`פתיחת ${ch.title} לכתיבה`} onClick={() => onOpen(ch.id)}>
                <Icon name="pen" size={13} />
              </button>
            </span>
          )}
        </td>
        {shown.map(([k]) => (
          <td key={k} className={`col-${k.startsWith('c:') ? 'c' : k}`}>
            {cell(ch, k)}
          </td>
        ))}
      </tr>
    )
  }

  // Rows grouped by part, as in the book (not when sorted)
  const body: ReactNode[] = []
  if (sort) for (const ch of sortRows(book.chapters, (c) => value(c, sort.key), sort.dir)) body.push(row(ch))
  else {
    let afterPart = false
    for (const node of book.outline) {
      if (node.type === 'part') {
        afterPart = true
        body.push(
          <tr key={node.id} className={`tpart${over?.id === node.id ? ' over-into' : ''}`} onDragOver={(e) => overPart(e, node)} onDrop={drop}>
            <td colSpan={shown.length + 2}>
              <Icon name="part" /> <span dir="auto">{node.title}</span> <span className="count">{node.children.length}</span>
            </td>
          </tr>
        )
        for (const id of node.children) if (byId.get(id)) body.push(row(byId.get(id)!))
      } else {
        if (afterPart) {
          afterPart = false
          body.push(
            <tr key={`loose-${node.id}`} className="tpart loose">
              <td colSpan={shown.length + 2}>מחוץ לחלקים</td>
            </tr>
          )
        }
        if (byId.get(node.id)) body.push(row(byId.get(node.id)!))
      }
    }
  }

  const addColumn = () => {
    const id = crypto.randomUUID()
    setFreshCol(id)
    onColumns([...cols, { id, name: 'עמודה חדשה' }])
  }

  return (
    <section className={`board ptable${trialFrom ? ' trial' : ''}`} aria-label="טבלת הפרקים" onClick={() => menu && setMenu(false)}>
      <div className="bbar">
        {modeSwitch}
        <div className="tcols-wrap" onClick={(e) => e.stopPropagation()}>
          <button className="fchip" aria-expanded={menu} aria-haspopup="dialog" onClick={() => setMenu(!menu)}>
            <Icon name="table" size={14} /> עמודות
            <Icon name="chev" size={12} />
          </button>
          {menu && (
            <div className="tcols" role="dialog" aria-label="עמודות הטבלה">
              <div className="tcols-h">אילו עמודות להציג</div>
              {allCols.map(([k, label]) => {
                const own = k.startsWith('c:') ? k.slice(2) : null
                return (
                  <div key={k} className="tcol">
                    <input type="checkbox" checked={!hidden.has(k)} aria-label={`להציג את ${label}`} onChange={(e) => setHidden((h) => {
                      const n = new Set(h)
                      if (e.target.checked) n.delete(k)
                      else n.add(k)
                      return n
                    })} />
                    {own ? (
                      <>
                        <TextInput className="tcol-name" value={label} aria-label="שם העמודה" autoFocus={freshCol === own} onDone={(name) => onColumns(cols.map((c) => (c.id === own ? { ...c, name: name.trim() || c.name } : c)))} />
                        {sureCol === own ? (
                          <button className="ib danger" autoFocus onBlur={() => setSureCol(null)} onClick={() => (setSureCol(null), onColumns(cols.filter((c) => c.id !== own)))}>
                            למחוק עם הערכים?
                          </button>
                        ) : (
                          <button className="ib icon" title="מחיקת העמודה (והערכים שבה)" aria-label={`מחיקת העמודה ${label}`} onClick={() => setSureCol(own)}>
                            <Icon name="trash" size={14} />
                          </button>
                        )}
                      </>
                    ) : (
                      <span>{label}</span>
                    )}
                  </div>
                )
              })}
              <button className="ib tcol-add" onClick={addColumn}>
                <Icon name="plus" size={14} /> עמודה משלי
              </button>
              <p className="tcols-note">עמודה משלכם: למשל "נקודת מבט", "מקום" או "מה עוד חסר". כותבים בתא, והערך נשמר עם הפרק.</p>
            </div>
          )}
        </div>
        {barExtra}
        <span className="grow" />
        <span className="bhint">
          {sort
            ? 'ממוין רק לתצוגה. לחיצה נוספת על הכותרת מחזירה לסדר הספר'
            : trialFrom
              ? 'סדר ניסיוני: גרירת שורה לא משנה את הספר עד שלוחצים "להחיל על הספר"'
              : 'לחיצה על כותרת ממיינת. גרירת שורה משנה את סדר הפרקים בספר'}
        </span>
      </div>
      {!book.chapters.length ? (
        <div className="bempty-board">אין עדיין פרקים בספר.</div>
      ) : (
        <div className="twrap">
          <table className="ptab">
            <thead>
              <tr>
                <th className="col-n">
                  <button onClick={() => clickHead('num')}>#{arrow('num')}</button>
                </th>
                <th className="col-title">
                  <button onClick={() => clickHead('title')}>פרק{arrow('title')}</button>
                </th>
                {shown.map(([k, label, tip]) => (
                  <th key={k} className={`col-${k.startsWith('c:') ? 'c' : k}`}>
                    <button title={tip ? `${tip}. לחיצה ממיינת` : 'לחיצה ממיינת'} onClick={() => clickHead(k)}>
                      {label}
                      {arrow(k)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>{body}</tbody>
          </table>
          {!sort && (
            <div
              className={`tend${over?.id === '__end' ? ' over-into' : ''}`}
              onDragOver={(e) => {
                if (!drag && !isIdea(e)) return
                e.preventDefault()
                mark({ id: '__end', mark: 'into' }, { kind: 'end' })
              }}
              onDrop={drop}
            >
              {drag || over ? 'גרירה לכאן: סוף הספר, מחוץ לחלקים' : ''}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/** Which characters (background pages of kind "character") are named in each chapter */
function usePeople(book: Book, on: boolean): Map<string, string[]> {
  const { texts } = useBookTexts(on ? book : { ...book, chapters: [] }, 8000)
  return useMemo(() => {
    const m = new Map<string, string[]>()
    if (!on || !texts) return m
    for (const c of book.materials.filter((x) => x.kind === 'character')) {
      for (const o of occurrences(texts.chapters, namesOf(c))) m.set(o.chapterId, [...(m.get(o.chapterId) ?? []), c.name])
    }
    return m
  }, [on, texts, book.materials])
}
