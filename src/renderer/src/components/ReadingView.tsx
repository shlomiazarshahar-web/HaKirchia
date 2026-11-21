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
import { PAGE_SIZES, type BookLayout, type PageSize, type PublishSettings } from '@shared/publish'
import { api } from '../api'
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

  const sections = useMemo(() => {
    if (!docs) return null
    return bookSections({ title: book.title, chapters: book.chapters.map((c) => ({ id: c.id, title: c.title, doc: docs[c.id] ?? { type: 'doc', content: [] } })), outline: book.outline, publish: book.publish }, 'end')
  }, [docs, book])

  const setLayout = (patch: Partial<BookLayout>) => onPublish({ ...book.publish, layout: { ...layout, ...patch } })

  return (
    <div className="reading">
      {sections ? (
        <Pages book={book} sections={sections} layout={layout} startId={startId} onOpenChapter={onOpenChapter} panelOpen={panel} onPanel={() => setPanel(!panel)} />
      ) : (
        <div className="rd-loading">פותח את הספר…</div>
      )}
      {panel && <LayoutPanel layout={layout} onChange={setLayout} onEditMatter={onEditMatter} onExport={onExport} onClose={() => setPanel(false)} />}
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
  const colH = (g.h - g.top - g.bottom) * MM
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
    return lead + sections.map((s, i) => (set.has(i) ? '<div class="rd-blank"></div>' : '') + sectionTag(s, layout, i)).join('\n')
  }, [sections, layout, blanks])
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
    const head = layout.runningHeads && !opening ? (p % 2 === 1 ? (layout.chapterNewPage ? s.title : '') : book.title) : ''
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
  const paper = (side: 'right' | 'left', p: number, d: { head: string; num: string }): ReactNode =>
    p >= 1 && (!measure || p <= measure.pages) ? (
      <div className={`rd-paper ${side}`} style={{ width: pageW, height: pageH }}>
        {d.head && (
          <div className="rd-head" style={{ top: (g.top * MM) / 2 - 8, insetInline: side === 'right' ? `${g.outer * MM}px ${g.inner * MM}px` : `${g.inner * MM}px ${g.outer * MM}px` }}>
            {d.head}
          </div>
        )}
        {d.num && (
          <div className="rd-num" style={{ bottom: (g.bottom * MM) / 2 - 8 }}>
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
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
        </div>
        </div>
      </div>
    </div>
  )
}

interface PanelProps {
  layout: BookLayout
  onChange: (patch: Partial<BookLayout>) => void
  onEditMatter: () => void
  onExport: (format: 'pdf' | 'docx' | 'epub') => void
  onClose: () => void
}

function LayoutPanel({ layout, onChange, onEditMatter, onExport, onClose }: PanelProps) {
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
      <div className="set-sub">כותרות הפרקים</div>
      <TitleStyleFields layout={layout} onChange={onChange} />
      <div className="set-sub">עימוד</div>
      {sw('partPage', 'כל כותרת חלק בעמוד משלה, באמצע העמוד')}
      {sw('chapterNewPage', 'כל פרק מתחיל בעמוד חדש')}
      {sw('chapterOdd', 'פרק מתחיל תמיד בעמוד שמאלי (אי־זוגי)', 'כמו בספרים מודפסים: אם צריך, נוסף עמוד ריק לפני הפרק', !layout.chapterNewPage)}
      {sw('justify', 'יישור לשני הצדדים')}
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

/** How chapter titles look: font, size, bold and placement (reading view, PDF, Word, ePub, and the editor's title) */
export function TitleStyleFields({ layout, onChange }: { layout: BookLayout; onChange: (patch: Partial<BookLayout>) => void }) {
  const prefs = usePrefs()
  const fonts = [...EDITOR_FONTS, ...prefs.customFonts.map((f) => f.family).filter((f) => !EDITOR_FONTS.includes(f))]
  return (
    <>
      <label className="field">
        גופן
        <select value={layout.titleFont} onChange={(e) => onChange({ titleFont: e.target.value })} style={{ fontFamily: layout.titleFont || layout.font }}>
          <option value="">כמו הטקסט ({layout.font})</option>
          {fonts.map((f) => (
            <option key={f} value={f} style={{ fontFamily: f }}>
              {f}
            </option>
          ))}
        </select>
      </label>
      <SizeField label="גודל" value={layout.titleSize} min={12} max={40} step={1} onChange={(titleSize) => onChange({ titleSize })} />
      <div className="seg title-seg" role="group" aria-label="מיקום הכותרת">
        <button aria-pressed={layout.titleAlign === 'center'} onClick={() => onChange({ titleAlign: 'center' })}>
          <Icon name="align-c" size={14} /> במרכז
        </button>
        <button aria-pressed={layout.titleAlign === 'start'} onClick={() => onChange({ titleAlign: 'start' })}>
          <Icon name="align-r" size={14} /> בצד
        </button>
        <button aria-pressed={layout.titleBold} title="כותרת מודגשת" onClick={() => onChange({ titleBold: !layout.titleBold })}>
          <b>מודגש</b>
        </button>
      </div>
      <div className="title-preview" style={{ fontFamily: `'${layout.titleFont || layout.font}', serif`, fontWeight: layout.titleBold ? 700 : 500, textAlign: layout.titleAlign, fontSize: Math.min(28, layout.titleSize) }}>
        פרק ראשון
      </div>
    </>
  )
}
