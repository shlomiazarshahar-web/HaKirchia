import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Editor } from '@tiptap/react'
import type { Book, Bookmark, Chapter, ChapterStatus, OpResult, OutlineNode, PartNode, RecentBook, Theme } from '@shared/types'
import { newPartTitle, partOf, parts, moveNode, startPartAt, ungroupPart, withOutline } from '@shared/outline'
import { CHAPTERS_DIR } from '@shared/constants'
import { addPane, closePane, MAX_PANES, nextContent, normalizeLayout, setPaneContent, translationLayout, type PaneLayout } from '@shared/panes'
import { loadParagraphCounts, sendToTranslate, useParagraphCounts } from './translate'
import { bookProgress } from '@shared/translation'
import { MASTER_LABEL } from './labels'
import { api, flushAll, onWordsReport, setPendingStop } from './api'
import { IconSprite, Icon } from './components/Icons'
import { Home } from './components/Home'
import { UpdateBanner } from './components/Update'
import { Binder } from './components/Binder'
import { type SaveState } from './components/ChapterEditor'
import { MasterView } from './components/MasterView'
import { CorkBoard } from './components/CorkBoard'
import { SplitView } from './components/SplitView'
import { FormatBar } from './components/FormatBar'
import { Inspector } from './components/Inspector'
import { ConfirmDialog, NewBookDialog } from './components/Dialogs'
import { NiqqudAtCursor, WritingSettings } from './components/HebrewTools'
import { FocusBar, StopCard, StopDialog } from './components/Focus'
import { getPrefs, initPrefs, setTypewriterNow, usePrefs } from './prefs'
import { stopHere, centerCursor } from './editor'
import { addBookmark, applyJump, bookmarkAt, bookmarkPos, bookmarkText, editorChapter, editorsFor, getBookmarks, loadBookmarks, removeBookmark, sceneAt, scenesIn, setPendingJump, useBookmarks, useEditorsVersion, type JumpTarget, type SceneItem } from './nav'
import { SearchPanel } from './components/SearchPanel'
import { QuickOpen, type QuickEntry } from './components/QuickOpen'
import { BookmarkList, BookmarkNamer } from './components/Bookmarks'
import type { StopPoint } from '@shared/stoppoint'
import appIcon from './assets/icon.png'
import { addNote, loadDrawer, loadNotes, moveSelectionToDrawer } from './drafts'
import { CompareDialog, DrawerPanel, type CompareRequest } from './components/Drafts'
import { ReadingView, ElementStyleFields } from './components/ReadingView'
import { MatterDialog } from './components/MatterDialog'
import { elStyle, type PublishSettings } from '@shared/publish'
import { KIND_ICON, KIND_NEW, KIND_ONE, type Material, type MaterialKind } from '@shared/background'
import { BgContext, type BgActions } from './components/bgctx'
import { Inspiration, PlanSwitch, Timeline, type PlanMode } from './components/Plan'
import { setGlossaryTerms, setTermClick } from './background'
import { ReviewPanel } from './components/Review'
import { Workshop } from './components/Workshop'
import { initAi } from './ai'

type Toast = { text: string; error?: boolean } | null
type Dialog =
  | { kind: 'newBook' }
  | { kind: 'settings' }
  | { kind: 'matter'; pageId?: string }
  | { kind: 'titleStyle' }
  | { kind: 'delete'; chapter: Chapter }
  | { kind: 'deletePart'; part: PartNode }
  | { kind: 'deleteMaterial'; material: Material }
  | null
type Menu = { chapter: Chapter; x: number; y: number } | { part: PartNode; x: number; y: number } | { material: Material; x: number; y: number } | null
type View = 'write' | 'master' | 'board' | 'read'

const SAVE_LABEL: Record<SaveState, string> = { saved: 'נשמר', dirty: 'יש שינויים…', saving: 'שומר…', error: 'השמירה נכשלה' }
const ZOOMS = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6]

