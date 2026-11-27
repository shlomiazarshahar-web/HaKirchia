// Split screen (feature 6): two or three panes side by side, each showing a chapter or the master.
// Every pane is a full editor of the chapter's own file. When the same chapter is open twice, the
// editors pass the typing to each other (see onLiveEdit in api.ts), so nothing is saved twice.
//
// PaneFrame and PaneRow are generic on purpose: the translation screen (feature 12) will put a PDF
// and the embedded Google Translate in the same kind of panes, with the same draggable borders.

import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { Editor } from '@tiptap/react'
import type { Book, Chapter } from '@shared/types'
import { CHAPTER_DRAG_TYPE, MATERIAL_DRAG_TYPE, MAX_PANES, evenSplit, layoutRects, nextContent, resizeSplit, splitPane, swapPanes, closePane, setPaneContent, treeOf, type PaneContent, type PaneLayout, type PaneNode } from '@shared/panes'
import { AltEditor, ChapterEditor, type SaveState } from './ChapterEditor'
import { MasterView } from './MasterView'
import { PdfPane } from './PdfPane'
import { WebPane } from './WebPane'
import { Icon } from './Icons'
import { MASTER_LABEL } from '../labels'
import { KIND_ICON, KIND_LABEL, MATERIAL_KINDS, materialsOf } from '@shared/background'
import { MaterialPane } from './Background'
import { GlossaryPane } from './Glossary'


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
  /** Translation (features 12, 13): the chapter the PDF pane follows, and what it needs */
  activeChapterId: string | null
  onBook: (b: Book) => void
  onNotice: (msg: string) => void
  onNeedTranslatePane: () => void
  /** The writing review (feature 19) when it is shown as a pane */
  renderReview: (onClose: () => void) => ReactNode
  /** The plan beside the writing (feature 67) */
  renderPlan: () => ReactNode
}

