import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import type { Book, Chapter, PMNode } from '@shared/types'
import { countWords } from '@shared/docx'
import { api, hasLiveTwin, onDiskChange, onLiveEdit, publishLiveEdit, registerFlusher, reportWords, takePendingStop } from '../api'
import { editorExtensions, restoreStop } from '../editor'
import { Icon } from './Icons'

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

interface Props {
  book: Book
  chapter: Chapter
  onEditor: (e: Editor | null) => void
  onWords: (n: number) => void
  onSaveState: (s: SaveState) => void
  onError: (msg: string) => void
  onRename: (title: string) => void
  /** false right after adding a chapter, so the name field in the list keeps the focus */
  autoFocus: boolean
  /** 'focus' when other editors are on screen too (split screen): active while focused */
  activateOn?: 'mount' | 'focus'
  onRelease?: (e: Editor) => void
}

const SAVE_DELAY_MS = 800

/** Loads one chapter file, then shows the editor. Remounted (key) for every chapter. */
export function ChapterEditor(props: Props) {
  const { book, chapter } = props
  const [loaded, setLoaded] = useState<{ doc: PMNode; warnings: string[] } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api.loadChapter(book.path, chapter.id).then((r) => {
      if (!alive) return
      if (r.ok && r.value) setLoaded(r.value)
      else setLoadError(r.error ?? 'שגיאה בפתיחת הפרק')
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.path, chapter.id])

  return (
    <main className="desk">
      <article className="paper">
        <div className="docfile">
          <Icon name="file" />
          <span className="fname">{chapter.file}</span>
        </div>
        <TitleInput title={chapter.title} onRename={props.onRename} />
        {loadError && <div className="paper-state">לא הצלחתי לפתוח את הקובץ: {loadError}</div>}
        {!loaded && !loadError && <div className="paper-state">פותח את הפרק…</div>}
        {loaded && (
          <ChapterBody
            bookPath={book.path}
            chapterId={chapter.id}
            initial={loaded.doc}
            warnings={loaded.warnings}
            autoFocus={props.autoFocus}
            activateOn={props.activateOn ?? 'mount'}
            onEditor={props.onEditor}
            onRelease={props.onRelease}
            onWords={props.onWords}
            onSaveState={props.onSaveState}
            onError={props.onError}
          />
        )}
      </article>
    </main>
  )
}

