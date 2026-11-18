// The original of the chapter being translated (feature 12): a PDF reader inside a pane, next to
// the chapter. Scrolling is synced by paragraphs, not by percent: the paragraph at the top of the
// chapter brings the matching paragraph of the original to the top, and the other way round.
// Hovering a paragraph on one side marks its pair on the other side.
//
// Which paragraphs belong to the chapter is set right here: click a paragraph of the PDF and press
// "כאן מתחיל הפרק" / "כאן נגמר הפרק". The paragraphs are then counted for the progress (feature 28).

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { TextLayer } from 'pdfjs-dist'
import type { Editor } from '@tiptap/react'
import type { Book, Chapter } from '@shared/types'
import { chapterRange, countsAsParagraph, translationProgress, type ChapterSource, type SourcePara, type SourceRef } from '@shared/translation'
import { api } from '../api'
import { editorsFor, useEditorsVersion } from '../nav'
import { loadPdf, pdfParagraphs, sendToTranslate, useParagraphCounts, type LoadedPdf } from '../translate'
import { Icon } from './Icons'

interface Props {
  book: Book
  /** The chapter this pane shows the original of (the chapter in focus); null when none is open */
  chapter: Chapter | null
  onBook: (b: Book) => void
  onError: (msg: string) => void
  onNotice: (msg: string) => void
  /** Opens a Google Translate pane when there is none (the sent text waits for it) */
  onNeedTranslatePane: () => void
}

const SYNC_KEY = 'hakirchia.pdfSync'
const ZOOM_KEY = 'hakirchia.pdfZoom'
const readPref = (k: string, d: string) => {
  try {
    return localStorage.getItem(k) ?? d
  } catch {
    return d
  }
}
const writePref = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* not kept */
  }
}

/** How many words of a paragraph to show in a message */
const opening = (t: string) => {
  const w = t.split(/\s+/).slice(0, 6).join(' ')
  return w.length < t.length ? w + '…' : w
}

