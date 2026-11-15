import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import type { Book, Chapter, ChapterStatus, OpResult, RecentBook, Theme } from '@shared/types'
import { CHAPTERS_DIR } from '@shared/constants'
import { api, flushAll } from './api'
import { IconSprite, Icon } from './components/Icons'
import { Home } from './components/Home'
import { Binder } from './components/Binder'
import { ChapterEditor, type SaveState } from './components/ChapterEditor'
import { MasterView } from './components/MasterView'
import { FormatBar } from './components/FormatBar'
import { Inspector } from './components/Inspector'
import { ConfirmDialog, NewBookDialog } from './components/Dialogs'
import appIcon from './assets/icon.png'

type Toast = { text: string; error?: boolean } | null
type Dialog = { kind: 'newBook' } | { kind: 'delete'; chapter: Chapter } | null
type Menu = { chapter: Chapter; x: number; y: number } | null
type View = 'write' | 'master'

const SAVE_LABEL: Record<SaveState, string> = { saved: 'נשמר', dirty: 'יש שינויים…', saving: 'שומר…', error: 'השמירה נכשלה' }

export default function App() {
  const [theme, setTheme] = useState<Theme>('light')
  const [books, setBooks] = useState<RecentBook[]>([])
  const [book, setBook] = useState<Book | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [view, setView] = useState<View>('write')
  /** In the master: the chapter being edited (shown in the inspector and status bar) */
  const [masterFocusId, setMasterFocusId] = useState<string | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [words, setWords] = useState(0)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [toast, setToast] = useState<Toast>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [menu, setMenu] = useState<Menu>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const lastChapter = useRef<Record<string, string>>({})
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback((text: string, error = false) => {
    setToast({ text, error })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), error ? 9000 : 5000)
  }, [])

  const refreshLibrary = useCallback(() => api.listLibrary().then(setBooks), [])

  useEffect(() => {
    api.getSettings().then((s) => {
      setTheme(s.theme)
      lastChapter.current = s.lastChapter ?? {}
    })
    void refreshLibrary()
    api.onFlushBeforeClose(flushAll)
  }, [refreshLibrary])

  /** Applies a result that returns the updated book; shows errors and notices. */
  const applyBook = (r: OpResult<Book>): Book | null => {
    if (!r.ok || !r.value) {
      show(r.error ?? 'משהו השתבש', true)
      return null
    }
    setBook(r.value)
    if (r.notice) show(r.notice, true)
    return r.value
  }

  const enterBook = (b: Book) => {
    setBook(b)
    setView('write')
    setMasterFocusId(null)
    const last = lastChapter.current[b.path]
    setActiveId(b.chapters.some((c) => c.id === last) ? last : (b.chapters[0]?.id ?? null))
  }

  const openBook = async (path: string) => {
    await flushAll()
    const r = await api.openBook(path)
    if (!r.ok || !r.value) return show(r.error ?? 'לא הצלחתי לפתוח את הספר', true)
    enterBook(r.value)
  }

  const openFolder = async () => {
    const p = await api.chooseFolder('open')
    if (p) await openBook(p)
  }

  const goHome = async () => {
    await flushAll()
    setBook(null)
    setActiveId(null)
    void refreshLibrary()
  }

  const switchView = async (v: View) => {
    if (v === view) return
    // Save everything first, so the other view reads the files exactly as they are now
    await flushAll()
    setEditor(null)
    setMasterFocusId(null)
    setView(v)
  }

  /** From the master: open one chapter in the writing view */
  const openChapter = async (id: string) => {
    if (!book) return
    await flushAll()
    setEditor(null)
    setView('write')
    setActiveId(id)
    lastChapter.current[book.path] = id
    void api.setLastChapter(book.path, id)
  }

  const selectChapter = async (id: string) => {
    if (!book) return
    if (view === 'master') {
      // In the master, a chapter in the binder jumps to its place in the text
      document.getElementById(`m-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setMasterFocusId(id)
      return
    }
    if (id === activeId) return
    await flushAll()
    setActiveId(id)
    lastChapter.current[book.path] = id
    void api.setLastChapter(book.path, id)
  }

  const addChapter = async () => {
    if (!book) return
    await flushAll()
    const r = await api.addChapter(book.path, `פרק ${book.chapters.length + 1}`)
    if (!r.ok || !r.value) return show(r.error ?? 'לא הצלחתי להוסיף פרק', true)
    setBook(r.value.book)
    setActiveId(r.value.chapterId)
    setRenamingId(r.value.chapterId)
    void api.setLastChapter(book.path, r.value.chapterId)
  }

  const renameChapter = async (id: string, title: string) => {
    if (!book) return
    await flushAll()
    applyBook(await api.renameChapter(book.path, id, title))
  }

  const reorder = async (ids: string[]) => {
    if (!book) return
    // Show the new order right away, then rename the files on disk
    const byId = new Map(book.chapters.map((c) => [c.id, c]))
    setBook({ ...book, chapters: ids.map((id) => byId.get(id)!).filter(Boolean) })
    await flushAll()
    if (!applyBook(await api.reorderChapters(book.path, ids))) setBook(book)
  }

  const deleteChapter = async (ch: Chapter) => {
    if (!book) return
    setDialog(null)
    await flushAll()
    const idx = book.chapters.findIndex((c) => c.id === ch.id)
    const nb = applyBook(await api.deleteChapter(book.path, ch.id))
    if (!nb) return
    if (activeId === ch.id) setActiveId(nb.chapters[Math.min(idx, nb.chapters.length - 1)]?.id ?? null)
    show(`הפרק "${ch.title}" הועבר לסל המחזור`)
  }

  const updateMeta = async (id: string, meta: { status?: ChapterStatus; synopsis?: string }) => {
    if (!book) return
    // optimistic, so the status dot changes immediately
    setBook((b) => (b ? { ...b, chapters: b.chapters.map((c) => (c.id === id ? { ...c, ...meta } : c)) } : b))
    const r = await api.updateChapterMeta(book.path, id, meta)
    if (!r.ok) show(r.error ?? 'לא הצלחתי לשמור את פרטי הפרק', true)
  }

  const createBook = async (parent: string, title: string): Promise<string | null> => {
    const r = await api.createBook(parent, title)
    if (!r.ok || !r.value) return r.error ?? 'לא הצלחתי ליצור את הספר'
    setDialog(null)
    enterBook(r.value)
    return null
  }

  const toggleTheme = () => {
    const t: Theme = theme === 'light' ? 'dark' : 'light'
    setTheme(t)
    void api.setTheme(t)
  }

  const chapterPath = (ch: Chapter) => {
    const sep = book!.path.includes('\\') ? '\\' : '/'
    return [book!.path, CHAPTERS_DIR, ch.file].join(sep)
  }

  const active = book?.chapters.find((c) => c.id === activeId) ?? null
  const inMaster = !!book && view === 'master'
  const masterFocus = inMaster ? (book!.chapters.find((c) => c.id === masterFocusId) ?? null) : null
  const inspected = inMaster ? (masterFocus ?? book!.chapters[0] ?? null) : active
  const overlay = api.platform === 'win32' || api.platform === 'linux'

  return (
    <div className="app" data-mode={theme} data-overlay={overlay ? '1' : '0'} onClick={() => menu && setMenu(null)}>
      <IconSprite />
      <div className="titlebar">
        <img className="logo" src={appIcon} alt="" />
        <b>הַכְּרִיכִיָּה</b>
        {book && (
          <span className="crumb">
            {book.title}
            {inMaster ? ' · מאסטר' : active ? ` · ${active.title}` : ''}
          </span>
        )}
      </div>

      <div className="topbar">
        <button className="ib" title="כל הספרים" aria-pressed={!book} onClick={goHome}>
          <Icon name="shelf" />
          ספרייה
        </button>
        {book && (
          <>
            <span className="sep" />
            <div className="tabs" role="tablist">
              <button className="tab" role="tab" aria-selected={view === 'write'} onClick={() => switchView('write')}>
                <Icon name="pen" />
                כתיבה
              </button>
              <button className="tab" role="tab" aria-selected={view === 'master'} title="כל הפרקים ברצף" onClick={() => switchView('master')}>
                <Icon name="master" />
                מאסטר
              </button>
              <button className="tab" role="tab" aria-selected="false" disabled title="יגיע בהמשך">
                <Icon name="split" />
                מפוצל
              </button>
              <button className="tab" role="tab" aria-selected="false" disabled title="יגיע בהמשך">
                <Icon name="grid" />
                לוח שעם
              </button>
              <button className="tab" role="tab" aria-selected="false" disabled title="יגיע בהמשך">
                <Icon name="translate" />
                תרגום
              </button>
            </div>
          </>
        )}
        <span className="grow" />
      </div>

      {book && <FormatBar editor={editor} />}

      <div className="body">
        {!book && <Home books={books} onOpen={openBook} onNew={() => setDialog({ kind: 'newBook' })} onOpenFolder={openFolder} onForget={(p) => api.forgetBook(p).then(refreshLibrary)} />}
        {book && (
          <>
            <Binder
              book={book}
              activeId={activeId}
              masterActive={inMaster}
              onMaster={() => switchView('master')}
              renamingId={renamingId}
              onSelect={selectChapter}
              onAdd={addChapter}
              onRename={renameChapter}
              onStartRename={setRenamingId}
              onReorder={reorder}
              onContextMenu={(chapter, x, y) => setMenu({ chapter, x, y })}
            />
            {inMaster ? (
              <MasterView
                key={book.path}
                book={book}
                onEditor={setEditor}
                onRelease={(e) => setEditor((cur) => (cur === e ? null : cur))}
                onFocusChapter={setMasterFocusId}
                onOpenChapter={openChapter}
                onWords={setWords}
                onSaveState={setSaveState}
                onError={(m) => show(m, true)}
              />
            ) : active ? (
              <ChapterEditor
                key={`${book.path}|${active.id}`}
                book={book}
                chapter={active}
                onEditor={setEditor}
                onWords={setWords}
                onSaveState={setSaveState}
                onError={(m) => show(m, true)}
                onRename={(t) => renameChapter(active.id, t)}
                autoFocus={renamingId !== active.id}
              />
            ) : (
              <main className="desk">
                <article className="paper">
                  <div className="paper-state">
                    אין עדיין פרקים בספר הזה.
                    <button className="btn" onClick={addChapter}>
                      פרק חדש
                    </button>
                  </div>
                </article>
              </main>
            )}
            {inspected && <Inspector book={book} chapter={inspected} onMeta={updateMeta} onShowFile={() => api.showFile(chapterPath(inspected))} />}
          </>
        )}
      </div>

      <div className="statusbar">
        {book && (inMaster ? book.chapters.length > 0 : active) && (
          <span className={`saved ${saveState}`}>
            <i />
            <span>{SAVE_LABEL[saveState]}</span>
          </span>
        )}
        {inMaster ? (
          masterFocus ? (
            <span>
              עורך במאסטר ← <span className="fname">{masterFocus.file}</span>
            </span>
          ) : (
            <span>מאסטר · {book!.chapters.length} קבצים מקושרים</span>
          )
        ) : (
          book && active && <span className="fname">{active.file}</span>
        )}
        <span className="grow" />
        {inMaster && <span className="wc">{words.toLocaleString('he-IL')} מילים בספר</span>}
        {book && !inMaster && active && <span className="wc">{words.toLocaleString('he-IL')} מילים בפרק</span>}
        {book && <span>{book.chapters.length} פרקים</span>}
        <button className="ib" title={theme === 'light' ? 'מצב כהה' : 'מצב בהיר'} onClick={toggleTheme}>
          <Icon name={theme === 'light' ? 'moon' : 'sun'} />
        </button>
      </div>

      {menu && (
        <div className="menu" role="menu" style={{ top: menu.y, left: Math.max(8, menu.x - 180) }} onClick={(e) => e.stopPropagation()}>
          <button role="menuitem" onClick={() => (setRenamingId(menu.chapter.id), setMenu(null))}>
            <Icon name="rename" />
            שינוי שם
          </button>
          <button role="menuitem" onClick={() => (api.showFile(chapterPath(menu.chapter)), setMenu(null))}>
            <Icon name="folder" />
            הצגה בתיקייה
          </button>
          <button role="menuitem" className="danger" onClick={() => (setDialog({ kind: 'delete', chapter: menu.chapter }), setMenu(null))}>
            <Icon name="trash" />
            מחיקת הפרק
          </button>
        </div>
      )}

      {dialog?.kind === 'newBook' && <NewBookDialog onCancel={() => setDialog(null)} onCreate={createBook} />}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title={`למחוק את "${dialog.chapter.title}"?`}
          text="קובץ הפרק יעבור לסל המחזור של Windows, ואפשר יהיה לשחזר אותו משם. שאר הפרקים יקבלו מספור חדש."
          confirmLabel="מחיקה"
          onCancel={() => setDialog(null)}
          onConfirm={() => deleteChapter(dialog.chapter)}
        />
      )}

      {toast && (
        <div className={`toast${toast.error ? ' error' : ''}`} role="status" onClick={() => setToast(null)}>
          {toast.text}
        </div>
      )}
    </div>
  )
}
