// Writing review with Claude (feature 19): the side panel (new review, findings, follow-up questions,
// earlier reviews) and the review settings (API key, model, instructions, review kinds).
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import type { Book, Chapter } from '@shared/types'
import {
  addUsage,
  estimateReview,
  DEFAULT_INSTRUCTIONS,
  DEFAULT_KINDS,
  EFFORTS,
  findingsSoFar,
  findQuote,
  formatCost,
  MODELS,
  newId,
  parseReview,
  partialReply,
  historyText,
  relevantReviews,
  type ChatTurn,
  type Effort,
  type Exercise,
  type Finding,
  type FindingStatus,
  type ModelId,
  type Review,
  type ReviewKind,
  type ReviewRequest,
  type ReviewScope,
  type ReviewText,
  snapshotTexts,
  followUpRequest
} from '@shared/review'
import { api } from '../api'
import { saveKey, setAi, useAi, useAiJob, useAiKey } from '../ai'
import { bookTexts } from '../background'
import { applyJump, editorChapter, reviewParas, textBlocks, type JumpTarget } from '../nav'
import { pdfParagraphs } from '../translate'
import { chapterRange } from '@shared/translation'
import { Icon } from './Icons'

// ---------------------------------------------------------------------------
// What is reviewed
// ---------------------------------------------------------------------------

export type ReviewTarget =
  | { mode: 'book'; book: Book; chapter: Chapter | null; editor: Editor | null; goTo: (chapterId: string, t?: JumpTarget) => void }
  | { mode: 'exercise'; exercise: Exercise; editor: Editor | null; onSaved: (list: Review[]) => void }

const SCOPE_LABEL: Record<ReviewScope, string> = { selection: 'הקטע המסומן', chapter: 'הפרק', book: 'כל הספר', exercise: 'התרגיל' }

function when(ts: number): string {
  const d = new Date(ts)
  return `${d.getDate()}.${d.getMonth() + 1}.${String(d.getFullYear()).slice(2)} ${d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`
}

/** Selected words in the editor, with the chapter they are in */
function selectionOf(editor: Editor | null): { text: string; notes: string[]; chapterId?: string } | null {
  if (!editor || editor.isDestroyed) return null
  const { from, to } = editor.state.selection
  if (to - from < 2) return null
  // footnotes inside the selection come as [^1] marks plus their text (round 13 fix)
  const { paras, notes } = reviewParas(editor.state.doc, from, to)
  const text = paras.join('\n').trim()
  if (text.length < 2) return null
  return { text, notes, chapterId: editorChapter(editor)?.chapterId }
}


// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

