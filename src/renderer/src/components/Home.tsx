import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RecentBook } from '@shared/types'
import { Icon } from './Icons'
import { RenameField } from './Binder'
import wordmark from '../assets/wordmark.svg'
import { UpdateStatus } from './Update'

const COVER_COLORS = ['#0F3B33', '#6B2E3A', '#2D3F63', '#5A4A2A', '#3E2F57', '#2F5A4E']

function coverColor(path: string): string {
  let h = 0
  for (const ch of path) h = (h * 31 + ch.charCodeAt(0)) | 0
  return COVER_COLORS[Math.abs(h) % COVER_COLORS.length]
}

function when(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const time = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === today.toDateString()) return `נפתח היום ב־${time}`
  const y = new Date(today)
  y.setDate(today.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return 'נפתח אתמול'
  return `נפתח ב־${d.getDate()}.${d.getMonth() + 1}`
}

interface Props {
  books: RecentBook[]
  onOpen: (path: string) => void
  onNew: () => void
  onOpenFolder: () => void
  /** A new book from an existing manuscript in Word (feature 42) */
  onImport: () => void
  onForget: (path: string) => void
  onRename: (path: string, title: string) => void
  onArchive: (path: string, archived: boolean) => void
}

const ARCH_KEY = 'hakirchia.archiveOpen'

export function Home({ books, onOpen, onNew, onOpenFolder, onImport, onForget, onRename, onArchive }: Props) {
  const [menu, setMenu] = useState<{ book: RecentBook; x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [archOpen, setArchOpen] = useState(() => {
    try {
      return localStorage.getItem(ARCH_KEY) === '1'
    } catch {
      return false
    }
  })
  const menuRef = useRef<HTMLDivElement>(null)
  // RTL: the menu opens to the left of the pointer, and stays inside the window.
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!menu || !el) return
    const { width, height } = el.getBoundingClientRect()
    const left = menu.x - width >= 8 ? menu.x - width : Math.min(menu.x, window.innerWidth - width - 8)
    const top = Math.min(menu.y, window.innerHeight - height - 8)
    el.style.left = `${Math.max(8, left)}px`
    el.style.top = `${Math.max(8, top)}px`
    el.style.visibility = 'visible'
  }, [menu])
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    return () => (window.removeEventListener('click', close), window.removeEventListener('blur', close))
  }, [menu])
  const toggleArch = () => {
    setArchOpen(!archOpen)
    try {
      localStorage.setItem(ARCH_KEY, archOpen ? '0' : '1')
    } catch {
      /* not remembered */
    }
  }
  const shelf = books.filter((b) => !b.archived)
  const archived = books.filter((b) => b.archived)
  const card = (b: RecentBook) => (
    <div key={b.path} className={`book${b.exists ? '' : ' missing'}${b.archived ? ' archived' : ''}`}>
      <button
        className="book-btn"
        title={`${b.path}\nקליק ימני: שינוי שם, ארכוב`}
        onClick={() => (b.exists ? onOpen(b.path) : onForget(b.path))}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setMenu({ book: b, x: e.clientX, y: e.clientY })
        }}
      >
        <div className="cover" style={{ backgroundColor: coverColor(b.path) }}>
          <div>
            <div className="ct">{b.title}</div>
            <div className="band" />
          </div>
          <div className="cs">{b.chapterCount} פרקים</div>
        </div>
      </button>
      <div className="meta">
        {renaming === b.path ? (
          <RenameField
            initial={b.title}
            label="שם הספר"
            onDone={(t) => {
              setRenaming(null)
              if (t && t !== b.title) onRename(b.path, t)
            }}
          />
        ) : (
          <b>{b.title}</b>
        )}
        {b.exists ? when(b.lastOpened) : 'התיקייה לא נמצאה. לחיצה תסיר מהרשימה'}
      </div>
    </div>
  )
  return (
    <section className="home">
      <img className="wordmark" src={wordmark} alt="הַכְּרִיכִיָּה" />
      <div className="app-version">גרסה {__APP_VERSION__}</div>
      <UpdateStatus />
      <div className="hhead">
        <h2>הספרים שלי</h2>
        <span className="grow" />
        <button className="btn ghost" title="ספר חדש מקובץ Word ארוך (למשל ספר שהורד מגוגל דוקס), מחולק לפרקים לפי הכותרות" onClick={onImport}>
          ייבוא כתב יד מ־Word
        </button>
        <button className="btn ghost" onClick={onOpenFolder}>
          פתיחת תיקיית ספר קיימת
        </button>
      </div>
      {books.length === 0 && (
        <div className="welcome">
          ברוכים הבאים ל<b>הכריכייה</b>. כל ספר הוא תיקייה במחשב, וכל פרק בו הוא קובץ Word נפרד בתוך התיקייה "פרקים". אפשר להתחיל ב<b>ספר חדש</b>.
        </div>
      )}
      <div className="shelf">
        {shelf.map(card)}
        <button className="book new" onClick={onNew}>
          <div className="cover">
            <Icon name="plus" size={28} />
            <span>ספר חדש</span>
          </div>
          <div className="meta">
            <b>&nbsp;</b>תיקייה חדשה עם פרק ראשון
          </div>
        </button>
      </div>
      {archived.length > 0 && (
        <div className="archive">
          <button className="ib arch-toggle" aria-expanded={archOpen} onClick={toggleArch}>
            <span className={`chev${archOpen ? '' : ' closed'}`}>
              <Icon name="chev" size={12} />
            </span>
            ארכיון <span className="count">{archived.length}</span>
          </button>
          {archOpen && <div className="shelf">{archived.map(card)}</div>}
        </div>
      )}
      {menu && (
        <div ref={menuRef} className="menu" role="menu" style={{ position: 'fixed', left: menu.x, top: menu.y, visibility: 'hidden' }} onClick={(e) => e.stopPropagation()}>
          {menu.book.exists && (
            <button role="menuitem" onClick={() => (setMenu(null), onOpen(menu.book.path))}>
              <Icon name="book" /> פתיחה
            </button>
          )}
          {menu.book.exists && (
            <button role="menuitem" onClick={() => (setMenu(null), setRenaming(menu.book.path))}>
              <Icon name="rename" /> שינוי שם (גם שם התיקייה)
            </button>
          )}
          <button role="menuitem" onClick={() => (setMenu(null), onArchive(menu.book.path, !menu.book.archived))}>
            <Icon name="folder" /> {menu.book.archived ? 'החזרה מהארכיון למדף' : 'העברה לארכיון'}
          </button>
          <button role="menuitem" onClick={() => (setMenu(null), onForget(menu.book.path))}>
            <Icon name="close" /> הסרה מהרשימה (הקבצים נשארים)
          </button>
        </div>
      )}
    </section>
  )
}
