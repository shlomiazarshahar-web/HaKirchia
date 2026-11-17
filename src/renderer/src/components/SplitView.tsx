// Split screen (feature 6): two or three panes side by side, each showing a chapter or the master.
// Every pane is a full editor of the chapter's own file. When the same chapter is open twice, the
// editors pass the typing to each other (see onLiveEdit in api.ts), so nothing is saved twice.
//
// PaneFrame and PaneRow are generic on purpose: the translation screen (feature 12) will put a PDF
// and the embedded Google Translate in the same kind of panes, with the same draggable borders.

import { Fragment, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { Editor } from '@tiptap/react'
import type { Book, Chapter } from '@shared/types'
import { CHAPTER_DRAG_TYPE, resizeBorder, swapPanes, closePane, setPaneContent, type PaneContent, type PaneLayout } from '@shared/panes'
import { ChapterEditor, type SaveState } from './ChapterEditor'
import { MasterView } from './MasterView'
import { Icon } from './Icons'
import { MASTER_LABEL } from '../labels'


const WORST: SaveState[] = ['error', 'saving', 'dirty', 'saved']

interface Props {
  book: Book
  layout: PaneLayout
  focusKey: string
  /** right after adding a chapter: its name is being typed in the binder, so don't grab the focus */
  renamingId: string | null
  onLayout: (l: PaneLayout) => void
  /** focused writing mode: only this pane is shown (the others stay open, hidden) */
  only?: string | null
  /** the pane whose "על הפרק" panel is open (slides out inside that pane), and how to draw it */
  infoKey: string | null
  onInfo: (key: string | null) => void
  renderInfo: (ch: Chapter) => ReactNode
  onFocusPane: (key: string) => void
  onEditor: (e: Editor | null) => void
  onRelease: (e: Editor) => void
  onRename: (id: string, title: string) => void
  /** master pane: the chapter being edited / the "open chapter" link */
  onMasterFocus: (id: string) => void
  onOpenFromMaster: (id: string) => void
  /** words and save state of the pane in focus, for the status bar */
  onWords: (n: number) => void
  onSaveState: (s: SaveState) => void
  onError: (msg: string) => void
}

export function SplitView(props: Props) {
  const { book, layout, focusKey, onLayout, onFocusPane } = props
  const words = useRef(new Map<string, number>())
  // words per pane, also kept in state so the pane headers show them
  const [shown, setShown] = useState<Record<string, number>>({})
  const states = useRef(new Map<string, SaveState>())
  const byId = new Map(book.chapters.map((c) => [c.id, c]))
  const n = layout.panes.length

  const report = () => {
    props.onWords(words.current.get(focusKey) ?? 0)
    const keys = new Set(layout.panes.map((p) => p.key))
    const all = [...states.current].filter(([k]) => keys.has(k)).map(([, s]) => s)
    props.onSaveState(WORST.find((s) => all.includes(s)) ?? 'saved')
  }
  const reportRef = useRef(report)
  reportRef.current = report
  useEffect(() => reportRef.current(), [focusKey, layout])

  const setWords = (key: string, w: number) => {
    words.current.set(key, w)
    setShown((m) => (m[key] === w ? m : { ...m, [key]: w }))
    if (key === focusKey) props.onWords(w)
  }
  const setState = (key: string, s: SaveState) => {
    states.current.set(key, s)
    reportRef.current()
  }

  return (
    <PaneRow widths={layout.widths} only={props.only ? layout.panes.findIndex((p) => p.key === props.only) : -1} onWidths={(widths) => onLayout({ ...layout, widths })}>
      {layout.panes.map((pane, i) => {
        const c = pane.content
        const ch = c.kind === 'chapter' ? byId.get(c.id) : undefined
        const focused = pane.key === focusKey
        return (
          <PaneFrame
            key={pane.key}
            paneKey={pane.key}
            focused={focused && n > 1 && !props.only}
            bare={n === 1 || !!props.only}
            onFocus={() => onFocusPane(pane.key)}
            onDropChapter={(id) => {
              onLayout(setPaneContent(layout, i, { kind: 'chapter', id }))
              onFocusPane(pane.key)
            }}
            head={
              <>
                <Icon name={c.kind === 'master' ? 'master' : 'file'} />
                <ContentPicker book={book} value={c} label={`מה מוצג בחלון ${i + 1}`} onChange={(v) => onLayout(setPaneContent(layout, i, v))} />
                {shown[pane.key] !== undefined && (
                  <small className="pstat" title={ch ? ch.file : undefined}>
                    {shown[pane.key].toLocaleString('he-IL')} מילים{c.kind === 'master' ? ' בספר' : ''}
                  </small>
                )}
              </>
            }
            drawer={
              ch && props.infoKey === pane.key ? (
                <PaneDrawer label={`על הפרק: ${ch.title}`} onClose={() => props.onInfo(null)}>
                  {props.renderInfo(ch)}
                </PaneDrawer>
              ) : null
            }
            actions={
              <>
                {ch && (
                  <button
                    className="ib icon"
                    data-drawer-toggle={pane.key}
                    aria-pressed={props.infoKey === pane.key}
                    title="על הפרק: סטטוס, תקציר והערות (Ctrl+Shift+I)"
                    aria-label="על הפרק"
                    onClick={() => props.onInfo(props.infoKey === pane.key ? null : pane.key)}
                  >
                    <Icon name="info" />
                  </button>
                )}
                {i < n - 1 && (
                  <button className="ib icon" title="החלפת מקום עם החלון שמשמאל" aria-label="החלפת מקום עם החלון שמשמאל" onClick={() => onLayout(swapPanes(layout, i, i + 1))}>
                    <Icon name="swap" />
                  </button>
                )}
                <button className="ib icon" title={n > 1 ? 'סגירת החלון (Ctrl+Shift+X)' : 'זה החלון היחיד'} aria-label="סגירת החלון" disabled={n <= 1} onClick={() => onLayout(closePane(layout, i))}>
                  <Icon name="close" />
                </button>
              </>
            }
          >
            {c.kind === 'master' ? (
              <MasterView
                key={`${book.path}|master`}
                book={book}
                onEditor={props.onEditor}
                onRelease={props.onRelease}
                onFocusChapter={props.onMasterFocus}
                onOpenChapter={props.onOpenFromMaster}
                onWords={(w) => setWords(pane.key, w)}
                onSaveState={(s) => setState(pane.key, s)}
                onError={props.onError}
              />
            ) : ch ? (
              <ChapterEditor
                key={`${book.path}|${ch.id}`}
                book={book}
                chapter={ch}
                activateOn="focus"
                autoFocus={false}
                onEditor={props.onEditor}
                onRelease={props.onRelease}
                onWords={(w) => setWords(pane.key, w)}
                onSaveState={(s) => setState(pane.key, s)}
                onError={props.onError}
                onRename={(t) => props.onRename(ch.id, t)}
              />
            ) : null}
          </PaneFrame>
        )
      })}
    </PaneRow>
  )
}

/** Chooses what a pane shows: the master or any chapter, grouped by part like the binder. */
function ContentPicker({ book, value, label, onChange }: { book: Book; value: PaneContent; label: string; onChange: (c: PaneContent) => void }) {
  const byId = new Map(book.chapters.map((c) => [c.id, c]))
  const num = new Map(book.chapters.map((c, i) => [c.id, i + 1]))
  const opt = (id: string) => {
    const ch = byId.get(id)
    return ch ? (
      <option key={id} value={`c:${id}`}>
        {num.get(id)}. {ch.title}
      </option>
    ) : null
  }
  const loose: ReactNode[] = []
  const groups: ReactNode[] = []
  for (const node of book.outline) {
    if (node.type === 'chapter') loose.push(opt(node.id))
    else
      groups.push(
        <optgroup key={node.id} label={node.title}>
          {node.children.map(opt)}
        </optgroup>
      )
  }
  return (
    <select
      className="ppick"
      aria-label={label}
      title="בחירת מה להציג בחלון הזה"
      value={value.kind === 'master' ? 'master' : `c:${value.id}`}
      onChange={(e) => {
        const v = e.target.value
        onChange(v === 'master' ? { kind: 'master' } : { kind: 'chapter', id: v.slice(2) })
      }}
    >
      <option value="master">{MASTER_LABEL}</option>
      {loose.length > 0 && <optgroup label="פרקים">{loose}</optgroup>}
      {groups}
    </select>
  )
}

/** One pane: a header bar (what it shows + buttons) above its own scrolling content. */
export function PaneFrame({
  head,
  actions,
  focused,
  bare = false,
  drawer,
  paneKey,
  onFocus,
  onDropChapter,
  children
}: {
  head: ReactNode
  actions?: ReactNode
  focused: boolean
  /** the only pane: no header bar, looks like the plain writing view */
  bare?: boolean
  /** a side panel that slides out inside this pane, over its content */
  drawer?: ReactNode
  /** data-pane on the pane, so an editor can be told apart by the pane it is in */
  paneKey?: string
  onFocus: () => void
  onDropChapter?: (id: string) => void
  children: ReactNode
}) {
  const [dropOn, setDropOn] = useState(false)
  const accepts = (e: DragEvent) => !!onDropChapter && e.dataTransfer.types.includes(CHAPTER_DRAG_TYPE)
  return (
    <section
      className={`pane${focused ? ' focused' : ''}${bare ? ' bare' : ''}${dropOn ? ' drop' : ''}`}
      data-pane={paneKey}
      onFocusCapture={onFocus}
      onMouseDown={onFocus}
      onDragOver={(e) => {
        if (!accepts(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setDropOn(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropOn(false)
      }}
      onDrop={(e) => {
        if (!accepts(e)) return
        e.preventDefault()
        setDropOn(false)
        const id = e.dataTransfer.getData(CHAPTER_DRAG_TYPE)
        if (id) onDropChapter!(id)
      }}
    >
      {!bare && (
        <div className="phead">
          <span className="t">{head}</span>
          {actions}
        </div>
      )}
      <div className="pbody">
        {children}
        {drawer}
      </div>
      {dropOn && <div className="pdrop">שחררו כאן כדי לפתוח את הפרק בחלון הזה</div>}
    </section>
  )
}

/** A side panel inside a pane. Closes by itself on a click anywhere outside it, or with Esc. */
export function PaneDrawer({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (ref.current && !ref.current.contains(t) && !t.closest('[data-drawer-toggle]')) close.current()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close.current()
    window.addEventListener('mousedown', down, true)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', down, true)
      window.removeEventListener('keydown', key)
    }
  }, [])
  return (
    <div className="pdrawer" ref={ref} role="complementary" aria-label={label}>
      {children}
    </div>
  )
}

/** Panes in a row with draggable borders between them. Widths are fractions that add up to 1. */
export function PaneRow({ widths, onWidths, only = -1, children }: { widths: number[]; onWidths: (w: number[]) => void; only?: number; children: ReactNode[] }) {
  const row = useRef<HTMLDivElement>(null)
  const drag = useRef<{ index: number; x: number; start: number[] } | null>(null)
  const [dragging, setDragging] = useState(false)

  const begin = (index: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { index, x: e.clientX, start: widths }
    setDragging(true)
  }
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || !row.current) return
    const W = row.current.getBoundingClientRect().width
    const rtl = getComputedStyle(row.current).direction === 'rtl'
    // In right-to-left, the first pane is on the right: moving the border left makes it wider
    const dx = (e.clientX - d.x) * (rtl ? -1 : 1)
    onWidths(resizeBorder(d.start, d.index, dx / W))
  }
  const end = () => {
    drag.current = null
    setDragging(false)
  }
  const nudge = (index: number) => (e: React.KeyboardEvent) => {
    const rtl = row.current && getComputedStyle(row.current).direction === 'rtl'
    const step = e.key === 'ArrowLeft' ? 0.03 : e.key === 'ArrowRight' ? -0.03 : 0
    if (!step) return
    e.preventDefault()
    onWidths(resizeBorder(widths, index, rtl ? step : -step))
  }

  return (
    <div className={`panes${dragging ? ' resizing' : ''}`} ref={row}>
      {children.map((child, i) => (
        <Fragment key={(child as { key?: string }).key ?? i}>
          {i > 0 && only < 0 && (
            <div
              className="prz"
              role="separator"
              aria-orientation="vertical"
              aria-label="גבול בין חלונות, גרירה משנה את הרוחב"
              tabIndex={0}
              title="גרירה לשינוי הרוחב. לחיצה כפולה: רוחב שווה"
              onPointerDown={begin(i - 1)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              onDoubleClick={() => onWidths(widths.map(() => 1 / widths.length))}
              onKeyDown={nudge(i - 1)}
            />
          )}
          <div className="pslot" style={only < 0 ? { flex: `${widths[i] ?? 1} 1 0` } : only === i ? { flex: '1 1 0' } : { display: 'none' }}>
            {child}
          </div>
        </Fragment>
      ))}
    </div>
  )
}
