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
import { chapterRange, countsAsParagraph, imageScenes, splitPlan, suggestChapter, translationProgress, type ChapterSource, type PdfImage, type SceneMark, type SourcePara, type SourceRef, type SourceStructure, type SplitItem } from '@shared/translation'
import { api, flushAll, notifyDiskChange } from '../api'
import { editorsFor, useEditorsVersion } from '../nav'
import { loadParagraphCounts, loadPdf, pdfImages, pdfParagraphs, sendToTranslate, useParagraphCounts, type LoadedPdf } from '../translate'
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
const DISMISS_KEY = 'hakirchia.pdfSuggestDismissed'
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
      onBook={onBook}
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
  onBook: (b: Book) => void
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

function PdfReader({ book, chapter, src, files, onSave, onBook, onLink, onAddFile, onError, onNotice, onNeedTranslatePane }: ReaderProps) {
  const [pdf, setPdf] = useState<LoadedPdf | null>(null)
  const [structure, setStructure] = useState<SourceStructure | null>(null)
  const paras = structure?.paras ?? null
  const [images, setImages] = useState<PdfImage[] | null>(null)
  const [dismissed, setDismissed] = useState(() => readPref(DISMISS_KEY, '').split('|'))
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
      (p) => {
        if (!alive) return
        setStructure(p)
        // pictures (ornaments that mark scene breaks) are looked for after the text, it takes longer
        pdfImages(book.path, src.pdf).then(
          (im) => alive && setImages(im),
          () => alive && setImages([])
        )
      },
      () => alive && setStructure({ paras: [], scenes: [], chapters: [], candidates: [] })
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

  // Scene breaks in the original: lines of signs, and small pictures standing alone between paragraphs
  const scenes = useMemo(() => {
    if (!structure || !pdf) return []
    const fromImages = images ? imageScenes(images, structure.paras, structure.chapters, (n) => pdf.sizes[n - 1] ?? { w: 600, h: 800 }, pdf.doc.numPages) : []
    return [...structure.scenes, ...fromImages]
  }, [structure, images, pdf])
  const chapterStarts = structure?.chapters ?? []
  const scenesHere = scenes.filter((m) => m.after >= from && m.after < to).length

  // Where the chapter seems to start and end in the original (suggested until the writer marks the end)
  const suggestion = useMemo(() => {
    if (!paras?.length || src.end) return null
    const sg = suggestChapter(chapterStarts, paras.length, from, !!src.start)
    if (!sg) return null
    const end = sg.end < 0 ? paras.length - 1 : sg.end
    if (sg.start === from && end === to) return null
    return { ...sg, endIdx: end }
  }, [paras, chapterStarts, from, to, src.start, src.end])
  const sgKey = suggestion ? `${chapter.id}:${suggestion.start}:${suggestion.end}` : ''
  const applySuggestion = () => {
    if (!suggestion || !paras) return
    const next: ChapterSource = { ...src, start: paras[suggestion.start].ref }
    if (suggestion.end >= 0) next.end = paras[suggestion.end].ref
    else delete next.end
    void onSave(next)
    onNotice(`גבולות הפרק נקבעו: מ"${opening(paras[suggestion.start].text)}"${suggestion.end >= 0 ? ` עד "${opening(paras[suggestion.end].text)}"` : ' עד סוף הקובץ'}`)
  }
  // The whole book by its original: one chapter file per chapter found in the PDF
  const [splitOpen, setSplitOpen] = useState(false)
  const plan = useMemo(() => (structure && structure.chapters.length >= 2 ? splitPlan(structure.paras, structure.chapters, scenes) : []), [structure, scenes])
  const linkedHere = book.chapters.filter((c) => book.sources?.[c.id]?.pdf === src.pdf).length
  const splitKey = `split:${book.path}:${src.pdf}`
  const offerSplit = plan.length >= 2 && linkedHere * 2 < plan.length && !dismissed.includes(splitKey)
  const dismissSplit = () => {
    const next = [...dismissed.slice(-50), splitKey]
    setDismissed(next)
    writePref(DISMISS_KEY, next.join('|'))
  }
  const doSplit = async (items: SplitItem[]) => {
    // the chapter open now is empty and linked to this PDF: it becomes the first one
    const reuse = chapterParas <= 1 && src.pdf ? chapter.id : undefined
    await flushAll()
    const r = await api.splitBySource(book.path, src.pdf, items, reuse)
    if (!r.ok || !r.value) return onError(r.error ?? 'יצירת הפרקים נכשלה')
    onBook(r.value)
    if (reuse) notifyDiskChange(book.path, reuse)
    void loadParagraphCounts(book.path)
    setSplitOpen(false)
    const made = items.length - (reuse ? 1 : 0)
    onNotice(`${made === 1 ? 'נוצר פרק חדש אחד' : `נוצרו ${made} פרקים חדשים`}${reuse ? ` (והפרק "${chapter.title}" הפך לראשון)` : ''}, כל אחד מקושר לחלק שלו במקור ועם מעברי הסצנה שלו`)
    if (r.notice) onNotice(r.notice)
  }

  const dismiss = () => {
    const next = [...dismissed.slice(-50), sgKey]
    setDismissed(next)
    writePref(DISMISS_KEY, next.join('|'))
  }
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
    const m = new Map<number, { i: number; k: number; last: boolean; x: number; y: number; w: number; h: number }[]>()
    paras?.forEach((p, i) =>
      p.boxes.forEach((b, k) => {
        if (!m.has(b.page)) m.set(b.page, [])
        m.get(b.page)!.push({ i, k, last: k === p.boxes.length - 1, x: b.x, y: b.y, w: b.w, h: b.h })
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
      // the paragraph at the mouse's height (also between paragraphs and in the margins)
      const y = e.clientY
      let k = -1
      for (let j = 0; j < cur.blocks.length; j++) {
        if (cur.blocks[j].getBoundingClientRect().top <= y) k = j
        else break
      }
      if (k >= 0 && y > cur.blocks[k].getBoundingClientRect().bottom + 24) k = -1
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
    const paper = el?.closest('.paper') as HTMLElement | null
    if (!el || !paper) return
    // A mark drawn over the paragraph, outside the editor's own elements: the editor redraws its
    // paragraphs and would drop a class added to them (that is why the mark used to come and go)
    const mark = document.createElement('div')
    mark.className = 'tr-pair-mark'
    const place = () => {
      const r = el.getBoundingClientRect()
      const pr = paper.getBoundingClientRect()
      mark.style.top = `${r.top - pr.top - 3}px`
      mark.style.left = `${r.left - pr.left - 4}px`
      mark.style.width = `${r.width + 8}px`
      mark.style.height = `${r.height + 6}px`
    }
    place()
    paper.append(mark)
    const ro = new ResizeObserver(place)
    ro.observe(el)
    return () => {
      ro.disconnect()
      mark.remove()
    }
  }, [hover, from, editorsVersion])

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
        <button className="ib" title="מראה אילו פרקים זוהו ב־PDF ומאפשר לבחור ולתקן, ואז ליצור מסמך לכל פרק" onClick={() => setSplitOpen(true)} disabled={!paras?.length}>
          <Icon name="part-plus" />
          זיהוי פרקים
        </button>
        <span className="grow" />
        {scenesHere > 0 && (
          <small className="pstat" title="מעברי סצנה שזוהו במקור בתוך הפרק: שורת כוכביות, כוכבית אחת או קישוט קטן בין פסקאות">
            {scenesHere} מעברי סצנה
          </small>
        )}
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
      {offerSplit && (
        <div className="pdf-suggest" role="status">
          <span>
            זוהו ב־PDF <b>{plan.length} פרקים</b>. אפשר ליצור מסמך לכל פרק, מקושר לחלק שלו במקור ועם מעברי הסצנה שלו.
          </span>
          <button className="btn" onClick={() => setSplitOpen(true)}>
            חלוקה לפרקים…
          </button>
          <button className="ib icon" aria-label="לא עכשיו" title="לא עכשיו" onClick={dismissSplit}>
            <Icon name="close" />
          </button>
        </div>
      )}
      {splitOpen && structure && (
        <SplitDialog
          structure={structure}
          scenes={scenes}
          picked={target()}
          imagesReady={images !== null}
          reuseTitle={chapterParas <= 1 ? chapter.title : null}
          onCancel={() => setSplitOpen(false)}
          onCreate={doSplit}
          onShow={(i) => scrollToPara(i)}
        />
      )}
      {!offerSplit && suggestion && !dismissed.includes(sgKey) && paras && (
        <div className="pdf-suggest" role="status">
          <span>
            נראה שהפרק מתחיל ב<b>"{opening(paras[suggestion.start].text)}"</b> (עמ' {paras[suggestion.start].boxes[0].page})
            {suggestion.end >= 0 ? (
              <>
                {' '}ונגמר לפני <b>"{opening(paras[suggestion.end + 1].text)}"</b> (עמ' {paras[suggestion.end + 1].boxes[0].page})
              </>
            ) : (
              ' וממשיך עד סוף הקובץ'
            )}
          </span>
          <button className="btn" onClick={applySuggestion}>
            לקבוע כך
          </button>
          <button className="ib" onClick={() => scrollToPara(suggestion.start)}>
            להראות
          </button>
          <button className="ib icon" aria-label="לא עכשיו" title="לא עכשיו" onClick={dismiss}>
            <Icon name="close" />
          </button>
        </div>
      )}
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
                      {b.i === from && b.k === 0 && <span className="sp-flag start" title="כאן מתחיל הפרק">התחלה</span>}
                      {b.i === to && b.last && src.end && <span className="sp-flag end" title="כאן נגמר הפרק">סוף</span>}
                      {b.i === reached && inside && b.k === 0 && <span className="sp-flag here" title="התרגום הגיע עד כאן">עד כאן</span>}
                    </div>
                  )
                })}
                {chapterStarts
                  .filter((i) => paras![i] && paras![i].boxes[0].page === n && i !== from)
                  .map((i) => {
                    const b = paras![i].boxes[0]
                    return (
                      <button
                        key={`ch${i}`}
                        className="sp-guess"
                        style={{ left: 4, top: b.y * scale - 2 }}
                        title="נראה כמו תחילת פרק. לחיצה בוחרת את הפסקה, ואז אפשר ללחוץ &quot;כאן מתחיל הפרק&quot;"
                        onClick={(e) => {
                          e.stopPropagation()
                          setPicked(i)
                        }}
                      >
                        פרק?
                      </button>
                    )
                  })}
                {scenes
                  .filter((m) => m.page === n)
                  .map((m) => (
                    <div key={`sc${m.y}`} className="sp-scene" style={{ top: m.y * scale }} title={m.kind === 'image' ? 'מעבר סצנה (קישוט בין פסקאות)' : 'מעבר סצנה'}>
                      <span>סצנה</span>
                    </div>
                  ))}
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
        return
      }
      // As in pdf.js's own viewer: while selecting, an empty layer under the text catches the mouse
      // between lines and words, so dragging over a gap keeps selecting instead of losing the selection
      const end = document.createElement('div')
      end.className = 'endOfContent'
      textDiv.current?.append(end)
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
      <div
        className="textLayer"
        ref={textDiv}
        onPointerDown={(e) => {
          const el = e.currentTarget
          el.classList.add('selecting')
          const up = () => {
            el.classList.remove('selecting')
            window.removeEventListener('pointerup', up)
          }
          window.addEventListener('pointerup', up)
        }}
      />
    </>
  )
}

