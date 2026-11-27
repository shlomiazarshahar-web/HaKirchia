import { Fragment, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { Book, Chapter, PartNode } from '@shared/types'
import { moveNode, updatePart, type Dragged, type DropTarget } from '@shared/outline'
import type { OutlineNode } from '@shared/types'
import { Icon } from './Icons'
import { CHAPTER_DRAG_TYPE, MATERIAL_DRAG_TYPE } from '@shared/panes'
import { KIND_ICON, KIND_LABEL, KIND_NEW, MATERIAL_KINDS, materialsOf, type Material, type MaterialKind } from '@shared/background'
import { MASTER_LABEL } from '../labels'
import { translationProgress } from '@shared/translation'
import { useParagraphCounts } from '../translate'
import { MATTER_KINDS, type MatterPage } from '@shared/publish'
import { LabelDots } from './Labels'

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
  /** Import chapters from a Word manuscript (feature 42) */
  onImport?: () => void
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
  /** Background materials (round 7): what is open now, and what to do */
  openMaterialIds?: string[]
  glossaryOpen?: boolean
  onOpenMaterial?: (id: string) => void
  onNewMaterial?: (kind: MaterialKind) => void
  onOpenGlossary?: () => void
  onMaterialMenu?: (m: Material, x: number, y: number) => void
  /** Renames the book (and its folder) */
  onRenameBook?: (title: string) => void
  /** Opens the front and back pages, at one page or at the list of new pages ('new') */
  onMatter?: (pageId?: string) => void
}

/** Where a drop would land, for drawing the line / highlight */
type Over = { id: string; mark: 'before' | 'after' | 'into' } | { id: '__end'; mark: 'end' }

