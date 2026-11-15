import { useEffect, useRef, useState } from 'react'
import type { Book, Chapter } from '@shared/types'
import { Icon } from './Icons'

interface Props {
  book: Book
  activeId: string | null
  masterActive: boolean
  onMaster: () => void
  renamingId: string | null
  onSelect: (id: string) => void
  onAdd: () => void
  onRename: (id: string, title: string) => void
  onStartRename: (id: string | null) => void
  onReorder: (ids: string[]) => void
  onContextMenu: (ch: Chapter, x: number, y: number) => void
}

export function Binder({ book, activeId, masterActive, onMaster, renamingId, onSelect, onAdd, onRename, onStartRename, onReorder, onContextMenu }: Props) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null)

  const drop = () => {
    if (!dragId || !over || dragId === over.id) return reset()
    const ids = book.chapters.map((c) => c.id).filter((id) => id !== dragId)
    let idx = ids.indexOf(over.id)
    if (over.after) idx += 1
    ids.splice(idx, 0, dragId)
    reset()
    if (ids.join() !== book.chapters.map((c) => c.id).join()) onReorder(ids)
  }
  const reset = () => {
    setDragId(null)
    setOver(null)
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
          <span className="name">{book.title} · מאסטר</span>
        </div>
      </div>
      <div className="bsec">
        <div className="bhead">
          כתב היד
          <button className="ib" title="פרק חדש" onClick={onAdd}>
            <Icon name="plus" />
          </button>
        </div>
        {book.chapters.length === 0 && <div className="bempty">אין עדיין פרקים. הפלוס למעלה מוסיף פרק.</div>}
        {book.chapters.map((ch) => {
          const cls = ['bitem']
          if (ch.id === activeId && !masterActive) cls.push('active')
          if (ch.id === dragId) cls.push('dragging')
          if (over?.id === ch.id && dragId !== ch.id) cls.push(over.after ? 'over-after' : 'over-before')
          return (
            <div
              key={ch.id}
              className={cls.join(' ')}
              role="button"
              tabIndex={0}
              aria-current={ch.id === activeId && !masterActive ? 'page' : undefined}
              draggable={renamingId !== ch.id}
              title={ch.file}
              onClick={() => onSelect(ch.id)}
              onDoubleClick={() => onStartRename(ch.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSelect(ch.id)
                if (e.key === 'F2') onStartRename(ch.id)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                onContextMenu(ch, e.clientX, e.clientY)
              }}
              onDragStart={(e) => {
                setDragId(ch.id)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', ch.id)
              }}
              onDragOver={(e) => {
                if (!dragId) return
                e.preventDefault()
                const r = e.currentTarget.getBoundingClientRect()
                setOver({ id: ch.id, after: e.clientY > r.top + r.height / 2 })
              }}
              onDrop={(e) => {
                e.preventDefault()
                drop()
              }}
              onDragEnd={reset}
            >
              <span className="grip" aria-hidden="true">
                ⋮⋮
              </span>
              <i className={`dot st-${ch.status}`} />
              {renamingId === ch.id ? (
                <RenameField
                  initial={ch.title}
                  onDone={(t) => {
                    onStartRename(null)
                    if (t && t !== ch.title) onRename(ch.id, t)
                  }}
                />
              ) : (
                <span className="name">{ch.title}</span>
              )}
            </div>
          )
        })}
      </div>
      <div className="bsec">
        <div className="bhead">חומרי רקע</div>
        <div className="bempty">דפי דמויות, מקומות ומחקר יגיעו בפיצ'ר נפרד.</div>
      </div>
    </nav>
  )
}

function RenameField({ initial, onDone }: { initial: string; onDone: (t: string | null) => void }) {
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
      aria-label="שם הפרק"
      dir="auto"
      onClick={(e) => e.stopPropagation()}
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