/** The book's chapter-title look, for the title above the text in the editor */
function titleVars(book: Book | null): CSSProperties | undefined {
  if (!book) return undefined
  const t = elStyle(book.publish.layout, 'chapterTitle')
  return {
    ...(t.font ? { '--title-font': `'${t.font.replace(/'/g, '')}', var(--editor-font)` } : {}),
    '--title-weight': t.bold ? 700 : 500,
    '--title-align': t.align === 'auto' ? 'center' : t.align
  } as CSSProperties
}

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
  /** Writing view: its panes (one, or 2–3 side by side), and the one in focus (by its stable key) */
  const [split, setSplit] = useState<PaneLayout | null>(null)
  const [focusKey, setFocusKey] = useState('')
  /** With more than one pane, "על הפרק" is hidden; it slides out inside one pane (this one) on demand */
  const [infoKey, setInfoKey] = useState<string | null>(null)
  const [zoom, setZoomState] = useState(1)
  /** Focused writing mode: only the text being written, full screen (feature 7) */
  const [focusMode, setFocusMode] = useState(false)
  /** Words of every chapter of the open book (from the files, kept live while typing) */
  const [bookWords, setBookWords] = useState<Record<string, number>>({})
  /** Words in the selected text, when there is a selection */
  const [selWords, setSelWords] = useState(0)
  /** The "what next" note from last time, shown when the book opens */
  const [stopCard, setStopCard] = useState<StopPoint | null>(null)
  /** Asking "what next?" before closing the book (going to the library) or the app */
  const [stopAsk, setStopAsk] = useState<{ closingApp: boolean; resolve: (close: boolean) => void } | null>(null)
  const [niqqudOpen, setNiqqudOpen] = useState(false)
  /** Find and replace panel (feature 24): open with the replace field or not, and the text to look for */
  const [find, setFind] = useState<{ replace: boolean; seed: { text: string; n: number; rep?: string } } | null>(null)
  /** Round 7: the planning tab's view (cards, timeline, inspiration), and the background page just created */
  const [planMode, setPlanMode] = useState<PlanMode>('cards')
  const [freshMaterial, setFreshMaterial] = useState<string | null>(null)
  /** Ctrl+P quick jump (feature 33) */
  const [quick, setQuick] = useState(false)
  /** A bookmark just added, asking for its name (feature 30) */
  const [namer, setNamer] = useState<Bookmark | null>(null)
  /** Scenes of the chapter being written (feature 29), listed in the binder */
  const [scenes, setScenes] = useState<{ chapterId: string; items: SceneItem[]; current: number } | null>(null)
  /** Round 4: a comparison on screen (versions, alternative drafts), the drawer panel, a note just added */
  const [compare, setCompare] = useState<CompareRequest | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  /** Round 8: the review side panel (feature 19); the library's workshop tab and the exercise open in it (feature 22) */
  const [reviewOpen, setReviewOpen] = useState(false)
  const [homeTab, setHomeTab] = useState<'books' | 'workshop'>('books')
  const [exerciseId, setExerciseId] = useState<string | null>(null)
  const [focusNote, setFocusNote] = useState<string | null>(null)
  const bookmarks = useBookmarks()
  const editorsVersion = useEditorsVersion()
  const prefs = usePrefs()
  const paraCounts = useParagraphCounts(book?.path)
  const splitSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedLayouts = useRef<Record<string, PaneLayout>>({})
  // The translation screen (feature 12): the writing view with its own panes (chapter, PDF, Google Translate)
  const [trMode, setTrMode] = useState(false)
  const savedTr = useRef<Record<string, PaneLayout>>({})
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
      initPrefs(s)
      initAi(s)
      lastChapter.current = s.lastChapter ?? {}
      savedLayouts.current = s.splitLayout ?? {}
      savedTr.current = s.translateLayout ?? {}
      if (s.zoom && s.zoom !== 1) {
        setZoomState(s.zoom)
        void api.setZoom(s.zoom)
      }
    })
    void refreshLibrary()
    api.onBeforeClose((wait) => beforeClose.current(wait))
  }, [refreshLibrary])

  // Live word counts of the open book
  const bookPathRef = useRef<string | null>(null)
  bookPathRef.current = book?.path ?? null
  useEffect(
    () =>
      onWordsReport((bookPath, id, w) => {
        if (bookPath !== bookPathRef.current) return
        openCounts.current.add(id)
        setBookWords((m) => (m[id] === w ? m : { ...m, [id]: w }))
      }),
    []
  )
  const refreshWords = (path: string) => {
    void loadParagraphCounts(path)
    return api.wordCounts(path).then((r) => {
      if (r.ok && r.value && bookPathRef.current === path) setBookWords((m) => ({ ...r.value, ...pickOpen(m) }))
    })
  }
  // counts reported by editors that are open now are newer than the files on disk
  const openCounts = useRef<Set<string>>(new Set())
  const pickOpen = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).filter(([id]) => openCounts.current.has(id)))

  // Words in the selection
  useEffect(() => {
    if (!editor) return setSelWords(0)
    const upd = () => {
      const { from, to, empty } = editor.state.selection
      setSelWords(empty ? 0 : (editor.state.doc.textBetween(from, to, ' ', ' ').match(/[^\s\u05BE\u2013\u2014]+/g)?.length ?? 0))
    }
    upd()
    editor.on('selectionUpdate', upd)
    return () => {
      editor.off('selectionUpdate', upd)
    }
  }, [editor])

  // Scenes of the chapter being written, and which one the cursor is in. Before the text was clicked,
  // the editor of the chapter in the pane in focus.
  const focusedChapterId = (() => {
    const p = split?.panes.find((x) => x.key === focusKey)
    return p?.content.kind === 'chapter' ? p.content.id : null
  })()
  const sceneEditor = editor ?? (book && focusedChapterId ? (editorsFor(book.path, focusedChapterId).find((e) => e.view.dom.closest(`[data-pane="${focusKey}"]`)) ?? null) : null)
  useEffect(() => {
    const editor = sceneEditor
    const ch = editorChapter(editor)
    if (!editor || !ch || view !== 'write') return setScenes(null)
    let t: ReturnType<typeof setTimeout> | null = null
    const upd = () => {
      if (editor.isDestroyed) return
      const items = scenesIn(editor.state.doc)
      const current = sceneAt(items, editor.state.selection.head)
      setScenes((old) =>
        old && old.chapterId === ch.chapterId && old.current === current && JSON.stringify(old.items) === JSON.stringify(items) ? old : { chapterId: ch.chapterId, items, current }
      )
    }
    const later = () => {
      if (t) clearTimeout(t)
      t = setTimeout(upd, 250)
    }
    upd()
    editor.on('update', later)
    editor.on('selectionUpdate', later)
    return () => {
      if (t) clearTimeout(t)
      editor.off('update', later)
      editor.off('selectionUpdate', later)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneEditor, view, editorsVersion])

  // The "what next" note steps aside once writing starts
  useEffect(() => {
    if (saveState === 'dirty') setStopCard(null)
  }, [saveState])

  // Typewriter scrolling is on while focus mode is on and wants it
  useEffect(() => {
    setTypewriterNow(focusMode && prefs.focus.typewriter)
  }, [focusMode, prefs.focus.typewriter])

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
    bookPathRef.current = b.path
    setBookWords({})
    openCounts.current = new Set()
    void refreshWords(b.path)
    setView('write')
    setTrMode(false)
    setMasterFocusId(null)
    setInfoKey(null)
    // Where the writer stopped last time wins over the last chapter shown
    const sp = b.stopPoint && b.chapters.some((c) => c.id === b.stopPoint!.chapterId) ? b.stopPoint : null
    const last = sp?.chapterId ?? lastChapter.current[b.path]
    const active = b.chapters.some((c) => c.id === last) ? last : (b.chapters[0]?.id ?? null)
    setActiveId(active)
    // The panes as they were last left in this book, or just the chapter being written
    let l = normalizeLayout(savedLayouts.current[b.path], b, active)
    let pane = l.panes.find((p) => p.content.kind === 'chapter' && p.content.id === active)
    if (!pane && active) {
      l = setPaneContent(l, 0, { kind: 'chapter', id: active })
      pane = l.panes[0]
    }
    setSplit(l)
    setFocusKey((pane ?? l.panes[0]).key)
    setPendingStop(b.path, sp)
    setStopCard(sp && sp.note ? sp : null)
    loadBookmarks(b.path, b.bookmarks ?? [])
    loadNotes(b.path, b.notes ?? [])
    void loadDrawer(b.path)
    setDrawerOpen(false)
    setCompare(null)
    setFind(null)
    setNamer(null)
  }

  /** Remembers where the writer is now (the chapter and the cursor), with an optional note. */
  const saveStop = async (note: string) => {
    if (!book) return
    let chapterId: string | null = null
    let place: Pick<StopPoint, 'pos' | 'before' | 'after'> = { pos: 1, before: '', after: '' }
    const pane = split?.panes.find((p) => p.key === focusKey)
    if (view === 'write' && pane?.content.kind === 'chapter') chapterId = pane.content.id
    else if (masterFocusId) chapterId = masterFocusId
    else chapterId = activeId
    if (editor && !editor.isDestroyed && chapterId && (view === 'write' ? pane?.content.kind === 'chapter' : masterFocusId === chapterId)) place = stopHere(editor)
    if (!chapterId) return
    const sp: StopPoint = { chapterId, ...place, note, at: Date.now() }
    const r = await api.setStopPoint(book.path, sp)
    if (r.ok) setBook((b) => (b && b.path === book.path ? { ...b, stopPoint: sp } : b))
  }

  /** Before leaving the book: asks "what next?" (if wanted), saves the stopping point. false = stay. */
  const leaveBook = async (closingApp: boolean, wait?: () => void): Promise<boolean> => {
    if (!book || book.chapters.length === 0) return true
    let note = ''
    if (getPrefs().askStopNote) {
      wait?.()
      if (focusMode) exitFocus()
      const answer = await new Promise<string | null>((resolve) =>
        setStopAsk({ closingApp, resolve: (ok) => resolve(ok ? (stopNoteRef.current ?? '') : null) })
      )
      setStopAsk(null)
      if (answer === null) return false
      note = answer
    }
    await saveStop(note)
    return true
  }
  const stopNoteRef = useRef<string | null>(null)
  const beforeClose = useRef<(wait: () => void) => Promise<boolean>>(async () => true)
  beforeClose.current = async (wait) => {
    if (!(await leaveBook(true, wait))) return false
    await flushAll()
    return true
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
    if (!book) return
    if (!(await leaveBook(false))) return
    exitFocus()
    await flushAll()
    setBook(null)
    setActiveId(null)
    void refreshLibrary()
  }

  /**
   * The panes of the writing view (tr = false) or of the translation screen (tr = true), as they
   * were last left in this book, showing the chapter being worked on.
   */
  const layoutFor = (b: Book, tr: boolean, active: string | null): { layout: PaneLayout; focus: string } => {
    const saved = (tr ? savedTr : savedLayouts).current[b.path]
    let l = normalizeLayout(saved, b, active)
    if (tr && !saved) l = translationLayout(b, active)
    let pane = l.panes.find((p) => p.content.kind === 'chapter' && p.content.id === active)
    if (!pane && active) {
      const at = l.panes.findIndex((p) => p.content.kind === 'chapter')
      l = setPaneContent(l, Math.max(0, at), { kind: 'chapter', id: active })
      pane = l.panes[Math.max(0, at)]
    }
    return { layout: l, focus: (pane ?? l.panes[0]).key }
  }

  const switchView = async (v: View) => {
    if (!book || (v === view && !(v === 'write' && trMode))) return
    // Save everything first, so the other view reads the files exactly as they are now
    await flushAll()
    setEditor(null)
    setMasterFocusId(null)
    if (trMode) {
      // leaving the translation screen: the writing view comes back as it was
      const { layout, focus } = layoutFor(book, false, activeId)
      setTrMode(false)
      setSplit(layout)
      setFocusKey(focus)
      setInfoKey(null)
    }
    setView(v)
    void refreshWords(book.path)
  }

  /** The translation screen: the chapter, its original (PDF) and Google Translate side by side */
  const openTranslate = async () => {
    if (!book || book.chapters.length === 0 || (view === 'write' && trMode)) return
    await flushAll()
    setEditor(null)
    setMasterFocusId(null)
    setInfoKey(null)
    const { layout, focus } = layoutFor(book, true, activeId)
    setTrMode(true)
    setSplit(layout)
    setFocusKey(focus)
    setView('write')
    void refreshWords(book.path)
  }

  /** Text was sent to Google Translate but no such pane is open: open one */
  const needTranslatePane = () => {
    if (!book || !split || split.panes.some((p) => p.content.kind === 'web')) return
    if (split.panes.length < MAX_PANES) updateSplit(addPane(split, { kind: 'web' }))
    else {
      const at = [...split.panes.keys()].reverse().find((i) => split.panes[i].key !== focusKey && split.panes[i].content.kind !== 'pdf') ?? split.panes.length - 1
      updateSplit(setPaneContent(split, at, { kind: 'web' }))
    }
    show('נפתח חלון של גוגל תרגום')
  }

  /** Ctrl+Shift+T: the selected text (in the PDF or in a chapter) goes to Google Translate */
  const sendSelection = () => {
    const text = window.getSelection()?.toString() ?? ''
    if (!text.trim()) return show('סמנו קודם את הטקסט שרוצים לתרגם')
    if (!sendToTranslate(text)) needTranslatePane()
  }

  const exitFocus = () => {
    setFocusMode((on) => {
      if (on) void api.setFullScreen(false)
      return false
    })
  }
  const toggleFocus = () => {
    if (!book || book.chapters.length === 0) return
    if (focusMode) return exitFocus()
    if (view !== 'write') void switchView('write')
    setInfoKey(null)
    setMenu(null)
    setFocusMode(true)
    void api.setFullScreen(true)
  }

  /** Changes the panes of the writing view. Saved (a moment later) so the book opens the same way next time. */
  const updateSplit = (l: PaneLayout) => {
    if (!book) return
    setSplit(l)
    if (!l.panes.some((p) => p.key === focusKey)) setFocusKey(l.panes[0].key)
    const path = book.path
    const tr = trMode
    ;(tr ? savedTr : savedLayouts).current[path] = l
    if (splitSaveTimer.current) clearTimeout(splitSaveTimer.current)
    splitSaveTimer.current = setTimeout(() => void (tr ? api.setTranslateLayout(path, l) : api.setSplitLayout(path, l)), 400)
  }

  const focusPane = (key: string) => {
    if (!split) return
    setFocusKey(key)
    const p = split.panes.find((x) => x.key === key)
    if (p?.content.kind === 'chapter' && book) {
      setActiveId(p.content.id)
      lastChapter.current[book.path] = p.content.id
      void api.setLastChapter(book.path, p.content.id)
    }
  }

  /** Shows a chapter in the pane in focus. If that pane shows the whole book, the chapter opens next to it. */
  const showInSplit = (id: string, fromMaster = false) => {
    if (!book || !split) return
    let l = split
    let i = l.panes.findIndex((p) => p.key === focusKey)
    if (i < 0) i = 0
    if (l.panes.length > 1 && (fromMaster || l.panes[i].content.kind !== 'chapter')) {
      const other = l.panes.findIndex((p, j) => j !== i && p.content.kind === 'chapter')
      if (other >= 0) i = other
      else if (l.panes.length < MAX_PANES) {
        l = addPane(l, { kind: 'chapter', id }, i)
        i = i + 1
      } else i = l.panes.findIndex((_, j) => j !== i)
    }
    l = setPaneContent(l, i, { kind: 'chapter', id })
    updateSplit(l)
    setFocusKey(l.panes[i].key)
    setActiveId(id)
    lastChapter.current[book.path] = id
    void api.setLastChapter(book.path, id)
  }

  /**
   * Goes to a chapter, and to a place in it (a search result, a bookmark, a scene): in the pane that
   * already shows it, or in the whole-book view when that is what is on screen, or opens it.
   */
  const goTo = async (chapterId: string, target?: JumpTarget, bookmarkId?: string) => {
    if (!book || !book.chapters.some((c) => c.id === chapterId)) return
    const jumpIn = (ed: ReturnType<typeof editorsFor>[number]) => {
      if (!target) return ed.commands.focus()
      const exact = bookmarkId !== undefined ? bookmarkPos(ed, bookmarkId) : undefined
      applyJump(ed, exact !== undefined ? { pos: exact, focus: target.focus } : target)
    }
    if (view === 'board') {
      await flushAll()
      setEditor(null)
      setView('write')
    } else {
      const pane = split?.panes.find((p) => p.key === focusKey)
      const masterNow = view === 'master' || (view === 'write' && pane?.content.kind === 'master')
      if (masterNow) {
        const scope = view === 'master' ? '#master-desk' : `[data-pane="${pane!.key}"]`
        const ed = editorsFor(book.path, chapterId).find((e) => e.view.dom.closest(scope))
        setMasterFocusId(chapterId)
        if (ed) return jumpIn(ed)
        document.getElementById(`m-${chapterId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
      // already on screen in one of the panes: jump there
      const shownIn = split?.panes.find((p) => p.content.kind === 'chapter' && p.content.id === chapterId)
      if (shownIn) {
        const ed = editorsFor(book.path, chapterId).find((e) => e.view.dom.closest(`[data-pane="${shownIn.key}"]`))
        if (ed) {
          if (shownIn.key !== focusKey) focusPane(shownIn.key)
          return jumpIn(ed)
        }
      }
    }
    if (target) setPendingJump(book.path, chapterId, target)
    showInSplit(chapterId)
  }

  /** Adds a bookmark at the cursor, or removes the one that is there already (Ctrl+Shift+ל) */
  const toggleBookmark = () => {
    if (!book || !editor || editor.isDestroyed || !editorChapter(editor)) return
    const here = bookmarkAt(editor)
    if (here) {
      removeBookmark(here.id)
      return show(`הסימנייה "${bookmarkText(here)}" הוסרה`)
    }
    const b = addBookmark(editor)
    if (b) setNamer(b)
  }

  const openFind = (replace: boolean) => {
    if (!book) return
    if (focusMode) exitFocus()
    setDrawerOpen(false)
    let text = ''
    if (editor && !editor.isDestroyed) {
      const { from, to, empty } = editor.state.selection
      const t = empty ? '' : editor.state.doc.textBetween(from, to, ' ')
      if (t.length <= 80 && !t.includes('\n')) text = t.trim()
    }
    setFind((f) => ({ replace: replace || (f?.replace ?? false), seed: { text, n: (f?.seed.n ?? 0) + 1 } }))
  }

  const closeFind = () => {
    setFind(null)
    if (editor && !editor.isDestroyed) editor.commands.focus()
  }

  /** Everything Ctrl+P can jump to */
  const quickEntries = (): QuickEntry[] => {
    if (!book) return []
    const out: QuickEntry[] = []
    const partTitle = new Map<string, string>()
    for (const p of parts(book.outline)) for (const id of p.children) partTitle.set(id, p.title)
    book.chapters.forEach((c, i) =>
      out.push({ kind: 'chapter', id: c.id, label: c.title, extra: `פרק ${i + 1}${partTitle.has(c.id) ? ` · ${partTitle.get(c.id)}` : ''}`, run: () => void goTo(c.id) })
    )
    for (const p of parts(book.outline)) {
      if (!p.children.length) continue
      out.push({
        kind: 'part',
        id: p.id,
        label: p.title,
        extra: `${p.children.length} פרקים`,
        run: () => {
          if (view === 'master') document.getElementById(`m-${p.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          else void goTo(p.children[0])
        }
      })
    }
    const titles = new Map(book.chapters.map((c) => [c.id, c.title]))
    for (const b of getBookmarks()) {
      if (!titles.has(b.chapterId)) continue
      out.push({ kind: 'bookmark', id: b.id, label: bookmarkText(b), extra: titles.get(b.chapterId), run: () => void goTo(b.chapterId, { pos: b.pos, before: b.before, after: b.after }, b.id) })
    }
    if (scenes && scenes.items.length > 1) {
      const ed = sceneEditor
      scenes.items.forEach((sc, i) =>
        out.push({ kind: 'scene', id: `${scenes.chapterId}-${i}`, label: sc.label, extra: `סצנה ${i + 1} · ${titles.get(scenes.chapterId) ?? ''}`, run: () => ed && !ed.isDestroyed && applyJump(ed, { pos: sc.pos }) })
      )
    }
    for (const m of book.materials) out.push({ kind: 'material', id: m.id, label: m.name, extra: `${KIND_ONE[m.kind]}${m.aliases.length ? ` · ${m.aliases.join(', ')}` : ''}`, run: () => void openBeside({ kind: 'material', id: m.id }) })
    out.push({ kind: 'view', id: 'glossary', label: 'מילון מונחים ושמות', extra: 'חומרי רקע', run: () => void openBeside({ kind: 'glossary' }) })
    out.push({ kind: 'view', id: 'master', label: MASTER_LABEL, extra: 'כל הפרקים ברצף', run: () => void switchView('master') })
    out.push({ kind: 'view', id: 'board', label: 'תכנון', extra: 'כרטיסים, ציר זמן והשראה', run: () => void switchView('board') })
    return out
  }

  const goToScene = (pos: number) => {
    const ed = sceneEditor
    if (!ed || ed.isDestroyed) return
    ed.chain().focus().setTextSelection(pos).run()
    requestAnimationFrame(() => centerCursor(ed.view, true))
  }

  const addPaneNow = () => {
    if (!book || !split || split.panes.length >= MAX_PANES) return
    if (view !== 'write') void switchView('write')
    const i = Math.max(0, split.panes.findIndex((p) => p.key === focusKey))
    const l = addPane(split, nextContent(split, book, i), i)
    updateSplit(l)
    focusPane(l.panes[i + 1].key)
  }

  /** Opens an alternative draft (feature 35) in a pane next to the one in focus */
  const openAlt = (altId: string) => {
    if (!book || !split) return
    const shown = split.panes.find((p) => p.content.kind === 'alt' && p.content.id === altId)
    if (view !== 'write') {
      void switchView('write')
    }
    if (shown) return focusPane(shown.key)
    const i = Math.max(0, split.panes.findIndex((p) => p.key === focusKey))
    let l: PaneLayout
    let at: number
    if (split.panes.length < MAX_PANES) {
      l = addPane(split, { kind: 'alt', id: altId }, i)
      at = i + 1
    } else {
      at = split.panes.findIndex((_, j) => j !== i)
      l = setPaneContent(split, at, { kind: 'alt', id: altId })
    }
    updateSplit(l)
    setFocusKey(l.panes[at].key)
  }

  /** A private note on the selected words, or about the chapter (Ctrl+Alt+M); its field opens */
  const addNoteHere = () => {
    if (!book || !editor || editor.isDestroyed) return
    const ch = editorChapter(editor)
    if (!ch || ch.bookPath !== book.path) return
    if (focusMode) exitFocus()
    const n = addNote(ch.chapterId, '', editor)
    setFind(null)
    setDrawerOpen(false)
    if (split && split.panes.length > 1 && view === 'write') {
      const pane = editor.view.dom.closest('[data-pane]')?.getAttribute('data-pane')
      if (pane) setInfoKey(pane)
    }
    setFocusNote(n.id)
    setTimeout(() => setFocusNote(null), 800)
    show(n.anchor ? 'הערה פרטית חדשה על המילים המסומנות' : 'הערה פרטית חדשה לפרק')
  }

  const toggleDrawer = () => {
    if (!book) return
    if (focusMode) exitFocus()
    setFind(null)
    setReviewOpen(false)
    setDrawerOpen((o) => !o)
  }
  const toggleReview = () => {
    if (!book) return
    if (focusMode) exitFocus()
    setFind(null)
    setDrawerOpen(false)
    if (view === 'board' || view === 'read') void switchView('write')
    setReviewOpen((o) => !o)
  }

  /** Moves the selected text to the drawer (Ctrl+Shift+M); without a selection, opens the drawer */
  const toDrawer = () => {
    if (!book) return
    if (editor && !editor.isDestroyed && !editor.state.selection.empty) {
      const ch = editorChapter(editor)
      const title = book.chapters.find((c) => c.id === ch?.chapterId)?.title ?? ''
      if (moveSelectionToDrawer(editor, title)) return show('הטקסט הועבר למגירה (בצד שמאל של המסך: מגירה)')
    }
    toggleDrawer()
  }

  const closeFocusedPane = () => {
    if (!split || split.panes.length <= 1) return
    const i = Math.max(0, split.panes.findIndex((p) => p.key === focusKey))
    const l = closePane(split, i)
    updateSplit(l)
    focusPane(l.panes[Math.min(i, l.panes.length - 1)].key)
  }

  const setZoom = (z: number) => {
    const v = Math.round(Math.min(ZOOMS[ZOOMS.length - 1], Math.max(ZOOMS[0], z)) * 100) / 100
    setZoomState(v)
    void api.setZoom(v)
  }
  const stepZoom = (dir: 1 | -1) => {
    const i = ZOOMS.findIndex((z) => z >= zoom - 0.001)
    const at = i < 0 ? ZOOMS.length - 1 : i
    setZoom(ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (ZOOMS[at] > zoom + 0.001 && dir === 1 ? at - 1 : at) + dir))])
  }

  // Keyboard shortcuts of the window. e.code, so they work with a Hebrew keyboard layout too.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  keys.current = (e: KeyboardEvent) => {
    if (e.code === 'F11' && !e.ctrlKey && !e.altKey) return e.preventDefault(), toggleFocus()
    if (e.key === 'Escape' && focusMode && !document.querySelector('.pop, .scrim, .pdrawer')) return e.preventDefault(), exitFocus()
    // Ctrl+Alt+M: private note (as Word's new comment)
    if (e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && e.code === 'KeyM' && book && editor) return e.preventDefault(), addNoteHere()
    // Ctrl+Alt+F: footnote (as in Word). Caught here by the key's place: on Windows Ctrl+Alt is also AltGr,
    // and with a Hebrew keyboard the editor's own shortcut never sees an "f"
    if (e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && e.code === 'KeyF' && book && editor) {
      e.preventDefault()
      e.stopPropagation()
      if (!editor.isDestroyed && editor.isEditable) editor.chain().focus().insertFootnote().run()
      return
    }
    if (e.code === 'F3' && find && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      document.querySelector<HTMLButtonElement>(e.shiftKey ? '.findpanel [aria-label="המופע הקודם"]' : '.findpanel [aria-label="המופע הבא"]')?.click()
      return
    }
    if (!e.ctrlKey || e.altKey || e.metaKey) return
    if (book && !e.shiftKey && !document.querySelector('.scrim')) {
      if (e.code === 'KeyF') return e.preventDefault(), openFind(false)
      if (e.code === 'KeyH') return e.preventDefault(), openFind(true)
      if (e.code === 'KeyP') return e.preventDefault(), setQuick((q) => !q)
      // Ctrl+W closes the pane in focus too (when there is more than one)
      if (e.code === 'KeyW' && view === 'write' && !focusMode && split && split.panes.length > 1) return e.preventDefault(), closeFocusedPane()
    }
    if (e.shiftKey) {
      if (e.code === 'KeyK' && book && editor && !editor.isDestroyed) return e.preventDefault(), toggleBookmark()
      if (e.code === 'KeyM' && book) return e.preventDefault(), toDrawer()
      if (e.code === 'KeyD') return e.preventDefault(), toggleTheme()
      if (e.code === 'KeyF' && book) return e.preventDefault(), toggleFocus()
      if (e.code === 'KeyB' && editor && editor.isEditable && !editor.isDestroyed) return e.preventDefault(), setNiqqudOpen((o) => !o)
      if (e.code === 'KeyT' && book) return e.preventDefault(), sendSelection()
    }
    if (e.shiftKey && book && view === 'write' && !focusMode) {
      if (e.code === 'KeyN') return e.preventDefault(), addPaneNow()
      // by the key's place, or by its letter (X, or ס on a Hebrew keyboard) in case the place is reported differently
      if (e.code === 'KeyX' || e.key === 'x' || e.key === 'X' || e.key === 'ס') return e.preventDefault(), closeFocusedPane()
      if (e.code === 'KeyI' && split && split.panes.length > 1) {
        e.preventDefault()
        const p = split.panes.find((x) => x.key === focusKey)
        if (p?.content.kind === 'chapter') setInfoKey((k) => (k === p.key ? null : p.key))
        return
      }
    }
    if (!e.shiftKey || e.code === 'Equal') {
      if (e.code === 'Equal' || e.code === 'NumpadAdd') return e.preventDefault(), stepZoom(1)
      if (e.code === 'Minus' || e.code === 'NumpadSubtract') return e.preventDefault(), stepZoom(-1)
      if (e.code === 'Digit0' || e.code === 'Numpad0') return e.preventDefault(), setZoom(1)
    }
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e)
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [])

  // Chapters deleted (or the book changed): drop panes that showed them
  useEffect(() => {
    if (!book || !split) return
    const next = normalizeLayout(split, book, activeId)
    if (JSON.stringify(next) !== JSON.stringify(split)) updateSplit(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book?.chapters, book?.alts, book?.materials])

  // The glossary and the names of characters and places are marked in the chapter editors (feature 20)
  // Correct spellings get a purple line only for the background page open beside the chapter (or all terms while the glossary is open)
  const openBg = (split?.panes ?? []).flatMap((p) => (p.content.kind === 'material' ? [p.content.id] : p.content.kind === 'glossary' ? ['glossary'] : [])).join('|')
  useEffect(() => {
    if (book) setGlossaryTerms(book, openBg ? openBg.split('|') : [])
  }, [book, openBg])

  // ---------------------------------------------------------------------------
  // Background materials (round 7)
  // ---------------------------------------------------------------------------

  /** Shows something next to the pane in focus (a background page, the glossary), or brings it forward when already shown */
  const openBeside = async (content: { kind: 'material'; id: string } | { kind: 'glossary' }) => {
    if (!book || !split) return
    if (view !== 'write') {
      await flushAll()
      setEditor(null)
      setMasterFocusId(null)
      setView('write')
    }
    const isIt = (p: (typeof split.panes)[number]) => p.content.kind === content.kind && ('id' in content ? 'id' in p.content && p.content.id === content.id : true)
    const shown = split.panes.find(isIt)
    if (shown) return setFocusKey(shown.key)
    const i = Math.max(0, split.panes.findIndex((p) => p.key === focusKey))
    let l: PaneLayout
    let at: number
    const aside = split.panes.findIndex((p) => p.content.kind === 'material' || p.content.kind === 'glossary')
    if (aside >= 0) {
      // a background page is already open: it makes way for this one
      at = aside
      l = setPaneContent(split, at, content)
    } else if (split.panes.length < MAX_PANES) {
      l = addPane(split, content, i)
      at = i + 1
    } else {
      at = split.panes.findIndex((_, j) => j !== i)
      l = setPaneContent(split, at, content)
    }
    updateSplit(l)
    setFocusKey(l.panes[at].key)
  }

  const newMaterial = async (kind: MaterialKind) => {
    if (!book) return
    const r = await api.createMaterial(book.path, kind)
    if (!r.ok || !r.value) return show(r.error ?? 'לא הצלחתי ליצור את הדף', true)
    setBook(r.value.book)
    setFreshMaterial(r.value.value.id)
    setTimeout(() => setFreshMaterial(null), 1500)
    void openBeside({ kind: 'material', id: r.value.value.id })
  }

  /** Right-click on selected words: a background page named by them, or a glossary entry */
  const [freshTerm, setFreshTerm] = useState<string | null>(null)
  const fromSelection = async (kind: string, text: string) => {
    if (!book) return
    if (kind === 'character' || kind === 'place' || kind === 'research') {
      const r = await api.createMaterial(book.path, kind, text)
      if (!r.ok || !r.value) return show(r.error ?? 'לא הצלחתי ליצור את הדף', true)
      setBook(r.value.book)
      void openBeside({ kind: 'material', id: r.value.value.id })
      return show(`נוצר דף ל"${text}" בחומרי הרקע`)
    }
    const known = book.glossary.find((g) => (kind === 'term' ? g.term : g.original).trim() === text)
    let id = known?.id
    if (!known) {
      id = crypto.randomUUID()
      const list = [...book.glossary, { id, term: kind === 'term' ? text : '', original: kind === 'original' ? text : '', variants: [], accepted: [], note: '' }]
      const r = await api.setGlossary(book.path, list)
      if (!r.ok || !r.value) return show(r.error ?? 'השמירה נכשלה', true)
      setBook(r.value.book)
    }
    setFreshTerm(id!)
    setTimeout(() => setFreshTerm(null), 1500)
    void openBeside({ kind: 'glossary' })
    if (known) show(`"${text}" כבר במילון המונחים`)
  }
  const fromSelectionRef = useRef(fromSelection)
  fromSelectionRef.current = fromSelection
  useEffect(() => api.onContextBackground((k, t) => void fromSelectionRef.current(k, t)), [])
  const openBesideRef = useRef(openBeside)
  openBesideRef.current = openBeside
  useEffect(() => {
    setTermClick((ref) => void openBesideRef.current(ref.startsWith('m:') ? { kind: 'material', id: ref.slice(2) } : { kind: 'glossary' }))
    return () => setTermClick(null)
  }, [])

  /** Renames the book and its folder; the book opens again from its new place */
  const renameBook = async (title: string) => {
    if (!book) return
    await flushAll()
    const old = book.path
    const r = await api.renameBook(old, title)
    if (!r.ok || !r.value) return show(r.error ?? 'לא הצלחתי לשנות את השם', true)
    const nb = r.value.book
    if (nb.path !== old) {
      for (const rec of [savedLayouts.current, savedTr.current, lastChapter.current]) if (old in rec) (rec as Record<string, unknown>)[nb.path] = (rec as Record<string, unknown>)[old]
      enterBook(nb)
    } else setBook(nb)
    show(r.value.notice ?? `שם הספר שונה ל"${nb.title}"${nb.path !== old ? ', וגם שם התיקייה' : ''}`, !!r.value.notice)
  }

  const deleteMaterial = async (m: Material) => {
    if (!book) return
    setDialog(null)
    await flushAll()
    const r = await api.deleteMaterial(book.path, m.id)
    if (!r.ok || !r.value) return show(r.error ?? 'המחיקה נכשלה', true)
    setBook(r.value.book)
    show(`הדף "${m.name}" נמחק. קובץ ה-Word שלו עבר לסל המחזור`)
  }

  const bgActions: BgActions | null = book
    ? {
        book,
        onBook: (b) => setBook((cur) => (cur && cur.path === b.path ? b : cur)),
        show,
        goTo: (id, t) => void goTo(id, t),
        openMaterial: (id) => void openBeside({ kind: 'material', id }),
        openGlossary: () => void openBeside({ kind: 'glossary' }),
        newMaterial: (k) => void newMaterial(k),
        deleteMaterial: (id) => {
          const m = book.materials.find((x) => x.id === id)
          if (m) setDialog({ kind: 'deleteMaterial', material: m })
        },
        findReplace: (text, rep) => {
          if (focusMode) exitFocus()
          setDrawerOpen(false)
          setFind((f) => ({ replace: true, seed: { text, rep, n: (f?.seed.n ?? 0) + 1 } }))
        },
        freshMaterial,
        freshTerm
      }
    : null

  /** Front and back pages, author and page layout (features 31, 36, 16) */
  useEffect(() => {
    const open = () => setDialog({ kind: 'titleStyle' })
    window.addEventListener('hakirchia:title-style', open)
    return () => window.removeEventListener('hakirchia:title-style', open)
  }, [])
  const publishSaving = useRef<Promise<unknown>>(Promise.resolve())
  const savePublish = async (p: PublishSettings) => {
    if (!book) return
    setBook({ ...book, publish: p })
    const r = await api.setPublish(book.path, p)
    if (!r.ok || !r.value) return show(r.error ?? 'השמירה נכשלה', true)
    setBook(r.value)
  }

  const [exporting, setExporting] = useState<string | null>(null)
  const [exportMenu, setExportMenu] = useState(false)
  /** Exports the whole book as saved (everything is saved first) */
  const exportBook = async (format: 'pdf' | 'docx' | 'epub') => {
    if (!book || exporting) return
    setExportMenu(false)
    await flushAll()
    const label = format === 'pdf' ? 'PDF' : format === 'docx' ? 'Word' : 'ePub'
    setExporting(label)
    try {
      const r = await api.exportBook(book.path, book.title, format)
      if (!r.ok) return show(`הייצוא ל־${label} נכשל: ${r.error ?? ''}`, true)
      if (!r.value) return
      show(`הספר יוצא ל־${label}. הקובץ נשמר בתיקייה "${r.value.split(/[\\/]/).slice(-2, -1)[0]}"`)
      void api.showFile(r.value)
    } finally {
      setExporting(null)
    }
  }

  /** From the whole-book view: open one chapter in the writing view */
  const openChapter = async (id: string) => {
    if (!book) return
    if (view === 'write') return showInSplit(id, true)
    await flushAll()
    setEditor(null)
    setView('write')
    showInSplit(id)
  }

  const selectChapter = async (id: string) => {
    if (!book) return
    const pane = split?.panes.find((p) => p.key === focusKey)
    if (view === 'master' || (view === 'write' && split && split.panes.length > 1 && pane?.content.kind === 'master')) {
      // In the whole book, a chapter in the binder jumps to its place in the text
      document.getElementById(`m-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setMasterFocusId(id)
      return
    }
    if (pane?.content.kind === 'chapter' && pane.content.id === id) return
    showInSplit(id)
  }

  /** New chapter: at the end of the given part, or of the part of the chapter being written, or of the book. */
  const addChapter = async (partId?: string) => {
    if (!book) return
    await flushAll()
    const inPart = partId ?? (view === 'write' && activeId ? partOf(book.outline, activeId)?.id : undefined)
    const r = await api.addChapter(book.path, `פרק ${book.chapters.length + 1}`, inPart)
    if (!r.ok || !r.value) return show(r.error ?? 'לא הצלחתי להוסיף פרק', true)
    if (r.notice) show(r.notice, true)
    if (inPart) r.value.book = withOutline(r.value.book, r.value.book.outline.map((n) => (n.type === 'part' && n.id === inPart ? { ...n, collapsed: false } : n)))
    setBook(r.value.book)
    setRenamingId(r.value.chapterId)
    if (view === 'write') showInSplit(r.value.chapterId)
    else setActiveId(r.value.chapterId)
    void api.setLastChapter(book.path, r.value.chapterId)
  }

  const renameChapter = async (id: string, title: string) => {
    if (!book) return
    await flushAll()
    applyBook(await api.renameChapter(book.path, id, title))
  }

  /** Saves a new binder tree (moved chapters, parts). Shown right away, then the files are renamed on disk. */
  const saveOutline = async (outline: OutlineNode[]) => {
    if (!book) return
    const before = book
    const next = withOutline(book, outline)
    setBook(next)
    const orderChanged = next.chapters.map((c) => c.id).join() !== before.chapters.map((c) => c.id).join()
    if (orderChanged) await flushAll()
    if (!applyBook(await api.saveOutline(before.path, next.outline))) setBook(before)
  }

  // Close the niqqud panel when the editor it types into goes away
  useEffect(() => {
    if (!editor) setNiqqudOpen(false)
  }, [editor])

  const addPart = () => {
    if (!book) return
    const id = crypto.randomUUID()
    void saveOutline([...book.outline, { type: 'part', id, title: newPartTitle(book.outline), collapsed: false, children: [] }])
    setRenamingId(id)
  }

  const partFromChapter = (ch: Chapter) => {
    if (!book) return
    const id = crypto.randomUUID()
    void saveOutline(startPartAt(book.outline, ch.id, { id, title: newPartTitle(book.outline) }))
    setRenamingId(id)
  }

  const moveToPart = (ch: Chapter, partId: string | null) => {
    if (!book) return
    if (partId) void saveOutline(moveNode(book.outline, { type: 'chapter', id: ch.id }, { kind: 'into', partId, at: 'end' }))
    else {
      // Out of its part: right after the part, at the top level
      const host = partOf(book.outline, ch.id)
      if (host) void saveOutline(moveNode(book.outline, { type: 'chapter', id: ch.id }, { kind: 'after', ref: { type: 'part', id: host.id } }))
    }
  }

  const removePart = (p: PartNode) => {
    if (!book) return
    setDialog(null)
    void saveOutline(ungroupPart(book.outline, p.id))
    show(`החלק "${p.title}" הוסר. הפרקים שהיו בו נשארו במקומם.`)
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

  const draftsCtx = { editor, onCompare: setCompare, onBook: (b: Book) => setBook(b), onOpenAlt: openAlt, show }

  const inMaster = !!book && view === 'master'
  const inBoard = !!book && view === 'board'
  const inRead = !!book && view === 'read'
  const inWrite = !!book && view === 'write' && !!split
  const multi = inWrite && split!.panes.length > 1
  const focusedPane = inWrite ? (split!.panes.find((p) => p.key === focusKey) ?? split!.panes[0]) : null
  const writeChapter = focusedPane?.content.kind === 'chapter' ? (book!.chapters.find((c) => c.id === (focusedPane.content as { id: string }).id) ?? null) : null
  const writeMaster = focusedPane?.content.kind === 'master'
  const masterFocus = inMaster || writeMaster ? (book!.chapters.find((c) => c.id === masterFocusId) ?? null) : null
  const inspected = inMaster ? (masterFocus ?? book!.chapters[0] ?? null) : writeMaster ? (masterFocus ?? null) : writeChapter
  const overlay = api.platform === 'win32' || api.platform === 'linux'
  const empty = !!book && book.chapters.length === 0
  const totalWords = book ? book.chapters.reduce((sum, c) => sum + (bookWords[c.id] ?? 0), 0) : 0
  const focusOn = focusMode && inWrite && !empty
  const stopChapter = stopCard ? book?.chapters.find((c) => c.id === stopCard.chapterId) : undefined
  const themeLabel = theme === 'light' ? 'מצב כהה' : 'מצב בהיר'
  const bookTr = book ? bookProgress(book.chapters.filter((c) => book.sources?.[c.id]).map((c) => ({ chapterParas: paraCounts[c.id] ?? 1, sourceParas: book.sources[c.id].paras }))) : null

  return (
    <div
      className={`app${focusOn ? ' focusmode' : ''}${focusOn && prefs.focus.typewriter ? ' typewriter' : ''}${focusOn && prefs.focus.dim ? ' dim' : ''}`}
      data-mode={theme}
      data-overlay={overlay ? '1' : '0'}
      style={titleVars(book)}
      onClick={() => (menu && setMenu(null), exportMenu && setExportMenu(false))}
    >
      <IconSprite />
      <div className="titlebar">
        <img className="logo" src={appIcon} alt="" />
        <b>הַכְּרִיכִיָּה</b>
        {book && (
          <span className="crumb">
            {book.title}
            {inWrite && trMode ? ' · תרגום' : ''}
            {inMaster ? ` · ${MASTER_LABEL}` : inBoard ? ' · תכנון' : inRead ? ' · קריאה' : writeChapter ? ` · ${writeChapter.title}` : writeMaster ? ` · ${MASTER_LABEL}` : ''}
          </span>
        )}
      </div>

      <div className="topbar">
        <button className="ib" title="כל הספרים" aria-pressed={!book} onClick={goHome}>
          <Icon name="shelf" />
          ספרייה
        </button>
        {!book && (
          <>
            <span className="sep" />
            <div className="tabs" role="tablist">
              <button className="tab" role="tab" aria-selected={homeTab === 'books'} onClick={() => setHomeTab('books')}>
                <Icon name="book" />
                הספרים שלי
              </button>
              <button className="tab" role="tab" aria-selected={homeTab === 'workshop'} title="תרגילי כתיבה קצרים, בלי לפתוח ספר" onClick={() => setHomeTab('workshop')}>
                <Icon name="workshop" />
                סדנה
              </button>
            </div>
          </>
        )}
        {book && (
          <>
            <span className="sep" />
            <div className="tabs" role="tablist">
              <button className="tab" role="tab" aria-selected={view === 'write' && !trMode} onClick={() => switchView('write')}>
                <Icon name="pen" />
                כתיבה
              </button>
              <button className="tab" role="tab" aria-selected={view === 'master'} title="כל הפרקים ברצף" onClick={() => switchView('master')}>
                <Icon name="master" />
                {MASTER_LABEL}
              </button>
              <button className="tab" role="tab" aria-selected={view === 'board'} title="תכנון הספר: כרטיס לכל פרק, ציר הזמן של הסיפור ולוח השראה" onClick={() => switchView('board')}>
                <Icon name="grid" />
                תכנון
              </button>
              <button className="tab" role="tab" aria-selected={view === 'read'} disabled={empty} title="מצב קריאה: הספר כמו ספר מודפס, עמוד מול עמוד, בלי כלי עריכה" onClick={() => switchView('read')}>
                <Icon name="book" />
                קריאה
              </button>
              <button
                className="tab"
                role="tab"
                aria-selected={view === 'write' && trMode}
                disabled={empty}
                title="הפרק, המקור שלו (PDF) וגוגל תרגום זה לצד זה. החלונות והרוחב ניתנים לשינוי כמו בכתיבה"
                onClick={() => void openTranslate()}
              >
                <Icon name="translate" />
                תרגום
              </button>
            </div>
          </>
        )}
        <span className="grow" />
        {book && !empty && (
          <>
            <button className="searchbox" title="חיפוש והחלפה בכל הספר (Ctrl+F, החלפה: Ctrl+H)" aria-pressed={!!find} onClick={() => (find ? closeFind() : openFind(false))}>
              <Icon name="search" />
              <span>חיפוש<span className="lbl"> בכל הספר</span></span>
              <kbd>Ctrl+F</kbd>
            </button>
            <button className="ib" title="מעבר מהיר לפרק, חלק או סימנייה (Ctrl+P)" onClick={() => setQuick(true)}>
              <Icon name="jump" />
              <span className="lbl">מעבר מהיר</span>
            </button>
            <button className="ib" title="ביקורת כתיבה עם Claude: על קטע מסומן, על הפרק או על כל הספר" aria-pressed={reviewOpen} onClick={toggleReview}>
              <Icon name="review" />
              <span className="lbl">ביקורת</span>
            </button>
            <button className="ib" title="מגירה: טקסט שנחתך או נמחק, ואפשר להחזיר אותו (Ctrl+Shift+M מעביר את הטקסט המסומן)" aria-pressed={drawerOpen} onClick={toggleDrawer}>
              <Icon name="drawer" />
              <span className="lbl">מגירה</span>
            </button>
          </>
        )}
        {book && !empty && (
          <span className="export-wrap">
            <button className="ib" title="ייצוא הספר כולו: PDF להדפסה, Word או ePub" aria-expanded={exportMenu} disabled={!!exporting} onClick={(e) => (e.stopPropagation(), setExportMenu(!exportMenu))}>
              <Icon name="export" />
              <span className="lbl">{exporting ? `מייצא ${exporting}…` : 'ייצוא'}</span>
            </button>
            {exportMenu && (
              <div className="menu export-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                <button role="menuitem" onClick={() => void exportBook('pdf')}>
                  <span>PDF להדפסה</span>
                  <small>עימוד ספר, כותרות רצות, מספרי עמודים</small>
                </button>
                <button role="menuitem" onClick={() => void exportBook('docx')}>
                  <span>קובץ Word אחד</span>
                  <small>כל הספר מאוחד ל־docx</small>
                </button>
                <button role="menuitem" onClick={() => void exportBook('epub')}>
                  <span>ePub</span>
                  <small>לקוראים אלקטרוניים</small>
                </button>
                <div className="msep" />
                <button role="menuitem" onClick={() => (setExportMenu(false), setDialog({ kind: 'matter' }))}>
                  <span>עמודי פתיחה וסיום…</span>
                  <small>שער, הקדשה, מוטו, תוכן עניינים, תודות</small>
                </button>
                <button role="menuitem" onClick={() => (setExportMenu(false), void switchView('read'))}>
                  <span>עימוד ותצוגה מקדימה</span>
                  <small>מצב קריאה, עמוד מול עמוד</small>
                </button>
              </div>
            )}
          </span>
        )}
        {inWrite && !empty && (
          <button className="ib" title="מצב כתיבה ממוקדת: רק הטקסט, על כל המסך (F11 או Ctrl+Shift+כ)" onClick={toggleFocus}>
            <Icon name="focus" />
            <span className="lbl">כתיבה ממוקדת</span>
          </button>
        )}
        <button className="ib theme-btn" title={`${themeLabel} (Ctrl+Shift+ג)`} aria-label={themeLabel} onClick={toggleTheme}>
          <Icon name={theme === 'light' ? 'moon' : 'sun'} />
          {theme === 'light' ? 'כהה' : 'בהיר'}
        </button>
        <button className="ib" title="טיפוגרפיה עברית, בדיקת איות ומילון אישי, גופנים, נקודת עצירה" onClick={() => setDialog({ kind: 'settings' })}>
          <Icon name="gear" />
          <span className="lbl">הגדרות כתיבה</span>
        </button>
        {inWrite && !empty && (
          <>
            <button
              className="ib"
              title={split!.panes.length >= MAX_PANES ? 'אפשר עד שלושה חלונות' : 'עוד חלון לצד החלון הפעיל (Ctrl+Shift+N)'}
              disabled={split!.panes.length >= MAX_PANES}
              onClick={addPaneNow}
            >
              <Icon name="pane-plus" />
              <span className="lbl">חלון נוסף</span>
            </button>
          </>
        )}
      </div>

      {book && !inBoard && !inRead && <FormatBar editor={editor} onBookmark={toggleBookmark} onNote={addNoteHere} onDrawer={toDrawer} />}

      <BgContext.Provider value={bgActions}>
      <div className="body">
        {!book && homeTab === 'workshop' && <Workshop show={show} openId={exerciseId} onOpen={setExerciseId} />}
        {!book && homeTab === 'books' && (
          <Home
            books={books}
            onOpen={openBook}
            onNew={() => setDialog({ kind: 'newBook' })}
            onOpenFolder={openFolder}
            onForget={(p) => api.forgetBook(p).then(refreshLibrary)}
            onRename={(p, t) =>
              void api.renameBook(p, t, true).then((r) => {
                if (!r.ok || !r.value) return show(r.error ?? 'לא הצלחתי לשנות את השם', true)
                const np = r.value.book.path
                if (np !== p) for (const rec of [savedLayouts.current, savedTr.current, lastChapter.current]) if (p in rec) (rec as Record<string, unknown>)[np] = (rec as Record<string, unknown>)[p]
                show(r.value.notice ?? `שם הספר שונה ל"${r.value.book.title}"`, !!r.value.notice)
                refreshLibrary()
              })
            }
            onArchive={(p, a) => void api.archiveBook(p, a).then(() => (refreshLibrary(), show(a ? 'הספר הועבר לארכיון שבתחתית הספרייה' : 'הספר חזר למדף')))}
          />
        )}
        {inBoard && planMode === 'timeline' && <Timeline bar={<PlanSwitch mode={planMode} onMode={setPlanMode} />} onOpenChapter={openChapter} />}
        {inBoard && planMode === 'inspiration' && <Inspiration bar={<PlanSwitch mode={planMode} onMode={setPlanMode} />} onOpenChapter={openChapter} />}
        {inBoard && planMode === 'cards' && (
          <CorkBoard
            modeSwitch={<PlanSwitch mode={planMode} onMode={setPlanMode} />}
            key={book!.path}
            book={book!}
            onOpen={openChapter}
            onMeta={updateMeta}
            onOutline={saveOutline}
            onAdd={(partId) => addChapter(partId)}
            onContextMenu={(chapter, x, y) => setMenu({ chapter, x, y })}
            onPartMenu={(part, x, y) => setMenu({ part, x, y })}
            onWords={setWords}
            renamingId={renamingId}
            onRename={renameChapter}
            onStartRename={setRenamingId}
          />
        )}
        {inRead && (
          <ReadingView
            key={book!.path}
            book={book!}
            startId={activeId}
            onPublish={(p) => void savePublish(p)}
            onEditMatter={() => setDialog({ kind: 'matter' })}
            onExport={(f) => void exportBook(f)}
            onOpenChapter={openChapter}
            onError={(m) => show(m, true)}
          />
        )}
        {book && !inBoard && !inRead && (
          <>
            <Binder
              book={book}
              activeId={inWrite ? (writeChapter?.id ?? null) : activeId}
              masterActive={inMaster || (multi && writeMaster)}
              onMaster={() => (multi ? updateSplit(setPaneContent(split!, split!.panes.indexOf(focusedPane!), { kind: 'master' })) : switchView('master'))}
              renamingId={renamingId}
              onSelect={selectChapter}
              onAdd={() => addChapter()}
              onAddPart={addPart}
              onRename={renameChapter}
              onStartRename={setRenamingId}
              onOutline={saveOutline}
              onContextMenu={(chapter, x, y) => setMenu({ chapter, x, y })}
              onPartMenu={(part, x, y) => setMenu({ part, x, y })}
              scenes={inWrite ? scenes : null}
              onScene={goToScene}
              bookmarks={<BookmarkList book={book} list={bookmarks} onGo={(b) => void goTo(b.chapterId, { pos: b.pos, before: b.before, after: b.after }, b.id)} onRemove={(b) => removeBookmark(b.id)} />}
              openMaterialIds={inWrite ? split!.panes.flatMap((p) => (p.content.kind === 'material' ? [p.content.id] : [])) : []}
              glossaryOpen={inWrite && split!.panes.some((p) => p.content.kind === 'glossary')}
              onOpenMaterial={(id) => void openBeside({ kind: 'material', id })}
              onNewMaterial={(k) => void newMaterial(k)}
              onOpenGlossary={() => void openBeside({ kind: 'glossary' })}
              onMaterialMenu={(material, x, y) => setMenu({ material, x, y })}
              onRenameBook={(t) => void renameBook(t)}
              onMatter={(pageId) => setDialog({ kind: 'matter', pageId })}
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
            ) : inWrite && !empty ? (
              <SplitView
                book={book}
                layout={split!}
                focusKey={focusedPane!.key}
                renamingId={renamingId}
                onLayout={updateSplit}
                only={focusOn ? focusedPane!.key : null}
                infoKey={multi && !focusOn ? infoKey : null}
                onInfo={setInfoKey}
                renderInfo={(ch) => <Inspector book={book} chapter={ch} onMeta={updateMeta} onShowFile={() => api.showFile(chapterPath(ch))} drafts={draftsCtx} focusNote={focusNote} />}
                onFocusPane={(k) => k !== focusKey && focusPane(k)}
                onEditor={setEditor}
                onRelease={(e) => setEditor((cur) => (cur === e ? null : cur))}
                onRename={renameChapter}
                onMasterFocus={setMasterFocusId}
                onOpenFromMaster={openChapter}
                onWords={setWords}
                onSaveState={setSaveState}
                onError={(m) => show(m, true)}
                activeChapterId={activeId}
                onBook={setBook}
                onNotice={(m) => show(m)}
                onNeedTranslatePane={needTranslatePane}
              />
            ) : (
              <main className="desk">
                <article className="paper">
                  <div className="paper-state">
                    אין עדיין פרקים בספר הזה.
                    <button className="btn" onClick={() => addChapter()}>
                      פרק חדש
                    </button>
                  </div>
                </article>
              </main>
            )}
            {stopCard && stopChapter && inWrite && <StopCard sp={stopCard} chapterTitle={stopChapter.title} onClose={() => setStopCard(null)} />}
            {inspected && !multi && !find && !drawerOpen && !reviewOpen && (
              <Inspector book={book} chapter={inspected} onMeta={updateMeta} onShowFile={() => api.showFile(chapterPath(inspected))} drafts={draftsCtx} focusNote={focusNote} />
            )}
          </>
        )}
        {book && reviewOpen && !find && !focusOn && !inBoard && !inRead && (
          <ReviewPanel
            key={book.path}
            target={{ mode: 'book', book, chapter: inspected ?? null, editor, goTo: (id, t) => void goTo(id, t) }}
            onClose={() => setReviewOpen(false)}
            show={show}
          />
        )}
        {book && drawerOpen && !find && !focusOn && !inBoard && !inRead && <DrawerPanel book={book} editor={editor} onClose={() => setDrawerOpen(false)} show={show} />}
        {book && find && !focusOn && !inRead && (
          <SearchPanel
            key={book.path}
            book={book}
            replace={find.replace}
            seed={find.seed}
            currentId={inWrite ? (writeChapter?.id ?? null) : inMaster || writeMaster ? (masterFocusId ?? null) : null}
            onGo={(id, t) => void goTo(id, t)}
            onClose={closeFind}
            onChanged={() => void refreshWords(book.path)}
            onError={(m) => show(m, true)}
          />
        )}
      </div>
      </BgContext.Provider>

      <div className="statusbar">
        {book && !inBoard && !inRead && !empty && (
          <span className={`saved ${saveState}`}>
            <i />
            <span>{SAVE_LABEL[saveState]}</span>
          </span>
        )}
        {(inMaster || writeMaster) && !empty ? (
          masterFocus ? (
            <span>
              עורך את <span className="fname">{masterFocus.file}</span>
            </span>
          ) : (
            <span>
              {MASTER_LABEL} · {book!.chapters.length} קבצים מקושרים
            </span>
          )
        ) : inBoard ? (
          <span>
            {planMode === 'cards'
              ? 'תכנון · לחיצה כפולה על כרטיס פותחת את הפרק, לחיצה על השם משנה אותו'
              : planMode === 'timeline'
                ? 'ציר זמן · אירועי הסיפור לפי סדר הזמן. גרירת הנקודה משנה את המקום'
                : 'לוח השראה · אפשר לגרור לכאן תמונות מהמחשב'}
          </span>
        ) : inRead ? (
          <span>מצב קריאה · חיצים או גלגלת להפוך דף · לחיצה כפולה על הטקסט פותחת את הפרק לכתיבה</span>
        ) : (
          writeChapter && <span className="fname">{writeChapter.file}</span>
        )}
        <span className="grow" />
        {selWords > 0 && <span className="wc sel">{selWords.toLocaleString('he-IL')} מילים מסומנות</span>}
        {writeChapter && <span className="wc">{words.toLocaleString('he-IL')} מילים בפרק</span>}
        {inBoard && !empty && planMode === 'cards' && <span className="wc">{words.toLocaleString('he-IL')} מילים בספר</span>}
        {book && !inBoard && !empty && (
          <span className="wc" title="סטטיסטיקה בלבד">
            {totalWords.toLocaleString('he-IL')} מילים בספר
          </span>
        )}
        {bookTr && (
          <span className="wc" title={`בפרקים שיש להם מקור: ${bookTr.done} מתוך ${bookTr.total} פסקאות של המקור כבר מתורגמות (נתון בלבד)`}>
            תורגם {bookTr.percent}% מהספר
          </span>
        )}
        {book && (
          <span>
            {book.chapters.length} פרקים
            {parts(book.outline).length > 0 && ` · ${parts(book.outline).length} חלקים`}
          </span>
        )}
        <span className="zoom" role="group" aria-label="גודל התצוגה">
          <button className="ib icon" title="הקטנה (Ctrl+מינוס)" aria-label="הקטנת התצוגה" disabled={zoom <= ZOOMS[0]} onClick={() => stepZoom(-1)}>
            <Icon name="minus" />
          </button>
          <button className="ib zval" title="חזרה ל-100% (Ctrl+0)" onClick={() => setZoom(1)}>
            {Math.round(zoom * 100)}%
          </button>
          <button className="ib icon" title="הגדלה (Ctrl+פלוס)" aria-label="הגדלת התצוגה" disabled={zoom >= ZOOMS[ZOOMS.length - 1]} onClick={() => stepZoom(1)}>
            <Icon name="plus" />
          </button>
        </span>
      </div>

      {focusOn && <FocusBar chapterWords={writeChapter ? words : null} bookWords={totalWords} theme={theme} onTheme={toggleTheme} onExit={exitFocus} />}
      {niqqudOpen && editor && !editor.isDestroyed && <NiqqudAtCursor editor={editor} onClose={() => setNiqqudOpen(false)} />}
      {compare && <CompareDialog req={compare} onClose={() => setCompare(null)} />}
      {quick && book && <QuickOpen entries={quickEntries()} onClose={() => setQuick(false)} />}
      {namer && editor && !editor.isDestroyed && <BookmarkNamer editor={editor} bookmark={namer} onClose={() => setNamer(null)} />}
      {stopAsk && (
        <StopDialog
          previous={book?.stopPoint}
          closingApp={stopAsk.closingApp}
          onDone={(note) => {
            stopNoteRef.current = note
            stopAsk.resolve(true)
          }}
          onCancel={() => stopAsk.resolve(false)}
        />
      )}

      {menu && 'chapter' in menu && book && (
        <div className="menu" role="menu" style={{ top: Math.min(menu.y, window.innerHeight - 320), left: Math.max(8, menu.x - 200) }} onClick={(e) => e.stopPropagation()}>
          <button role="menuitem" onClick={() => (setRenamingId(menu.chapter.id), setMenu(null))}>
            <Icon name="rename" />
            שינוי שם
          </button>
          <button role="menuitem" onClick={() => (api.showFile(chapterPath(menu.chapter)), setMenu(null))}>
            <Icon name="folder" />
            הצגה בתיקייה
          </button>
          <div className="msep" />
          <button role="menuitem" title="חלק חדש שמתחיל בפרק הזה וכולל את הפרקים שאחריו" onClick={() => (partFromChapter(menu.chapter), setMenu(null))}>
            <Icon name="part-plus" />
            חלק חדש מהפרק הזה
          </button>
          {parts(book.outline).length > 0 && (
            <>
              <div className="mlabel">העברה לחלק</div>
              {parts(book.outline).map((p) => {
                const here = p.children.includes(menu.chapter.id)
                return (
                  <button key={p.id} role="menuitemradio" aria-checked={here} disabled={here} onClick={() => (moveToPart(menu.chapter, p.id), setMenu(null))}>
                    <Icon name="part" />
                    {p.title}
                  </button>
                )
              })}
              {partOf(book.outline, menu.chapter.id) && (
                <button role="menuitem" onClick={() => (moveToPart(menu.chapter, null), setMenu(null))}>
                  <Icon name="file" />
                  הוצאה מהחלק
                </button>
              )}
            </>
          )}
          <div className="msep" />
          <button role="menuitem" className="danger" onClick={() => (setDialog({ kind: 'delete', chapter: menu.chapter }), setMenu(null))}>
            <Icon name="trash" />
            מחיקת הפרק
          </button>
        </div>
      )}
      {menu && 'material' in menu && (
        <div className="menu" role="menu" style={{ top: Math.min(menu.y, window.innerHeight - 200), left: Math.max(8, menu.x - 200) }} onClick={(e) => e.stopPropagation()}>
          <button role="menuitem" onClick={() => (void openBeside({ kind: 'material', id: menu.material.id }), setMenu(null))}>
            <Icon name={KIND_ICON[menu.material.kind]} />
            פתיחה
          </button>
          <button role="menuitem" onClick={() => (book && void api.showMaterialFile(book.path, menu.material.id), setMenu(null))}>
            <Icon name="folder" />
            הצגה בתיקייה
          </button>
          <div className="msep" />
          <button role="menuitem" className="danger" onClick={() => (setDialog({ kind: 'deleteMaterial', material: menu.material }), setMenu(null))}>
            <Icon name="trash" />
            מחיקת הדף
          </button>
        </div>
      )}
      {menu && 'part' in menu && (
        <div className="menu" role="menu" style={{ top: menu.y, left: Math.max(8, menu.x - 200) }} onClick={(e) => e.stopPropagation()}>
          <button role="menuitem" onClick={() => (setRenamingId(menu.part.id), setMenu(null))}>
            <Icon name="rename" />
            שינוי שם החלק
          </button>
          <button role="menuitem" onClick={() => (void addChapter(menu.part.id), setMenu(null))}>
            <Icon name="plus" />
            פרק חדש בחלק הזה
          </button>
          <div className="msep" />
          <button role="menuitem" className="danger" onClick={() => (setDialog({ kind: 'deletePart', part: menu.part }), setMenu(null))}>
            <Icon name="trash" />
            הסרת החלק
          </button>
        </div>
      )}

      {dialog?.kind === 'titleStyle' && book && (
        <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && setDialog(null)}>
          <div className="dialog title-style" role="dialog" aria-label="כותרות הפרקים" onKeyDown={(e) => e.key === 'Escape' && setDialog(null)}>
            <h2>כותרות הפרקים</h2>
            <p>חל על כל הפרקים: בעורך, במצב קריאה ובכל ייצוא. את שאר חלקי הספר מעצבים בדף "עימוד" שבמצב קריאה.</p>
            <ElementStyleFields el="chapterTitle" layout={book.publish.layout} onChange={(patch) => void savePublish({ ...book.publish, layout: { ...book.publish.layout, ...patch } })} />
            <div className="actions">
              <button className="btn" onClick={() => setDialog(null)}>
                סגירה
              </button>
            </div>
          </div>
        </div>
      )}
      {dialog?.kind === 'matter' && book && (
        <MatterDialog
          book={book}
          startId={dialog.pageId}
          onSave={(p) => (publishSaving.current = savePublish(p))}
          onRenameBook={(t) => void publishSaving.current.then(() => renameBook(t))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'settings' && <WritingSettings onClose={() => setDialog(null)} />}
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

      {dialog?.kind === 'deleteMaterial' && (
        <ConfirmDialog
          title={`למחוק את "${dialog.material.name}"?`}
          text={`קובץ ה-Word של ה${KIND_ONE[dialog.material.kind]} יעבור לסל המחזור של Windows. התמונות שלו יישארו בלוח ההשראה, בלי שיוך.`}
          confirmLabel="מחיקה"
          onCancel={() => setDialog(null)}
          onConfirm={() => void deleteMaterial(dialog.material)}
        />
      )}
      {dialog?.kind === 'deletePart' && (
        <ConfirmDialog
          title={`להסיר את החלק "${dialog.part.title}"?`}
          text={
            dialog.part.children.length
              ? `רק החלוקה תוסר. ${dialog.part.children.length === 1 ? 'הפרק שבחלק נשאר' : `${dialog.part.children.length} הפרקים שבחלק נשארים`} בספר, באותו מקום ובאותו סדר. שום קובץ לא נמחק.`
              : 'החלק ריק, ושום קובץ לא נמחק.'
          }
          confirmLabel="הסרה"
          onCancel={() => setDialog(null)}
          onConfirm={() => removePart(dialog.part)}
        />
      )}

      <UpdateBanner />
      {toast && (
        <div className={`toast${toast.error ? ' error' : ''}`} role="status" onClick={() => setToast(null)}>
          {toast.text}
        </div>
      )}
    </div>
  )
}