export function SplitView(props: Props) {
  const { book, layout, focusKey, onLayout, onFocusPane } = props
  const words = useRef(new Map<string, number>())
  // words per pane, also kept in state so the pane headers show them
  const [shown, setShown] = useState<Record<string, number>>({})
  const states = useRef(new Map<string, SaveState>())
  const byId = new Map(book.chapters.map((c) => [c.id, c]))
  const n = layout.panes.length
  // The PDF pane shows the original of the chapter in focus (or else of the first chapter on screen)
  const shownChapters = layout.panes.flatMap((p) => (p.content.kind === 'chapter' ? [p.content.id] : []))
  const pdfChapterId = props.activeChapterId && shownChapters.includes(props.activeChapterId) ? props.activeChapterId : (shownChapters[0] ?? null)
  const pdfChapter = pdfChapterId ? (byId.get(pdfChapterId) ?? null) : null

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
    <PaneArea tree={treeOf(layout)} only={props.only ?? null} onTree={(tree) => onLayout({ ...layout, tree })}>
      {layout.panes.map((pane, i) => {
        const c = pane.content
        const ch = c.kind === 'chapter' ? byId.get(c.id) : undefined
        const alt = c.kind === 'alt' ? book.alts?.find((a) => a.id === c.id) : undefined
        const altOf = alt ? byId.get(alt.chapterId) : undefined
        const mat = c.kind === 'material' ? book.materials.find((m) => m.id === c.id) : undefined
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
            onDropMaterial={(id) => {
              onLayout(setPaneContent(layout, i, { kind: 'material', id }))
              onFocusPane(pane.key)
            }}
            head={
              <>
                <Icon name={c.kind === 'master' ? 'master' : c.kind === 'alt' ? 'alt' : c.kind === 'pdf' ? 'pdf' : c.kind === 'web' ? 'globe' : c.kind === 'glossary' ? 'glossary' : c.kind === 'review' ? 'review' : c.kind === 'plan' ? 'grid' : mat ? KIND_ICON[mat.kind] : 'file'} />
                <ContentPicker book={book} value={c} label={`מה מוצג בחלון ${i + 1}`} onChange={(v) => onLayout(setPaneContent(layout, i, v))} />
                {c.kind === 'pdf' && pdfChapter && <small className="pstat">של {pdfChapter.title}</small>}
                {shown[pane.key] !== undefined && (c.kind === 'chapter' || c.kind === 'master' || c.kind === 'alt') && (
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
                {n < MAX_PANES && (
                  <>
                    <button className="ib icon" title="פיצול החלון לשניים, זה לצד זה" aria-label="פיצול לצד" onClick={() => onLayout(splitPane(layout, i, nextContent(layout, book, i), 'h'))}>
                      <Icon name="split-h" />
                    </button>
                    <button className="ib icon" title="פיצול החלון לשניים, זה מעל זה" aria-label="פיצול למטה" onClick={() => onLayout(splitPane(layout, i, nextContent(layout, book, i), 'v'))}>
                      <Icon name="split-v" />
                    </button>
                  </>
                )}
                {i < n - 1 && (
                  <button className="ib icon" title="החלפת מקום עם החלון הבא" aria-label="החלפת מקום עם החלון הבא" onClick={() => onLayout(swapPanes(layout, i, i + 1))}>
                    <Icon name="swap" />
                  </button>
                )}
                <button className="ib icon" title={n > 1 ? 'סגירת החלון (Ctrl+Shift+X)' : 'זה החלון היחיד'} aria-label="סגירת החלון" disabled={n <= 1} onClick={() => onLayout(closePane(layout, i))}>
                  <Icon name="close" />
                </button>
              </>
            }
          >
            {c.kind === 'review' ? (
              <div className="pane-review">{props.renderReview(() => onLayout(closePane(layout, i)))}</div>
            ) : c.kind === 'plan' ? (
              props.renderPlan()
            ) : c.kind === 'pdf' ? (
              <PdfPane book={book} chapter={pdfChapter} onBook={props.onBook} onError={props.onError} onNotice={props.onNotice} onNeedTranslatePane={props.onNeedTranslatePane} />
            ) : c.kind === 'web' ? (
              <WebPane />
            ) : c.kind === 'glossary' ? (
              <GlossaryPane />
            ) : mat ? (
              <MaterialPane
                key={`${book.path}|mat|${mat.id}`}
                material={mat}
                onEditor={props.onEditor}
                onRelease={props.onRelease}
                onWords={(w) => setWords(pane.key, w)}
                onSaveState={(s) => setState(pane.key, s)}
                onError={props.onError}
              />
            ) : c.kind === 'master' ? (
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
            ) : alt && altOf ? (
              <AltEditor
                key={`${book.path}|alt|${alt.id}`}
                book={book}
                alt={alt}
                chapter={altOf}
                activateOn="focus"
                autoFocus={false}
                onEditor={props.onEditor}
                onRelease={props.onRelease}
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
    </PaneArea>
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
      value={
        value.kind === 'master' || value.kind === 'pdf' || value.kind === 'web' || value.kind === 'glossary' || value.kind === 'review' || value.kind === 'plan'
          ? value.kind
          : value.kind === 'alt'
            ? `a:${value.id}`
            : value.kind === 'material'
              ? `m:${value.id}`
              : `c:${value.id}`
      }
      onChange={(e) => {
        const v = e.target.value
        onChange(
          v === 'master' || v === 'pdf' || v === 'web' || v === 'glossary' || v === 'review' || v === 'plan'
            ? { kind: v }
            : v.startsWith('a:')
              ? { kind: 'alt', id: v.slice(2) }
              : v.startsWith('m:')
                ? { kind: 'material', id: v.slice(2) }
                : { kind: 'chapter', id: v.slice(2) }
        )
      }}
    >
      <option value="master">{MASTER_LABEL}</option>
      <option value="plan">תכנון: כרטיסים או ציר זמן</option>
      <option value="review">ביקורת כתיבה (Claude)</option>
      <optgroup label="תרגום">
        <option value="pdf">המקור (PDF) של הפרק</option>
        <option value="web">גוגל תרגום</option>
      </optgroup>
      {loose.length > 0 && <optgroup label="פרקים">{loose}</optgroup>}
      {groups}
      <optgroup label="חומרי רקע">
        <option value="glossary">מילון מונחים ושמות</option>
      </optgroup>
      {MATERIAL_KINDS.map((k) => {
        const list = materialsOf(book.materials ?? [], k)
        return list.length ? (
          <optgroup key={k} label={`חומרי רקע: ${KIND_LABEL[k]}`}>
            {list.map((m) => (
              <option key={m.id} value={`m:${m.id}`}>
                {m.name}
              </option>
            ))}
          </optgroup>
        ) : null
      })}
      {(book.alts ?? []).length > 0 && (
        <optgroup label="טיוטות חלופיות">
          {(book.alts ?? []).map((a) => (
            <option key={a.id} value={`a:${a.id}`}>
              {a.name} ({byId.get(a.chapterId)?.title ?? ''})
            </option>
          ))}
        </optgroup>
      )}
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
  onDropMaterial,
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
  onDropMaterial?: (id: string) => void
  children: ReactNode
}) {
  const [dropOn, setDropOn] = useState(false)
  const accepts = (e: DragEvent) =>
    (!!onDropChapter && e.dataTransfer.types.includes(CHAPTER_DRAG_TYPE)) || (!!onDropMaterial && e.dataTransfer.types.includes(MATERIAL_DRAG_TYPE))
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
        const mid = e.dataTransfer.getData(MATERIAL_DRAG_TYPE)
        if (id) onDropChapter!(id)
        else if (mid) onDropMaterial?.(mid)
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
      {dropOn && <div className="pdrop">שחררו כאן כדי לפתוח בחלון הזה</div>}
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

/**
 * The panes, placed by the layout tree (round 11, Blender-like): every pane is positioned on its own
 * over one area, so splitting or closing a pane never reloads the others. Every border between
 * panes can be dragged; a double click makes that split even.
 */
export function PaneArea({ tree, onTree, only = null, children }: { tree: PaneNode; onTree: (t: PaneNode) => void; only?: string | null; children: ReactNode[] }) {
  const area = useRef<HTMLDivElement>(null)
  const drag = useRef<{ path: number[]; index: number; dir: 'h' | 'v'; at: number; span: number; start: PaneNode } | null>(null)
  const [dragging, setDragging] = useState<'h' | 'v' | null>(null)
  const { rects, borders } = layoutRects(tree)
  const rtl = () => !!area.current && getComputedStyle(area.current).direction === 'rtl'

  const begin = (b: (typeof borders)[number]) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { path: b.path, index: b.index, dir: b.dir, at: b.dir === 'h' ? e.clientX : e.clientY, span: b.span, start: tree }
    setDragging(b.dir)
  }
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || !area.current) return
    const box = area.current.getBoundingClientRect()
    const whole = d.dir === 'h' ? box.width : box.height
    // in right-to-left the first pane is on the right: moving the border left makes it wider
    const px = d.dir === 'h' ? (e.clientX - d.at) * (rtl() ? -1 : 1) : e.clientY - d.at
    onTree(resizeSplit(d.start, d.path, d.index, px / Math.max(1, whole * d.span)))
  }
  const end = () => {
    drag.current = null
    setDragging(null)
  }
  const nudge = (b: (typeof borders)[number]) => (e: React.KeyboardEvent) => {
    let step = 0
    if (b.dir === 'h') step = e.key === 'ArrowLeft' ? 0.03 : e.key === 'ArrowRight' ? -0.03 : 0
    else step = e.key === 'ArrowDown' ? 0.03 : e.key === 'ArrowUp' ? -0.03 : 0
    if (!step) return
    e.preventDefault()
    onTree(resizeSplit(tree, b.path, b.index, b.dir === 'h' && !rtl() ? -step : step))
  }
  const pct = (v: number) => `${v * 100}%`

  return (
    <div className={`panes area${dragging ? ` resizing ${dragging}` : ''}`} ref={area}>
      {children.map((child, i) => {
        const key = (child as { key?: string }).key ?? String(i)
        const r = rects.get(key)
        const style: React.CSSProperties = only
          ? only === key
            ? { insetInlineStart: 0, top: 0, width: '100%', height: '100%' }
            : { display: 'none' }
          : r
            ? { insetInlineStart: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) }
            : { display: 'none' }
        return (
          <div key={key} className="pslot" style={style}>
            {child}
          </div>
        )
      })}
      {!only &&
        borders.map((b) => (
          <div
            key={`${b.path.join('.')}:${b.index}`}
            className={`prz ${b.dir}`}
            role="separator"
            aria-orientation={b.dir === 'h' ? 'vertical' : 'horizontal'}
            aria-label={b.dir === 'h' ? 'גבול בין חלונות, גרירה משנה את הרוחב' : 'גבול בין חלונות, גרירה משנה את הגובה'}
            tabIndex={0}
            title={b.dir === 'h' ? 'גרירה לשינוי הרוחב. לחיצה כפולה: חלוקה שווה' : 'גרירה לשינוי הגובה. לחיצה כפולה: חלוקה שווה'}
            style={b.dir === 'h' ? { insetInlineStart: pct(b.x), top: pct(b.y), height: pct(b.h) } : { insetInlineStart: pct(b.x), top: pct(b.y), width: pct(b.w) }}
            onPointerDown={begin(b)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onDoubleClick={() => onTree(evenSplit(tree, b.path))}
            onKeyDown={nudge(b)}
          />
        ))}
    </div>
  )
}