export function PdfPane({ book, chapter, onBook, onError, onNotice, onNeedTranslatePane }: Props) {
  const src = chapter ? book.sources?.[chapter.id] : undefined
  const [files, setFiles] = useState<string[] | null>(null)

  const refreshFiles = () => api.listSourcePdfs(book.path).then(setFiles)
  useEffect(() => {
    void refreshFiles()
  }, [book.path])

  const save = async (next: ChapterSource | null) => {
    if (!chapter) return
    const r = await api.setSource(book.path, chapter.id, next)
    if (!r.ok || !r.value) return onError(r.error ?? 'השמירה נכשלה')
    onBook(r.value)
  }

  /** Links the chapter to a PDF. It starts right after where the previous chapter ended in the same PDF. */
  const link = (pdf: string) => {
    if (!chapter) return
    const at = book.chapters.findIndex((c) => c.id === chapter.id)
    let start: SourceRef | undefined
    for (let i = at - 1; i >= 0; i--) {
      const prev = book.sources?.[book.chapters[i].id]
      if (prev?.pdf !== pdf) continue
      if (prev.end) start = { page: prev.end.page, para: prev.end.para + 1 }
      break
    }
    void save({ pdf, ...(start ? { start } : {}) })
  }

  const addFile = async () => {
    const r = await api.addSourcePdf(book.path)
    if (!r.ok) return onError(r.error ?? 'לא ניתן להוסיף את הקובץ')
    if (!r.value) return
    await refreshFiles()
    link(r.value)
  }

  if (!chapter) {
    return (
      <div className="pdfpane">
        <div className="pdf-empty">
          <Icon name="pdf" size={28} />
          <p>חלון המקור מציג את ה־PDF של הפרק שנמצא בחלון הפעיל. פתחו פרק באחד החלונות כדי להתחיל.</p>
        </div>
      </div>
    )
  }

  if (!src) {
    return (
      <div className="pdfpane">
        <div className="pdf-empty">
          <Icon name="pdf" size={28} />
          <p>
            לפרק <b>{chapter.title}</b> עוד לא נבחר מקור. בוחרים את ה־PDF של הספר המקורי, וההעתק שלו נשמר בתיקיית הספר (בתיקייה "מקור").
          </p>
          {files && files.length > 0 && (
            <div className="pdf-files">
              {files.map((f) => (
                <button key={f} className="btn ghost" onClick={() => link(f)}>
                  <Icon name="pdf" />
                  {f}
                </button>
              ))}
            </div>
          )}
          <button className="btn" onClick={() => void addFile()}>
            <Icon name="plus" />
            {files && files.length ? 'קובץ PDF אחר…' : 'בחירת קובץ PDF…'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <PdfReader
      key={`${book.path}|${src.pdf}`}
      book={book}
      chapter={chapter}
      src={src}
      files={files ?? [src.pdf]}
      onSave={save}
      onLink={link}
      onAddFile={addFile}
      onError={onError}
      onNotice={onNotice}
      onNeedTranslatePane={onNeedTranslatePane}
    />
  )
}

interface ReaderProps {
  book: Book
  chapter: Chapter
  src: ChapterSource
  files: string[]
  onSave: (s: ChapterSource | null) => Promise<void>
  onLink: (pdf: string) => void
  onAddFile: () => Promise<void>
  onError: (msg: string) => void
  onNotice: (msg: string) => void
  onNeedTranslatePane: () => void
}

/** Where things are on the chapter's side: its scrolling area and its paragraphs (title first) */
function chapterSide(editor: Editor | undefined): { scroller: HTMLElement; blocks: HTMLElement[] } | null {
  if (!editor || editor.isDestroyed) return null
  const dom = editor.view.dom as HTMLElement
  const scroller = dom.closest('.desk') as HTMLElement | null
  if (!scroller) return null
  const blocks: HTMLElement[] = []
  const title = dom.closest('.paper')?.querySelector('.ch-title') as HTMLElement | null
  if (title) blocks.push(title)
  editor.state.doc.forEach((node, offset) => {
    if (!countsAsParagraph(node.textContent)) return
    const el = editor.view.nodeDOM(offset)
    if (el instanceof HTMLElement) blocks.push(el)
  })
  return { scroller, blocks }
}

const topIn = (el: HTMLElement, scroller: HTMLElement) => el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop

function PdfReader({ book, chapter, src, files, onSave, onLink, onAddFile, onError, onNotice, onNeedTranslatePane }: ReaderProps) {
  const [pdf, setPdf] = useState<LoadedPdf | null>(null)
  const [paras, setParas] = useState<SourcePara[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [width, setWidth] = useState(0)
  const [zoom, setZoom] = useState(() => Number(readPref(ZOOM_KEY, '1')) || 1)
  const [synced, setSynced] = useState(() => readPref(SYNC_KEY, '1') === '1')
  const [visible, setVisible] = useState<Set<number>>(new Set([1]))
  const [page, setPage] = useState(1)
  const [hover, setHover] = useState<number | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  const view = useRef<HTMLDivElement>(null)
  const pageEls = useRef(new Map<number, HTMLDivElement>())
  const counts = useParagraphCounts(book.path)
  const editorsVersion = useEditorsVersion()

  // Load the file, then find its paragraphs (takes a few seconds for a long book)
  useEffect(() => {
    let alive = true
    loadPdf(book.path, src.pdf).then(
      (p) => alive && setPdf(p),
      (e) => alive && setFailed(e instanceof Error ? e.message : String(e))
    )
    pdfParagraphs(book.path, src.pdf).then(
      (p) => alive && setParas(p),
      () => alive && setParas([])
    )
    return () => {
      alive = false
    }
  }, [book.path, src.pdf])

  // Fit the page width to the pane
  useEffect(() => {
    const el = view.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [pdf])
  const maxW = pdf ? Math.max(...pdf.sizes.map((s) => s.w)) : 600
  const scale = Math.max(0.3, ((Math.max(200, width) - 36) / maxW) * zoom)

  const [from, to] = useMemo(() => (paras ? chapterRange(paras, src) : [0, -1]), [paras, src])
  const total = paras ? Math.max(0, to - from + 1) : (src.paras ?? 0)
  const chapterParas = counts[chapter.id] ?? 1
  const progress = translationProgress(chapterParas, total)

  // Remember how many paragraphs the original chapter has, for the progress in the binder
  useEffect(() => {
    if (paras && paras.length && src.paras !== total) void onSave({ ...src, paras: total })
  }, [paras, total])

  // Pages near the visible part are drawn; the others stay empty boxes
  useEffect(() => {
    const root = view.current
    if (!root || !pdf) return
    const io = new IntersectionObserver(
      (entries) => {
        setVisible((cur) => {
          const next = new Set(cur)
          for (const en of entries) {
            const n = Number((en.target as HTMLElement).dataset.page)
            if (en.isIntersecting) next.add(n)
            else next.delete(n)
          }
          return next
        })
      },
      { root, rootMargin: '800px 0px' }
    )
    pageEls.current.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [pdf, scale])

  // Paragraph boxes on each page, with their index in `paras`
  const boxesByPage = useMemo(() => {
    const m = new Map<number, { i: number; x: number; y: number; w: number; h: number }[]>()
    paras?.forEach((p, i) =>
      p.boxes.forEach((b) => {
        if (!m.has(b.page)) m.set(b.page, [])
        m.get(b.page)!.push({ i, x: b.x, y: b.y, w: b.w, h: b.h })
      })
    )
    return m
  }, [paras])

  /** Top of a paragraph (its first box) inside the scrolling area, in pixels */
  const paraTop = (i: number): number | null => {
    const p = paras?.[i]
    const el = p && pageEls.current.get(p.boxes[0].page)
    return p && el ? el.offsetTop + p.boxes[0].y * scale : null
  }
  const paraHeight = (i: number) => (paras?.[i] ? Math.max(8, paras[i].boxes[0].h * scale) : 20)

  const scrollToPara = (i: number, frac = 0) => {
    const v = view.current
    const top = paraTop(i)
    if (!v || top === null) return
    v.scrollTop = top + frac * paraHeight(i) - 12
  }

  // Open at the start of the chapter
  const opened = useRef('')
  useEffect(() => {
    if (!pdf || !paras || !view.current) return
    const key = `${chapter.id}|${src.start?.page}|${src.start?.para}`
    if (opened.current === key) return
    opened.current = key
    if (paras.length && from < paras.length) requestAnimationFrame(() => scrollToPara(from))
    else if (src.start) {
      const el = pageEls.current.get(src.start.page)
      if (el) view.current.scrollTop = el.offsetTop - 8
    }
  }, [pdf, paras, chapter.id, src.start?.page, src.start?.para])

  // ---- synced scrolling, by paragraphs -----------------------------------------------------
  const quietUntil = useRef({ pdf: 0, chapter: 0 })
  const editor = editorsFor(book.path, chapter.id)[0]
  const side = useRef<ReturnType<typeof chapterSide>>(null)
  side.current = chapterSide(editor)

  /** The paragraph at the top of the PDF view, and how far into it */
  const pdfTopPara = (): { i: number; frac: number } | null => {
    const v = view.current
    if (!v || !paras?.length) return null
    const y = v.scrollTop + 12
    let best = -1
    for (let i = 0; i < paras.length; i++) {
      const t = paraTop(i)
      if (t === null) continue
      if (t <= y) best = i
      else break
    }
    if (best < 0) return { i: 0, frac: 0 }
    return { i: best, frac: Math.max(0, Math.min(1, (y - (paraTop(best) ?? 0)) / paraHeight(best))) }
  }

  const onPdfScroll = () => {
    const v = view.current
    if (!v || !pdf) return
    // page number for the header
    let cur = 1
    pageEls.current.forEach((el, n) => {
      if (el.offsetTop <= v.scrollTop + v.clientHeight / 3) cur = Math.max(cur, n)
    })
    setPage(cur)
    if (!synced || Date.now() < quietUntil.current.pdf) return
    const s = chapterSide(editor)
    const top = pdfTopPara()
    if (!s || !top) return
    const k = top.i - from
    quietUntil.current.chapter = Date.now() + 120
    if (k < 0) s.scroller.scrollTop = 0
    else if (k >= s.blocks.length) s.scroller.scrollTop = s.scroller.scrollHeight
    else s.scroller.scrollTop = topIn(s.blocks[k], s.scroller) + top.frac * s.blocks[k].offsetHeight - 12
  }

  // The chapter's scrolling and hovering
  useEffect(() => {
    const s = chapterSide(editor)
    if (!s || !paras) return
    const onScroll = () => {
      if (!synced || Date.now() < quietUntil.current.chapter) return
      const cur = chapterSide(editor)
      if (!cur || !cur.blocks.length) return
      const y = cur.scroller.scrollTop + 12
      let k = 0
      for (let j = 0; j < cur.blocks.length; j++) {
        if (topIn(cur.blocks[j], cur.scroller) <= y) k = j
        else break
      }
      const el = cur.blocks[k]
      const frac = Math.max(0, Math.min(1, (y - topIn(el, cur.scroller)) / Math.max(1, el.offsetHeight)))
      quietUntil.current.pdf = Date.now() + 120
      const i = from + k
      if (i > to) scrollToPara(Math.max(from, to), 1)
      else scrollToPara(i, frac)
    }
    const onMove = (e: MouseEvent) => {
      const cur = chapterSide(editor)
      if (!cur) return
      const t = e.target as HTMLElement
      const k = cur.blocks.findIndex((b) => b === t || b.contains(t))
      setHover(k < 0 ? null : from + k)
    }
    const onLeave = () => setHover(null)
    s.scroller.addEventListener('scroll', onScroll, { passive: true })
    s.scroller.addEventListener('mousemove', onMove)
    s.scroller.addEventListener('mouseleave', onLeave)
    return () => {
      s.scroller.removeEventListener('scroll', onScroll)
      s.scroller.removeEventListener('mousemove', onMove)
      s.scroller.removeEventListener('mouseleave', onLeave)
    }
  }, [editor, editorsVersion, paras, from, to, synced, scale])

  // Mark the pair of the hovered paragraph in the chapter
  useEffect(() => {
    const s = side.current
    if (hover === null || !s) return
    const el = s.blocks[hover - from]
    if (!el) return
    el.classList.add('tr-pair')
    return () => el.classList.remove('tr-pair')
  }, [hover, from])

  // ---- the paragraph under the mouse in the PDF ----------------------------------------------
  const paraAt = (n: number, e: React.MouseEvent<HTMLDivElement>): number | null => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - r.left) / scale
    const y = (e.clientY - r.top) / scale
    const hit = boxesByPage.get(n)?.find((b) => x >= b.x - 6 && x <= b.x + b.w + 6 && y >= b.y - 4 && y <= b.y + b.h + 4)
    return hit ? hit.i : null
  }

  const target = (): number | null => picked ?? pdfTopPara()?.i ?? null

  const setStart = () => {
    const i = target()
    if (i === null || !paras?.[i]) return
    const next: ChapterSource = { ...src, start: paras[i].ref }
    if (next.end && to >= 0 && i > to) delete next.end
    void onSave(next)
    onNotice(`הפרק מתחיל ב: "${opening(paras[i].text)}"`)
  }
  const setEnd = () => {
    const i = target()
    if (i === null || !paras?.[i]) return
    if (i < from) return onError('סוף הפרק לא יכול להיות לפני תחילתו')
    void onSave({ ...src, end: paras[i].ref })
    onNotice(`הפרק נגמר ב: "${opening(paras[i].text)}"`)
  }

  const send = () => {
    const sel = window.getSelection()
    let text = ''
    if (sel && !sel.isCollapsed && view.current?.contains(sel.anchorNode)) text = sel.toString()
    if (!text.trim()) {
      const i = target()
      text = i !== null && paras?.[i] ? paras[i].text : ''
    }
    if (!text.trim()) return onNotice('סמנו טקסט ב־PDF או לחצו על פסקה, ואז "לתרגום"')
    if (!sendToTranslate(text)) onNeedTranslatePane()
  }

  const setZoomKept = (z: number) => {
    const v = Math.min(3, Math.max(0.5, Math.round(z * 10) / 10))
    setZoom(v)
    writePref(ZOOM_KEY, String(v))
  }

  const reached = from + chapterParas // first paragraph not translated yet
  const head: ReactNode = (
    <div className="pdf-bar">
      <select
        className="ppick"
        aria-label="קובץ המקור"
        title="קובץ המקור של הפרק"
        value={src.pdf}
        onChange={(e) => {
          const v = e.target.value
          if (v === '+') void onAddFile()
          else if (v === '-') void onSave(null)
          else onLink(v)
        }}
      >
        {files.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
        <option value="+">קובץ PDF אחר…</option>
        <option value="-">ניתוק הפרק מהמקור</option>
      </select>
      {pdf && (
        <small className="pstat">
          עמ' {page} מתוך {pdf.doc.numPages}
        </small>
      )}
      <span className="grow" />
      <button
        className={`ib${synced ? ' on' : ''}`}
        aria-pressed={synced}
        title="גלילה מסונכרנת לפי פסקאות: הפסקה שבראש הפרק מביאה את בת הזוג שלה במקור"
        onClick={() => {
          setSynced(!synced)
          writePref(SYNC_KEY, synced ? '0' : '1')
        }}
      >
        <Icon name="link" />
        <span className="lbl2">{synced ? 'מסונכרן' : 'לא מסונכרן'}</span>
      </button>
      <button className="ib" title="שליחת הטקסט המסומן (או הפסקה שנבחרה) לגוגל תרגום (Ctrl+Shift+T)" onClick={send}>
        <Icon name="send" />
        <span className="lbl2">לתרגום</span>
      </button>
    </div>
  )

  return (
    <div className="pdfpane">
      {head}
      <div className="pdf-bar sub">
        <button className="ib" title="הפסקה שנבחרה (לחיצה על פסקה ב־PDF), או זו שבראש החלון, היא תחילת הפרק" onClick={setStart} disabled={!paras?.length}>
          <Icon name="start" />
          כאן מתחיל הפרק
        </button>
        <button className="ib" title="הפסקה שנבחרה, או זו שבראש החלון, היא הפסקה האחרונה של הפרק" onClick={setEnd} disabled={!paras?.length}>
          <Icon name="end" />
          כאן נגמר הפרק
        </button>
        <span className="grow" />
        {progress ? (
          <small className="pdf-progress" title="כמה פסקאות של הפרק המקורי כבר יש בתרגום (נתון בלבד)">
            <i style={{ width: `${progress.percent}%` }} />
            <span>
              {progress.done}/{progress.total} פסקאות · {progress.percent}%
            </span>
          </small>
        ) : !paras ? (
          <small className="pstat">קורא את הפסקאות…</small>
        ) : null}
        <button className="ib icon" title="הקטנה" aria-label="הקטנת ה־PDF" onClick={() => setZoomKept(zoom - 0.1)}>
          <Icon name="minus" />
        </button>
        <button className="ib icon" title="הגדלה" aria-label="הגדלת ה־PDF" onClick={() => setZoomKept(zoom + 0.1)}>
          <Icon name="plus" />
        </button>
      </div>
      <div className="pdfview" ref={view} dir="ltr" onScroll={onPdfScroll}>
        {failed && <div className="pdf-empty">לא ניתן לפתוח את הקובץ: {failed}</div>}
        {!pdf && !failed && <div className="pdf-empty">פותח את הקובץ…</div>}
        {pdf &&
          pdf.sizes.map((s, k) => {
            const n = k + 1
            return (
              <div
                key={n}
                className="pdfpage"
                data-page={n}
                ref={(el) => {
                  if (el) pageEls.current.set(n, el)
                  else pageEls.current.delete(n)
                }}
                style={{ width: s.w * scale, height: s.h * scale }}
                onMouseMove={(e) => setHover(paraAt(n, e))}
                onMouseLeave={() => setHover(null)}
                onClick={(e) => {
                  const sel = window.getSelection()
                  if (sel && !sel.isCollapsed) return
                  const i = paraAt(n, e)
                  setPicked(i === picked ? null : i)
                }}
              >
                {visible.has(n) && <PageCanvas pdf={pdf} n={n} scale={scale} />}
                {(boxesByPage.get(n) ?? []).map((b) => {
                  const inside = b.i >= from && b.i <= to
                  const cls = ['sp', inside ? 'in' : 'out', hover === b.i ? 'pair' : '', picked === b.i ? 'picked' : '', b.i === reached && inside ? 'here' : ''].filter(Boolean).join(' ')
                  return (
                    <div key={`${b.i}-${b.y}`} className={cls} style={{ left: b.x * scale - 4, top: b.y * scale - 2, width: b.w * scale + 8, height: b.h * scale + 4 }}>
                      {b.i === from && paras![b.i].boxes[0].page === n && <span className="sp-flag start" title="כאן מתחיל הפרק">התחלה</span>}
                      {b.i === to && paras![b.i].boxes[paras![b.i].boxes.length - 1].page === n && src.end && <span className="sp-flag end" title="כאן נגמר הפרק">סוף</span>}
                      {b.i === reached && inside && paras![b.i].boxes[0].page === n && <span className="sp-flag here" title="התרגום הגיע עד כאן">עד כאן</span>}
                    </div>
                  )
                })}
              </div>
            )
          })}
      </div>
    </div>
  )
}

/** One page: the picture of the page, with the text over it (invisible, so it can be selected) */
function PageCanvas({ pdf, n, scale }: { pdf: LoadedPdf; n: number; scale: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const textDiv = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let cancelled = false
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null
    let layer: TextLayer | null = null
    void (async () => {
      const page = await pdf.doc.getPage(n)
      if (cancelled || !canvas.current || !textDiv.current) return
      const vp = page.getViewport({ scale })
      const ratio = window.devicePixelRatio || 1
      const c = canvas.current
      c.width = Math.floor(vp.width * ratio)
      c.height = Math.floor(vp.height * ratio)
      c.style.width = `${vp.width}px`
      c.style.height = `${vp.height}px`
      const ctx = c.getContext('2d')
      if (!ctx) return
      task = page.render({ canvas: c, canvasContext: ctx, viewport: vp, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined })
      try {
        await task.promise
      } catch {
        return
      }
      if (cancelled || !textDiv.current) return
      textDiv.current.replaceChildren()
      textDiv.current.style.setProperty('--scale-factor', String(scale))
      textDiv.current.style.setProperty('--total-scale-factor', String(scale))
      layer = new TextLayer({ textContentSource: page.streamTextContent(), container: textDiv.current, viewport: vp })
      try {
        await layer.render()
      } catch {
        /* cancelled */
      }
    })()
    return () => {
      cancelled = true
      task?.cancel()
      layer?.cancel()
    }
  }, [pdf, n, scale])
  return (
    <>
      <canvas ref={canvas} />
      <div className="textLayer" ref={textDiv} />
    </>
  )
}
