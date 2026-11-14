import { useEffect, useRef, useState } from 'react'
import { api } from '../api'

export function NewBookDialog({ onCancel, onCreate }: { onCancel: () => void; onCreate: (parent: string, title: string) => Promise<string | null> }) {
  const [title, setTitle] = useState('')
  const [parent, setParent] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    api.defaultFolder().then(setParent)
    ref.current?.focus()
  }, [])

  const submit = async () => {
    if (!title.trim()) return setErr('צריך לתת לספר שם')
    setBusy(true)
    const e = await onCreate(parent, title.trim())
    setBusy(false)
    if (e) setErr(e)
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form
        className="dialog"
        role="dialog"
        aria-label="ספר חדש"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      >
        <h2>ספר חדש</h2>
        <label className="field">
          שם הספר
          <input ref={ref} value={title} dir="auto" onChange={(e) => setTitle(e.target.value)} placeholder="למשל: הנמל השקט" />
        </label>
        <div className="field">
          איפה לשמור
          <div className="pathrow">
            <span className="mono">{parent}</span>
            <button
              type="button"
              className="btn ghost"
              onClick={async () => {
                const p = await api.chooseFolder('parent')
                if (p) setParent(p)
              }}
            >
              שינוי…
            </button>
          </div>
        </div>
        <p>תיווצר תיקייה בשם הספר, ובתוכה התיקייה "פרקים" עם קובץ Word לכל פרק.</p>
        {err && <div className="err">{err}</div>}
        <div className="actions">
          <button type="submit" className="btn" disabled={busy}>
            יצירת הספר
          </button>
          <button type="button" className="btn ghost" onClick={onCancel}>
            ביטול
          </button>
        </div>
      </form>
    </div>
  )
}

export function ConfirmDialog({
  title,
  text,
  confirmLabel,
  onCancel,
  onConfirm
}: {
  title: string
  text: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dialog" role="alertdialog" aria-label={title} onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
        <h2>{title}</h2>
        <p>{text}</p>
        <div className="actions">
          <button className="btn danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button ref={ref} className="btn ghost" onClick={onCancel}>
            ביטול
          </button>
        </div>
      </div>
    </div>
  )
}
