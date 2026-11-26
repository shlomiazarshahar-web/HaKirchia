// Round 11, feature 46: translation memory, at the bottom of the source pane. For the paragraph being
// translated (the one picked in the original, else the one the cursor is at in the chapter, else the
// first one not translated yet) it shows earlier paragraphs of the book that repeat it, whole or a
// phrase of five words or more, with how they were translated. A phrase marked in the original can
// be looked up too ("בזיכרון" in the pane's bar). Claude can point at the words that render the phrase.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import type { Book, Chapter } from '@shared/types'
import { chapterRange, countsAsParagraph, type SourcePara } from '@shared/translation'
import { buildMemory, findInMemory, findPhrase, type TmIndex, type TmMatch, type TmPair } from '@shared/trmemory'
import { api } from '../api'
import { pdfParagraphs } from '../translate'
import { Icon } from './Icons'

const OPEN_KEY = 'hakirchia.tmOpen'

interface Props {
  book: Book
  chapter: Chapter
  editor: Editor | undefined
  /** The original's paragraphs, and the chapter's range in them */
  paras: SourcePara[]
  from: number
  to: number
  /** A paragraph picked in the original (it wins) */
  picked: number | null
  /** The first paragraph not translated yet */
  reached: number
  /** A phrase marked in the original to look up; null when none */
  query: string | null
  onClearQuery: () => void
  onNotice: (msg: string) => void
  onError: (msg: string) => void
}

/** The chapter's paragraphs as they are now in the editor (the title first) */
function liveTexts(editor: Editor | undefined, title: string): string[] | null {
  if (!editor || editor.isDestroyed) return null
  const out = [title]
  editor.state.doc.forEach((node) => {
    const t = node.textContent.replace(/\s+/g, ' ').trim()
    if (countsAsParagraph(t)) out.push(t)
  })
  return out
}

/** Paragraph index (0 = title) of the cursor: an empty paragraph is the next one to translate */
function cursorIndex(editor: Editor): number {
  const { $from } = editor.state.selection
  const idx = $from.index(0)
  let k = 1
  for (let j = 0; j < idx && j < editor.state.doc.childCount; j++) if (countsAsParagraph(editor.state.doc.child(j).textContent)) k++
  return k
}

const keyOf = (p: TmPair) => `${p.chapterId}:${p.k}`