interface SplitProps {
  structure: SourceStructure
  scenes: SceneMark[]
  /** The paragraph clicked in the PDF (or the one at the top of the window), which can be added as a chapter start */
  picked: number | null
  imagesReady: boolean
  /** The empty chapter open now, which becomes the first one */
  reuseTitle: string | null
  onCancel: () => void
  onCreate: (items: SplitItem[]) => Promise<void>
  onShow: (paraIndex: number) => void
}

type RowMode = 'new' | 'cont' | 'skip'
const MODE_LABEL: Record<RowMode, string> = { new: 'פרק חדש', cont: 'לא כותרת', skip: 'לא לתרגם' }

/** The chapters as the rows say: each "new" or "skip" row starts a range up to the next one */
function planFromRows(paras: SourcePara[], rows: { i: number; mode: RowMode }[], scenes: SceneMark[]) {
  const bounds = rows.filter((r) => r.mode !== 'cont').sort((a, b) => a.i - b.i)
  const plan = splitPlan(
    paras,
    bounds.map((r) => r.i),
    scenes
  )
  return plan.map((it, k) => ({ ...it, mode: bounds[k].mode }))
}

/**
 * Finding the chapters in the PDF and making a chapter file for each: the headings found are
 * marked "new chapter", weaker candidates (short lines that may be headings) are listed too, and
 * any paragraph clicked in the PDF can be added. A range marked "don't translate" (thanks that
 * looked like a chapter) gets no file.
 */
