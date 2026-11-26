// Reading mode (feature 31): the book as a printed book, page facing page, with no editing tools.
// It is laid out exactly like the PDF export (same page size, margins, fonts and switches), so it
// is also the print preview. Page 1 is on the left, alone, like the first page of a Hebrew book;
// then each spread shows an even page on the right and an odd page on the left.
//
// How: the whole book is one multi-column box whose columns are exactly the pages' text areas.
// Columns run from right to left; the box is moved sideways to show one spread at a time.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Book, PMNode } from '@shared/types'
import { bookCss, bookSections, oddPagePlan, pageGeometry, sectionTag, tocEntries, type Section } from '@shared/bookhtml'
import { ALIGN_LABEL, ELEMENT_KEYS, ELEMENTS, elStyle, PAGE_SIZES, printedTitle, type ElementKey, type ElementStyle, type BookLayout, type PageSize, type PublishSettings } from '@shared/publish'
import { api } from '../api'
import { fixPageStarts, PAGE_SLACK, placeFootnotes } from '../footnotes'
import { EDITOR_FONTS } from '../fonts'
import { usePrefs } from '../prefs'
import { Icon } from './Icons'

const MM = 96 / 25.4

interface Props {
  book: Book
  /** Open at this chapter (the one being written) */
  startId: string | null
  onPublish: (p: PublishSettings) => void
  onEditMatter: () => void
  onExport: (format: 'pdf' | 'docx' | 'epub') => void
  /** Double click on the text: write in that chapter */
  onOpenChapter: (id: string) => void
  onError: (msg: string) => void
}

const POS_KEY = 'hakirchia.readPage'
const readPos = (path: string): number | null => {
  try {
    const v = JSON.parse(localStorage.getItem(POS_KEY) ?? '{}')[path]
    return typeof v === 'number' ? v : null
  } catch {
    return null
  }
}
const writePos = (path: string, page: number) => {
  try {
    const all = JSON.parse(localStorage.getItem(POS_KEY) ?? '{}')
    all[path] = page
    localStorage.setItem(POS_KEY, JSON.stringify(all))
  } catch {
    /* not kept */
  }
}

interface Measure {
  /** Section index → first page (page 1 = the first page of the book) */
  starts: Record<number, number>
  pages: number
}

export function ReadingView({ book, startId, onPublish, onEditMatter, onExport, onOpenChapter, onError }: Props) {
  const [docs, setDocs] = useState<Record<string, PMNode> | null>(null)
  const [panel, setPanel] = useState(false)
  const layout = book.publish.layout

  // The chapters as saved (the view was opened after everything was saved)
  const structure = book.chapters.map((c) => c.id + c.title).join('|')
  useEffect(() => {
    let alive = true
    api.exportData(book.path).then((r) => {
      if (!alive) return
      if (!r.ok || !r.value) return onError(r.error ?? 'לא ניתן לקרוא את הפרקים')
      setDocs(r.value.docs)
    })
    return () => {
      alive = false
    }
  }, [book.path, structure])

  // the scene break image (feature 48), read from the book's folder
  const [sceneImage, setSceneImage] = useState<string | undefined>(undefined)
  useEffect(() => {
    let alive = true
    if (!layout.sceneImage) return setSceneImage(undefined)
    api.readSceneImage(book.path, layout.sceneImage).then((r) => alive && setSceneImage(r.ok && r.value ? r.value : undefined))
    return () => {
      alive = false
    }
  }, [book.path, layout.sceneImage, layout.sceneImageTick])

  const sections = useMemo(() => {
    if (!docs) return null
    return bookSections(
      { title: book.title, chapters: book.chapters.map((c) => ({ id: c.id, title: c.title, noExport: c.noExport, doc: docs[c.id] ?? { type: 'doc', content: [] } })), outline: book.outline, publish: book.publish, sceneImage },
      'end'
    )
  }, [docs, book, sceneImage])

  const setLayout = (patch: Partial<BookLayout>) => onPublish({ ...book.publish, layout: { ...layout, ...patch } })

  return (
    <div className="reading">
      {sections ? (
        <Pages book={book} sections={sections} layout={layout} startId={startId} onOpenChapter={onOpenChapter} panelOpen={panel} onPanel={() => setPanel(!panel)} />
      ) : (
        <div className="rd-loading">פותח את הספר…</div>
      )}
      {panel && <LayoutPanel bookPath={book.path} layout={layout} onChange={setLayout} onEditMatter={onEditMatter} onExport={onExport} onError={onError} onClose={() => setPanel(false)} />}
    </div>
  )
}

