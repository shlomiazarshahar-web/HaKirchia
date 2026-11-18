import { useEffect, useRef, useState } from 'react'
import type { Book, Chapter, ChapterStatus } from '@shared/types'
import { STATUS_LABELS } from '@shared/types'
import { CHAPTERS_DIR } from '@shared/constants'
import { AltsSection, NotesSection, VersionsSection, type DraftsContext } from './Drafts'

interface Props {
  book: Book
  chapter: Chapter
  onMeta: (id: string, meta: { status?: ChapterStatus; synopsis?: string }) => void
  onShowFile: () => void
  /** versions, notes and alternative drafts of the chapter (round 4) */
  drafts: Omit<DraftsContext, 'book' | 'chapter'>
  /** a note just added from the keyboard: its field gets the focus */
  focusNote?: string | null
}

export function Inspector({ book, chapter, onMeta, onShowFile, drafts, focusNote }: Props) {
  const [syn, setSyn] = useState(chapter.synopsis)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<string | null>(null)

  // Synopsis saves itself shortly after typing stops, and when leaving the chapter
  useEffect(() => {
    setSyn(chapter.synopsis)
    const id = chapter.id
    return () => {
      if (timer.current) clearTimeout(timer.current)
      if (pending.current !== null) onMeta(id, { synopsis: pending.current })
      pending.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter.id])

  const sep = book.path.includes('\\') ? '\\' : '/'
  return (
    <aside className="insp" aria-label="פרטי הפרק">
      <div className="isec">
        <h3>על הפרק</h3>
        <label className="field">
          סטטוס
          <select value={chapter.status} onChange={(e) => onMeta(chapter.id, { status: e.target.value as ChapterStatus })}>
            {(Object.keys(STATUS_LABELS) as ChapterStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          תקציר (מופיע בלוח השעם)
          <textarea
            value={syn}
            dir="auto"
            onChange={(e) => {
              const v = e.target.value
              setSyn(v)
              pending.current = v
              if (timer.current) clearTimeout(timer.current)
              timer.current = setTimeout(() => {
                pending.current = null
                onMeta(chapter.id, { synopsis: v })
              }, 700)
            }}
          />
        </label>
        <div className="field">
          קובץ
          <span className="mono">{[book.path, CHAPTERS_DIR, chapter.file].join(sep)}</span>
          <button className="btn ghost" onClick={onShowFile}>
            הצגה בתיקייה
          </button>
        </div>
      </div>
      <NotesSection book={book} chapter={chapter} {...drafts} focusNote={focusNote} />
      <VersionsSection book={book} chapter={chapter} {...drafts} />
      <AltsSection book={book} chapter={chapter} {...drafts} />
    </aside>
  )
}