function TitleInput({ title, onRename }: { title: string; onRename: (t: string) => void }) {
  const [value, setValue] = useState(title)
  useEffect(() => setValue(title), [title])
  const commit = () => {
    const t = value.trim()
    if (!t) setValue(title)
    else if (t !== title) onRename(t)
  }
  return (
    <input
      className="ch-title"
      value={value}
      aria-label="שם הפרק"
      placeholder="שם הפרק"
      dir="auto"
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setValue(title)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

export interface BodyProps {
  bookPath: string
  chapterId: string
  initial: PMNode
  warnings: string[]
  autoFocus: boolean
  /** 'mount': this is the only editor on screen. 'focus': one of many (master), active while focused. */
  activateOn: 'mount' | 'focus'
  onEditor: (e: Editor | null) => void
  /** focus mode: this editor is going away (chapter deleted, master closed) */
  onRelease?: (e: Editor) => void
  onWords: (n: number) => void
  onSaveState: (s: SaveState) => void
  onError: (msg: string) => void
}

/**
 * The text of one chapter, saved automatically to its .docx file. Used by the writing view and,
 * once per chapter, by the master. Reloads itself when the file changes outside the app.
 */
export function ChapterBody({ bookPath, chapterId, initial, warnings, autoFocus, activateOn, onEditor, onRelease, onWords, onSaveState, onError }: BodyProps) {
  const [readOnly, setReadOnly] = useState(warnings.length > 0)
  const [warn, setWarn] = useState(warnings)
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef<PMNode>(initial)
  const saving = useRef<Promise<void>>(Promise.resolve())
  const ids = useRef({ bookPath, chapterId })
  const me = useRef(Symbol('editor'))
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cb = useRef({ onEditor, onRelease, onWords, onSaveState, onError })
  cb.current = { onEditor, onRelease, onWords, onSaveState, onError }

  const save = async () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    // Wait for a save already on its way, then save again only if something changed
    await saving.current
    if (!dirty.current) return
    dirty.current = false
    cb.current.onSaveState('saving')
    const run = (async () => {
      const r = await api.saveChapter(ids.current.bookPath, ids.current.chapterId, latest.current)
      if (!r.ok) {
        dirty.current = true
        cb.current.onSaveState('error')
        cb.current.onError(r.error ?? 'השמירה נכשלה')
      } else cb.current.onSaveState(dirty.current ? 'dirty' : 'saved')
    })()
    saving.current = run
    await run
  }
  const saveRef = useRef(save)
  saveRef.current = save

  const words = (e: Editor) => {
    const n = countWords(e.getText({ blockSeparator: '\n' }))
    reportWords(ids.current.bookPath, ids.current.chapterId, n)
    return n
  }

  /** Passes the text on to other editors of the same chapter (split screen) */
  const publishLive = () => {
    if (liveTimer.current) clearTimeout(liveTimer.current)
    liveTimer.current = null
    publishLiveEdit(ids.current.bookPath, ids.current.chapterId, latest.current, me.current)
  }

  const editor = useEditor({
    extensions: editorExtensions,
    content: initial,
    editable: !readOnly,
    autofocus: autoFocus ? 'end' : false,
    editorProps: { attributes: { spellcheck: 'true', 'aria-label': 'טקסט הפרק' } },
    onFocus: ({ editor }) => {
      if (activateOn === 'focus') cb.current.onEditor(editor)
    },
    onBlur: () => {
      if (liveTimer.current) publishLive()
    },
    onUpdate: ({ editor, transaction }) => {
      // TipTap also reports an "update" with no real change when the editor starts; ignoring it
      // keeps a chapter from being re-saved (and a Word file rewritten) just by opening it
      if (!transaction.docChanged || transaction.getMeta('liveSync')) return
      latest.current = editor.getJSON() as PMNode
      if (hasLiveTwin(ids.current.bookPath, ids.current.chapterId)) {
        if (liveTimer.current) clearTimeout(liveTimer.current)
        liveTimer.current = setTimeout(publishLive, 150)
      }
      dirty.current = true
      cb.current.onSaveState('dirty')
      cb.current.onWords(words(editor))
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void saveRef.current(), SAVE_DELAY_MS)
    }
  })

  useEffect(() => {
    if (!editor) return
    if (activateOn === 'mount') cb.current.onEditor(editor)
    cb.current.onWords(words(editor))
    cb.current.onSaveState('saved')
    // The book opened where the writer stopped: the cursor goes back to that spot
    const stop = takePendingStop(ids.current.bookPath, ids.current.chapterId)
    if (stop) setTimeout(() => !editor.isDestroyed && restoreStop(editor, stop), 60)
    const unregister = registerFlusher(() => saveRef.current())
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    // The file was changed outside the app: show the new text, unless there is unsaved typing here
    const stopListening = onDiskChange(ids.current.bookPath, ids.current.chapterId, async () => {
      await saving.current
      if (editor.isDestroyed) return
      if (dirty.current) {
        cb.current.onError('קובץ הפרק השתנה מחוץ לכריכייה בזמן שהקלדת כאן. הטקסט שעל המסך יישמר ויחליף את השינוי החיצוני.')
        return
      }
      const r = await api.loadChapter(ids.current.bookPath, ids.current.chapterId)
      if (!r.ok || !r.value || dirty.current || editor.isDestroyed) return
      latest.current = r.value.doc
      editor.commands.setContent(r.value.doc, { emitUpdate: false })
      cb.current.onWords(words(editor))
      setWarn(r.value.warnings)
      if (r.value.warnings.length) setReadOnly(true)
    })
    // The same chapter was typed in somewhere else on screen: show that text here too
    const stopLive = onLiveEdit(ids.current.bookPath, ids.current.chapterId, (doc, from) => {
      if (from === me.current || editor.isDestroyed) return
      try {
        const content = editor.schema.nodeFromJSON(doc).content
        const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, content)
        tr.setMeta('addToHistory', false).setMeta('liveSync', true).setMeta('preventUpdate', true)
        editor.view.dispatch(tr)
        latest.current = doc
        cb.current.onWords(words(editor))
      } catch {
        /* a malformed document is ignored; this editor keeps its text */
      }
    })
    return () => {
      if (liveTimer.current) publishLive()
      stopLive()
      stopListening()
      window.removeEventListener('keydown', onKey)
      unregister()
      if (activateOn === 'mount') cb.current.onEditor(null)
      else cb.current.onRelease?.(editor)
      void saveRef.current()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  useEffect(() => {
    editor?.setEditable(!readOnly)
  }, [editor, readOnly])

  return (
    <>
      {readOnly && (
        <div className="warnbanner" role="alert">
          <div>
            בקובץ הזה יש דברים שהכריכייה עוד לא יודעת להציג: <b>{warn.join(', ')}</b>. כדי לא לאבד אותם, הפרק פתוח לקריאה בלבד.
          </div>
          <div className="row">
            <button className="btn ghost" onClick={() => setReadOnly(false)}>
              לערוך בכל זאת
            </button>
          </div>
          <div className="lp-note">אם עורכים, עותק של הקובץ המקורי יישמר קודם בתיקייה "גיבוי קבצים מקוריים" שבתיקיית הספר.</div>
        </div>
      )}
      <div className="prose">
        <EditorContent editor={editor} style={{ display: 'contents' }} />
      </div>
    </>
  )
}
