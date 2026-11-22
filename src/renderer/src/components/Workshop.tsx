// The workshop (feature 22): short writing exercises outside any book, a list of prompts waiting to
// be written (the writer's own, imported, or suggested by Claude), and a review of each exercise.
import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import type { LoadedChapter } from '@shared/types'
import { splitPrompts, type Exercise, type ExercisePrompt, type Workshop as WorkshopData } from '@shared/review'
import { api } from '../api'
import { useAiJob, useAiKey } from '../ai'
import { Icon } from './Icons'
import { ChapterBody, type SaveState } from './ChapterEditor'
import { FormatBar } from './FormatBar'
import { ReviewPanel, AiSettingsDialog } from './Review'

function when(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return `היום ב־${d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`
  return `${d.getDate()}.${d.getMonth() + 1}.${String(d.getFullYear()).slice(2)}`
}

const SOURCE_LABEL: Record<ExercisePrompt['source'], string> = { mine: '', claude: 'הצעה של Claude', import: 'מיובא' }

export function Workshop({ show, openId, onOpen }: { show: (t: string, e?: boolean) => void; openId: string | null; onOpen: (id: string | null) => void }) {
  const [ws, setWs] = useState<WorkshopData | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void api.openWorkshop().then((r) => (r.ok && r.value ? setWs(r.value) : setError(r.error ?? 'לא הצלחתי לפתוח את הסדנה')))
  }, [])
  if (error) return <div className="paper-state">{error}</div>
  if (!ws) return <div className="paper-state">פותח את הסדנה…</div>
  const open = openId ? ws.exercises.find((e) => e.id === openId) : null
  if (open) return <ExerciseView key={open.id} ws={ws} exercise={open} onWs={setWs} onBack={() => onOpen(null)} show={show} />
  return <WorkshopHome ws={ws} onWs={setWs} onOpen={onOpen} show={show} />
}

