import { Fragment, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { Book, Chapter, PartNode } from '@shared/types'
import { moveNode, updatePart, type Dragged, type DropTarget } from '@shared/outline'
import type { OutlineNode } from '@shared/types'
import { Icon } from './Icons'
import { CHAPTER_DRAG_TYPE } from '@shared/panes'
import { MASTER_LABEL } from '../labels'

interface Props {
  book: Book
  activeId: string | null
  masterActive: boolean
  onMaster: () => void
  /** Chapter or part whose name is being edited in the list */
  renamingId: string | null
  onSelect: (id: string) => void
  onAdd: () => void
  onAddPart: () => void
  onRename: (id: string, title: string) => void
  onStartRename: (id: string | null) => void
  onOutline: (outline: OutlineNode[]) => void
  onContextMenu: (ch: Chapter, x: number, y: number) => void
  onPartMenu: (part: PartNode, x: number, y: number) => void
  /** The scenes of the chapter being written, listed under it (feature 29) */
  scenes?: { chapterId: string; items: { label: string; pos: number }[]; current: number } | null
  onScene?: (pos: number) => void
  /** Shown under the chapters: the list of bookmarks */
  bookmarks?: ReactNode
}

/** Where a drop would land, for drawing the line / highlight */
type Over = { id: string; mark: 'before' | 'after' | 'into' } | { id: '__end'; mark: 'end' }

export function Binder(props: Props) {
  const { book, activeId, masterActive, onMaster, renamingId, onSelect, onAdd, onAddPart, onStartRename, onOutline } = props
  const [drag, setDrag] = useState<Dragged | null>(null)
  const [over, setOver] = useState<Over | null>(null)
  const [target, setTarget] = useState<DropTarget | null>(null)
  const byId = new Map(book.chapters.map((c) => [c.id, c]))
  const hasParts = book.outline.some((n) => n.type === 'part')

  const reset = () => {
    setDrag(null)
    setOver(null)
    setTarget(null)
  }
  const drop = () => {
    if (drag && target) {
      const next = moveNode(book.outline, drag, target)
      if (JSON.stringify(next) !== JSON.stringify(book.outline)) onOutline(next)
    }
    reset()
  }

  /** Works out the drop target from the mouse position over a row. */
  const overRow = (e: DragEvent<HTMLDivElement>, row: Dragged, part?: PartNode) => {
    if (!drag) return
    e.preventDefault()
    e.stopPropagation()
    if (drag.type === row.type && drag.id === row.id) {
      setOver(null)
      setTarget(null)
      return
    }
    const r = e.currentTarget.getBoundingClientRect()
    const y = (e.clientY - r.top) / r.height
    if (row.type === 'part' && drag.type === 'chapter' && part) {
      // Upper edge: before the part. The rest of the row: into the part.
      if (y < 0.3) {
        setOver({ id: row.id, mark: 'before' })
        setTarget({ kind: 'before', ref: row })
      } else {
        setOver({ id: row.id, mark: 'into' })
        setTarget({ kind: 'into', partId: row.id, at: part.collapsed ? 'end' : 'start' })
      }
      return
    }
    const after = y > 0.5
    setOver({ id: row.id, mark: after ? 'after' : 'before' })
    setTarget({ kind: after ? 'after' : 'before', ref: row })
  }

  const dragProps = (row: Dragged, renaming: boolean, part?: PartNode) => ({
    draggable: !renaming,
    onDragStart: (e: DragEvent<HTMLDivElement>) => {
      e.stopPropagation()
      setDrag(row)
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', row.id)
      // lets a chapter be dropped on a pane of the split screen
      if (row.type === 'chapter') {
        e.dataTransfer.effectAllowed = 'copyMove'
        e.dataTransfer.setData(CHAPTER_DRAG_TYPE, row.id)
      }
    },
    onDragOver: (e: DragEvent<HTMLDivElement>) => overRow(e, row, part),
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      drop()
    },
    onDragEnd: reset
  })

  const chapterRow = (ch: Chapter, inPart: boolean) => {
    const cls = ['bitem']
    if (inPart) cls.push('bsub')
    if (ch.id === activeId && !masterActive) cls.push('active')
    if (drag?.type === 'chapter' && ch.id === drag.id) cls.push('dragging')
    if (over?.id === ch.id) cls.push(`over-${over.mark}`)
    const sc = props.scenes && props.scenes.chapterId === ch.id && props.scenes.items.length > 1 ? props.scenes : null
    return (
      <Fragment key={ch.id}>
      <div
        className={cls.join(' ')}
        role="treeitem"
        aria-level={inPart ? 2 : 1}
        tabIndex={0}
        aria-current={ch.id === activeId && !masterActive ? 'page' : undefined}
        title={ch.file}
        onClick={() => onSelect(ch.id)}
        onDoubleClick={() => onStartRename(ch.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSelect(ch.id)
          if (e.key === 'F2') onStartRename(ch.id)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          props.onContextMenu(ch, e.clientX, e.clientY)
        }}
        {...dragProps({ type: 'chapter', id: ch.id }, renamingId === ch.id)}
      >
        <span className="grip" aria-hidden="true">
          ⋮⋮
        </span>
        <i className={`dot st-${ch.status}`} />
        {renamingId === ch.id ? (
          <RenameField
            initial={ch.title}
            label="שם הפרק"
            onDone={(t) => {
              onStartRename(null)
              if (t && t !== ch.title) props.onRename(ch.id, t)
            }}
          />
        ) : (
          <span className="name">{ch.title}</span>
        )}
        {sc && <span className="count" title={`${sc.items.length} סצנות`}>{sc.items.length}</span>}
      </div>
      {sc && (
        <div className={`bscenes${inPart ? ' bsub' : ''}`} role="group" aria-label={`הסצנות של ${ch.title}`}>
          {sc.items.map((s, i) => (
            <button
              key={i}
              className={`bscene${i === sc.current ? ' cur' : ''}`}
              title={`סצנה ${i + 1} (Alt+PageDown / Alt+PageUp למעבר בין סצנות)`}
              onClick={() => props.onScene?.(s.pos)}
            >
              <span className="sn">{i + 1}</span>
              <span className="name" dir="auto">{s.label}</span>
            </button>
          ))}
        </div>
      )}
      </Fragment>
    )
  }

  const partRow = (p: PartNode) => {
    const cls = ['bitem', 'bpart']
    if (drag?.type === 'part' && p.id === drag.id) cls.push('dragging')
    if (over?.id === p.id) cls.push(`over-${over.mark}`)
    const toggle = () => onOutline(updatePart(book.outline, p.id, { collapsed: !p.collapsed }))
    return (
      <div
        className={cls.join(' ')}
        role="treeitem"
        aria-level={1}
        aria-expanded={!p.collapsed}
        tabIndex={0}
        title={`${p.children.length} פרקים. גוררים פרק לכאן כדי להכניס אותו לחלק.`}
        onClick={toggle}
        onDoubleClick={(e) => {
          e.stopPropagation()
          onStartRename(p.id)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') toggle()
          if (e.key === 'F2') onStartRename(p.id)
          // Right to left: the arrow pointing "forward" (left) opens, the other one closes
          if (e.key === 'ArrowRight' && !p.collapsed) toggle()
          if (e.key === 'ArrowLeft' && p.collapsed) toggle()
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          props.onPartMenu(p, e.clientX, e.clientY)
        }}
        {...dragProps({ type: 'part', id: p.id }, renamingId === p.id, p)}
      >
        <span className={`chev${p.collapsed ? ' closed' : ''}`} aria-hidden="true">
          <Icon name="chev" />
        </span>
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
          <span className="name">{p.title}</span>
        )}
        <span className="count">{p.children.length}</span>
      </div>
    )
  }

  return (
    <nav className="binder" aria-label="עץ הספר">
      <div className="bsec">
        <div
          className={`bitem master${masterActive ? ' active' : ''}`}
          role="button"
          tabIndex={0}
          aria-current={masterActive ? 'page' : undefined}
          title="כל הפרקים ברצף, לפי הסדר בעץ"
          onClick={onMaster}
          onKeyDown={(e) => e.key === 'Enter' && onMaster()}
        >
          <Icon name="master" />
          <span className="name">{MASTER_LABEL}</span>
        </div>
      </div>
      <div className="bsec">
        <div className="bhead">
          כתב היד
          <span className="bhead-btns">
            <button className="ib" title="חלק חדש (קבוצת פרקים)" onClick={onAddPart}>
              <Icon name="part-plus" />
            </button>
            <button className="ib" title="פרק חדש" onClick={onAdd}>
              <Icon name="plus" />
            </button>
          </span>
        </div>
        {book.outline.length === 0 && <div className="bempty">אין עדיין פרקים. הפלוס למעלה מוסיף פרק.</div>}
        <div className="btree" role="tree" aria-label="פרקים וחלקים">
          {book.outline.map((n) =>
            n.type === 'part' ? (
              <div key={n.id} className="bgroup" role="group">
                {partRow(n)}
                {!n.collapsed &&
                  (n.children.length ? (
                    n.children.map((id) => byId.get(id) && chapterRow(byId.get(id)!, true))
                  ) : (
                    <div
                      className={`bempty bsub${over?.id === n.id && over.mark === 'into' ? ' over-into' : ''}`}
                      onDragOver={(e) => {
                        if (drag?.type !== 'chapter') return
                        e.preventDefault()
                        setOver({ id: n.id, mark: 'into' })
                        setTarget({ kind: 'into', partId: n.id, at: 'end' })
                      }}
                      onDrop={(e) => {
                        e.preventDefault()
                        drop()
                      }}
                    >
                      חלק ריק. אפשר לגרור לכאן פרקים.
                    </div>
                  ))}
              </div>
            ) : (
              byId.get(n.id) && chapterRow(byId.get(n.id)!, false)
            )
          )}
        </div>
        {drag && hasParts && (
          <div
            className={`bdrop-end${over?.mark === 'end' ? ' on' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setOver({ id: '__end', mark: 'end' })
              setTarget({ kind: 'end' })
            }}
            onDrop={(e) => {
              e.preventDefault()
              drop()
            }}
          >
            לסוף הספר, מחוץ לחלקים
          </div>
        )}
      </div>
      {props.bookmarks}
      <div className="bsec">
        <div className="bhead">חומרי רקע</div>
        <div className="bempty">דפי דמויות, מקומות ומחקר יגיעו בפיצ'ר נפרד.</div>
      </div>
    </nav>
  )
}

export function RenameField({ initial, label, onDone }: { initial: string; label: string; onDone: (t: string | null) => void }) {
  const [v, setV] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const finish = (t: string | null) => {
    if (done.current) return
    done.current = true
    onDone(t)
  }
  return (
    <input
      ref={ref}
      value={v}
      aria-label={label}
      dir="auto"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => finish(v.trim() || null)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(v.trim() || null)
        if (e.key === 'Escape') finish(null)
      }}
    />
  )
}
