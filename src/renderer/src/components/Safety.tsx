// Round 9 "להתחיל לעבוד בבטחה": unsaved text found after a crash (feature 41) and the daily
// backups of the book (feature 49).

import { useEffect, useRef, useState } from 'react'
import { api, flushAll, notifyDiskChange } from '../api'
import type { Book } from '@shared/types'
import { KIND_LABEL, type RecoveryItem } from '@shared/recovery'
import { KEEP_CHOICES, type BackupChapter, type BackupInfo, type BackupSettings } from '@shared/backup'

const time = (ts: number) => new Date(ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })

/** "היום ב-14:05", "אתמול ב-09:12", "20.11 ב-18:40" */
export function whenText(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const y = new Date(today)
  y.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return `היום ב־${time(ts)}`
  if (d.toDateString() === y.toDateString()) return `אתמול ב־${time(ts)}`
  return `${d.getDate()}.${d.getMonth() + 1}${d.getFullYear() !== today.getFullYear() ? `.${d.getFullYear()}` : ''} ב־${time(ts)}`
}

/** A day folder's name (2026-11-22) as words */
function dayText(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const today = new Date()
  const yest = new Date(today)
  yest.setDate(today.getDate() - 1)
  const name = date.toLocaleDateString('he-IL', { weekday: 'long' })
  if (date.toDateString() === today.toDateString()) return `היום (${name})`
  if (date.toDateString() === yest.toDateString()) return `אתמול (${name})`
  return `${name}, ${d}.${m}.${y}`
}

// ---------------------------------------------------------------------------
// Crash recovery
// ---------------------------------------------------------------------------

