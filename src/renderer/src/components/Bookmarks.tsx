import { useMemo, useState } from 'react'
import type { Editor } from '@tiptap/react'
import type { Book, Bookmark } from '@shared/types'
import { bookmarkText, renameBookmark } from '../nav'
import { Popover } from './HebrewTools'
import { Icon } from './Icons'

/** Right after adding a bookmark: a small box at the cursor to say what to come back for. */
export function BookmarkNamer({ editor, bookmark, onClose }: { editor: Editor; bookmark: Bookmark; onClose: () => void }) {
  const [v, setV] = useState(bookmark.label)
  const at = useMemo(() => {
    try {
      const c = editor.view.coordsAtPos(editor.state.selection.head)
      return { x: c.left, y: c.bottom }
    } catch {
      return { x: window.innerWidth / 2, y: 140 }
    }
  }, [editor])
  const done = (save: boolean) => {
    if (save && v.trim() !== bookmark.label) renameBookmark(bookmark.id, v)
    onClose()
    editor.commands.focus()
  }
  return (
    <Popover anchor={null} at={at} label="סימנייה חדשה" width={320} onClose={() => done(true)}>
      <div className="bm-namer">
        <div className="lp-h">
          <Icon name="bookmark" /> נוספה סימנייה
        </div>
        <input
          autoFocus
          value={v}
          dir="auto"
          placeholder="על מה לחזור לכאן? (לא חובה)"
          aria-label="שם הסימנייה"
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.preventDefault(), done(true)
            if (e.key === 'Escape') e.preventDefault(), e.stopPropagation(), done(false)
          }}
        />
        <div className="lp-note">Enter שומר. הסימנייה מופיעה ברשימה שבעמודה הימנית וב־Ctrl+P. Ctrl+Shift+ל באותו מקום מסירה אותה.</div>
      </div>
    </Popover>
  )
}

/** The list of the book's bookmarks, at the bottom of the binder. */
export function BookmarkList({ book, list, onGo, onRemove }: { book: Book; list: Bookmark[]; onGo: (b: Bookmark) => void; onRemove: (b: Bookmark) => void }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [val, setVal] = useState('')
  const titles = new Map(book.chapters.map((c) => [c.id, c.title]))
  const shown = list.filter((b) => titles.has(b.chapterId))
  return (
    <div className="bsec bmarks" role="group" aria-label="סימניות">
      <div className="bhead">
        <span>סימניות{shown.length ? ` (${shown.length})` : ''}</span>
      </div>
      {!shown.length && <div className="lp-note bm-empty">Ctrl+Shift+ל מסמן מקום בטקסט לחזור אליו.</div>}
      {shown.map((b) =>
        editing === b.id ? (
          <input
            key={b.id}
            className="rename"
            autoFocus
            value={val}
            dir="auto"
            placeholder="על מה לחזור לכאן?"
            aria-label="שם הסימנייה"
            onChange={(e) => setVal(e.target.value)}
            onBlur={() => (renameBookmark(b.id, val), setEditing(null))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setEditing(null)
            }}
          />
        ) : (
          <div
            key={b.id}
            className="bitem bm-item"
            role="button"
            tabIndex={0}
            title={`${titles.get(b.chapterId)} · לחיצה כפולה לשינוי השם`}
            onClick={() => onGo(b)}
            onDoubleClick={() => (setEditing(b.id), setVal(b.label))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onGo(b)
              if (e.key === 'F2') setEditing(b.id), setVal(b.label)
              if (e.key === 'Delete') onRemove(b)
            }}
          >
            <Icon name="bookmark" />
            <span className="bm-text">
              <span className={b.label ? '' : 'bm-ctx'} dir="auto">
                {bookmarkText(b)}
              </span>
              <small>{titles.get(b.chapterId)}</small>
            </span>
            <button
              className="ib icon bm-x"
              title="הסרת הסימנייה"
              aria-label="הסרת הסימנייה"
              onClick={(e) => {
                e.stopPropagation()
                onRemove(b)
              }}
            >
              <Icon name="close" />
            </button>
          </div>
        )
      )}
    </div>
  )
}
