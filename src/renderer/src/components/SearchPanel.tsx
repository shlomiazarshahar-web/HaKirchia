import { useEffect, useMemo, useRef, useState } from 'react'
import type { Node as PMDoc } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import type { Book, PMNode } from '@shared/types'
import { DEFAULT_SEARCH, snippet, type SearchOptions } from '@shared/search'
import { api, flushAll } from '../api'
import { docFromJSON, editorsFor, findInDoc, setSearchHighlight, type DocMatch, type JumpTarget } from '../nav'
import { Icon } from './Icons'

interface Props {
  book: Book
  /** Open with the replace field showing (Ctrl+H) */
  replace: boolean
  /** Text to search for when the panel opens (the selected text), or a new request to focus it */
  seed: { text: string; n: number }
  /** The chapter being written now, for "only this chapter" */
  currentId: string | null
  onGo: (chapterId: string, t: JumpTarget) => void
  onClose: () => void
  /** Chapters changed on disk by a replace (to refresh word counts) */
  onChanged: () => void
  onError: (msg: string) => void
}

interface ChapterHits {
  id: string
  title: string
  num: number
  /** opened read-only because of content the app cannot show; never replaced */
  locked: boolean
  matches: DocMatch[]
}

/** What a "replace all" changed, to take it back */
type Undo = { count: number; chapters: { id: string; before: PMNode }[] }

const SHOW_MAX = 400

/** One chapter's text as it is now: from its editor when it is open, otherwise from its file. */
async function chapterDoc(bookPath: string, id: string): Promise<{ doc: PMDoc; locked: boolean } | null> {
  const ed = editorsFor(bookPath, id)[0]
  if (ed) return { doc: ed.state.doc, locked: !ed.isEditable }
  const r = await api.loadChapter(bookPath, id)
  if (!r.ok || !r.value) return null
  try {
    return { doc: docFromJSON(r.value.doc), locked: r.value.warnings.length > 0 }
  } catch {
    return null
  }
}

