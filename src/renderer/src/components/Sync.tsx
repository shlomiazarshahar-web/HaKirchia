// Round 16: the settings section for sharing the app state between computers through a folder
// (Google Drive): which folder, whether it is reachable, which computers use it.
import { useEffect, useState } from 'react'
import type { SyncStatus } from '@shared/appstate'
import { api } from '../api'

function ago(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const today = new Date()
  const time = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === today.toDateString()) return `היום ב־${time}`
  const y = new Date(today)
  y.setDate(today.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return `אתמול ב־${time}`
  return `ב־${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`
}

const inside = (path: string, folder: string) => {
  const n = (p: string) => p.replace(/[\\/]+$/, '').toLowerCase()
  return n(path).startsWith(n(folder) + '\\') || n(path).startsWith(n(folder) + '/') || n(path) === n(folder)
}

export function SyncSection() {
  const [st, setSt] = useState<SyncStatus | null>(null)
  const [name, setName] = useState('')
  const [wsPath, setWsPath] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const got = (s: SyncStatus) => (setSt(s), setName(s.computerName))
  const loadWs = () => void api.getSettings().then((s) => setWsPath(s.workshopUnavailable ? null : (s.workshopPath ?? '')))
  useEffect(() => {
    void api.syncStatus().then(got)
    loadWs()
  }, [])
  if (!st) return null

  const choose = async () => {
    setBusy(true)
    const r = await api.chooseSyncFolder()
    setBusy(false)
    if (!r.ok) return setMsg({ text: r.error ?? 'לא הצלחתי להתחיל לסנכרן', error: true })
    if (!r.value) return
    got(r.value)
    loadWs()
    setMsg({ text: r.value.computers.length > 1 ? 'המצב מהתיקייה נטען, והספרים של המחשב הזה נוספו אליו.' : 'מעכשיו המצב של האפליקציה נשמר גם בתיקייה הזו.' })
  }
  const stop = async () => {
    got(await api.stopSync())
    setMsg({ text: 'הסנכרון הופסק במחשב הזה. הוא ממשיך לעבוד עם העותק שלו, והקובץ בתיקייה נשאר.' })
  }
  const moveWs = async () => {
    const r = await api.workshopToShared()
    if (!r.ok || !r.value) return setMsg({ text: r.error ?? 'לא הצלחתי להעביר את הסדנה', error: true })
    setWsPath(r.value.path)
    setMsg({ text: 'הסדנה עובדת עכשיו מהתיקייה המשותפת.' })
  }

  return (
    <section className="sync">
      <h3>סנכרון בין מחשבים</h3>
      {!st.folder ? (
        <>
          <p className="lp-note">
            רשימת הספרים, איפה עצרת בכל ספר, הסדנה וההגדרות (גופנים, טיפוגרפיה, מילון אישי, צבע, צלילים ועוד) יכולים להישמר בקובץ בתיקייה משותפת, למשל בגוגל דרייב, וכך כמה מחשבים עובדים מאותו מצב. אם כבר יש שם קובץ ממחשב אחר, הוא ייטען.
          </p>
          <div className="set-row">
            <button className="btn" disabled={busy} onClick={() => void choose()}>
              בחירת תיקייה משותפת…
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="set-row">
            <span className={`sync-dot${st.connected ? ' on' : ''}`} aria-hidden="true" />
            <span>{st.connected ? 'מסונכרן דרך:' : st.error || 'התיקייה המשותפת לא זמינה כרגע'}</span>
            <bdi className="mono sync-path" dir="ltr" title={st.folder}>
              {st.folder}
            </bdi>
          </div>
          {!st.connected && <p className="lp-note warn">בינתיים האפליקציה עובדת עם העותק של המחשב הזה, והשינויים יישמרו בתיקייה כשהיא תחזור.</p>}
          <div className="set-row">
            <button className="ib" onClick={() => void api.openPath(st.folder!)}>
              פתיחת התיקייה
            </button>
            <button className="ib" onClick={() => void api.reloadSync().then(got)}>
              לבדוק עכשיו
            </button>
            <button className="ib" disabled={busy} onClick={() => void choose()}>
              תיקייה אחרת…
            </button>
            <span className="grow" />
            <button className="ib" onClick={() => void stop()}>
              הפסקת הסנכרון במחשב הזה
            </button>
          </div>
          <label className="set-row">
            <span>שם המחשב הזה:</span>
            <input value={name} aria-label="שם המחשב הזה" maxLength={60} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== st.computerName && void api.setComputerName(name).then(got)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          </label>
          {st.computers.length > 0 && (
            <ul className="sync-pcs">
              {st.computers.map((c) => (
                <li key={c.name + c.seen}>
                  <b>{c.name}</b>
                  {c.me ? ' (המחשב הזה)' : ` · נראה לאחרונה ${ago(c.seen)}`}
                </li>
              ))}
            </ul>
          )}
          {st.savedAt > 0 && (
            <p className="lp-note">
              נשמר לאחרונה {ago(st.savedAt)}
              {st.savedBy ? ` (${st.savedBy})` : ''}.
            </p>
          )}
          {st.connected && wsPath !== null && !inside(wsPath || '', st.folder) && (
            <div className="set-row">
              <span className="lp-note">הסדנה (תרגילי הכתיבה) שמורה בתיקייה אחרת. אם היא לא בגוגל דרייב, המחשב השני לא יראה אותה.</span>
              <span className="grow" />
              <button className="ib" onClick={() => void moveWs()}>
                העתקת הסדנה לתיקייה המשותפת
              </button>
            </div>
          )}
        </>
      )}
      {msg && <p className={`lp-note${msg.error ? ' warn' : ''}`}>{msg.text}</p>}
      <p className="lp-note">
        גיבוי יומי, גודל התצוגה ומפתח ה־API של Claude נשארים לכל מחשב בנפרד. ספר שהתיקייה שלו לא זמינה במחשב הזה (למשל נשמר בכונן C של מחשב אחר) מופיע באפור בספרייה, ובקליק ימני אפשר לבחור את המקום שלו מחדש. הבחירה נשמרת רק למחשב הזה, והמחשב השני ממשיך עם הנתיב שלו.
      </p>
    </section>
  )
}
