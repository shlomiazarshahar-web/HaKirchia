import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import type { Book, Chapter, PMNode } from '@shared/types'
import { countWords } from '@shared/docx'
import { api, registerFlusher } from '../api'
import { editorExtensions } from '../editor'
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
        {loaded && <EditorSurface {...props} initial={loaded.doc} warnings={loaded.warnings} />}
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

function EditorSurface({ book, chapter, initial, warnings, autoFocus, onEditor, onWords, onSaveState, onError }: Props & { initial: PMNode; warnings: string[] }) {
  const [readOnly, setReadOnly] = useState(warnings.length > 0)
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef<PMNode>(initial)
  const saving = useRef<Promise<void>>(Promise.resolve())
  const ids = useRef({ bookPath: book.path, chapterId: chapter.id })

  const save = async () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    // Wait for a save already on its way, then save again only if something changed
    await saving.current
    if (!dirty.current) return
    dirty.current = false
    onSaveState('saving')
    const run = (async () => {
      const r = await api.saveChapter(ids.current.bookPath, ids.current.chapterId, latest.current)
      if (!r.ok) {
        dirty.current = true
        onSaveState('error')
        onError(r.error ?? 'השמירה נכשלה')
      } else onSaveState(dirty.current ? 'dirty' : 'saved')
    })()
    saving.current = run
    await run
  }
  const saveRef = useRef(save)
  saveRef.current = save

  const editor = useEditor({
    extensions: editorExtensions,
    content: initial,
    editable: !readOnly,
    autofocus: autoFocus ? 'end' : false,
    editorProps: { attributes: { spellcheck: 'true', 'aria-label': 'טקסט הפרק' } },
    onUpdate: ({ editor }) => {
      latest.current = editor.getJSON() as PMNode
      dirty.current = true
      onSaveState('dirty')
      onWords(countWords(editor.getText({ blockSeparator: '\n' })))
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void saveRef.current(), SAVE_DELAY_MS)
    }
  })

  useEffect(() => {
    if (!editor) return
    onEditor(editor)
    onWords(countWords(editor.getText({ blockSeparator: '\n' })))
    onSaveState('saved')
    const unregister = registerFlusher(() => saveRef.current())
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      unregister()
      onEditor(null)
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
            בקובץ הזה יש דברים שהכריכייה עוד לא יודעת להציג: <b>{warnings.join(', ')}</b>. כדי לא לאבד אותם, הפרק פתוח לקריאה בלבד.
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
