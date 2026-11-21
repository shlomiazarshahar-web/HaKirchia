import { useEffect, useMemo, useRef, useState } from 'react'
import { rankItems, type QuickItem } from '@shared/quickopen'
import { Icon } from './Icons'

export interface QuickEntry extends QuickItem {
  /** chapter, part, bookmark, scene or view: the icon and the small label */
  kind: 'chapter' | 'part' | 'bookmark' | 'scene' | 'view' | 'material'
  run: () => void
}

const KIND_LABEL: Record<QuickEntry['kind'], string> = { chapter: 'פרק', part: 'חלק', bookmark: 'סימנייה', scene: 'סצנה', view: 'תצוגה', material: 'חומרי רקע' }
const KIND_ICON: Record<QuickEntry['kind'], string> = { chapter: 'file', part: 'part', bookmark: 'bookmark', scene: 'scene', view: 'master', material: 'person' }

/** Ctrl+P (feature 33): a box in the middle of the screen; type a few letters, Enter jumps there. */
export function QuickOpen({ entries, onClose }: { entries: QuickEntry[]; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const list = useMemo(() => rankItems(entries, q, 60), [entries, q])
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => setSel(0), [q])
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const pick = (e: QuickEntry | undefined) => {
    if (!e) return
    onClose()
    // after the box is gone, so the editor can take the focus
    setTimeout(e.run, 0)
  }

  return (
    <div className="scrim quick-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="quick" role="dialog" aria-label="מעבר מהיר">
        <div className="quick-in">
          <Icon name="search" />
          <input
            autoFocus
            value={q}
            dir="auto"
            placeholder="לאן לעבור? שם של פרק, חלק או סימנייה…"
            aria-label="לאן לעבור"
            role="combobox"
            aria-expanded="true"
            aria-controls="quick-list"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') e.preventDefault(), setSel((s) => Math.min(list.length - 1, s + 1))
              else if (e.key === 'ArrowUp') e.preventDefault(), setSel((s) => Math.max(0, s - 1))
              else if (e.key === 'Enter') e.preventDefault(), pick(list[sel])
              else if (e.key === 'Escape') e.preventDefault(), onClose()
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="quick-list" id="quick-list" role="listbox" ref={listRef}>
          {list.map((e, i) => (
            <button key={`${e.kind}-${e.id}`} role="option" aria-selected={i === sel} className="quick-item" onMouseMove={() => i !== sel && setSel(i)} onClick={() => pick(e)}>
              <Icon name={KIND_ICON[e.kind]} />
              <span className="qi-label" dir="auto">
                {e.label}
              </span>
              {e.extra && <span className="qi-extra">{e.extra}</span>}
              <span className="qi-kind">{KIND_LABEL[e.kind]}</span>
            </button>
          ))}
          {!list.length && <div className="lp-note quick-empty">לא נמצא. אפשר לחפש בתוך הטקסט עם Ctrl+F.</div>}
        </div>
        <div className="quick-foot">↑↓ לבחירה · Enter למעבר · דמויות ומקומות יצטרפו כשיהיו חומרי רקע</div>
      </div>
    </div>
  )
}
