import { useEffect, useState } from 'react'
import type { UpdateState } from '@shared/update'
import { api } from '../api'

/** Where the app stands with updating itself (version 1.1) */
export function useUpdateState(): UpdateState {
  const [s, setS] = useState<UpdateState>({ kind: 'idle' })
  useEffect(() => {
    void api.updateState().then(setS)
    return api.onUpdateState(setS)
  }, [])
  return s
}

/** In the settings (round 16; it used to be on the home screen): whether test versions arrive too */
export function TestUpdatesToggle() {
  const [on, setOn] = useState<boolean | null>(null)
  useEffect(() => {
    void api.testUpdates().then(setOn)
  }, [])
  if (on === null) return null
  return (
    <label className="set-row" title="גרסאות בדיקה הן גרסאות לפני מיזוג, כדי לנסות שינויים חדשים. הן עלולות להכיל תקלות.">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => {
          setOn(e.target.checked)
          void api.setTestUpdates(e.target.checked)
        }}
      />{' '}
      לקבל גם גרסאות בדיקה
    </label>
  )
}

/** One line under the version number on the home screen, with "check now" */
export function UpdateStatus() {
  const s = useUpdateState()
  if (s.kind === 'dev') return null
  return (
    <UpdateLine s={s} />
  )
}

function UpdateLine({ s }: { s: UpdateState }) {
  const check = (
    <button className="linkbtn" onClick={() => void api.checkForUpdates()}>
      בדיקת עדכונים
    </button>
  )
  switch (s.kind) {
    case 'checking':
      return <div className="update-line">בודקת אם יש גרסה חדשה…</div>
    case 'latest':
      return <div className="update-line">זו הגרסה העדכנית ביותר. {check}</div>
    case 'downloading':
      return <div className="update-line">מורידה את גרסה {s.version} ברקע ({s.percent}%)…</div>
    case 'ready':
      return (
        <div className="update-line">
          גרסה {s.version} מוכנה ותותקן כשהאפליקציה תיסגר.{' '}
          <button className="linkbtn" onClick={() => void api.installUpdate()}>
            להפעיל מחדש עכשיו
          </button>
        </div>
      )
    case 'available-portable':
      return (
        <div className="update-line">
          יש גרסה חדשה ({s.version}).{' '}
          <a href={s.url} target="_blank" rel="noreferrer">
            להורדה
          </a>
        </div>
      )
    case 'error':
      return (
        <div className="update-line">
          {s.message} {check}
        </div>
      )
    default:
      return <div className="update-line">{check}</div>
  }
}

/** A small note anywhere in the app once a new version is ready (or, in the portable copy, exists) */
export function UpdateBanner() {
  const s = useUpdateState()
  const [hidden, setHidden] = useState<string | null>(null)
  if (s.kind !== 'ready' && s.kind !== 'available-portable') return null
  if (hidden === s.version) return null
  return (
    <div className="update-banner" role="status">
      {s.kind === 'ready' ? (
        <>
          <div>
            <b>גרסה {s.version} של הכריכייה מוכנה.</b> היא תותקן מעצמה כשהאפליקציה תיסגר, ואפשר גם עכשיו. הספרים וההגדרות נשארים.
          </div>
          <div className="ub-actions">
            <button className="btn" onClick={() => void api.installUpdate()}>
              להפעיל מחדש עכשיו
            </button>
            <button className="btn ghost" onClick={() => setHidden(s.version)}>
              אחר כך
            </button>
          </div>
        </>
      ) : (
        <>
          <div>
            <b>יש גרסה חדשה של הכריכייה ({s.version}).</b> הגרסה הניידת לא מתעדכנת מעצמה, אז צריך להוריד אותה מחדש.
          </div>
          <div className="ub-actions">
            <a className="btn" href={s.url} target="_blank" rel="noreferrer">
              להורדה
            </a>
            <button className="btn ghost" onClick={() => setHidden(s.version)}>
              אחר כך
            </button>
          </div>
        </>
      )}
    </div>
  )
}