interface PagesProps {
  book: Book
  sections: Section[]
  layout: BookLayout
  startId: string | null
  onOpenChapter: (id: string) => void
  panelOpen: boolean
  onPanel: () => void
}

function Pages({ book, sections, layout, startId, onOpenChapter, panelOpen, onPanel }: PagesProps) {
  const g = pageGeometry(layout)
  const pageW = g.w * MM
  const pageH = g.h * MM
  const colW = (g.w - g.inner - g.outer) * MM
  // a few pixels shorter than the page, like the PDF (see footnotes.ts)
  const colH = (g.h - g.top - g.bottom) * MM - (layout.notesAt !== 'chapter' ? PAGE_SLACK : 0)
  const gap = 2 * g.inner * MM
  const stride = colW + gap
  const oddPages = layout.chapterNewPage && layout.chapterOdd

  const stage = useRef<HTMLDivElement>(null)
  const flow = useRef<HTMLDivElement>(null)
  const [blanks, setBlanks] = useState<number[] | null>(null)
  const [measure, setMeasure] = useState<Measure | null>(null)
  const [spread, setSpread] = useState(0)
  const [fit, setFit] = useState(1)
  const [fontsTick, setFontsTick] = useState(0)

  // Everything that changes the layout starts a new measuring round
  const html = useMemo(() => {
    const lead = '<div class="rd-lead"></div>'
    const set = new Set(blanks ?? [])
    return `<!--${fontsTick}-->` + lead + sections.map((s, i) => (set.has(i) ? '<div class="rd-blank"></div>' : '') + sectionTag(s, layout, i)).join('\n')
  }, [sections, layout, blanks, fontsTick])
  const css = useMemo(() => bookCss(layout, '.rd-flow'), [layout])
  const key = `${css}|${sections.map((s) => s.html.length).join(',')}|${fontsTick}`
  const lastKey = useRef(key)
  useEffect(() => {
    if (lastKey.current === key) return
    lastKey.current = key
    setBlanks(null)
    setMeasure(null)
  }, [key])

  // Fonts that finish loading change the layout
  useEffect(() => {
    const on = () => setFontsTick((t) => t + 1)
    document.fonts.addEventListener('loadingdone', on)
    return () => document.fonts.removeEventListener('loadingdone', on)
  }, [])

  /** The page an element starts on: its column, counted from the right */
  const pageOf = (el: HTMLElement): number => {
    const f = flow.current!
    return Math.max(0, Math.round((f.clientWidth - colW - el.offsetLeft) / stride))
  }

  useLayoutEffect(() => {
    const f = flow.current
    if (!f) return
    // a fresh copy of the book every time: placing the notes changes the text, and doing it twice breaks the pages
    f.innerHTML = html
    // footnotes go to the bottom of their page before the pages are counted
    if (layout.notesAt !== 'chapter') {
      placeFootnotes(f, { colW, colH, stride })
      // the same page starts as the PDF fixes (see print.ts), so both show the same pages
      fixPageStarts(f, { colW, colH, stride })
    }
    const starts: Record<number, number> = {}
    f.querySelectorAll<HTMLElement>(':scope > section[data-sec]').forEach((el) => {
      starts[Number(el.dataset.sec)] = pageOf(el)
    })
    if (blanks === null) {
      if (oddPages) {
        setBlanks(oddPagePlan(sections, starts, layout).blanks)
        return
      }
      setBlanks([])
      return
    }
    // columns run to the left; the whole width tells how many there are (column 0 is the empty one before page 1)
    const pages = Math.max(1, Math.round((f.scrollWidth + gap) / stride) - 1, ...Object.values(starts))
    // the table of contents shows the same page numbers
    f.querySelectorAll<HTMLElement>('.pg[data-toc]').forEach((el) => {
      const i = sections.findIndex((s) => s.id === el.dataset.toc)
      el.textContent = i >= 0 && starts[i] ? String(starts[i]) : ''
    })
    setMeasure({ starts, pages })
  }, [html, blanks])

  // Fit a spread to the screen
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth - 40
      const h = el.clientHeight - 30
      setFit(Math.max(0.3, Math.min(w / (2 * pageW), h / pageH)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [pageW, pageH])

  const lastSpread = measure ? Math.floor(measure.pages / 2) : 0
  const go = (k: number) => setSpread(Math.max(0, Math.min(lastSpread, k)))
  const goPage = (p: number) => go(Math.floor(p / 2))

  // Open where the writer is (or where reading stopped last time)
  const opened = useRef(false)
  useEffect(() => {
    if (!measure || opened.current) return
    opened.current = true
    const i = startId ? sections.findIndex((s) => s.id === startId) : -1
    const kept = readPos(book.path)
    if (i >= 0 && measure.starts[i]) goPage(measure.starts[i])
    else if (kept) goPage(kept)
  }, [measure])
  useEffect(() => {
    if (measure) writePos(book.path, spread * 2 || 1)
  }, [spread, measure])
  useEffect(() => {
    if (measure && spread > lastSpread) setSpread(lastSpread)
  }, [measure, lastSpread])

  // Keys: left = forward (like turning a page of a Hebrew book)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, select, textarea, [contenteditable="true"]')) return
      if (e.key === 'ArrowLeft' || e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) go(spread + 1)
      else if (e.key === 'ArrowRight' || e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) go(spread - 1)
      else if (e.key === 'Home') go(0)
      else if (e.key === 'End') go(lastSpread)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [spread, lastSpread])

  const wheelAt = useRef(0)
  const onWheel = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaY) < 8 || Date.now() - wheelAt.current < 350) return
    wheelAt.current = Date.now()
    go(spread + (e.deltaY > 0 ? 1 : -1))
  }

  /** Which section a page belongs to */
  const sectionAt = (p: number): number => {
    if (!measure) return -1
    let best = -1
    for (const [i, s] of Object.entries(measure.starts)) if (s <= p && (best < 0 || s >= measure.starts[best])) best = Number(i)
    return best
  }
  const isBlank = (p: number) => !!measure && (blanks ?? []).some((i) => measure.starts[i] === p + 1)

  /** Page number and running head of a page */
  const decor = (p: number): { head: string; num: string } => {
    if (!measure || p < 1 || p > measure.pages || isBlank(p)) return { head: '', num: '' }
    const i = sectionAt(p)
    const s = sections[i]
    if (!s || s.kind !== 'chapter') return { head: '', num: '' }
    const opening = measure.starts[i] === p
    const head = layout.runningHeads && !opening ? (p % 2 === 1 ? (layout.chapterNewPage ? s.title : '') : printedTitle(book.title, book.publish.info)) : ''
    return { head, num: layout.pageNumbers ? String(p) : '' }
  }

  const right = spread * 2
  const left = spread * 2 + 1
  const toc = useMemo(() => tocEntries({ title: book.title, chapters: book.chapters.map((c) => ({ id: c.id, title: c.title, doc: { type: 'doc' } })), outline: book.outline, publish: book.publish }), [book])
  const here = sectionAt(left <= (measure?.pages ?? 0) ? left : right)
  const hereId = sections[here]?.kind === 'matter' ? '' : (sections[here]?.id ?? '')

  // Links inside the book (contents, notes) turn to the page instead of scrolling
  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a[href^="#"]') as HTMLAnchorElement | null
    if (a) {
      e.preventDefault()
      const target = flow.current?.querySelector<HTMLElement>(`[id="${CSS.escape(a.getAttribute('href')!.slice(1))}"]`)
      if (target) goPage(pageOf(target))
      return
    }
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) return
    // a click on the left page turns forward, on the right page back
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    if (e.detail === 1) {
      const x = e.clientX - r.left
      if (x < r.width * 0.25) go(spread + 1)
      else if (x > r.width * 0.75) go(spread - 1)
    }
  }
  const onDoubleClick = (e: React.MouseEvent) => {
    const sec = (e.target as HTMLElement).closest('section[data-sec]') as HTMLElement | null
    const s = sec ? sections[Number(sec.dataset.sec)] : undefined
    if (s?.kind === 'chapter') onOpenChapter(s.id)
  }

  const pageInfo = measure ? (spread === 0 ? `עמוד 1 מתוך ${measure.pages}` : left <= measure.pages ? `עמודים ${right}–${left} מתוך ${measure.pages}` : `עמוד ${right} מתוך ${measure.pages}`) : 'מעמד את הספר…'
  const dRight = decor(right)
  const dLeft = decor(left)
  const hs = elStyle(layout, 'heads')
  const headFont = { fontFamily: `'${(hs.font || layout.font).replace(/'/g, '')}', serif`, fontSize: `${hs.size}pt`, fontWeight: hs.bold ? 700 : 400 }
  const paper = (side: 'right' | 'left', p: number, d: { head: string; num: string }): ReactNode =>
    p >= 1 && (!measure || p <= measure.pages) ? (
      <div className={`rd-paper ${side}`} style={{ width: pageW, height: pageH }}>
        {d.head && (
          <div className="rd-head" style={{ ...headFont, top: (g.top * MM) / 2 - 8, insetInline: side === 'right' ? `${g.outer * MM}px ${g.inner * MM}px` : `${g.inner * MM}px ${g.outer * MM}px` }}>
            {d.head}
          </div>
        )}
        {d.num && (
          <div className="rd-num" style={{ ...headFont, bottom: (g.bottom * MM) / 2 - 8 }}>
            {d.num}
          </div>
        )}
      </div>
    ) : (
      <div className={`rd-paper ${side} none`} style={{ width: pageW, height: pageH }} />
    )

  return (
    <div className="rd-main">
      <div className="rd-bar">
        <select className="ppick" aria-label="מעבר לפרק" value={hereId} onChange={(e) => {
          const i = sections.findIndex((s) => s.id === e.target.value)
          if (i >= 0 && measure?.starts[i]) goPage(measure.starts[i])
        }}>
          <option value="" disabled>
            {sections[here]?.kind === 'matter' ? 'עמודי פתיחה וסיום' : 'מעבר לפרק…'}
          </option>
          {toc.map((t) => (
            <option key={t.id} value={t.id}>
              {(t.level ? '   ' : '') + t.title}
            </option>
          ))}
        </select>
        <span className="grow" />
        <button className="ib icon" title="אחורה (חץ ימינה)" aria-label="עמודים קודמים" disabled={spread === 0} onClick={() => go(spread - 1)}>
          <Icon name="prev" />
        </button>
        <small className="rd-info">{pageInfo}</small>
        <button className="ib icon" title="קדימה (חץ שמאלה)" aria-label="עמודים הבאים" disabled={spread >= lastSpread} onClick={() => go(spread + 1)}>
          <Icon name="next" />
        </button>
        <span className="grow" />
        <button className="ib" aria-pressed={panelOpen} title="גודל עמוד, גופן וגודל האות, כותרות הפרקים, ומתגי עימוד" onClick={onPanel}>
          <Icon name="gear" />
          עימוד
        </button>
      </div>
      <div className="rd-stage" ref={stage} onWheel={onWheel}>
        <div className="rd-fitbox" style={{ width: 2 * pageW * fit, height: pageH * fit }}>
        <div className="rd-spread" style={{ width: 2 * pageW, height: pageH, transform: `scale(${fit})` }} onClick={onClick} onDoubleClick={onDoubleClick} title="לחיצה כפולה על הטקסט פותחת את הפרק לכתיבה">
          {paper('right', right, dRight)}
          {paper('left', left, dLeft)}
          <style>{css}</style>
          <style>{`.rd-flow { --ch: ${colH}px; }`}</style>
          <div className="rd-clip" style={{ top: g.top * MM, height: colH, insetInline: `${g.outer * MM}px` }}>
            <div
              ref={flow}
              className={`rd-flow${measure ? '' : ' measuring'}`}
              dir="rtl"
              style={{ width: 2 * colW + gap, height: colH, columnWidth: colW, columnGap: gap, transform: `translateX(${spread * 2 * stride}px)` }}
            />
          </div>
        </div>
        </div>
      </div>
    </div>
  )
}

