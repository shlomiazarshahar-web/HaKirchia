import type { RecentBook } from '@shared/types'
import { Icon } from './Icons'
import wordmark from '../assets/wordmark.svg'

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
  onForget: (path: string) => void
}

export function Home({ books, onOpen, onNew, onOpenFolder, onForget }: Props) {
  return (
    <section className="home">
      <img className="wordmark" src={wordmark} alt="הַכְּרִיכִיָּה" />
      <div className="hhead">
        <h2>הספרים שלי</h2>
        <span className="grow" />
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
        {books.map((b) => (
          <button
            key={b.path}
            className={`book${b.exists ? '' : ' missing'}`}
            title={b.path}
            onClick={() => (b.exists ? onOpen(b.path) : onForget(b.path))}
          >
            <div className="cover" style={{ backgroundColor: coverColor(b.path) }}>
              <div>
                <div className="ct">{b.title}</div>
                <div className="band" />
              </div>
              <div className="cs">{b.chapterCount} פרקים</div>
            </div>
            <div className="meta">
              <b>{b.title}</b>
              {b.exists ? when(b.lastOpened) : 'התיקייה לא נמצאה. לחיצה תסיר מהרשימה'}
            </div>
          </button>
        ))}
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
    </section>
  )
}