export function ReviewPanel({ target, onClose, show }: { target: ReviewTarget; onClose: () => void; show: (t: string, e?: boolean) => void }) {
  const ai = useAi()
  const key = useAiKey()
  const job = useAiJob()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [list, setList] = useState<Review[]>(target.mode === 'exercise' ? (target.exercise.reviews ?? []) : [])
  const [openId, setOpenId] = useState<string | null>(null)
  const [tab, setTab] = useState<'new' | 'list'>('new')
  const bookPath = target.mode === 'book' ? target.book.path : null
  const exerciseId = target.mode === 'exercise' ? target.exercise.id : null

  useEffect(() => {
    if (!bookPath) return
    void api.listReviews(bookPath).then((r) => r.ok && r.value && setList(r.value))
  }, [bookPath])
  useEffect(() => {
    if (target.mode === 'exercise') setList(target.exercise.reviews ?? [])
    setOpenId(null)
    setTab('new')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exerciseId])

  const save = async (rv: Review, remove = false) => {
    if (target.mode === 'book') {
      const r = await api.putReview(target.book.path, rv, remove)
      if (!r.ok || !r.value) return show(r.error ?? 'לא הצלחתי לשמור את הביקורת', true)
      setList(r.value)
    } else {
      const r = await api.putExerciseReview(target.exercise.id, rv, remove)
      if (!r.ok || !r.value) return show(r.error ?? 'לא הצלחתי לשמור את הביקורת', true)
      const ex = r.value.workshop.exercises.find((e) => e.id === target.exercise.id)
      setList(ex?.reviews ?? [])
      target.onSaved(ex?.reviews ?? [])
    }
  }

  // What this panel would review in a book: the chapter shown, the selection in it, or the whole book
  const current = target.mode === 'book' ? target.chapter : null
  const relevant = target.mode === 'book' ? list : list
  const open = list.find((r) => r.id === openId) ?? null

  return (
    <aside className="findpanel reviewpanel" aria-label="ביקורת כתיבה" onKeyDown={(e) => e.key === 'Escape' && !settingsOpen && (e.stopPropagation(), onClose())}>
      <div className="fp-head">
        <h3>
          <Icon name="review" /> ביקורת · Claude
        </h3>
        <span className="grow" />
        <button className="ib icon" title="הגדרות ביקורת: מפתח, מודל, הנחיות וסוגי ביקורת" aria-label="הגדרות ביקורת" onClick={() => setSettingsOpen(true)}>
          <Icon name="gear" />
        </button>
        <button className="ib icon" title="סגירה (Esc)" aria-label="סגירת הביקורת" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      {!key.has ? (
        <div className="rv-nokey">
          <p>כדי לקבל ביקורת מ־Claude צריך מפתח API אישי של Anthropic. מגדירים אותו פעם אחת.</p>
          <button className="btn" onClick={() => setSettingsOpen(true)}>
            הגדרת מפתח
          </button>
        </div>
      ) : open ? (
        <ReviewView key={open.id} review={open} list={list} target={target} onBack={() => setOpenId(null)} onSave={save} show={show} />
      ) : (
        <>
          <div className="rv-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'new'} onClick={() => setTab('new')}>
              ביקורת חדשה
            </button>
            <button role="tab" aria-selected={tab === 'list'} onClick={() => setTab('list')}>
              ביקורות קודמות{relevant.length ? ` (${relevant.length})` : ''}
            </button>
          </div>
          {tab === 'new' ? (
            <NewReview
              target={target}
              current={current}
              list={list}
              running={job.jobId !== null}
              partial={job.partial}
              onCancel={job.cancel}
              onRun={async (req, meta) => {
                const id = job.start()
                const r = await api.review(id, req)
                job.done()
                if (!r.ok || !r.value) return show(r.error ?? 'הביקורת נכשלה', true)
                const parsed = parseReview(r.value.json, req.texts)
                const reviewed = meta.scope === 'selection' ? undefined : snapshotTexts(req.texts)
                const rv: Review = { id: newId(), at: Date.now(), ...meta, model: r.value.model, ...parsed, chat: [], usage: r.value.usage, ...(reviewed ? { reviewed } : {}) }
                await save(rv)
                setOpenId(rv.id)
              }}
            />
          ) : (
            <div className="rv-list">
              {list.length === 0 && <div className="lp-note">עדיין אין ביקורות{target.mode === 'book' ? ' בספר הזה' : ' לתרגיל הזה'}.</div>}
              {list.map((r) => {
                const left = r.findings.filter((f) => f.status === 'open').length
                return (
                  <button key={r.id} className="rv-item" onClick={() => setOpenId(r.id)}>
                    <b>{r.title}</b>
                    <small>
                      {SCOPE_LABEL[r.scope]} · {when(r.at)} · {r.findings.length} הערות{left < r.findings.length ? `, ${left} פתוחות` : ''}
                    </small>
                    {r.kinds.length > 0 && <small className="rv-kinds">{r.kinds.join(' · ')}</small>}
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}
      {settingsOpen && <AiSettingsDialog onClose={() => setSettingsOpen(false)} />}
    </aside>
  )
}

// ---------------------------------------------------------------------------
// A new review
// ---------------------------------------------------------------------------

type Meta = Pick<Review, 'scope' | 'targetId' | 'title' | 'kinds' | 'question' | 'excerpt' | 'excerptNotes' | 'withSource' | 'withHistory' | 'effort' | 'withBackground'>

/** Builds the request: the texts are read now (open editors win over the files) */
export async function buildRequest(target: ReviewTarget, meta: Meta, kinds: ReviewKind[], withBackground: boolean, earlier: Review[] = []): Promise<ReviewRequest | string> {
  const k = kinds.filter((x) => meta.kinds.includes(x.name)).map((x) => ({ name: x.name, prompt: x.prompt }))
  const titleOf = (id?: string) => (target.mode === 'book' && id ? target.book.chapters.find((c) => c.id === id)?.title : undefined)
  const history = meta.withHistory && earlier.length ? historyText(earlier, meta, titleOf) || undefined : undefined
  if (target.mode === 'exercise') {
    const ed = target.editor
    const { paras, notes } = ed && !ed.isDestroyed ? reviewParas(ed.state.doc) : { paras: [], notes: [] }
    if (!paras.join('').trim()) return 'התרגיל עדיין ריק'
    return { scope: 'exercise', texts: [{ title: target.exercise.title, paras, ...(notes.length ? { notes } : {}) }], kinds: k, question: meta.question, exercisePrompt: target.exercise.prompt, history }
  }
  const { book } = target
  let texts: ReviewText[] = []
  let contextTitle: string | undefined
  if (meta.scope === 'selection') {
    if (!meta.excerpt) return 'לא סומן טקסט'
    contextTitle = book.chapters.find((c) => c.id === meta.targetId)?.title
    texts = [{ title: contextTitle ?? 'קטע', paras: meta.excerpt.split('\n'), ...(meta.excerptNotes?.length ? { notes: meta.excerptNotes } : {}) }]
  } else {
    const all = await bookTexts(book, true)
    const pick = meta.scope === 'book' ? book.chapters : book.chapters.filter((c) => c.id === meta.targetId)
    texts = pick
      .map((c): ReviewText => {
        const doc = all.docs.get(c.id)
        if (!doc) return { id: c.id, title: c.title, paras: [] }
        // footnotes as [^1] marks plus their text after the chapter (round 13 fix)
        const { paras, notes } = reviewParas(doc)
        return { id: c.id, title: c.title, paras, ...(notes.length ? { notes } : {}) }
      })
      .filter((t) => t.paras.join('').trim())
    if (!texts.length) return meta.scope === 'book' ? 'אין עדיין טקסט בספר' : 'הפרק עדיין ריק'
    // translated chapters: the original's paragraphs from the linked PDF, to compare with
    if (meta.withSource)
      for (const t of texts) {
        const src = t.id ? book.sources?.[t.id] : undefined
        if (!src) continue
        try {
          const st = await pdfParagraphs(book.path, src.pdf)
          const [from, to] = chapterRange(st.paras, src)
          t.source = st.paras.slice(from, to + 1).map((p) => p.text)
        } catch {
          /* the PDF could not be read: reviewed without it */
        }
      }
  }
  let background: string | undefined
  if (withBackground) {
    const r = await api.bookBackground(book.path)
    if (r.ok) background = r.value
  }
  return { scope: meta.scope, texts, contextTitle, kinds: k, question: meta.question, background, bookTitle: book.title, history }
}

function NewReview({
  target,
  current,
  list,
  running,
  partial,
  onCancel,
  onRun
}: {
  target: ReviewTarget
  current: Chapter | null
  list: Review[]
  running: boolean
  partial: string
  onCancel: () => void
  onRun: (req: ReviewRequest, meta: Meta) => Promise<void>
}) {
  const ai = useAi()
  const [scope, setScope] = useState<ReviewScope>(target.mode === 'exercise' ? 'exercise' : 'chapter')
  const [picked, setPicked] = useState<string[]>(() => ai.kinds.filter((k) => k.on).map((k) => k.name))
  const [question, setQuestion] = useState('')
  const [withBg, setWithBg] = useState(true)
  const [withSrc, setWithSrc] = useState(true)
  const [withHist, setWithHist] = useState(true)
  // round 17: model and depth for this review (start from the settings)
  const [pickModel, setPickModel] = useState<ModelId>(ai.model)
  const [pickEffort, setPickEffort] = useState<Effort>(ai.effort)
  useEffect(() => setPickModel(ai.model), [ai.model])
  useEffect(() => setPickEffort(ai.effort), [ai.effort])
  const [error, setError] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [sel, setSel] = useState(() => selectionOf(target.editor))
  const [size, setSize] = useState<number | null>(null)
  const book = target.mode === 'book' ? target.book : null
  const hasBg = !!book && ((book.materials?.length ?? 0) > 0 || (book.glossary?.length ?? 0) > 0)
  // a translated chapter (or a book with some): the original can be sent along
  const hasSrc = !!book && (scope === 'book' ? Object.keys(book.sources ?? {}).length > 0 : scope === 'chapter' && !!current && !!book.sources?.[current.id])

  // the selection changes while the panel is open
  useEffect(() => {
    const ed = target.editor
    if (!ed || ed.isDestroyed) return
    const upd = () => setSel(selectionOf(ed))
    ed.on('selectionUpdate', upd)
    return () => void ed.off('selectionUpdate', upd)
  }, [target.editor])
  useEffect(() => {
    if (scope === 'selection' && !sel) setScope('chapter')
  }, [sel, scope])

  // the size of what would be sent, for the price estimate
  useEffect(() => {
    let alive = true
    const run = async () => {
      if (target.mode === 'exercise') {
        const ed = target.editor
        return setSize(ed && !ed.isDestroyed ? ed.state.doc.textContent.length : 0)
      }
      if (scope === 'selection') return setSize(sel?.text.length ?? 0)
      const all = await bookTexts(target.book)
      if (!alive) return
      const ids = scope === 'book' ? null : current?.id
      setSize(all.chapters.filter((c) => !ids || c.id === ids).reduce((n, c) => n + c.paras.join('\n').length, 0))
    }
    void run()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, current?.id, sel?.text, target.mode === 'exercise' ? target.exercise.id : target.book.path])

  // earlier reviews of what would be reviewed now, to build on
  const histTarget = target.mode === 'exercise' ? { scope: 'exercise' as ReviewScope, targetId: target.exercise.id } : scope === 'book' ? { scope, targetId: undefined } : { scope, targetId: scope === 'selection' ? (sel?.chapterId ?? current?.id) : current?.id }
  const earlier = relevantReviews(list, histTarget)
  const decided = earlier.reduce((n, r) => n + r.findings.filter((f) => f.status !== 'open' || f.decision || f.thread?.length).length, 0)

  const toggle = (name: string) => setPicked((p) => (p.includes(name) ? p.filter((x) => x !== name) : [...p, name]))
  const run = async () => {
    setError(null)
    let meta: Meta
    if (target.mode === 'exercise') meta = { scope: 'exercise', targetId: target.exercise.id, title: target.exercise.title, kinds: picked, question: question.trim() || undefined }
    else if (scope === 'book') meta = { scope, title: 'כל הספר', kinds: picked, question: question.trim() || undefined }
    else if (scope === 'selection') {
      const chapterId = sel?.chapterId ?? current?.id
      const t = target.book.chapters.find((c) => c.id === chapterId)?.title ?? ''
      meta = { scope, targetId: chapterId, title: `קטע מ"${t}"`, kinds: picked, question: question.trim() || undefined, excerpt: sel?.text, ...(sel?.notes.length ? { excerptNotes: sel.notes } : {}) }
    } else {
      if (!current) return setError('קודם בוחרים פרק')
      meta = { scope, targetId: current.id, title: current.title, kinds: picked, question: question.trim() || undefined }
    }
    if (!picked.length && !meta.question) return setError('בוחרים לפחות סוג ביקורת אחד, או כותבים שאלה')
    if (hasSrc && withSrc) meta.withSource = true
    if (earlier.length && withHist) meta.withHistory = true
    meta.effort = pickEffort
    if (hasBg && withBg) meta.withBackground = true
    setPreparing(true)
    const req = await buildRequest(target, meta, ai.kinds, hasBg && withBg, earlier)
    setPreparing(false)
    if (typeof req === 'string') return setError(req)
    await onRun({ ...req, model: pickModel, effort: pickEffort }, meta)
  }

  if (running || preparing) {
    const n = findingsSoFar(partial)
    return (
      <div className="rv-running">
        <div className="rv-spin" aria-hidden />
        <b>{preparing ? 'אוסף את הטקסט…' : partial ? `Claude כותב את הביקורת · ${n} הערות עד עכשיו` : 'Claude קורא וחושב…'}</b>
        <small className="lp-note">{scope === 'book' ? 'ביקורת על כל הספר יכולה לקחת כמה דקות.' : 'זה לוקח בדרך כלל חצי דקה עד שתי דקות.'}</small>
        {!preparing && (
          <button className="btn ghost" onClick={onCancel}>
            ביטול
          </button>
        )}
      </div>
    )
  }

  // what would be sent, in characters: the text, the original (about as long), and earlier reviews
  const sentChars = size ? size * (hasSrc && withSrc ? 2 : 1) + (withHist && earlier.length ? Math.min(40000, historyText(earlier, histTarget).length) : 0) : 0
  return (
    <div className="rv-new">
      {target.mode === 'book' && (
        <div className="rv-row">
          <span className="rv-lbl">מה לבקר</span>
          <div className="fchips">
            <button className="fchip" aria-pressed={scope === 'selection'} disabled={!sel} title={sel ? '' : 'מסמנים קטע בטקסט'} onClick={() => setScope('selection')}>
              הקטע המסומן
            </button>
            <button className="fchip" aria-pressed={scope === 'chapter'} disabled={!current} onClick={() => setScope('chapter')}>
              {current ? `הפרק: ${current.title}` : 'הפרק'}
            </button>
            <button className="fchip" aria-pressed={scope === 'book'} onClick={() => setScope('book')}>
              כל הספר
            </button>
          </div>
        </div>
      )}
      {target.mode === 'exercise' && <div className="lp-note">הביקורת תהיה על התרגיל "{target.exercise.title}"{target.exercise.prompt ? ', כולל השאלה אם הוא עונה על ההנחיה' : ''}.</div>}
      <div className="rv-row">
        <span className="rv-lbl">על מה להסתכל</span>
        <div className="fchips">
          {ai.kinds.map((k) => (
            <button key={k.id} className="fchip" aria-pressed={picked.includes(k.name)} title={k.prompt} onClick={() => toggle(k.name)}>
              {k.name}
            </button>
          ))}
        </div>
      </div>
      {hasBg && (
        <label className="chk">
          <input type="checkbox" checked={withBg} onChange={(e) => setWithBg(e.target.checked)} /> לצרף את דפי הדמויות, המקומות, המחקר והמילון כהקשר
        </label>
      )}
      {hasSrc && (
        <label className="chk">
          <input type="checkbox" checked={withSrc} onChange={(e) => setWithSrc(e.target.checked)} /> להשוות למקור (ה־PDF שמקושר {scope === 'book' ? 'לפרקים' : 'לפרק'}). כדאי לבחור גם "תרגום"
        </label>
      )}
      {earlier.length > 0 && (
        <label className="chk">
          <input type="checkbox" checked={withHist} onChange={(e) => setWithHist(e.target.checked)} /> להתחשב {earlier.length === 1 ? 'בביקורת הקודמת' : `ב־${earlier.length} הביקורות הקודמות`}
          {decided ? ` ובמה שהחלטת בהן (${decided} הערות שטופלו, נדחו או נדונו)` : ''}
        </label>
      )}
      <label className="field">
        שאלה או בקשה (לא חובה)
        <textarea dir="auto" rows={3} value={question} placeholder="למשל: האם הסוף של הפרק מרגיש מוקדם מדי?" onChange={(e) => setQuestion(e.target.value)} />
      </label>
      <div className="rv-row rv-pick">
        <span className="rv-lbl">מודל ועומק</span>
        <select value={pickModel} aria-label="מודל" onChange={(e) => setPickModel(e.target.value as ModelId)}>
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label.replace('Claude ', '')}
            </option>
          ))}
        </select>
        <select value={pickEffort} aria-label="עומק" onChange={(e) => setPickEffort(e.target.value as Effort)}>
          {EFFORTS.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </select>
      </div>
      {error && <div className="rv-err">{error}</div>}
      <button className="btn" onClick={() => void run()}>
        <Icon name="spark" /> הרצת ביקורת
      </button>
      <div className="lp-note">
        {sentChars > 0 ? `הערכה: בערך ${formatCost(estimateReview(pickModel, pickEffort, sentChars))} לביקורת. תגובות ושאלות אחריה: כמה סנטים כל אחת. ` : ''}הטקסט נשלח ל־Anthropic לצורך הביקורת בלבד.
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// A review: summary, findings, follow-up questions
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<FindingStatus, string> = { open: 'פתוחות', done: 'טופלו', dismissed: 'לא רלוונטיות' }

function ReviewView({ review, list, target, onBack, onSave, show }: { review: Review; list: Review[]; target: ReviewTarget; onBack: () => void; onSave: (rv: Review, remove?: boolean) => Promise<void>; show: (t: string, e?: boolean) => void }) {
  const ai = useAi()
  const job = useAiJob()
  const [rv, setRv] = useState(review)
  const [kind, setKind] = useState<string | null>(null)
  const [status, setStatus] = useState<FindingStatus>('open')
  const [q, setQ] = useState('')
  const [missing, setMissing] = useState<Set<string>>(new Set())
  const [confirmDel, setConfirmDel] = useState(false)
  /** Comments whose conversation is shown */
  const [openThreads, setOpenThreads] = useState<Set<string>>(new Set())
  const toggleThread = (id: string) =>
    setOpenThreads((o) => {
      const n = new Set(o)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  /** The comment Claude is answering about right now */
  const [replyFor, setReplyFor] = useState<string | null>(null)
  const chatEnd = useRef<HTMLDivElement>(null)
  useEffect(() => setRv(review), [review])

  const kinds = useMemo(() => [...new Set(rv.findings.map((f) => f.kind))], [rv.findings])
  const counts = (s: FindingStatus) => rv.findings.filter((f) => f.status === s).length
  const shown = rv.findings.filter((f) => f.status === status && (!kind || f.kind === kind))
  const book = target.mode === 'book' ? target.book : null
  const chapterTitle = (id?: string) => (book && id ? book.chapters.find((c) => c.id === id)?.title : undefined)

  const update = (next: Review) => {
    setRv(next)
    void onSave(next)
  }
  const patchFinding = (base: Review, id: string, patch: Partial<Finding>): Review => ({ ...base, findings: base.findings.map((f) => (f.id === id ? { ...f, ...patch } : f)) })
  const setFinding = (id: string, s: FindingStatus) => update(patchFinding(rv, id, { status: s }))
  const setDecision = (id: string, decision: string) => update(patchFinding(rv, id, { decision: decision.trim() || undefined }))

  /** The same request the review was made with: the text as reviewed, plus what changed since (round 16), for follow-ups */
  const request = async () => {
    const req = await buildRequest(target, rv, ai.kinds, rv.effort ? !!rv.withBackground : target.mode === 'book' && rv.scope !== 'selection', rv.withHistory ? relevantReviews(list, rv, rv.at) : [])
    return typeof req === 'string' && !rv.reviewed?.length ? req : followUpRequest(typeof req === 'string' ? { scope: rv.scope, texts: [], kinds: [] } : req, rv)
  }

  /** The writer answers one comment; Claude answers and sums up what was decided */
  const reply = async (f: Finding, message: string): Promise<boolean> => {
    if (job.jobId) return false
    const req = await request()
    if (typeof req === 'string') return show(req, true), false
    const asked = patchFinding(rv, f.id, { thread: [...(f.thread ?? []), { role: 'user', text: message }] })
    setRv(asked)
    setReplyFor(f.id)
    const id = job.start()
    const r = await api.findingReply(id, req, rv, f, message)
    job.done()
    setReplyFor(null)
    if (!r.ok || !r.value) {
      setRv(rv)
      show(r.error ?? 'התגובה לא נשלחה', true)
      return false
    }
    const thread = [...(f.thread ?? []), { role: 'user' as const, text: message }, { role: 'assistant' as const, text: r.value.reply, cost: r.value.usage.cost }]
    update({ ...patchFinding(rv, f.id, { thread, ...(r.value.decision ? { decision: r.value.decision } : {}) }), usage: addUsage(rv.usage, r.value.usage) })
    return true
  }

  const jump = async (f: Finding) => {
    if (!f.quote) return
    const notFound = () => {
      setMissing((m) => new Set(m).add(f.id))
      show('המשפט הזה כבר לא נמצא בטקסט (אולי שונה מאז)', true)
    }
    if (target.mode === 'exercise') {
      const ed = target.editor
      if (!ed || ed.isDestroyed) return
      const blocks = textBlocks(ed.state.doc)
      const hit = findQuote(
        blocks.map((b) => b.text),
        f.quote
      )
      if (!hit) return notFound()
      const b = blocks[hit.para]
      return applyJump(ed, { pos: b.pos + 1 + hit.start, to: b.pos + 1 + hit.end })
    }
    const chapterId = f.chapterId ?? rv.targetId
    if (!chapterId || !target.book.chapters.some((c) => c.id === chapterId)) return notFound()
    const texts = await bookTexts(target.book, true)
    const blocks = texts.blocks.get(chapterId) ?? []
    const hit = findQuote(
      blocks.map((b) => b.text),
      f.quote
    )
    if (!hit) return notFound()
    const b = blocks[hit.para]
    target.goTo(chapterId, { pos: b.pos + 1 + hit.start, to: b.pos + 1 + hit.end })
  }

  const ask = async () => {
    const question = q.trim()
    if (!question || job.jobId) return
    const req = await request()
    if (typeof req === 'string') return show(req, true)
    setQ('')
    const asked: Review = { ...rv, chat: [...rv.chat, { role: 'user', text: question }] }
    setRv(asked)
    requestAnimationFrame(() => chatEnd.current?.scrollIntoView({ block: 'end' }))
    const id = job.start()
    const r = await api.followUp(id, req, rv, rv.chat, question)
    job.done()
    if (!r.ok || !r.value) {
      setRv(rv)
      setQ(question)
      return show(r.error ?? 'השאלה לא נשלחה', true)
    }
    const next: Review = { ...asked, chat: [...asked.chat, { role: 'assistant', text: r.value.text, cost: r.value.usage.cost }], usage: addUsage(rv.usage, r.value.usage) }
    update(next)
    requestAnimationFrame(() => chatEnd.current?.scrollIntoView({ block: 'end' }))
  }

  const copyAll = async () => {
    const lines = [`ביקורת: ${rv.title} (${when(rv.at)})`, '', rv.summary, '']
    for (const f of rv.findings) {
      lines.push(`[${f.kind}]${chapterTitle(f.chapterId) && rv.scope === 'book' ? ` ${chapterTitle(f.chapterId)}:` : ''}${f.quote ? ` "${f.quote}"` : ''}`, f.comment + (f.suggestion ? ` ← ${f.suggestion}` : ''))
      for (const t of f.thread ?? []) lines.push(`  ${t.role === 'user' ? 'אני' : 'Claude'}: ${t.text}`)
      if (f.decision) lines.push(`  הוחלט: ${f.decision}`)
      lines.push('')
    }
    if (rv.lessons) lines.push('מה זה מלמד על הכתיבה שלך:', rv.lessons, '')
    if (rv.next) lines.push('מה הייתי עושה עכשיו:', rv.next, '')
    for (const t of rv.chat) lines.push(t.role === 'user' ? `שאלה: ${t.text}` : t.text, '')
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      show('הביקורת הועתקה')
    } catch {
      show('לא הצלחתי להעתיק', true)
    }
  }

  return (
    <div className="rv-view">
      <div className="rv-top">
        <button className="ib" onClick={onBack} title="חזרה">
          <Icon name="next" /> חזרה
        </button>
        <span className="grow" />
        <button className="ib icon" title="העתקת כל הביקורת" aria-label="העתקת כל הביקורת" onClick={() => void copyAll()}>
          <Icon name="file" />
        </button>
        <button className="ib icon" title="מחיקת הביקורת" aria-label="מחיקת הביקורת" onClick={() => setConfirmDel(true)}>
          <Icon name="trash" />
        </button>
      </div>
      {confirmDel && (
        <div className="rv-confirm">
          למחוק את הביקורת הזו?
          <button className="ib" onClick={() => void onSave(rv, true).then(onBack)}>
            מחיקה
          </button>
          <button className="ib" onClick={() => setConfirmDel(false)}>
            לא
          </button>
        </div>
      )}
      <div className="rv-scroll">
        <div className="rv-head">
          <b>{rv.title}</b>
          <small>
            {SCOPE_LABEL[rv.scope]} · {when(rv.at)}
            {rv.question ? ` · שאלה: ${rv.question}` : ''}
          </small>
        </div>
        {rv.summary && (
          <div className="rv-summary" dir="auto">
            {rv.summary}
          </div>
        )}
        {rv.findings.length > 0 && (
          <>
            <div className="fchips rv-status">
              {(['open', 'done', 'dismissed'] as FindingStatus[]).map((s) =>
                s === 'open' || counts(s) ? (
                  <button key={s} className="fchip" aria-pressed={status === s} onClick={() => setStatus(s)}>
                    {STATUS_LABEL[s]} <span className="cnt">{counts(s)}</span>
                  </button>
                ) : null
              )}
            </div>
            {kinds.length > 1 && (
              <div className="fchips">
                <button className="fchip" aria-pressed={!kind} onClick={() => setKind(null)}>
                  הכל
                </button>
                {kinds.map((k) => (
                  <button key={k} className="fchip" aria-pressed={kind === k} onClick={() => setKind(kind === k ? null : k)}>
                    {k} <span className="cnt">{rv.findings.filter((f) => f.kind === k && f.status === status).length}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        <div className="rv-findings">
          {rv.findings.length === 0 && <div className="lp-note">אין הערות בביקורת הזו.</div>}
          {rv.findings.length > 0 && shown.length === 0 && <div className="lp-note">{status === 'open' ? 'כל ההערות טופלו. כל הכבוד.' : 'אין כאן הערות.'}</div>}
          {shown.map((f) => (
            <div key={f.id} className={`rv-card${f.kind === 'מה עובד' ? ' good' : ''}`}>
              <div className="rv-card-top">
                <span className="rv-kind">{f.kind}</span>
                {rv.scope === 'book' && chapterTitle(f.chapterId) && <small>{chapterTitle(f.chapterId)}</small>}
              </div>
              {f.quote && (
                <button className={`rv-quote${missing.has(f.id) ? ' missing' : ''}`} dir="auto" title={missing.has(f.id) ? 'לא נמצא בטקסט' : 'קפיצה למקום בטקסט'} onClick={() => void jump(f)}>
                  “{f.quote}”
                </button>
              )}
              <div className="rv-comment" dir="auto">
                {f.comment}
              </div>
              {f.suggestion && (
                <div className="rv-suggest" dir="auto">
                  ← {f.suggestion}
                </div>
              )}
              {f.decision && !openThreads.has(f.id) && (
                <div className="rv-decision" dir="auto">
                  <b>הוחלט:</b> {f.decision}
                </div>
              )}
              {openThreads.has(f.id) && (
                <FindingThread
                  finding={f}
                  busy={replyFor === f.id}
                  partial={replyFor === f.id ? partialReply(job.partial) : ''}
                  locked={!!job.jobId}
                  onReply={(m) => reply(f, m)}
                  onDecision={(d) => setDecision(f.id, d)}
                  onCancel={job.cancel}
                />
              )}
              <div className="dw-actions">
                <button className="ib" title="לענות על ההערה הזו ולדבר עליה עם Claude" aria-expanded={openThreads.has(f.id)} onClick={() => toggleThread(f.id)}>
                  {openThreads.has(f.id) ? 'הסתרת השיחה' : f.thread?.length ? `שיחה (${f.thread.filter((t) => t.role === 'user').length})` : 'תגובה'}
                </button>
                {f.status === 'open' ? (
                  <>
                    <button className="ib" title="סימון שטיפלתי בזה" onClick={() => setFinding(f.id, 'done')}>
                      <Icon name="check" /> טופל
                    </button>
                    <button className="ib" title="ההערה לא מתאימה" onClick={() => setFinding(f.id, 'dismissed')}>
                      לא רלוונטי
                    </button>
                  </>
                ) : (
                  <button className="ib" onClick={() => setFinding(f.id, 'open')}>
                    החזרה לפתוחות
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {rv.lessons && (
          <div className="rv-section">
            <b>מה זה מלמד על הכתיבה שלך</b>
            <div dir="auto">{rv.lessons}</div>
          </div>
        )}
        {rv.next && (
          <div className="rv-section">
            <b>מה הייתי עושה עכשיו</b>
            <div dir="auto">{rv.next}</div>
          </div>
        )}
        {(rv.chat.length > 0 || job.jobId) && (
          <div className="rv-chat">
            {rv.chat.map((t, i) => (
              <div key={i} className={`rv-msg ${t.role}`} dir="auto">
                {t.text}
                <MsgCost t={t} />
              </div>
            ))}
            {job.jobId && !replyFor && (
              <div className="rv-msg assistant pending" dir="auto">
                {partialReply(job.partial) || 'Claude חושב…'}
              </div>
            )}
          </div>
        )}
        <div ref={chatEnd} />
      </div>
      <div className="rv-ask">
        <textarea
          dir="auto"
          rows={2}
          value={q}
          disabled={!!job.jobId}
          placeholder="שאלת המשך על הביקורת…"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void ask()
            }
          }}
        />
        {job.jobId ? (
          <button className="ib" onClick={job.cancel}>
            ביטול
          </button>
        ) : (
          <button className="ib icon" title="שליחה (Enter)" aria-label="שליחה" disabled={!q.trim()} onClick={() => void ask()}>
            <Icon name="send" />
          </button>
        )}
      </div>
      <div className="lp-note rv-foot">
        {MODELS.find((m) => m.id === rv.model)?.label ?? rv.model}
        {rv.effort ? ` · ${EFFORTS.find((x) => x.id === rv.effort)?.label ?? ''}` : ''} · עלות עד עכשיו, כולל תגובות ושאלות: {formatCost(rv.usage.cost)}
      </div>
    </div>
  )
}

/** Round 17: what one answer cost, small, under it */
function MsgCost({ t }: { t: ChatTurn }) {
  if (t.role !== 'assistant' || t.cost === undefined) return null
  return <small className="rv-cost">{formatCost(t.cost)}</small>
}

// ---------------------------------------------------------------------------
// A conversation about one comment
// ---------------------------------------------------------------------------

function FindingThread({
  finding,
  busy,
  partial,
  locked,
  onReply,
  onDecision,
  onCancel
}: {
  finding: Finding
  busy: boolean
  partial: string
  /** Claude is busy with something else in this review */
  locked: boolean
  onReply: (message: string) => Promise<boolean>
  onDecision: (text: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState('')
  const [decision, setDecision] = useState(finding.decision ?? '')
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => setDecision(finding.decision ?? ''), [finding.decision])
  useEffect(() => box.current?.focus(), [])
  const send = async () => {
    const m = draft.trim()
    if (!m || locked) return
    setDraft('')
    if (!(await onReply(m))) setDraft(m)
  }
  const thread = finding.thread ?? []
  return (
    <div className="rv-thread">
      {thread.map((t, i) => (
        <div key={i} className={`rv-msg ${t.role}`} dir="auto">
          {t.text}
          <MsgCost t={t} />
        </div>
      ))}
      {busy && (
        <div className="rv-msg assistant pending" dir="auto">
          {partial || 'Claude חושב…'}
        </div>
      )}
      <div className="rv-ask">
        <textarea
          ref={box}
          dir="auto"
          rows={2}
          value={draft}
          disabled={locked}
          placeholder={thread.length ? 'המשך השיחה על ההערה…' : 'מה דעתך על ההערה? למשל: "זה מכוון, כי…" או "איך היית מתקן?"'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
        />
        {busy ? (
          <button className="ib" onClick={onCancel}>
            ביטול
          </button>
        ) : (
          <button className="ib icon" title="שליחה (Enter)" aria-label="שליחת תגובה" disabled={!draft.trim() || locked} onClick={() => void send()}>
            <Icon name="send" />
          </button>
        )}
      </div>
      <label className="rv-decision-edit">
        <span>מה הוחלט</span>
        <input
          dir="auto"
          value={decision}
          placeholder="Claude ימלא אחרי השיחה, ואפשר לכתוב בעצמך"
          title="ביקורות הבאות יתחשבו בהחלטה הזו"
          onChange={(e) => setDecision(e.target.value)}
          onBlur={() => decision.trim() !== (finding.decision ?? '') && onDecision(decision)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </label>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Review settings
// ---------------------------------------------------------------------------

export function AiSettingsDialog({ onClose }: { onClose: () => void }) {
  const ai = useAi()
  const key = useAiKey()
  const [keyText, setKeyText] = useState('')
  const [keyMsg, setKeyMsg] = useState<{ text: string; error?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [instr, setInstr] = useState(ai.instructions)
  const [kinds, setKinds] = useState<ReviewKind[]>(ai.kinds)

  // instructions and kinds are saved when the dialog closes, and when a field loses focus
  const commit = () => setAi({ instructions: instr, kinds: kinds.filter((k) => k.name.trim()) })
  const close = () => (commit(), onClose())

  const saveAndTest = async () => {
    setBusy(true)
    setKeyMsg(null)
    const err = await saveKey(keyText)
    if (err) {
      setBusy(false)
      return setKeyMsg({ text: err, error: true })
    }
    const t = await api.testAiKey()
    setBusy(false)
    setKeyText('')
    setKeyMsg(t.ok ? { text: `המפתח עובד (${t.value}). הוא נשמר מוצפן במחשב הזה.` } : { text: t.error ?? 'המפתח לא עובד', error: true })
  }
  const test = async () => {
    setBusy(true)
    const t = await api.testAiKey()
    setBusy(false)
    setKeyMsg(t.ok ? { text: `המפתח עובד (${t.value}).` } : { text: t.error ?? 'המפתח לא עובד', error: true })
  }
  const setKind = (id: string, patch: Partial<ReviewKind>) => setKinds((ks) => ks.map((k) => (k.id === id ? { ...k, ...patch } : k)))

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog settings ai-settings" role="dialog" aria-label="הגדרות ביקורת" onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), close())}>
        <h2>הגדרות ביקורת עם Claude</h2>

        <section>
          <h3>מפתח API</h3>
          {key.has ? (
            <div className="set-row">
              <span>
                מוגדר מפתח שמסתיים ב־<span className="mono">{key.hint}</span>
              </span>
              <span className="grow" />
              <button className="ib" disabled={busy} onClick={() => void test()}>
                בדיקה
              </button>
              <button className="ib" disabled={busy} onClick={() => void saveKey('').then(() => setKeyMsg({ text: 'המפתח נמחק מהמחשב' }))}>
                מחיקה
              </button>
            </div>
          ) : (
            <ol className="ai-steps">
              <li>
                נכנסים ל־
                <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
                  console.anthropic.com
                </a>{' '}
                ומתחברים (אפשר עם אותו חשבון Google).
              </li>
              <li>ב־Billing מוסיפים קרדיט (למשל 5$). התשלום לפי שימוש, ונפרד מהמנוי ל־claude.ai.</li>
              <li>ב־API keys לוחצים Create Key, מעתיקים ומדביקים כאן.</li>
            </ol>
          )}
          <div className="pathrow">
            <input className="mono ai-key" type="password" dir="ltr" placeholder={key.has ? 'מפתח חדש במקום הקיים' : 'sk-ant-…'} value={keyText} onChange={(e) => setKeyText(e.target.value)} />
            <button className="btn" disabled={busy || !keyText.trim()} onClick={() => void saveAndTest()}>
              {busy ? 'בודק…' : 'שמירה'}
            </button>
          </div>
          {keyMsg && <p className={keyMsg.error ? 'err' : 'lp-note'}>{keyMsg.text}</p>}
        </section>

        <section>
          <h3>מודל</h3>
          {MODELS.map((m) => (
            <label key={m.id} className="set-row">
              <input type="radio" name="ai-model" checked={ai.model === m.id} onChange={() => setAi({ model: m.id })} />
              <span>{m.label}</span>
              <span className="set-ex">
                {m.note} · <bdi dir="ltr">${m.input} / ${m.output}</bdi> למיליון טוקנים (קלט / פלט)
              </span>
            </label>
          ))}
          <label className="set-row">
            <span>יסודיות</span>
            <select value={ai.effort} onChange={(e) => setAi({ effort: e.target.value as typeof ai.effort, r17: true })}>
              {EFFORTS.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
            <span className="set-ex">יותר יסודי = לוקח יותר זמן ועולה קצת יותר</span>
          </label>
          <p className="lp-note">
            רוב המחיר והזמן של ביקורת הם מה ש־Claude כותב: החשיבה השקטה וההערות. ביקורת על פרק ב־Opus 5.5 עולה בערך 60 סנט ב"יסודי" ובערך 35 ב"רגיל", ו־Sonnet בחצי מזה. תגובות ושאלות אחרי הביקורת עולות כמה סנטים, כי הפרק נשמר אצל Claude לשעה. אפשר לבחור מודל ועומק גם לכל ביקורת בנפרד, בחלון הביקורת.
          </p>
        </section>

        <section>
          <h3>הנחיות כלליות</h3>
          <p className="lp-note">כמו ההנחיות של פרויקט ב־claude.ai: אפשר להדביק כאן את ההנחיות מהפרויקט "ביקורת כתיבה". הן נשלחות עם כל ביקורת.</p>
          <textarea className="ai-instr" dir="auto" rows={9} value={instr} onChange={(e) => setInstr(e.target.value)} onBlur={commit} />
          <div>
            <button className="ib" onClick={() => setInstr(DEFAULT_INSTRUCTIONS)}>
              החזרה להנחיות ברירת המחדל
            </button>
          </div>
        </section>

        <section>
          <h3>סוגי ביקורת</h3>
          <p className="lp-note">כל סוג הוא כפתור בחלונית הביקורת. השם מופיע על הכפתור, והתיאור אומר ל־Claude על מה להסתכל. סוגים מסומנים נבחרים מראש.</p>
          {kinds.map((k) => (
            <div key={k.id} className="ai-kind">
              <div className="ai-kind-top">
                <input type="checkbox" title="נבחר מראש" checked={!!k.on} onChange={(e) => setKind(k.id, { on: e.target.checked })} />
                <input className="ai-kind-name" dir="auto" value={k.name} placeholder="שם" onChange={(e) => setKind(k.id, { name: e.target.value })} onBlur={commit} />
                <button className="ib icon" title="מחיקת הסוג" aria-label="מחיקת הסוג" onClick={() => setKinds((ks) => ks.filter((x) => x.id !== k.id))}>
                  <Icon name="trash" />
                </button>
              </div>
              <textarea dir="auto" rows={2} value={k.prompt} placeholder="על מה להסתכל" onChange={(e) => setKind(k.id, { prompt: e.target.value })} onBlur={commit} />
            </div>
          ))}
          <div className="set-row">
            <button className="ib" onClick={() => setKinds((ks) => [...ks, { id: newId(), name: '', prompt: '', on: false }])}>
              <Icon name="plus" /> סוג חדש
            </button>
            <button className="ib" onClick={() => setKinds(DEFAULT_KINDS)}>
              החזרת סוגי ברירת המחדל
            </button>
          </div>
        </section>

        <div className="actions">
          <button className="btn" onClick={close}>
            סגירה
          </button>
        </div>
      </div>
    </div>
  )
}