export function TranslationMemory({ book, chapter, editor, paras, from, to, picked, reached, query, onClearQuery, onNotice, onError }: Props) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) !== '0'
    } catch {
      return true
    }
  })
  const [others, setOthers] = useState<TmIndex | null>(null)
  const [mine, setMine] = useState<TmIndex | null>(null)
  const [cursorK, setCursorK] = useState<number | null>(null)
  const [rendered, setRendered] = useState<Record<string, string>>({})
  const [asking, setAsking] = useState<string | null>(null)

  // The other chapters linked to an original: read from disk when the chapter in focus changes
  const sourcesKey = JSON.stringify(book.sources ?? {})
  useEffect(() => {
    let alive = true
    void (async () => {
      const r = await api.paragraphTexts(book.path)
      if (!r.ok || !r.value || !alive) return
      const pairs: TmPair[] = []
      for (const ch of book.chapters) {
        if (ch.id === chapter.id) continue
        const src = book.sources?.[ch.id]
        const texts = r.value[ch.id]
        if (!src || !texts) continue
        let structure
        try {
          structure = await pdfParagraphs(book.path, src.pdf)
        } catch {
          continue
        }
        const [f, t] = chapterRange(structure.paras, src)
        for (let k = 0; k < texts.length && f + k <= t; k++) {
          const s = structure.paras[f + k]
          if (s) pairs.push({ chapterId: ch.id, k, source: s.text, target: texts[k] })
        }
      }
      if (alive) setOthers(buildMemory(pairs))
    })()
    return () => {
      alive = false
    }
  }, [book.path, chapter.id, sourcesKey])

  // This chapter: live from the editor (a little after typing stops), and where its cursor is
  const fromRef = useRef(from)
  fromRef.current = from
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const rebuild = () => {
      const texts = liveTexts(editor, chapter.title)
      if (!texts) return
      const pairs: TmPair[] = []
      for (let k = 0; k < texts.length && fromRef.current + k <= to; k++) {
        const s = paras[fromRef.current + k]
        if (s) pairs.push({ chapterId: chapter.id, k, source: s.text, target: texts[k] })
      }
      setMine(buildMemory(pairs))
    }
    const onUpdate = () => {
      clearTimeout(timer)
      timer = setTimeout(rebuild, 700)
    }
    const onSel = () => setCursorK(cursorIndex(editor))
    rebuild()
    editor.on('update', onUpdate)
    editor.on('selectionUpdate', onSel)
    editor.on('focus', onSel)
    return () => {
      clearTimeout(timer)
      editor.off('update', onUpdate)
      editor.off('selectionUpdate', onSel)
      editor.off('focus', onSel)
    }
  }, [editor, chapter.id, chapter.title, paras, to])

  const target = picked ?? (cursorK !== null ? from + cursorK : reached)
  const inRange = target >= from && target <= to && !!paras[target]
  const ownKey = `${chapter.id}:${target - from}`

  const matches: TmMatch[] = useMemo(() => {
    const idx = [mine, others].filter((x): x is TmIndex => !!x)
    if (!idx.length) return []
    const skip = (p: TmPair) => keyOf(p) === ownKey
    let all: TmMatch[] = []
    if (query) for (const i of idx) all.push(...findPhrase(i, query, { skip, max: 6 }))
    else if (inRange) for (const i of idx) all.push(...findInMemory(i, paras[target].text, { skip, max: 4 }))
    all = all.sort((a, b) => Number(b.whole) - Number(a.whole) || b.words - a.words)
    const out: TmMatch[] = []
    for (const m of all) if (!out.some((o) => o.pair.target.trim() === m.pair.target.trim())) out.push(m)
    return out.slice(0, query ? 6 : 4)
  }, [mine, others, query, inRange, target, paras, ownKey])

  const toggle = () => {
    setOpen(!open)
    try {
      localStorage.setItem(OPEN_KEY, open ? '0' : '1')
    } catch {
      /* not kept */
    }
  }

  const titleOf = (id: string) => book.chapters.find((c) => c.id === id)?.title ?? ''

  const insert = (text: string) => {
    if (!editor || editor.isDestroyed) return onNotice('פתחו את הפרק בחלון כדי להכניס אליו טקסט')
    editor.chain().focus().insertContent(text).run()
  }
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(
      () => onNotice('הועתק'),
      () => onError('ההעתקה נכשלה')
    )
  }
  const ask = async (m: TmMatch) => {
    const k = `${keyOf(m.pair)}|${m.phrase}`
    setAsking(k)
    const r = await api.tmPhrase(m.pair.source, m.phrase, m.pair.target)
    setAsking(null)
    if (!r.ok) return onError(r.error ?? 'Claude לא ענה')
    setRendered((x) => ({ ...x, [k]: r.value || '' }))
    if (!r.value) onNotice('Claude לא מצא בתרגום מילים שמתרגמות את הביטוי')
  }

  const count = matches.length
  return (
    <div className={`tm${open ? ' open' : ''}`}>
      <div className="tm-head">
        <button className="ib" onClick={toggle} aria-expanded={open} title="תרגומים קודמים שלכם לשורות ולביטויים שחוזרים במקור">
          <Icon name="history" />
          זיכרון תרגום
          {count > 0 && <span className="tm-count">{count}</span>}
        </button>
        {query && (
          <span className="tm-query" title="הביטוי שסומן במקור">
            "{query.length > 40 ? query.slice(0, 40) + '…' : query}"
            <button className="ib icon" aria-label="ביטול החיפוש" title="חזרה להצעות לפסקה הנוכחית" onClick={onClearQuery}>
              <Icon name="close" />
            </button>
          </span>
        )}
        <span className="grow" />
        {open && !query && inRange && <small className="pstat">לפסקה "{paras[target].text.split(/\s+/).slice(0, 5).join(' ')}…"</small>}
      </div>
      {open && (
        <div className="tm-list">
          {!others && <div className="tm-empty">קורא את הפרקים שכבר תורגמו…</div>}
          {others && !count && (
            <div className="tm-empty">
              {query ? 'הביטוי הזה לא מופיע בפסקאות שכבר תרגמתם.' : 'אין כאן חזרה על משהו שכבר תרגמתם. כשפסקה במקור חוזרת על שורה או על ביטוי של חמש מילים ומעלה, התרגום הקודם יופיע כאן. אפשר גם לסמן ביטוי במקור וללחוץ "בזיכרון".'}
            </div>
          )}
          {matches.map((m) => {
            const k = `${keyOf(m.pair)}|${m.phrase}`
            const r = rendered[k]
            return (
              <div key={k} className="tm-item">
                <div className="tm-src" dir="auto">
                  {m.pair.source.slice(0, m.from)}
                  <mark>{m.pair.source.slice(m.from, m.to)}</mark>
                  {m.pair.source.slice(m.to)}
                </div>
                <div className="tm-tgt" dir="auto">
                  {m.pair.target}
                </div>
                <div className="tm-tools">
                  <small className="pstat">
                    {m.whole ? 'אותה שורה בדיוק' : `${m.words} מילים זהות`} · {m.pair.chapterId === chapter.id ? 'בפרק הזה' : titleOf(m.pair.chapterId)}
                  </small>
                  <span className="grow" />
                  {r && (
                    <span className="tm-render" dir="auto" title="המילים שתרגמו את הביטוי, לפי Claude">
                      {r}
                    </span>
                  )}
                  {!m.whole && r === undefined && (
                    <button className="ib" disabled={asking === k} onClick={() => void ask(m)} title="Claude מוצא בתרגום הקודם את המילים שתרגמו את הביטוי המסומן">
                      <Icon name="spark" />
                      {asking === k ? 'שואל…' : 'איך תרגמתי את הביטוי?'}
                    </button>
                  )}
                  <button className="ib" onClick={() => copy(r || m.pair.target)} title={r ? 'העתקת תרגום הביטוי' : 'העתקת התרגום הקודם'}>
                    העתקה
                  </button>
                  <button className="ib" onClick={() => insert(r || m.pair.target)} title="הכנסה לפרק, במקום הסמן">
                    הכנסה לפרק
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