function WorkshopHome({ ws, onWs, onOpen, show }: { ws: WorkshopData; onWs: (w: WorkshopData) => void; onOpen: (id: string) => void; show: (t: string, e?: boolean) => void }) {
  const [adding, setAdding] = useState(false)
  const [paste, setPaste] = useState('')
  const [theme, setTheme] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [aiSettings, setAiSettings] = useState(false)
  const key = useAiKey()
  const job = useAiJob()

  const newExercise = async (prompt = '', fromPromptId?: string) => {
    const r = await api.createExercise(prompt, undefined, fromPromptId)
    if (!r.ok || !r.value) return show(r.error ?? 'לא הצלחתי ליצור תרגיל', true)
    onWs(r.value.workshop)
    onOpen(r.value.value.id)
  }
  const addPasted = async () => {
    const list = splitPrompts(paste)
    if (!list.length) return
    const r = await api.addPrompts(list, 'mine')
    if (!r.ok || !r.value) return show(r.error ?? 'לא הצלחתי להוסיף', true)
    onWs(r.value.workshop)
    setPaste('')
    setAdding(false)
    show(r.value.value === 1 ? 'נוסף תרגיל אחד לרשימה' : `נוספו ${r.value.value} תרגילים לרשימה`)
  }
  const suggest = async () => {
    if (!key.has) return setAiSettings(true)
    const id = job.start()
    const avoid = [...ws.prompts.map((p) => p.text), ...ws.exercises.map((e) => e.prompt).filter(Boolean)]
    const r = await api.promptIdeas(id, theme, 5, avoid)
    job.done()
    if (!r.ok || !r.value) return show(r.error ?? 'לא התקבלו הצעות', true)
    const a = await api.addPrompts(r.value.prompts, 'claude')
    if (a.ok && a.value) onWs(a.value.workshop)
  }
  const importFiles = async () => {
    const r = await api.importExercises()
    if (!r.ok) return show(r.error ?? 'הייבוא נכשל', true)
    if (!r.value) return
    onWs(r.value.workshop)
    show(r.value.value === 1 ? 'יובא תרגיל אחד' : `יובאו ${r.value.value} תרגילים`)
  }

  return (
    <div className="workshop">
      <section className="ws-prompts">
        <div className="hhead">
          <h3>תרגילים שמחכים לכתיבה</h3>
          <span className="grow" />
          <button className="ib" onClick={() => setAdding(!adding)} aria-expanded={adding}>
            <Icon name="plus" /> הוספה
          </button>
        </div>
        {adding && (
          <div className="ws-add">
            <textarea dir="auto" rows={5} value={paste} autoFocus placeholder={'אפשר להדביק כמה תרגילים בבת אחת, כל אחד בשורה או בפסקה משלו (למשל מהפרויקט ב־claude.ai).'} onChange={(e) => setPaste(e.target.value)} />
            <div className="set-row">
              <button className="btn" disabled={!paste.trim()} onClick={() => void addPasted()}>
                הוספה לרשימה
              </button>
              <button className="ib" onClick={() => (setAdding(false), setPaste(''))}>
                ביטול
              </button>
            </div>
          </div>
        )}
        <div className="ws-plist">
          {ws.prompts.length === 0 && !adding && <div className="lp-note">אין עדיין תרגילים ברשימה. אפשר להוסיף בעצמך, להדביק מ־claude.ai, או לבקש הצעות מ־Claude.</div>}
          {ws.prompts.map((p) => (
            <div key={p.id} className="ws-prompt">
              {editing === p.id ? (
                <textarea
                  dir="auto"
                  rows={3}
                  autoFocus
                  defaultValue={p.text}
                  onBlur={(e) => {
                    setEditing(null)
                    const t = e.target.value.trim()
                    if (t && t !== p.text) void api.editPrompt(p.id, t).then((r) => r.ok && r.value && onWs(r.value.workshop))
                  }}
                  onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}
                />
              ) : (
                <div className="ws-ptext" dir="auto" onDoubleClick={() => setEditing(p.id)}>
                  {p.text}
                </div>
              )}
              <div className="dw-actions">
                <button className="ib" onClick={() => void newExercise(p.text, p.id)}>
                  <Icon name="pen" /> לכתוב עכשיו
                </button>
                {SOURCE_LABEL[p.source] && <small>{SOURCE_LABEL[p.source]}</small>}
                <button className="ib icon" title="עריכה" aria-label="עריכה" onClick={() => setEditing(p.id)}>
                  <Icon name="rename" />
                </button>
                <button className="ib icon" title="הסרה מהרשימה" aria-label="הסרה מהרשימה" onClick={() => void api.removePrompt(p.id).then((r) => r.ok && r.value && onWs(r.value.workshop))}>
                  <Icon name="trash" />
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="ws-suggest">
          <input dir="auto" value={theme} placeholder="נושא או מיקוד (לא חובה): דיאלוג, תיאור מקום, נקודת מבט…" onChange={(e) => setTheme(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !job.jobId && void suggest()} />
          {job.jobId ? (
            <button className="ib" onClick={job.cancel}>
              מחפש רעיונות… ביטול
            </button>
          ) : (
            <button className="ib" title="Claude יציע 5 תרגילים חדשים" onClick={() => void suggest()}>
              <Icon name="spark" /> הצעות מ־Claude
            </button>
          )}
        </div>
      </section>

      <section className="ws-list">
        <div className="hhead">
          <h3>התרגילים שלי</h3>
          <span className="grow" />
          <button className="btn ghost" title="קובצי Word או טקסט שכבר כתבת" onClick={() => void importFiles()}>
            ייבוא מקבצים
          </button>
          <button className="btn" onClick={() => void newExercise()}>
            <Icon name="plus" /> תרגיל חדש
          </button>
        </div>
        {ws.exercises.length === 0 && <div className="welcome">כאן כותבים תרגילים קצרים, בלי לפתוח ספר. כל תרגיל נשמר כקובץ Word בתיקיית הסדנה (<bdi dir="ltr">{ws.path}</bdi>), ואפשר לבקש עליו ביקורת מ־Claude.</div>}
        <div className="ws-cards">
          {ws.exercises.map((ex) => {
            const open = ex.reviews?.[0]?.findings.filter((f) => f.status === 'open').length ?? 0
            return (
              <button key={ex.id} className="ws-card" onClick={() => onOpen(ex.id)}>
                <b>{ex.title}</b>
                {ex.prompt && (
                  <span className="ws-cprompt" dir="auto">
                    {ex.prompt}
                  </span>
                )}
                <small>
                  {when(ex.updated)} · {ex.words.toLocaleString('he-IL')} מילים
                  {ex.reviews?.length ? ` · ${ex.reviews.length === 1 ? 'ביקורת אחת' : `${ex.reviews.length} ביקורות`}${open ? ` (${open} הערות פתוחות)` : ''}` : ''}
                </small>
              </button>
            )
          })}
        </div>
        <div className="lp-note ws-folder">
          התיקייה: <bdi className="mono" dir="ltr">{ws.path}</bdi>{' '}
          <button className="ib" onClick={() => void api.openPath(ws.path)}>
            פתיחה
          </button>
          <button className="ib" title="להעביר את הסדנה לתיקייה אחרת (התרגילים הקיימים נשארים במקום הישן)" onClick={() => void api.moveWorkshop().then((r) => r.ok && r.value && onWs(r.value))}>
            תיקייה אחרת…
          </button>
        </div>
      </section>
      {aiSettings && <AiSettingsDialog onClose={() => setAiSettings(false)} />}
    </div>
  )
}

function ExerciseView({ ws, exercise, onWs, onBack, show }: { ws: WorkshopData; exercise: Exercise; onWs: (w: WorkshopData) => void; onBack: () => void; show: (t: string, e?: boolean) => void }) {
  const [loaded, setLoaded] = useState<LoadedChapter | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [words, setWords] = useState(exercise.words)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [reviewOpen, setReviewOpen] = useState(false)
  const [title, setTitle] = useState(exercise.title)
  const [prompt, setPrompt] = useState(exercise.prompt)
  const [confirmDel, setConfirmDel] = useState(false)
  const latest = useRef(exercise)
  latest.current = exercise

  useEffect(() => {
    void api.loadExercise(exercise.id).then((r) => (r.ok && r.value ? setLoaded(r.value) : setLoadError(r.error ?? 'לא הצלחתי לפתוח את התרגיל')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveMeta = async (patch: { title?: string; prompt?: string }) => {
    const r = await api.updateExercise(exercise.id, patch)
    if (!r.ok || !r.value) return show(r.error ?? 'השמירה נכשלה', true)
    onWs(r.value.workshop)
  }
  const back = async () => {
    // the word count and date on the card come from the last save
    const r = await api.openWorkshop()
    if (r.ok && r.value) onWs(r.value)
    onBack()
  }
  const del = async () => {
    const r = await api.deleteExercise(exercise.id)
    if (!r.ok || !r.value) return show(r.error ?? 'המחיקה נכשלה', true)
    onWs(r.value.workshop)
    onBack()
    show('התרגיל עבר לסל המחזור')
  }

  return (
    <div className="exercise">
      <div className="ex-bar">
        <button className="ib" onClick={() => void back()}>
          <Icon name="next" /> לכל התרגילים
        </button>
        <span className="grow" />
        <span className={`saved ${saveState}`}>
          <i />
          <span>{saveState === 'saved' ? 'נשמר' : saveState === 'saving' ? 'שומר…' : saveState === 'error' ? 'השמירה נכשלה' : 'יש שינויים…'}</span>
        </span>
        <span className="lp-note">{words.toLocaleString('he-IL')} מילים</span>
        <button className="ib icon" title="הצגת הקובץ בתיקייה" aria-label="הצגת הקובץ בתיקייה" onClick={() => void api.showExerciseFile(exercise.id)}>
          <Icon name="folder" />
        </button>
        <button className="ib icon" title="מחיקת התרגיל" aria-label="מחיקת התרגיל" onClick={() => setConfirmDel(true)}>
          <Icon name="trash" />
        </button>
        <button className="ib" aria-pressed={reviewOpen} title="ביקורת על התרגיל עם Claude" onClick={() => setReviewOpen(!reviewOpen)}>
          <Icon name="review" /> ביקורת
        </button>
      </div>
      {confirmDel && (
        <div className="rv-confirm ex-confirm">
          למחוק את "{exercise.title}"? הקובץ יעבור לסל המחזור.
          <button className="ib" onClick={() => void del()}>
            מחיקה
          </button>
          <button className="ib" onClick={() => setConfirmDel(false)}>
            לא
          </button>
        </div>
      )}
      <FormatBar editor={editor} />
      <div className="body">
        <main className="desk">
          <article className="paper">
            <div className="docfile">
              <Icon name="workshop" />
              <span className="fname">תרגיל · {exercise.file}</span>
            </div>
            <input className="ch-title ex-title" dir="auto" value={title} aria-label="שם התרגיל" onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() !== exercise.title && void saveMeta({ title })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
            <label className="ex-prompt">
              <span>ההנחיה</span>
              <textarea dir="auto" rows={2} value={prompt} placeholder="מה התרגיל? (לא חובה, אבל עוזר לביקורת)" onChange={(e) => setPrompt(e.target.value)} onBlur={() => prompt !== exercise.prompt && void saveMeta({ prompt })} />
            </label>
            {loadError && <div className="paper-state">{loadError}</div>}
            {!loaded && !loadError && <div className="paper-state">פותח את התרגיל…</div>}
            {loaded && (
              <ChapterBody
                bookPath={ws.path}
                chapterId={exercise.id}
                exerciseId={exercise.id}
                initial={loaded.doc}
                warnings={loaded.warnings}
                autoFocus={!exercise.words}
                activateOn="mount"
                onEditor={setEditor}
                onWords={setWords}
                onSaveState={setSaveState}
                onError={(m) => show(m, true)}
                title={exercise.title}
              />
            )}
          </article>
        </main>
        {reviewOpen && (
          <ReviewPanel
            target={{
              mode: 'exercise',
              exercise: { ...exercise, title, prompt },
              editor,
              onSaved: (reviews) => onWs({ ...ws, exercises: ws.exercises.map((e) => (e.id === exercise.id ? { ...latest.current, reviews } : e)) })
            }}
            onClose={() => setReviewOpen(false)}
            show={show}
          />
        )}
      </div>
    </div>
  )
}
