// Saving and drafts round: versions (14), private notes (15), the drawer (27) and alternative
// drafts (35). The sections live in "על הפרק"; the drawer is a side panel like the find panel.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import type { AltDraft, Book, Chapter, DrawerItem, PMNode, PrivateNote, Version } from '@shared/types'
import { diffTexts, type DiffResult } from '@shared/diff'
import { sceneRange } from '@shared/drafts'
import { firstWords } from '@shared/scenes'
import { api, flushAll } from '../api'
import { editorChapter, editorsFor, sceneAt, scenesIn } from '../nav'
import { addNote, insertFromDrawer, removeFromDrawer, removeNote, setActiveNote, setDrawerAuto, showNote, updateNote, useDrawer, useNotes } from '../drafts'
import { Icon } from './Icons'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The text of one block, footnotes shown in brackets (so changes in notes show in a comparison) */
function blockText(n: PMNode): string {
  if (typeof n.text === 'string') return n.text
  if (n.type === 'hardBreak') return ' '
  if (n.type === 'footnote') return ` [הערה: ${String(n.attrs?.text ?? '')}]`
  return (n.content ?? []).map(blockText).join('')
}
export const paragraphsOf = (doc: PMNode | PMNode[]): string[] => (Array.isArray(doc) ? doc : (doc.content ?? [])).map(blockText)

const when = (at: number) => {
  const d = new Date(at)
  const today = new Date()
  const y = new Date(today)
  y.setDate(today.getDate() - 1)
  const time = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === today.toDateString()) return `היום, ${time}`
  if (d.toDateString() === y.toDateString()) return `אתמול, ${time}`
  return `${d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : '2-digit' })}, ${time}`
}

/** The editor that shows this chapter now: the one being written in, or any other on screen */
export function editorOf(bookPath: string, chapterId: string, current: Editor | null): Editor | null {
  if (current && !current.isDestroyed && editorChapter(current)?.chapterId === chapterId && editorChapter(current)?.bookPath === bookPath) return current
  return editorsFor(bookPath, chapterId)[0] ?? null
}

/** The chapter's text as it is now (from the screen when it is open, else from its file) */
async function currentDoc(bookPath: string, chapterId: string, editor: Editor | null): Promise<PMNode | null> {
  const ed = editorOf(bookPath, chapterId, editor)
  if (ed) return ed.getJSON() as PMNode
  const r = await api.loadChapter(bookPath, chapterId)
  return r.ok && r.value ? r.value.doc : null
}

/**
 * Puts new text in place of a chapter's text (or of some of its paragraphs). In an open editor it is
 * an ordinary edit, so Ctrl+Z brings the old text back; otherwise it is saved to the file directly.
 */
async function replaceText(bookPath: string, chapterId: string, editor: Editor | null, blocks: PMNode[], range?: { start: number; end: number }): Promise<string | null> {
  const ed = editorOf(bookPath, chapterId, editor)
  if (ed) {
    const content = blocks.map((b) => ed.schema.nodeFromJSON(b))
    const doc = ed.state.doc
    let from = 0
    let to = doc.content.size
    if (range) {
      from = 0
      for (let i = 0; i < range.start; i++) from += doc.child(i).nodeSize
      to = from
      for (let i = range.start; i < range.end; i++) to += doc.child(i).nodeSize
    }
    ed.view.dispatch(ed.state.tr.replaceWith(from, to, content.length ? content : ed.schema.nodes.paragraph.create()).setMeta('noDrawer', true).scrollIntoView())
    return null
  }
  const cur = await currentDoc(bookPath, chapterId, null)
  if (!cur) return 'לא הצלחתי לקרוא את הפרק'
  const all = cur.content ?? []
  const next = range ? [...all.slice(0, range.start), ...blocks, ...all.slice(range.end)] : blocks
  const r = await api.saveChapter(bookPath, chapterId, { type: 'doc', content: next.length ? next : [{ type: 'paragraph' }] })
  return r.ok ? null : (r.error ?? 'השמירה נכשלה')
}

// ---------------------------------------------------------------------------
// Comparing two texts
// ---------------------------------------------------------------------------

export interface CompareRequest {
  title: string
  oldLabel: string
  newLabel: string
  oldParas: string[]
  newParas: string[]
  /** e.g. "שחזור הגרסה הזו" / "בחירת הטיוטה" */
  action?: { label: string; run: () => void }
}