function SplitDialog({ structure, scenes, picked, imagesReady, reuseTitle, onCancel, onCreate, onShow }: SplitProps) {
  const { paras } = structure
  const [rows, setRows] = useState<{ i: number; mode: RowMode }[]>(() =>
    [...new Set([...structure.chapters, ...structure.candidates])].sort((a, b) => a - b).map((i) => ({ i, mode: structure.chapters.includes(i) ? 'new' : 'cont' }))
  )
  const [busy, setBusy] = useState(false)
  const plan = useMemo(() => planFromRows(paras, rows, scenes), [paras, rows, scenes])
  const made = plan.filter((it) => it.mode === 'new')
  const byStart = new Map(plan.map((it) => [it.from, it]))
  const canAdd = picked !== null && paras[picked] && !rows.some((r) => r.i === picked)
  const setMode = (i: number, mode: RowMode) => setRows((list) => list.map((r) => (r.i === i ? { ...r, mode } : r)))
  const add = () => {
    if (picked === null) return
    setRows((list) => [...list, { i: picked, mode: 'new' as RowMode }].sort((a, b) => a.i - b.i))
  }
  const found = structure.chapters.length
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dialog split" role="dialog" aria-label="זיהוי פרקים במקור" onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
        <h2>זיהוי פרקים במקור</h2>
        <p>
          {found >= 2 ? `זוהו ${found} פרקים.` : found === 1 ? 'זוהה רק פרק אחד בוודאות.' : 'לא זוהו פרקים בוודאות.'} ברשימה גם שורות קצרות שאולי הן כותרות: בוחרים לכל אחת אם היא מתחילה פרק חדש. לכל פרק נוצר מסמך משלו, מקושר לחלק שלו ב־PDF, עם שורת * * * בכל מעבר סצנה.
          {reuseTitle ? ` הפרק הריק "${reuseTitle}" יהיה הראשון.` : ' הפרקים מתווספים בסוף הספר.'} חלק שמסומן "לא לתרגם" (למשל תודות) לא מקושר לאף פרק.
        </p>
        <div className="split-list">
          {rows.length === 0 && <p className="split-empty">לא נמצאו שורות שנראות כמו כותרות. לוחצים על הכותרת של פרק ב־PDF ואז על "להוסיף".</p>}
          {rows.map((r) => {
            const it = byStart.get(r.i)
            const n = it && it.mode === 'new' ? made.indexOf(it) + 1 : 0
            return (
              <div key={r.i} className={`split-row ${r.mode}`}>
                <select value={r.mode} aria-label="מה השורה הזאת" onChange={(e) => setMode(r.i, e.target.value as RowMode)}>
                  {(['new', 'cont', 'skip'] as RowMode[]).map((m) => (
                    <option key={m} value={m}>
                      {MODE_LABEL[m]}
                    </option>
                  ))}
                </select>
                <b>{n ? `פרק ${n}` : r.mode === 'skip' ? 'בלי מסמך' : ''}</b>
                <span className="split-h" dir="auto" title={paras[r.i].text}>
                  {paras[r.i].text}
                </span>
                <small>
                  עמ׳ {paras[r.i].boxes[0].page}
                  {it ? ` · ${it.to - it.from + 1} פסקאות${it.scenes ? ` · ${it.scenes} מעברי סצנה` : ''}` : ''}
                </small>
                <button type="button" className="ib" onClick={() => onShow(r.i)}>
                  להראות
                </button>
              </div>
            )
          })}
        </div>
        <div className="split-add">
          <button className="ib" onClick={add} disabled={!canAdd} title="כותרת שחסרה ברשימה: סוגרים את החלון, לוחצים עליה ב־PDF, ופותחים שוב את זיהוי הפרקים">
            <Icon name="plus" />
            {canAdd ? `להוסיף כתחילת פרק: "${paras[picked!].text.split(/\s+/).slice(0, 6).join(' ')}"` : 'כותרת חסרה? לוחצים עליה ב־PDF ופותחים שוב את החלון'}
          </button>
        </div>
        {!imagesReady && <p className="lp-note">עדיין מחפש קישוטים שמסמנים מעברי סצנה…</p>}
        <div className="actions">
          <button className="btn ghost" onClick={onCancel}>
            ביטול
          </button>
          <button
            className="btn"
            disabled={!made.length || busy || !imagesReady}
            onClick={async () => {
              setBusy(true)
              await onCreate(made.map(({ from: _f, to: _t, page: _p, mode: _m, ...item }, n) => ({ ...item, title: `פרק ${n + 1}` })))
              setBusy(false)
            }}
          >
            {busy ? 'יוצר…' : made.length === 1 ? 'יצירת פרק אחד' : `יצירת ${made.length} פרקים`}
          </button>
        </div>
      </div>
    </div>
  )
}