interface PanelProps {
  bookPath: string
  onError: (msg: string) => void
  layout: BookLayout
  onChange: (patch: Partial<BookLayout>) => void
  onEditMatter: () => void
  onExport: (format: 'pdf' | 'docx' | 'epub') => void
  onClose: () => void
}

function LayoutPanel({ bookPath, layout, onChange, onEditMatter, onExport, onError, onClose }: PanelProps) {
  const prefs = usePrefs()
  const fonts = [...EDITOR_FONTS, ...prefs.customFonts.map((f) => f.family).filter((f) => !EDITOR_FONTS.includes(f))]
  const sw = (k: keyof BookLayout, label: string, title?: string, disabled = false) => (
    <label className="set-row" title={title}>
      <input type="checkbox" checked={!!layout[k]} disabled={disabled} onChange={(e) => onChange({ [k]: e.target.checked } as Partial<BookLayout>)} />
      <span>{label}</span>
    </label>
  )
  return (
    <aside className="rd-panel" aria-label="עימוד">
      <div className="rd-panel-h">
        <b>עימוד הספר</b>
        <button className="ib icon" aria-label="סגירה" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <p className="lp-note">ההגדרות נשמרות בספר, וה־PDF להדפסה יוצא בדיוק כך.</p>
      <label className="field">
        גודל עמוד
        <select value={layout.pageSize} onChange={(e) => onChange({ pageSize: e.target.value as PageSize })}>
          {(Object.keys(PAGE_SIZES) as PageSize[]).map((k) => (
            <option key={k} value={k}>
              {PAGE_SIZES[k].label}
            </option>
          ))}
        </select>
      </label>
      <div className="set-sub">גוף הטקסט</div>
      <label className="field">
        גופן
        <select value={layout.font} onChange={(e) => onChange({ font: e.target.value })} style={{ fontFamily: layout.font }}>
          {fonts.map((f) => (
            <option key={f} value={f} style={{ fontFamily: f }}>
              {f}
            </option>
          ))}
        </select>
      </label>
      <SizeField label="גודל האות" value={layout.fontSize} min={8} max={20} step={0.5} onChange={(fontSize) => onChange({ fontSize })} />
      <label className="field">
        רווח בין שורות
        <select value={String(layout.lineHeight)} onChange={(e) => onChange({ lineHeight: Number(e.target.value) })}>
          {[1.2, 1.35, 1.5, 1.65, 1.8, 2].map((v) => (
            <option key={v} value={String(v)}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <div className="set-sub">עיצוב חלקי הספר</div>
      <ElementsSection layout={layout} onChange={onChange} />
      <div className="set-sub">מעבר סצנה</div>
      <SceneImageField bookPath={bookPath} layout={layout} onChange={onChange} onError={onError} />
      <div className="set-sub">עימוד</div>
      {sw('partPage', 'כל כותרת חלק בעמוד משלה, באמצע העמוד')}
      {sw('chapterNewPage', 'כל פרק מתחיל בעמוד חדש')}
      {sw('chapterOdd', 'פרק מתחיל תמיד בעמוד שמאלי (אי־זוגי)', 'כמו בספרים מודפסים: אם צריך, נוסף עמוד ריק לפני הפרק', !layout.chapterNewPage)}
      {sw('justify', 'יישור לשני הצדדים')}
      <label className="set-row" title="בתחתית העמוד: כל הערה בעמוד שבו מופיע הסימון שלה. המספור רץ ברצף בכל הספר">
        <input type="checkbox" checked={layout.notesAt === 'chapter'} onChange={(e) => onChange({ notesAt: e.target.checked ? 'chapter' : 'page' })} />
        <span>הערות שוליים בסוף כל פרק (במקום בתחתית העמוד)</span>
      </label>
      {sw('pageNumbers', 'מספרי עמודים')}
      {sw('runningHeads', 'שם הספר ושם הפרק בראש העמוד')}
      {sw('matter', 'עמודי פתיחה וסיום (שער, הקדשה, תוכן…)')}
      <button className="btn ghost" onClick={onEditMatter}>
        עריכת עמודי הפתיחה והסיום…
      </button>
      <div className="set-sub">ייצוא</div>
      <div className="rd-exports">
        <button className="btn ghost" onClick={() => onExport('pdf')}>
          PDF להדפסה
        </button>
        <button className="btn ghost" onClick={() => onExport('docx')}>
          Word
        </button>
        <button className="btn ghost" onClick={() => onExport('epub')}>
          ePub
        </button>
      </div>
    </aside>
  )
}

/**
 * Feature 48: an image instead of the * * * sign between scenes, in reading mode, the PDF and the
 * ePub. While writing, the break stays * * *.
 */
function SceneImageField({ bookPath, layout, onChange, onError }: { bookPath: string; layout: BookLayout; onChange: (patch: Partial<BookLayout>) => void; onError: (msg: string) => void }) {
  const pick = async () => {
    const r = await api.pickSceneImage(bookPath)
    if (!r.ok) return onError(r.error ?? 'לא הצלחתי להוסיף את התמונה')
    // the tick makes the view read the file again when an image of the same name replaced it
    if (r.value) onChange({ sceneImage: r.value, sceneImageTick: Date.now() })
  }
  return (
    <>
      <p className="lp-note">בכתיבה נשאר * * *. במצב קריאה, ב־PDF וב־ePub יופיע במקומו קישוט שבוחרים.</p>
      <div className="rd-exports">
        <button className="btn ghost" onClick={() => void pick()}>
          {layout.sceneImage ? 'החלפת התמונה…' : 'בחירת תמונה…'}
        </button>
        {layout.sceneImage && (
          <button className="btn ghost" onClick={() => onChange({ sceneImage: '' })}>
            חזרה ל־* * *
          </button>
        )}
      </div>
      {layout.sceneImage && (
        <label className="field">
          גובה התמונה
          <select value={String(layout.sceneImageSize)} onChange={(e) => onChange({ sceneImageSize: Number(e.target.value) })}>
            {[1, 1.5, 2, 3, 4, 6].map((v) => (
              <option key={v} value={String(v)}>
                {v === 1 ? 'שורה אחת' : `${v} שורות`}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  )
}

/** A size in points, with − and + */
export function SizeField({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Math.round(v / step) * step)))
  return (
    <div className="field size-field">
      {label}
      <div className="size-row">
        <button className="ib icon" aria-label="קטן יותר" disabled={value <= min} onClick={() => set(value - step)}>
          <Icon name="minus" />
        </button>
        <input
          type="number"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (isFinite(v) && v >= min && v <= max) onChange(v)
          }}
        />
        <span className="unit">נק׳</span>
        <button className="ib icon" aria-label="גדול יותר" disabled={value >= max} onClick={() => set(value + step)}>
          <Icon name="plus" />
        </button>
      </div>
    </div>
  )
}

/** How one element of the book looks: font, size, placement and weight */
export function ElementStyleFields({ el, layout, onChange }: { el: ElementKey; layout: BookLayout; onChange: (patch: Partial<BookLayout>) => void }) {
  const prefs = usePrefs()
  const fonts = [...EDITOR_FONTS, ...prefs.customFonts.map((f) => f.family).filter((f) => !EDITOR_FONTS.includes(f))]
  const st = elStyle(layout, el)
  const info = ELEMENTS[el]
  const set = (p: Partial<ElementStyle>) => onChange({ styles: { ...layout.styles, [el]: { ...layout.styles[el], ...p } } })
  return (
    <>
      <label className="field">
        גופן
        <select value={st.font} onChange={(e) => set({ font: e.target.value })} style={{ fontFamily: st.font || layout.font }}>
          <option value="">כמו הטקסט ({layout.font})</option>
          {fonts.map((f) => (
            <option key={f} value={f} style={{ fontFamily: f }}>
              {f}
            </option>
          ))}
        </select>
      </label>
      <div className="size-auto">
        <SizeField label={st.auto ? 'גודל (לפי הטקסט)' : 'גודל'} value={st.size} min={6} max={72} step={el === 'notes' || el === 'heads' || el === 'matterText' || el === 'toc' ? 0.5 : 1} onChange={(size) => set({ size })} />
        {!st.auto && (
          <button className="ib" title="הגודל ישתנה שוב יחד עם גודל הטקסט" onClick={() => set({ size: 0 })}>
            <Icon name="undo" size={13} /> לפי הטקסט
          </button>
        )}
      </div>
      <div className="seg title-seg" role="group" aria-label="מיקום">
        {info.aligns.map((a) => (
          <button key={a} aria-pressed={st.align === a} onClick={() => set({ align: a })}>
            {a !== 'auto' && <Icon name={a === 'center' ? 'align-c' : a === 'start' ? 'align-r' : 'align-l'} size={14} />} {ALIGN_LABEL[a]}
          </button>
        ))}
        <button aria-pressed={st.bold} title="מודגש" onClick={() => set({ bold: !st.bold })}>
          <b>מודגש</b>
        </button>
        <button aria-pressed={!!st.italic} title="נטוי" onClick={() => set({ italic: !st.italic })}>
          <i>נטוי</i>
        </button>
      </div>
    </>
  )
}

/** Every element of the book, one at a time */
export function ElementsSection({ layout, onChange, keys, initial }: { layout: BookLayout; onChange: (patch: Partial<BookLayout>) => void; keys?: ElementKey[]; initial?: ElementKey }) {
  const [el, setEl] = useState<ElementKey>(initial ?? keys?.[0] ?? 'chapterTitle')
  const st = elStyle(layout, el)
  return (
    <>
      <label className="field">
        מה לעצב
        <select value={el} onChange={(e) => setEl(e.target.value as ElementKey)}>
          {(keys
            ? [{ label: 'סגנונות', keys }]
            : [
                { label: 'חלקי הספר', keys: ELEMENT_KEYS.filter((k) => !TEXT_KEYS.includes(k)) },
                { label: 'בתוך הטקסט', keys: TEXT_KEYS }
              ]
          ).map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.keys.map((k) => (
                <option key={k} value={k}>
                  {ELEMENTS[k].label}
                  {layout.styles[k] ? ' •' : ''}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <ElementStyleFields el={el} layout={layout} onChange={onChange} />
      <div className="title-preview" style={{ fontFamily: `'${st.font || layout.font}', serif`, fontWeight: st.bold ? 700 : 500, fontStyle: st.italic ? 'italic' : 'normal', textAlign: st.align === 'auto' ? 'center' : st.align, fontSize: Math.min(28, st.size * 1.333) }}>
        {PREVIEW[el]}
      </div>
    </>
  )
}

/** Elements inside the chapters' text: headings and the paragraph styles of feature 50 */
export const TEXT_KEYS: ElementKey[] = ['h2', 'h3', 'pLetter', 'pPoem', 'pQuote', 'pSign']

const PREVIEW: Record<ElementKey, string> = {
  chapterTitle: 'פרק ראשון',
  partTitle: 'חלק א׳',
  bookTitle: 'שם הספר',
  subtitle: 'רומן',
  author: 'שם הכותב',
  matterTitle: 'תודות',
  matterText: 'לאמא, שתמיד האמינה',
  toc: 'פרק ראשון ........ 7',
  notes: '1. הערה בתחתית העמוד',
  heads: 'שם הספר · 12',
  h2: 'כותרת בתוך הפרק',
  h3: 'כותרת משנה',
  pLetter: 'יקירתי, אני כותב לך מהנמל…',
  pPoem: 'לילה, והים שותק',
  pQuote: '״כל ההתחלות קשות״',
  pSign: 'הכניסה לעובדים בלבד'
}