export function RecoveryDialog({ items: initial, onClose, show }: { items: RecoveryItem[]; onClose: () => void; show: (text: string, error?: boolean) => void }) {
  const [items, setItems] = useState(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const done = (key: string) => setItems((l) => l.filter((x) => x.key !== key))
  useEffect(() => {
    if (!items.length) onClose()
  }, [items, onClose])

  const restore = async (it: RecoveryItem) => {
    setBusy(it.key)
    const r = await api.restoreRecovery(it.key)
    setBusy(null)
    if (!r.ok) return show(r.error ?? 'השחזור נכשל', true)
    done(it.key)
    show(`הטקסט של "${it.title}" שוחזר${it.kind === 'chapter' ? '. מה שהיה בקובץ לפני כן נשמר כגרסה' : ''}`)
  }
  const restoreAll = async () => {
    for (const it of items.filter((x) => !x.missing)) await restore(it)
  }
  const saveAs = async (it: RecoveryItem) => {
    setBusy(it.key)
    const r = await api.saveRecoveryAs(it.key, it.title)
    setBusy(null)
    if (!r.ok) return show(r.error ?? 'השמירה נכשלה', true)
    if (r.value) {
      done(it.key)
      show(`נשמר בקובץ ${r.value}`)
    }
  }
  const discard = async (it: RecoveryItem) => {
    const r = await api.discardRecovery(it.key)
    if (!r.ok) return show(r.error ?? 'משהו השתבש', true)
    done(it.key)
  }
  const canAll = items.filter((x) => !x.missing).length

  return (
    <div className="scrim">
      <div className="dialog recovery" role="alertdialog" aria-label="טקסט שלא נשמר" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h2>נמצא טקסט שלא נשמר</h2>
        <p>
          בפעם הקודמת הכריכייה נסגרה לפני שהספיקה לשמור {items.length === 1 ? 'את הטקסט הזה' : 'את הטקסטים האלה'} בקובץ. אפשר להחזיר {items.length === 1 ? 'אותו' : 'אותם'} למקום.
          בשחזור פרק, מה שיש בקובץ עכשיו נשמר קודם כגרסה, כך ששום דבר לא הולך לאיבוד.
        </p>
        <div className="rc-list">
          {items.map((it) => (
            <div key={it.key} className="rc-item">
              <div className="rc-head">
                <b>{it.title || 'ללא שם'}</b>
                <span className="rc-kind">
                  {KIND_LABEL[it.kind]}
                  {it.kind !== 'exercise' && it.bookTitle ? ` · ${it.bookTitle}` : ''}
                </span>
                <span className="grow" />
                <span className="rc-when">{whenText(it.at)}</span>
              </div>
              {it.preview && <div className="rc-preview">{it.preview}</div>}
              <div className="rc-meta">
                {it.words.toLocaleString('he-IL')} מילים בטקסט שלא נשמר
                {it.diskWords !== null && ` · ${it.diskWords.toLocaleString('he-IL')} בקובץ עכשיו`}
              </div>
              {it.missing && <div className="rc-missing">{it.missing}. אפשר לשמור את הטקסט כקובץ Word נפרד, או להשאיר אותו לפעם הבאה.</div>}
              <div className="row">
                <button className="btn" disabled={!!it.missing || busy === it.key} onClick={() => void restore(it)}>
                  שחזור
                </button>
                <button className="btn ghost" disabled={busy === it.key} onClick={() => void saveAs(it)}>
                  שמירה כקובץ Word…
                </button>
                <span className="grow" />
                <button className="ib danger-text" disabled={busy === it.key} title="הטקסט יישמר בצד עוד חודש, בתיקיית השחזור של התוכנה" onClick={() => void discard(it)}>
                  לא צריך
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="actions">
          {canAll > 1 && (
            <button className="btn" disabled={!!busy} onClick={() => void restoreAll()}>
              שחזור הכול
            </button>
          )}
          <button className="btn ghost" onClick={onClose}>
            להחליט בפעם הבאה
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Daily backups
// ---------------------------------------------------------------------------

/** On/off, folder and how many days, as in the writing settings and the backups window */
export function BackupSettingsFields({ onChange }: { onChange?: (s: BackupSettings) => void }) {
  const [s, setS] = useState<BackupSettings | null>(null)
  const [root, setRoot] = useState('')
  useEffect(() => {
    void api.getSettings().then((st) => setS({ enabled: st.backup?.enabled !== false, folder: st.backup?.folder ?? '', keep: st.backup?.keep ?? 30 }))
    void api.backupRoot().then(setRoot)
  }, [])
  if (!s) return null
  const set = async (patch: Partial<BackupSettings>) => {
    const next = await api.setBackupSettings(patch)
    setS(next)
    onChange?.(next)
  }
  return (
    <div className="bk-set">
      <label className="set-row">
        <input type="checkbox" checked={s.enabled} onChange={(e) => void set({ enabled: e.target.checked })} />
        <span>עותק מתוארך של הספר הפתוח, פעם ביום</span>
      </label>
      <div className="set-row">
        <span>לשמור</span>
        <select value={s.keep} aria-label="כמה ימים לשמור" onChange={(e) => void set({ keep: Number(e.target.value) })}>
          {[...new Set([...KEEP_CHOICES, s.keep])].sort((a, b) => a - b).map((n) => (
            <option key={n} value={n}>
              {n === 365 ? 'שנה' : `${n} ימים`}
            </option>
          ))}
        </select>
        <span>אחרונים לכל ספר</span>
      </div>
      <div className="set-row">
        <span className="mono bk-path" title={root}>
          {root}
        </span>
        <span className="grow" />
        <button
          className="ib"
          onClick={async () => {
            const next = await api.chooseBackupFolder()
            if (next) (setS(next), setRoot(await api.backupRoot()), onChange?.(next))
          }}
        >
          שינוי תיקייה…
        </button>
      </div>
      <p className="lp-note">
        כדאי שהתיקייה תהיה על המחשב עצמו ולא בגוגל דרייב: הדרייב מסנכרן גם מחיקות וטעויות, והגיבויים כאן לא משתנים אחרי שהיום שלהם עבר. קבצים שלא השתנו לא תופסים מקום נוסף.
      </p>
    </div>
  )
}

/** The status bar's line about today's backup; a click opens the backups window */
export function BackupStatus({ bookPath, onOpen, tick }: { bookPath: string; onOpen: () => void; tick: number }) {
  const [info, setInfo] = useState<BackupInfo | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => void api.backupInfo(bookPath).then((r) => alive && r.ok && setInfo(r.value ?? null))
    load()
    const off = api.onBackupDone((b) => b === bookPath && load())
    // "today" / "yesterday" in the text move on by themselves
    const iv = setInterval(load, 10 * 60_000)
    return () => {
      alive = false
      off()
      clearInterval(iv)
    }
  }, [bookPath, tick])
  if (!info) return null
  const last = info.days[0]
  const text = !info.settings.enabled ? 'גיבוי יומי כבוי' : info.error ? 'הגיבוי נכשל' : last ? `גיבוי: ${whenText(last.at)}` : 'גיבוי: עוד לא'
  return (
    <button className={`ib bk-status${info.error ? ' err' : ''}`} title={info.error ? `הגיבוי האחרון נכשל: ${info.error}` : 'גיבויים יומיים של הספר: לראות ולשחזר פרקים'} onClick={onOpen}>
      {text}
    </button>
  )
}

const STATE_LABEL: Record<BackupChapter['state'], string> = { same: 'לא השתנה מאז', changed: 'השתנה מאז', deleted: 'נמחק מהספר' }

export function BackupDialog({ book, onClose, onBook, show }: { book: Book; onClose: () => void; onBook: (b: Book) => void; show: (text: string, error?: boolean) => void }) {
  const [info, setInfo] = useState<BackupInfo | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [chapters, setChapters] = useState<BackupChapter[] | null>(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const load = () => api.backupInfo(book.path).then((r) => (r.ok ? setInfo(r.value ?? null) : show(r.error ?? 'משהו השתבש', true)))
  useEffect(() => {
    void load()
    ref.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.path])
  useEffect(() => {
    setChapters(null)
    if (open) void api.backupChapters(book.path, open).then((r) => (r.ok ? setChapters(r.value ?? []) : show(r.error ?? 'לא הצלחתי לקרוא את הגיבוי', true)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, book.path])

  const now = async () => {
    setBusy(true)
    await flushAll()
    const r = await api.backupNow(book.path)
    setBusy(false)
    if (!r.ok) return show(`הגיבוי נכשל: ${r.error}`, true)
    show('הספר גובה עכשיו')
    await load()
    if (open) setOpen(null)
  }
  const restore = async (day: string, ch: BackupChapter) => {
    setBusy(true)
    await flushAll()
    const r = await api.restoreFromBackup(book.path, day, ch.id)
    setBusy(false)
    if (!r.ok || !r.value) return show(r.error ?? 'השחזור נכשל', true)
    onBook(r.value.book)
    notifyDiskChange(book.path, r.value.chapterId)
    show(r.value.notice ?? (ch.state === 'deleted' ? `"${ch.title}" חזר לספר, כפרק אחרון` : `"${ch.title}" שוחזר מהגיבוי. מה שהיה בו לפני כן נשמר כגרסה`), !!r.value.notice)
    const again = await api.backupChapters(book.path, day)
    if (again.ok) setChapters(again.value ?? [])
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog backups" role="dialog" aria-label="גיבויים יומיים" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h2>גיבויים יומיים של "{book.title}"</h2>
        <p>
          כל יום נשמר עותק מלא של תיקיית הספר בתיקייה נפרדת על המחשב. העותק של היום מתעדכן כל חצי שעה כשהספר פתוח, ועותקים של ימים קודמים כבר לא משתנים. אפשר להחזיר מהם פרק שנפגע או נמחק.
        </p>
        {info?.error && <div className="err">הגיבוי האחרון נכשל: {info.error}</div>}
        <div className="row">
          <button ref={ref} className="btn" disabled={busy} onClick={() => void now()}>
            גיבוי עכשיו
          </button>
          <button className="btn ghost" onClick={() => void api.openBackups(book.path)}>
            פתיחת התיקייה
          </button>
        </div>
        <div className="bk-days">
          {info && !info.days.length && <p className="lp-note">עוד אין גיבויים לספר הזה. הראשון נוצר כמה שניות אחרי שהספר נפתח, או בלחיצה על "גיבוי עכשיו".</p>}
          {info?.days.map((d) => (
            <div key={d.day} className="bk-day">
              <button className="bk-dayhead" aria-expanded={open === d.day} onClick={() => setOpen(open === d.day ? null : d.day)}>
                <span className={`chev${open === d.day ? '' : ' closed'}`}>›</span>
                <b>{dayText(d.day)}</b>
                <span className="grow" />
                <span className="lp-note">עודכן ב־{time(d.at)}</span>
              </button>
              {open === d.day && (
                <div className="bk-chs">
                  {!chapters && <span className="lp-note">קורא…</span>}
                  {chapters?.map((c) => (
                    <div key={c.id} className={`bk-ch ${c.state}`}>
                      <span className="bk-title">{c.title}</span>
                      <span className="lp-note">
                        {c.words.toLocaleString('he-IL')} מילים · {STATE_LABEL[c.state]}
                      </span>
                      <span className="grow" />
                      {c.state !== 'same' && (
                        <button className="ib" disabled={busy} onClick={() => void restore(d.day, c)}>
                          {c.state === 'deleted' ? 'החזרה לספר' : 'שחזור הפרק'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <details className="bk-more">
          <summary>הגדרות הגיבוי</summary>
          <BackupSettingsFields onChange={() => void load()} />
        </details>
        <div className="actions">
          <button className="btn ghost" onClick={onClose}>
            סגירה
          </button>
        </div>
      </div>
    </div>
  )
}