export function CompareDialog({ req, onClose }: { req: CompareRequest; onClose: () => void }) {
  const diff: DiffResult = useMemo(() => diffTexts(req.oldParas, req.newParas), [req])
  const [onlyChanges, setOnlyChanges] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => closeRef.current?.focus(), [])
  const changed = diff.paragraphs.filter((p) => p.kind !== 'same').length
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog compare" role="dialog" aria-label={req.title} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onClose())}>
        <div className="cmp-head">
          <h2>{req.title}</h2>
          <button ref={closeRef} className="ib icon" aria-label="סגירה" title="סגירה (Esc)" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="cmp-legend">
          <span className="cmp-removed">{req.oldLabel}</span>
          <span className="cmp-added">{req.newLabel}</span>
          <span className="grow" />
          <span>
            {changed === 0 ? 'אין הבדלים' : `${diff.added.toLocaleString('he-IL')} מילים נוספו · ${diff.removed.toLocaleString('he-IL')} נמחקו`}
          </span>
          <label className="chk">
            <input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} /> רק מה שהשתנה
          </label>
        </div>
        <div className="cmp-body prose-like">
          {diff.paragraphs.map((p, i) =>
            onlyChanges && p.kind === 'same' ? null : (
              <p key={i} className={`cmp-p ${p.kind}`} dir="auto">
                {p.pieces.map((x, k) =>
                  x.kind === 'same' ? <span key={k}>{x.text}</span> : x.kind === 'added' ? <ins key={k}>{x.text}</ins> : <del key={k}>{x.text}</del>
                )}
                {!p.pieces.some((x) => x.text) && ' '}
              </p>
            )
          )}
        </div>
        <div className="actions">
          {req.action && (
            <button
              className="btn"
              onClick={() => {
                req.action!.run()
                onClose()
              }}
            >
              {req.action.label}
            </button>
          )}
          <button className="btn ghost" onClick={onClose}>
            סגירה
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sections of "על הפרק"
// ---------------------------------------------------------------------------

export interface DraftsContext {
  book: Book
  chapter: Chapter
  /** the editor being written in (may show another chapter) */
  editor: Editor | null
  onCompare: (req: CompareRequest) => void
  onBook: (b: Book) => void
  onOpenAlt: (altId: string) => void
  show: (text: string, error?: boolean) => void
}