/** Find and replace in the whole book (feature 24), or only in the chapter being written. */
export function SearchPanel({ book, replace, seed, currentId, onGo, onClose, onChanged, onError }: Props) {
  const [query, setQuery] = useState(seed.text)
  const [rep, setRep] = useState('')
  const [showRep, setShowRep] = useState(replace)
  const [opts, setOpts] = useState<SearchOptions>(DEFAULT_SEARCH)
  const [onlyChapter, setOnlyChapter] = useState(false)
  const [hits, setHits] = useState<ChapterHits[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [cursor, setCursor] = useState(-1)
  const [undo, setUndo] = useState<Undo | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const qRef = useRef<HTMLInputElement>(null)
  const run = useRef(0)

  useEffect(() => {
    if (replace) setShowRep(true)
    if (seed.text) setQuery(seed.text)
    requestAnimationFrame(() => {
      qRef.current?.focus()
      qRef.current?.select()
    })
  }, [seed, replace])

  const scope = useMemo(() => (onlyChapter && currentId ? book.chapters.filter((c) => c.id === currentId) : book.chapters), [book.chapters, onlyChapter, currentId])

  const search = async () => {
    const my = ++run.current
    if (!query.trim()) {
      setHits(null)
      setSearchHighlight(null)
      return
    }
    setBusy(true)
    setSearchHighlight({ query, opts })
    const out: ChapterHits[] = []
    for (const ch of scope) {
      const d = await chapterDoc(book.path, ch.id)
      if (my !== run.current) return
      if (!d) continue
      const matches = findInDoc(d.doc, query, opts)
      if (matches.length) out.push({ id: ch.id, title: ch.title, num: book.chapters.indexOf(ch) + 1, locked: d.locked, matches })
    }
    setHits(out)
    setBusy(false)
    setCursor(-1)
  }
  const searchRef = useRef(search)
  searchRef.current = search

  // search again shortly after the query or the options change
  useEffect(() => {
    const t = setTimeout(() => void searchRef.current(), 220)
    return () => clearTimeout(t)
  }, [query, opts, scope])

  // the marks in the text go away with the panel
  useEffect(() => () => setSearchHighlight(null), [])

  const flat = useMemo(() => (hits ?? []).flatMap((h) => h.matches.map((m) => ({ ch: h, m }))), [hits])
  const total = flat.length

  const go = (k: number) => {
    if (!flat.length) return
    const i = ((k % flat.length) + flat.length) % flat.length
    setCursor(i)
    const { ch, m } = flat[i]
    onGo(ch.id, { pos: m.from, to: m.to, focus: false })
  }

  const goRef = useRef(go)
  goRef.current = go

  /** Replaces matches in one chapter: in its editor when open (can be undone with Ctrl+Z), else in its file. */
  const replaceIn = async (h: ChapterHits, only?: DocMatch): Promise<{ count: number; before?: PMNode } | null> => {
    if (h.locked) return null
    const ed = editorsFor(book.path, h.id)[0]
    if (ed) {
      // positions found earlier may be out of date: look again in the text as it is now
      const now = findInDoc(ed.state.doc, query, opts)
      const list = only ? now.filter((m) => m.from === only.from && m.to === only.to) : now
      if (!list.length) return { count: 0 }
      const before = ed.getJSON() as PMNode
      const tr = ed.state.tr
      for (const m of [...list].reverse()) {
        if (rep) tr.insertText(rep, m.from, m.to)
        else tr.delete(m.from, m.to)
      }
      ed.view.dispatch(tr)
      return { count: list.length, before }
    }
    const r = await api.loadChapter(book.path, h.id)
    if (!r.ok || !r.value || r.value.warnings.length) return null
    const doc = docFromJSON(r.value.doc)
    const now = findInDoc(doc, query, opts)
    const list = only ? now.filter((m) => m.from === only.from && m.to === only.to) : now
    if (!list.length) return { count: 0 }
    // the same steps an editor would take, on the file's text
    const tr = EditorState.create({ doc }).tr
    for (const m of [...list].reverse()) {
      if (rep) tr.insertText(rep, m.from, m.to)
      else tr.delete(m.from, m.to)
    }
    const s = await api.saveChapter(book.path, h.id, tr.doc.toJSON() as PMNode)
    if (!s.ok) {
      onError(s.error ?? 'השמירה נכשלה')
      return null
    }
    return { count: list.length, before: r.value.doc }
  }

  const replaceOne = async () => {
    const i = cursor >= 0 ? cursor : 0
    const item = flat[i]
    if (!item) return
    await flushAll()
    const res = await replaceIn(item.ch, item.m)
    if (res?.before && res.count) {
      setUndo({ count: res.count, chapters: [{ id: item.ch.id, before: res.before }] })
      onChanged()
    }
    await search()
    // continue with the next match
    setTimeout(() => goRef.current(i), 0)
  }

  const replaceAll = async () => {
    if (!hits?.length) return
    setBusy(true)
    await flushAll()
    const changed: Undo['chapters'] = []
    let count = 0
    let skipped = 0
    for (const h of hits) {
      if (h.locked) {
        skipped++
        continue
      }
      const res = await replaceIn(h)
      if (res?.before && res.count) {
        count += res.count
        changed.push({ id: h.id, before: res.before })
      }
    }
    setUndo(count ? { count, chapters: changed } : null)
    setNote(
      count
        ? `הוחלפו ${count.toLocaleString('he-IL')} מופעים ב־${changed.length} ${changed.length === 1 ? 'פרק' : 'פרקים'}.` + (skipped ? ` ${skipped} פרקים שפתוחים לקריאה בלבד דולגו.` : '')
        : 'לא הוחלף כלום.'
    )
    onChanged()
    await search()
  }

  /** Takes back the last replace: each chapter gets its text from before */
  const takeBack = async () => {
    if (!undo) return
    await flushAll()
    for (const c of undo.chapters) {
      const ed = editorsFor(book.path, c.id)[0]
      if (ed) {
        const content = ed.schema.nodeFromJSON(c.before).content
        ed.view.dispatch(ed.state.tr.replaceWith(0, ed.state.doc.content.size, content))
      } else {
        const s = await api.saveChapter(book.path, c.id, c.before)
        if (!s.ok) onError(s.error ?? 'השמירה נכשלה')
      }
    }
    setNote('ההחלפה בוטלה.')
    setUndo(null)
    onChanged()
    await search()
  }

  const toggle = (k: keyof SearchOptions) => setOpts((o) => ({ ...o, [k]: !o[k] }))
  let shown = 0
  let k = -1

  return (
    <aside className="findpanel" aria-label="חיפוש והחלפה" onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onClose())}>
      <div className="fp-head">
        <h3>{showRep ? 'חיפוש והחלפה' : 'חיפוש'}</h3>
        <button className="ib icon" title="סגירה (Esc)" aria-label="סגירת החיפוש" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>

      <div className="fp-fields">
        <div className="fp-field">
          <Icon name="search" />
          <input
            ref={qRef}
            value={query}
            dir="auto"
            placeholder={onlyChapter ? 'חיפוש בפרק הזה' : 'חיפוש בכל הספר'}
            aria-label="מה לחפש"
            onChange={(e) => {
              setQuery(e.target.value)
              setNote(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                go(e.shiftKey ? cursor - 1 : cursor + 1)
              }
            }}
          />
        </div>
        {showRep && (
          <div className="fp-field">
            <Icon name="swap" />
            <input
              value={rep}
              dir="auto"
              placeholder="להחליף ב…"
              aria-label="להחליף ב"
              onChange={(e) => setRep(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void replaceOne())}
            />
          </div>
        )}
      </div>

      <div className="fp-opts">
        <label title="אָב ימצא גם אב, ולהפך">
          <input type="checkbox" checked={opts.ignoreNiqqud} onChange={() => toggle('ignoreNiqqud')} />
          בלי להתחשב בניקוד
        </label>
        <label title="דני לא ימצא את דניאל">
          <input type="checkbox" checked={opts.wholeWord} onChange={() => toggle('wholeWord')} />
          מילה שלמה
        </label>
        {opts.wholeWord && (
          <label className="sub" title="דני ימצא גם ודני, לדני, שדני. רק המילה עצמה מוחלפת">
            <input type="checkbox" checked={opts.prefixes} onChange={() => toggle('prefixes')} />
            גם עם ו, ה, ב, כ, ל, מ, ש לפניה
          </label>
        )}
        <label title="לאותיות באנגלית: A שונה מ־a">
          <input type="checkbox" checked={opts.matchCase} onChange={() => toggle('matchCase')} />
          אותיות גדולות וקטנות
        </label>
        {currentId && (
          <label>
            <input type="checkbox" checked={onlyChapter} onChange={() => setOnlyChapter((v) => !v)} />
            רק בפרק הפתוח
          </label>
        )}
      </div>

      <div className="fp-bar">
        <span className="fp-count" aria-live="polite">
          {busy ? 'מחפש…' : hits === null ? '' : total === 0 ? 'לא נמצא' : `${cursor >= 0 ? `${cursor + 1} מתוך ` : ''}${total.toLocaleString('he-IL')} ${total === 1 ? 'מופע' : 'מופעים'}${hits.length > 1 ? ` ב־${hits.length} פרקים` : ''}`}
        </span>
        <span className="grow" />
        <button className="ib icon" title="הקודם (Shift+Enter)" aria-label="המופע הקודם" disabled={!total} onClick={() => go(cursor - 1)}>
          <Icon name="up" />
        </button>
        <button className="ib icon" title="הבא (Enter)" aria-label="המופע הבא" disabled={!total} onClick={() => go(cursor + 1)}>
          <Icon name="chev" />
        </button>
        {!showRep && (
          <button className="ib" title="החלפה (Ctrl+H)" onClick={() => setShowRep(true)}>
            החלפה…
          </button>
        )}
      </div>

      {showRep && (
        <div className="fp-actions">
          <button className="btn ghost" disabled={!total || busy} onClick={replaceOne}>
            החלפה
          </button>
          <button className="btn" disabled={!total || busy} onClick={replaceAll}>
            {onlyChapter ? 'החלפת הכול בפרק' : 'החלפת הכול בספר'}
          </button>
        </div>
      )}

      {(note || undo) && (
        <div className="fp-note" role="status">
          <span>{note ?? `הוחלפו ${undo!.count} מופעים.`}</span>
          {undo && (
            <button className="ib" onClick={takeBack}>
              ביטול ההחלפה
            </button>
          )}
        </div>
      )}

      <div className="fp-results">
        {hits?.map((h) => (
          <section key={h.id} className="fp-ch">
            <div className="fp-chhead">
              <Icon name="file" />
              <span className="fp-chname">
                {h.num}. {h.title}
              </span>
              <span className="fp-n">{h.matches.length}</span>
            </div>
            {h.locked && <div className="lp-note">הפרק פתוח לקריאה בלבד, ולא יוחלף בו כלום.</div>}
            {h.matches.map((m) => {
              k++
              if (++shown > SHOW_MAX) return null
              const idx = k
              const sn = snippet(m.text, { start: m.start, end: m.end })
              return (
                <button key={`${m.from}`} className={`fp-hit${idx === cursor ? ' cur' : ''}`} dir="auto" onClick={() => go(idx)}>
                  {sn.before}
                  <mark>{sn.match}</mark>
                  {sn.after}
                </button>
              )
            })}
          </section>
        ))}
        {total > SHOW_MAX && <div className="lp-note">מוצגים {SHOW_MAX} המופעים הראשונים. "החלפת הכול" מחליפה את כולם.</div>}
        {hits !== null && total === 0 && !busy && !note && <div className="lp-note fp-empty">לא נמצא בספר. אפשר לנסות בלי "מילה שלמה", או בלי להתחשב בניקוד.</div>}
      </div>
    </aside>
  )
}
