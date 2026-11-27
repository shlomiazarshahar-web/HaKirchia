import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import type { Book, Chapter, PMNode } from '@shared/types'
import { api } from '../api'
import { isEmptyChapter } from '@shared/bookhtml'
import { ChapterBody, type SaveState } from './ChapterEditor'
import { Icon } from './Icons'

interface Props {
  book: Book
  onEditor: (e: Editor | null) => void
  onRelease: (e: Editor) => void
  onFocusChapter: (id: string) => void
  onOpenChapter: (id: string) => void
  onWords: (total: number) => void
  onSaveState: (s: SaveState) => void
  onError: (msg: string) => void
}

const WORST: SaveState[] = ['error', 'saving', 'dirty', 'saved']

/**
 * The master: every chapter file of the book, one after the other, in the order of the binder.
 * Nothing is copied: each section is an editor of the chapter's own .docx file, so typing here
 * saves into that file, and the master always shows what the files contain right now.
 */
export function MasterView({ book, onEditor, onRelease, onFocusChapter, onOpenChapter, onWords, onSaveState, onError }: Props) {
  const hint = useFirstTimeHint('hk.masterHintSeen')
  const words = useRef(new Map<string, number>())
  const states = useRef(new Map<string, SaveState>())

  // Forget chapters that were deleted
  useEffect(() => {
    const ids = new Set(book.chapters.map((c) => c.id))
    for (const m of [words.current, states.current] as Map<string, unknown>[]) for (const k of [...m.keys()]) if (!ids.has(k)) m.delete(k)
    report()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.chapters])

  const byId = new Map(book.chapters.map((c) => [c.id, c]))

  const report = () => {
    onWords([...words.current.values()].reduce((a, b) => a + b, 0))
    const all = [...states.current.values()]
    onSaveState(WORST.find((s) => all.includes(s)) ?? 'saved')
  }

  return (
    <main className="desk" id="master-desk">
      <article className="paper master">
        {hint && (
          <div className={`masterbanner${hint === 'fading' ? ' fading' : ''}`} role="note">
            <Icon name="link" />
            <span>
              כאן מוצגים כל <b>{book.chapters.length}</b> קובצי הפרקים ברצף, לפי הסדר בעץ. אפשר לערוך כאן, והשינוי נשמר מיד בקובץ הפרק המתאים.
            </span>
          </div>
        )}
        {book.chapters.length === 0 && <div className="paper-state">אין עדיין פרקים בספר הזה.</div>}
        {book.outline.flatMap((n) => {
          if (n.type !== 'part') return [chapterSection(n.id)]
          return [
            <header key={`p-${n.id}`} className="m-part" id={`m-${n.id}`}>
              <div className="lbl">חלק</div>
              <h1 dir="auto">{n.title}</h1>
              {n.children.length === 0 && <div className="empty">אין עדיין פרקים בחלק הזה</div>}
            </header>,
            ...n.children.map(chapterSection)
          ]
        })}
      </article>
    </main>
  )

  function chapterSection(id: string) {
    const ch = byId.get(id)
    if (!ch) return null
    return (
          <MasterChapter
            key={ch.id}
            bookPath={book.path}
            chapter={ch}
            onEditor={onEditor}
            onRelease={onRelease}
            onFocus={() => onFocusChapter(ch.id)}
            onOpen={() => onOpenChapter(ch.id)}
            onWords={(n) => {
              words.current.set(ch.id, n)
              report()
            }}
            onSaveState={(s) => {
              states.current.set(ch.id, s)
              report()
            }}
            onError={onError}
          />
    )
  }
}

/**
 * An explanation shown only the first time: visible for 10 seconds, then fades out.
 * Remembered in this computer's local storage.
 */
function useFirstTimeHint(storageKey: string): 'on' | 'fading' | null {
  const [state, setState] = useState<'on' | 'fading' | null>(() => {
    try {
      return localStorage.getItem(storageKey) ? null : 'on'
    } catch {
      return null
    }
  })
  useEffect(() => {
    if (state !== 'on') return
    try {
      localStorage.setItem(storageKey, '1')
    } catch {
      /* not remembered; it will show again next time */
    }
    const t1 = setTimeout(() => setState('fading'), 10000)
    const t2 = setTimeout(() => setState(null), 10600)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return state
}

interface ChapterProps {
  bookPath: string
  chapter: Chapter
  onEditor: (e: Editor | null) => void
  onRelease: (e: Editor) => void
  onFocus: () => void
  onOpen: () => void
  onWords: (n: number) => void
  onSaveState: (s: SaveState) => void
  onError: (msg: string) => void
}

function MasterChapter({ bookPath, chapter, onEditor, onRelease, onFocus, onOpen, onWords, onSaveState, onError }: ChapterProps) {
  const [loaded, setLoaded] = useState<{ doc: PMNode; warnings: string[] } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api.loadChapter(bookPath, chapter.id).then((r) => {
      if (!alive) return
      if (r.ok && r.value) setLoaded(r.value)
      else setLoadError(r.error ?? 'שגיאה בפתיחת הפרק')
    })
    return () => {
      alive = false
    }
  }, [bookPath, chapter.id])

  // a planned chapter with no text yet is not shown here (feature 66); it is opened from the binder
  if (loaded && isEmptyChapter(loaded.doc)) return null

  return (
    <section className="m-ch" id={`m-${chapter.id}`} onFocus={onFocus}>
      <div className="m-bound">
        <span className="chip" title="הקובץ שאליו נשמר הטקסט של הפרק הזה">
          <Icon name="file" />
          <span className="fname">{chapter.file}</span>
        </span>
        <button onClick={onOpen}>פתיחת הפרק</button>
      </div>
      <h2 dir="auto">{chapter.title}</h2>
      {loadError && <div className="paper-state">לא הצלחתי לפתוח את הקובץ: {loadError}</div>}
      {!loaded && !loadError && <div className="m-loading">פותח…</div>}
      {loaded && (
        <ChapterBody
          bookPath={bookPath}
          chapterId={chapter.id}
          title={chapter.title}
          initial={loaded.doc}
          warnings={loaded.warnings}
          autoFocus={false}
          activateOn="focus"
          onEditor={onEditor}
          onRelease={onRelease}
          onWords={onWords}
          onSaveState={onSaveState}
          onError={onError}
        />
      )}
    </section>
  )
}