/** Versions of the chapter (feature 14): keep one now, compare, restore */
export function VersionsSection(ctx: DraftsContext) {
  const { book, chapter } = ctx
  const [list, setList] = useState<Version[] | null>(null)
  const [naming, setNaming] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const load = async () => {
    const r = await api.listVersions(book.path, chapter.id)
    setList(r.ok && r.value ? r.value : [])
  }
  useEffect(() => {
    setList(null)
    setNaming(null)
    setMore(false)
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.path, chapter.id])

  const take = async (label: string) => {
    await flushAll()
    const r = await api.takeVersion(book.path, chapter.id, label)
    if (!r.ok) return ctx.show(r.error ?? 'לא הצלחתי לשמור גרסה', true)
    setNaming(null)
    ctx.show(label ? `נשמרה גרסה: "${label}"` : 'נשמרה גרסה')
    void load()
  }

  const compare = async (v: Version) => {
    await flushAll()
    const [old, cur] = await Promise.all([api.loadVersion(book.path, chapter.id, v.id), currentDoc(book.path, chapter.id, ctx.editor)])
    if (!old.ok || !old.value || !cur) return ctx.show(old.error ?? 'לא הצלחתי לקרוא את הגרסה', true)
    ctx.onCompare({
      title: `${chapter.title}: ${v.label || when(v.at)} מול עכשיו`,
      oldLabel: `בגרסה (${when(v.at)})`,
      newLabel: 'בטקסט של עכשיו',
      oldParas: paragraphsOf(old.value),
      newParas: paragraphsOf(cur),
      action: { label: 'שחזור הגרסה הזו', run: () => void restore(v) }
    })
  }

  const restore = async (v: Version) => {
    await flushAll()
    const old = await api.loadVersion(book.path, chapter.id, v.id)
    if (!old.ok || !old.value) return ctx.show(old.error ?? 'לא הצלחתי לקרוא את הגרסה', true)
    // the text of now is kept first, so a restore can always be taken back
    await api.takeVersion(book.path, chapter.id, '', 'לפני שחזור')
    const err = await replaceText(book.path, chapter.id, ctx.editor, old.value.content ?? [])
    if (err) return ctx.show(err, true)
    ctx.show(`הפרק שוחזר לגרסה של ${when(v.at)}. הטקסט הקודם נשמר כגרסה "לפני שחזור" (ואפשר גם Ctrl+Z).`)
    void load()
  }

  const remove = async (v: Version) => {
    await api.deleteVersion(book.path, chapter.id, v.id)
    void load()
  }

  const shown = list ? (more ? list : list.slice(0, 6)) : []
  return (
    <div className="isec">
      <h3>
        גרסאות
        <button className="ib icon" title="לשמור גרסה של הפרק כמו שהוא עכשיו, עם שם" aria-label="גרסה חדשה" onClick={() => setNaming(naming === null ? '' : null)}>
          <Icon name="history" />
        </button>
      </h3>
      {naming !== null && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault()
            void take(naming.trim() || 'גרסה')
          }}
        >
          <input autoFocus value={naming} dir="auto" placeholder='שם לגרסה, למשל "לפני שינוי הפתיחה"' aria-label="שם הגרסה" onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setNaming(null)} />
          <button className="btn">שמירה</button>
        </form>
      )}
      {list && list.length === 0 && <div className="lp-note">עוד אין גרסאות. תוך כדי כתיבה הכריכייה שומרת גרסה בעצמה כל חצי שעה, ואפשר לשמור גרסה עם שם בכפתור למעלה.</div>}
      <div className="ver">
        {shown.map((v) => (
          <div className="vrow" key={v.id}>
            <span className="when">
              {v.label ? `"${v.label}"` : when(v.at)}
              <small>
                {v.label ? when(v.at) : (v.reason ?? 'שמירה אוטומטית')} · {v.words.toLocaleString('he-IL')} מילים
              </small>
            </span>
            <button className="ib" title="מה השתנה מאז הגרסה הזו" onClick={() => void compare(v)}>
              השוואה
            </button>
            <button className="ib" title="להחזיר את הפרק לגרסה הזו (הטקסט של עכשיו יישמר כגרסה)" onClick={() => void restore(v)}>
              שחזור
            </button>
            <button className="ib icon" title="מחיקת הגרסה" aria-label="מחיקת הגרסה" onClick={() => void remove(v)}>
              <Icon name="trash" />
            </button>
          </div>
        ))}
      </div>
      {list && list.length > 6 && (
        <button className="linkbtn" onClick={() => setMore(!more)}>
          {more ? 'פחות' : `עוד ${list.length - 6} גרסאות`}
        </button>
      )}
    </div>
  )
}

/** Private notes of the chapter (feature 15): never go into the chapter file or an export */
export function NotesSection(ctx: DraftsContext & { focusNote?: string | null }) {
  const { book, chapter } = ctx
  const all = useNotes()
  const list = all.list.filter((n) => n.chapterId === chapter.id && all.bookPath === book.path)
  const [fresh, setFresh] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  // a note just added (here or from the keyboard): its field gets the keyboard once it is on screen
  const want = fresh ?? ctx.focusNote ?? null
  useEffect(() => {
    if (!want) return
    const el = box.current?.querySelector<HTMLTextAreaElement>(`textarea[data-note="${want}"]`)
    if (el) {
      el.focus()
      el.scrollIntoView({ block: 'nearest' })
      setFresh(null)
    }
  }, [want, list.length])

  const add = () => {
    const ed = editorOf(book.path, chapter.id, ctx.editor)
    const n = addNote(chapter.id, '', ed)
    setFresh(n.id)
  }
  const go = (n: PrivateNote) => {
    const ed = editorOf(book.path, chapter.id, ctx.editor)
    if (!ed || !showNote(ed, n.id)) ctx.show('המילים שההערה הזו הייתה עליהן כבר לא נמצאות בפרק. ההערה עצמה נשמרה.', true)
  }
  return (
    <div className="isec" ref={box}>
      <h3>
        הערות פרטיות
        <button className="ib icon" title="הערה חדשה. אם יש טקסט מסומן, ההערה תהיה עליו (Ctrl+Alt+M)" aria-label="הערה חדשה" onClick={add}>
          <Icon name="plus" />
        </button>
      </h3>
      {list.length === 0 && <div className="lp-note">הערות לעצמך: לא נכנסות לקובץ הפרק ולא לייצוא. מסמנים מילים ולוחצים על +, או Ctrl+Alt+M.</div>}
      {list.map((n) => (
        <div className="note pnote-card" key={n.id} onMouseEnter={() => setActiveNote(n.id)} onMouseLeave={() => setActiveNote(null)}>
          <textarea
            value={n.text}
            dir="auto"
            rows={2}
            data-note={n.id}
            placeholder="מה רצית לזכור?"
            aria-label="טקסט ההערה"
            onFocus={() => setActiveNote(n.id)}
            onBlur={() => setActiveNote(null)}
            onChange={(e) => updateNote(n.id, e.target.value)}
          />
          <small>
            {n.anchor ? (
              <button className="linkbtn" title="מעבר למילים בטקסט" onClick={() => go(n)}>
                על "{firstWords(n.anchor.quote, 5, 36)}"
              </button>
            ) : (
              'כללי לפרק'
            )}{' '}
            · {when(n.at)}
            <button className="ib icon" title="מחיקת ההערה" aria-label="מחיקת ההערה" onClick={() => removeNote(n.id)}>
              <Icon name="trash" />
            </button>
          </small>
        </div>
      ))}
    </div>
  )
}