export function Binder(props: Props) {
  const { book, activeId, masterActive, onMaster, renamingId, onSelect, onAdd, onAddPart, onImport, onStartRename, onOutline } = props
  const [drag, setDrag] = useState<Dragged | null>(null)
  const [over, setOver] = useState<Over | null>(null)
  const [target, setTarget] = useState<DropTarget | null>(null)
  const byId = new Map(book.chapters.map((c) => [c.id, c]))
  const hasParts = book.outline.some((n) => n.type === 'part')
  const paraCounts = useParagraphCounts(book.path)
  /** Translation progress of a chapter that has an original (feature 28) */
  const trOf = (id: string) => (book.sources?.[id] ? translationProgress(paraCounts[id] ?? 1, book.sources[id].paras) : null)

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
    if (ch.noExport) cls.push('noexp')
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
        <LabelDots book={book} chapter={ch} />
        {(() => {
          const tr = trOf(ch.id)
          return tr ? (
            <span className={`trp${tr.percent >= 100 ? ' full' : ''}`} title={`תרגום: ${tr.done} מתוך ${tr.total} פסקאות של המקור`}>
              {tr.percent}%
            </span>
          ) : null
        })()}
        {ch.noExport && (
          <span className="noexp-tag" title="לא בייצוא: לא נכנס למצב קריאה ולשום ייצוא (לחיצה ימנית לשינוי)">
            לא בייצוא
          </span>
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
      <BookTitle title={book.title} onRename={props.onRenameBook} />
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
            {onImport && (
              <button className="ib" title="ייבוא פרקים מקובץ Word ארוך, מחולקים לפי הכותרות" onClick={onImport}>
                <Icon name="import" />
              </button>
            )}
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
      <MatterSection {...props} />
      <MaterialsSection {...props} />
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

const FOLD_KEY = 'hakirchia.binderFolds'
function readFolds(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(FOLD_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function useFolds() {
  const [folds, setFolds] = useState<Record<string, boolean>>(readFolds)
  const toggle = (k: string) => {
    const next = { ...readFolds(), [k]: !folds[k] }
    setFolds(next)
    try {
      localStorage.setItem(FOLD_KEY, JSON.stringify(next))
    } catch {
      /* not remembered */
    }
  }
  return [folds, toggle] as const
}

const matterName = (p: MatterPage) => ((p.kind === 'other' || p.kind === 'thanks' || p.kind === 'about') && p.heading ? p.heading : MATTER_KINDS[p.kind].label)

/** The front and back pages (feature 36): a click opens the page for editing */
function MatterSection(props: Props) {
  const { book } = props
  const [folds, toggle] = useFolds()
  const closed = !!folds.matter
  const pages = book.publish.matter
  const row = (p: MatterPage) => (
    <div key={p.id} className="bitem bsub" role="button" tabIndex={0} title="עריכת העמוד" onClick={() => props.onMatter?.(p.id)} onKeyDown={(e) => e.key === 'Enter' && props.onMatter?.(p.id)}>
      <Icon name="file" />
      <span className="name" dir="auto">
        {matterName(p)}
      </span>
    </div>
  )
  const front = pages.filter((p) => p.where === 'front')
  const back = pages.filter((p) => p.where === 'back')
  return (
    <div className="bsec">
      <div className="bitem bfolder bmatter" role="button" tabIndex={0} aria-expanded={!closed} onClick={() => toggle('matter')} onKeyDown={(e) => e.key === 'Enter' && toggle('matter')}>
        <span className={`chev${closed ? ' closed' : ''}`}>
          <Icon name="chev" size={12} />
        </span>
        <Icon name="book" />
        <span className="name">עמודי פתיחה וסיום</span>
        <span className="count">{pages.length}</span>
        <button className="ib icon addin" title="עמוד חדש: שער, הקדשה, תודות…" aria-label="עמוד חדש" onClick={(e) => (e.stopPropagation(), props.onMatter?.('new'))}>
          <Icon name="plus" size={13} />
        </button>
      </div>
      {!closed && (
        <>
          {front.map(row)}
          {back.length > 0 && <div className="bsub-sep">אחרי הפרקים</div>}
          {back.map(row)}
          {pages.length === 0 && (
            <div className="bitem bsub muted" role="button" tabIndex={0} onClick={() => props.onMatter?.('new')}>
              <span className="name">הוספת שער, הקדשה, תודות…</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** Background pages (feature 11) in groups, and the glossary (feature 20) */
function MaterialsSection(props: Props) {
  const { book } = props
  const [folds, toggle] = useFolds()
  const [menu, setMenu] = useState(false)
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menu])
  const open = new Set(props.openMaterialIds ?? [])
  return (
    <div className="bsec">
      <div className="bhead">
        חומרי רקע
        <span className="bhead-btns">
          <button className="ib" title="דף רקע חדש: דמות, מקום או מחקר" aria-haspopup="menu" aria-expanded={menu} onClick={(e) => (e.stopPropagation(), setMenu(!menu))}>
            <Icon name="plus" />
          </button>
        </span>
        {menu && (
          <div className="menu bmenu" role="menu" onClick={(e) => e.stopPropagation()}>
            {MATERIAL_KINDS.map((k) => (
              <button key={k} role="menuitem" onClick={() => (setMenu(false), props.onNewMaterial?.(k))}>
                <Icon name={KIND_ICON[k]} />
                {KIND_NEW[k]}
              </button>
            ))}
          </div>
        )}
      </div>
      <div
        className={`bitem${props.glossaryOpen ? ' active' : ''}`}
        role="button"
        tabIndex={0}
        title="איך כל מונח ושם נכתב בספר, ומה הוא במקור"
        onClick={() => props.onOpenGlossary?.()}
        onKeyDown={(e) => e.key === 'Enter' && props.onOpenGlossary?.()}
      >
        <Icon name="glossary" />
        <span className="name">מילון מונחים ושמות</span>
        {book.glossary.length > 0 && <span className="count">{book.glossary.length}</span>}
      </div>
      {MATERIAL_KINDS.map((k) => {
        const list = materialsOf(book.materials, k)
        const closed = !!folds[k]
        return (
          <div key={k} className="bgroup" role="group">
            <div className="bitem bfolder" role="button" tabIndex={0} aria-expanded={!closed} onClick={() => toggle(k)} onKeyDown={(e) => e.key === 'Enter' && toggle(k)}>
              <span className={`chev${closed ? ' closed' : ''}`}>
                <Icon name="chev" size={12} />
              </span>
              <Icon name="folder" />
              <span className="name">{KIND_LABEL[k]}</span>
              <span className="count">{list.length}</span>
              <button className="ib icon addin" title={KIND_NEW[k]} aria-label={KIND_NEW[k]} onClick={(e) => (e.stopPropagation(), props.onNewMaterial?.(k))}>
                <Icon name="plus" size={13} />
              </button>
            </div>
            {!closed &&
              list.map((m) => (
                <div
                  key={m.id}
                  className={`bitem bsub${open.has(m.id) ? ' active' : ''}`}
                  role="button"
                  tabIndex={0}
                  draggable
                  title="לחיצה פותחת לצד הפרק. אפשר גם לגרור לחלון"
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'copy'
                    e.dataTransfer.setData(MATERIAL_DRAG_TYPE, m.id)
                    e.dataTransfer.setData('text/plain', m.name)
                  }}
                  onClick={() => props.onOpenMaterial?.(m.id)}
                  onKeyDown={(e) => e.key === 'Enter' && props.onOpenMaterial?.(m.id)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    props.onMaterialMenu?.(m, e.clientX, e.clientY)
                  }}
                >
                  <Icon name={KIND_ICON[k]} />
                  <span className="name" dir="auto">
                    {m.name}
                  </span>
                </div>
              ))}
          </div>
        )
      })}
    </div>
  )
}

/** The book's name at the top of the binder; a click renames it (and its folder) */
function BookTitle({ title, onRename }: { title: string; onRename?: (t: string) => void }) {
  const [editing, setEditing] = useState(false)
  if (editing)
    return (
      <div className="btitle editing">
        <RenameField
          initial={title}
          label="שם הספר"
          onDone={(t) => {
            setEditing(false)
            if (t && t !== title) onRename?.(t)
          }}
        />
      </div>
    )
  return (
    <button className="btitle" title="שינוי שם הספר (גם שם התיקייה שלו משתנה)" onClick={() => setEditing(true)}>
      <span dir="auto">{title}</span>
      <Icon name="rename" size={13} />
    </button>
  )
}