/** Alternative drafts of the chapter or of one of its scenes (feature 35) */
export function AltsSection(ctx: DraftsContext) {
  const { book, chapter } = ctx
  const list = (book.alts ?? []).filter((a) => a.chapterId === chapter.id)
  const [naming, setNaming] = useState<{ scene: boolean; name: string } | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [confirm, setConfirm] = useState<AltDraft | null>(null)

  const sceneNow = () => {
    const ed = editorOf(book.path, chapter.id, ctx.editor)
    if (!ed) return null
    const sc = scenesIn(ed.state.doc)
    if (sc.length < 2) return null
    const i = sceneAt(sc, ed.state.selection.head)
    return { index: i, label: sc[i].label }
  }
  const scene = sceneNow()

  const create = async (name: string, ofScene: boolean) => {
    await flushAll()
    const cur = await currentDoc(book.path, chapter.id, ctx.editor)
    if (!cur) return ctx.show('לא הצלחתי לקרוא את הפרק', true)
    let doc = cur
    let sc: AltDraft['scene'] | undefined
    if (ofScene) {
      const s = sceneNow()
      const range = s && sceneRange(paragraphsOf(cur), s.index)
      if (!s || !range) return ctx.show('לא מצאתי את הסצנה', true)
      doc = { type: 'doc', content: (cur.content ?? []).slice(range.start, range.end) }
      sc = s
    }
    const r = await api.createAlt(book.path, chapter.id, name, doc, sc)
    if (!r.ok || !r.value) return ctx.show(r.error ?? 'לא הצלחתי ליצור טיוטה חלופית', true)
    setNaming(null)
    ctx.onBook(r.value.book)
    ctx.onOpenAlt(r.value.altId)
  }

  /** The alternative's text, and the text it would replace (the whole chapter or its scene) */
  const texts = async (a: AltDraft) => {
    await flushAll()
    const [alt, cur] = await Promise.all([api.loadAlt(book.path, a.id), currentDoc(book.path, chapter.id, ctx.editor)])
    if (!alt.ok || !alt.value || !cur) {
      ctx.show(alt.error ?? 'לא הצלחתי לקרוא את הטיוטה', true)
      return null
    }
    const range = a.scene ? sceneRange(paragraphsOf(cur), a.scene.index) : null
    if (a.scene && !range) {
      ctx.show(`בפרק כבר אין סצנה מספר ${a.scene.index + 1}. אפשר לפתוח את הטיוטה ולהעתיק ממנה.`, true)
      return null
    }
    const main = range ? (cur.content ?? []).slice(range.start, range.end) : (cur.content ?? [])
    return { alt: alt.value.doc, main, range: range ?? undefined }
  }

  const compare = async (a: AltDraft) => {
    const t = await texts(a)
    if (!t) return
    ctx.onCompare({
      title: `${a.name} מול ${a.scene ? `הסצנה בפרק` : 'הפרק'}`,
      oldLabel: a.scene ? 'רק בסצנה שבפרק' : 'רק בפרק',
      newLabel: `רק בטיוטה "${a.name}"`,
      oldParas: paragraphsOf(t.main),
      newParas: paragraphsOf(t.alt),
      action: { label: 'בחירת הטיוטה הזו', run: () => setConfirm(a) }
    })
  }

  const choose = async (a: AltDraft) => {
    setConfirm(null)
    const t = await texts(a)
    if (!t) return
    await api.takeVersion(book.path, chapter.id, '', `לפני בחירת "${a.name}"`)
    const err = await replaceText(book.path, chapter.id, ctx.editor, t.alt.content ?? [], t.range)
    if (err) return ctx.show(err, true)
    ctx.show(`"${a.name}" נכנסה לפרק. הנוסח הקודם נשמר בגרסאות, והטיוטה החלופית עדיין כאן אם תרצה לחזור אליה.`)
  }

  const rename = async () => {
    if (!renaming) return
    const r = await api.renameAlt(book.path, renaming.id, renaming.name)
    setRenaming(null)
    if (r.ok && r.value) ctx.onBook(r.value)
  }

  const remove = async (a: AltDraft) => {
    await flushAll()
    const r = await api.deleteAlt(book.path, a.id)
    if (!r.ok || !r.value) return ctx.show(r.error ?? 'לא הצלחתי למחוק', true)
    ctx.onBook(r.value)
    ctx.show(`הטיוטה "${a.name}" הועברה לסל המחזור`)
  }

  const defaultName = (ofScene: boolean) => (ofScene ? `סצנה ${(scene?.index ?? 0) + 1}, נוסח ${list.filter((a) => a.scene?.index === scene?.index).length + 2}` : `נוסח ${list.filter((a) => !a.scene).length + 2}`)

  return (
    <div className="isec">
      <h3>טיוטות חלופיות</h3>
      {list.length === 0 && !naming && <div className="lp-note">נוסח נוסף של הפרק או של סצנה, שנכתב לצד המקורי. אחר כך משווים ובוחרים.</div>}
      {list.map((a) =>
        renaming?.id === a.id ? (
          <form
            key={a.id}
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault()
              void rename()
            }}
          >
            <input autoFocus value={renaming.name} dir="auto" aria-label="שם הטיוטה" onChange={(e) => setRenaming({ id: a.id, name: e.target.value })} onBlur={() => void rename()} onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)} />
          </form>
        ) : (
          <div className="vrow alt" key={a.id}>
            <span className="when">
              <button className="linkbtn" title="פתיחה בחלון ליד הפרק" onClick={() => ctx.onOpenAlt(a.id)}>
                {a.name}
              </button>
              <small>{a.scene ? `סצנה ${a.scene.index + 1}: ${a.scene.label}` : 'כל הפרק'}</small>
            </span>
            <button className="ib" title="מה שונה בין הטיוטה לבין הפרק" onClick={() => void compare(a)}>
              השוואה
            </button>
            <button className="ib" title={a.scene ? 'הטיוטה תחליף את הסצנה בפרק' : 'הטיוטה תחליף את הטקסט של הפרק'} onClick={() => setConfirm(a)}>
              בחירה
            </button>
            <button className="ib icon" title="שינוי שם" aria-label="שינוי שם הטיוטה" onClick={() => setRenaming({ id: a.id, name: a.name })}>
              <Icon name="rename" />
            </button>
            <button className="ib icon" title="מחיקה (לסל המחזור)" aria-label="מחיקת הטיוטה" onClick={() => void remove(a)}>
              <Icon name="trash" />
            </button>
          </div>
        )
      )}
      {naming ? (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault()
            void create(naming.name.trim() || defaultName(naming.scene), naming.scene)
          }}
        >
          <input autoFocus value={naming.name} dir="auto" placeholder={defaultName(naming.scene)} aria-label="שם הטיוטה" onChange={(e) => setNaming({ ...naming, name: e.target.value })} onKeyDown={(e) => e.key === 'Escape' && setNaming(null)} />
          <button className="btn">יצירה</button>
        </form>
      ) : (
        <div className="row-btns">
          <button className="btn ghost" title="עותק של הפרק כמו שהוא עכשיו, לכתוב בו נוסח אחר" onClick={() => setNaming({ scene: false, name: '' })}>
            <Icon name="alt" /> לפרק
          </button>
          {scene && (
            <button className="btn ghost" title={`עותק של הסצנה שהסמן נמצא בה: ${scene.label}`} onClick={() => setNaming({ scene: true, name: '' })}>
              <Icon name="alt" /> לסצנה {scene.index + 1}
            </button>
          )}
        </div>
      )}
      {confirm && (
        <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && setConfirm(null)}>
          <div className="dialog" role="dialog" aria-label="בחירת טיוטה" onKeyDown={(e) => e.key === 'Escape' && setConfirm(null)}>
            <h2>להכניס את "{confirm.name}" לפרק?</h2>
            <p>
              {confirm.scene
                ? `הטיוטה תחליף את סצנה ${confirm.scene.index + 1} בפרק "${chapter.title}". `
                : `הטיוטה תחליף את כל הטקסט של "${chapter.title}". `}
              הנוסח של עכשיו יישמר קודם בגרסאות, כך שאפשר לחזור אליו.
            </p>
            <div className="actions">
              <button className="btn" autoFocus onClick={() => void choose(confirm)}>
                כן, להכניס
              </button>
              <button className="btn ghost" onClick={() => setConfirm(null)}>
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The drawer panel (feature 27)
// ---------------------------------------------------------------------------

export function DrawerPanel({ book, editor, onClose, show }: { book: Book; editor: Editor | null; onClose: () => void; show: (t: string, e?: boolean) => void }) {
  const { items, auto, bookPath } = useDrawer()
  const [q, setQ] = useState('')
  const list = bookPath === book.path ? items.filter((x) => !q.trim() || x.text.includes(q.trim())) : []
  const canInsert = !!editor && !editor.isDestroyed && editor.isEditable
  const put = (it: DrawerItem) => {
    if (!editor || !insertFromDrawer(editor, it)) return show('כדי להחזיר טקסט, קודם לוחצים במקום בפרק שאליו הוא צריך לחזור', true)
    show('הטקסט חזר לפרק. הוא נשאר גם במגירה.')
  }
  const copy = async (it: DrawerItem) => {
    try {
      await navigator.clipboard.writeText(it.text)
      show('הטקסט הועתק')
    } catch {
      show('לא הצלחתי להעתיק', true)
    }
  }
  const how = (it: DrawerItem) => (it.how === 'cut' ? 'נחתך' : it.how === 'manual' ? 'הועבר למגירה' : 'נמחק')
  return (
    <aside className="findpanel drawerpanel" aria-label="מגירה" onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onClose())}>
      <div className="fp-head">
        <h3>מגירה</h3>
        <button className="ib icon" title="סגירה (Esc)" aria-label="סגירת המגירה" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className="lp-note">טקסט שנחתך או נמחק מהספר נשמר כאן, ואפשר להחזיר אותו למקום שבו הסמן נמצא. להעברה ידנית: מסמנים ולוחצים Ctrl+Shift+M.</div>
      <label className="chk">
        <input type="checkbox" checked={auto} onChange={(e) => setDrawerAuto(e.target.checked)} /> לשמור כאן אוטומטית כל טקסט שנחתך (Ctrl+X), או מחיקה של 4 מילים ומעלה
      </label>
      {items.length > 4 && (
        <div className="fp-field">
          <Icon name="search" />
          <input value={q} dir="auto" placeholder="חיפוש במגירה" aria-label="חיפוש במגירה" onChange={(e) => setQ(e.target.value)} />
        </div>
      )}
      <div className="dw-list">
        {list.length === 0 && <div className="lp-note">{q ? 'לא נמצא' : 'המגירה ריקה.'}</div>}
        {list.map((it) => (
          <div className="dw-item" key={it.id}>
            <div className="dw-text" dir="auto">
              {it.text}
            </div>
            <small>
              {how(it)} מ"{it.chapterTitle || 'פרק'}" · {when(it.at)}
            </small>
            <div className="dw-actions">
              <button className="ib" disabled={!canInsert} title={canInsert ? 'להכניס את הטקסט במקום שבו הסמן נמצא' : 'קודם לוחצים במקום בפרק'} onMouseDown={(e) => e.preventDefault()} onClick={() => put(it)}>
                החזרה לטקסט
              </button>
              <button className="ib" title="העתקה, כדי להדביק במקום אחר" onClick={() => void copy(it)}>
                העתקה
              </button>
              <button className="ib icon" title="מחיקה מהמגירה" aria-label="מחיקה מהמגירה" onClick={() => void removeFromDrawer([it.id])}>
                <Icon name="trash" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}
