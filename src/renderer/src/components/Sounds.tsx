// Music and background sounds while writing (feature 56): a small panel opened from the status bar
// (or the focused-writing bar). Built-in sounds work without internet; a YouTube link (for example a
// Lofi Girl stream) plays in a small player inside the panel. Closing the panel leaves everything
// playing; "השתקת הכול" stops it all.

import { createElement, useEffect, useRef, useState } from 'react'
import { anyPlaying, setMaster, setVolume, setYoutube, setYoutubeOn, SOUNDS, stopAll, toggleSound, useSounds, volumeOf } from '../sounds'
import { PLAYER_SCHEME, youtubeParts, youtubePlayer, youtubeWatch } from '@shared/sounds'
import { Icon } from './Icons'

/** The status bar's button */
export function SoundsButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  const s = useSounds()
  const on = anyPlaying(s)
  return (
    <button className={`sb-btn${on ? ' playing' : ''}`} aria-pressed={open} title="מוזיקה וצלילי רקע בזמן הכתיבה" onClick={(e) => (e.stopPropagation(), onClick())}>
      <Icon name="music" size={13} />
      {on ? 'מתנגן' : 'צלילים'}
    </button>
  )
}

interface WebviewEl extends HTMLElement {
  executeJavaScript: (code: string) => Promise<unknown>
}

/** Round 14: after the small player was refused by YouTube itself (not by one video), go straight to the normal page */
const PLAIN_KEY = 'hakirchia.youtube.plain'
const prefersPlain = () => {
  try {
    return localStorage.getItem(PLAIN_KEY) === '1'
  } catch {
    return false
  }
}
const rememberPlain = (on: boolean) => {
  try {
    localStorage.setItem(PLAIN_KEY, on ? '1' : '0')
  } catch {
    /* fine */
  }
}

/**
 * The panel. It stays mounted while anything plays (the YouTube player must not be closed), and is
 * only moved out of sight when "closed".
 */
export function SoundsPanel({ open, onClose, focus }: { open: boolean; onClose: () => void; focus: boolean }) {
  const s = useSounds()
  const [link, setLink] = useState(s.settings.youtube)
  const [err, setErr] = useState<string | null>(null)
  const [plain, setPlain] = useState(prefersPlain)
  const [note, setNote] = useState<string | null>(null)
  const ref = useRef<WebviewEl | null>(null)
  const embed = s.youtubeOn ? youtubePlayer(s.settings.youtube) : null
  const src = embed && plain ? youtubeWatch(s.settings.youtube) : embed

  // The small player says on its console whether YouTube agreed to play; if not, the normal page
  useEffect(() => {
    const wv = ref.current
    if (!wv || !src || plain) return
    const onMsg = (e: Event) => {
      const m = String((e as Event & { message?: string }).message ?? '')
      if (!m.startsWith(`${PLAYER_SCHEME}:error:`)) return
      const code = m.slice(`${PLAYER_SCHEME}:error:`.length)
      if (code === 'offline') return setNote('אין חיבור ליוטיוב. צריך אינטרנט כדי לנגן.')
      // 101/150: the owner of this video does not allow playing it in other sites
      if (code === '101' || code === '150') setNote('בעלי הסרטון הזה לא מרשים לנגן אותו מחוץ ליוטיוב, אז הוא נפתח כדף יוטיוב רגיל.')
      else {
        setNote('הנגן הקטן לא הצליח, אז הסרטון נפתח כדף יוטיוב רגיל (ומעכשיו כך תמיד).')
        rememberPlain(true)
      }
      setPlain(true)
    }
    wv.addEventListener('console-message', onMsg)
    return () => wv.removeEventListener('console-message', onMsg)
  }, [src, plain])

  useEffect(() => setLink(s.settings.youtube), [s.settings.youtube])
  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [open, onClose])

  const play = (url = link) => {
    const u = url.trim()
    if (!u) return setErr('הדביקו קישור ליוטיוב')
    if (!youtubeParts(u)) return setErr('זה לא נראה כמו קישור ליוטיוב (למשל youtube.com/watch?v=…)')
    setErr(null)
    setNote(null)
    setPlain(prefersPlain())
    setYoutube(u, true)
  }

  if (!open && !embed) return null
  return (
    <div className={`sounds-pop${open ? '' : ' away'}${focus ? ' infocus' : ''}`} role="dialog" aria-label="מוזיקה וצלילי רקע" aria-hidden={!open} onClick={(e) => e.stopPropagation()}>
      <div className="snd-head">
        <h3>
          <Icon name="music" /> צלילים בזמן הכתיבה
        </h3>
        <span className="grow" />
        {anyPlaying(s) && (
          <button className="ib" title="עוצר את כל הצלילים ואת יוטיוב" onClick={stopAll}>
            השתקת הכול
          </button>
        )}
        <button className="ib icon" aria-label="סגירה (הצלילים ממשיכים)" title="סגירה. מה שמתנגן ממשיך" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>

      <div className="snd-sec">
        <div className="snd-label">צלילים מובנים <small>עובדים גם בלי אינטרנט, אפשר כמה ביחד</small></div>
        <div className="snd-list">
          {SOUNDS.map((d) => {
            const on = !!s.playing[d.id]
            return (
              <div key={d.id} className={`snd-row${on ? ' on' : ''}`}>
                <button className="snd-toggle" aria-pressed={on} title={d.hint} onClick={() => toggleSound(d.id)}>
                  <Icon name={on ? 'pause' : 'play'} size={13} />
                  {d.name}
                </button>
                <input type="range" min={0} max={1} step={0.01} value={s.settings.on[d.id] ?? volumeOf(d.id)} aria-label={`עוצמה: ${d.name}`} disabled={!on} onChange={(e) => setVolume(d.id, Number(e.target.value))} />
              </div>
            )
          })}
        </div>
        <label className="snd-master">
          עוצמה כללית
          <input type="range" min={0} max={1} step={0.01} value={s.settings.master} onChange={(e) => setMaster(Number(e.target.value))} />
        </label>
      </div>

      <div className="snd-sec">
        <div className="snd-label">יוטיוב <small>קישור לסרטון, לשידור חי או לפלייליסט. צריך אינטרנט</small></div>
        <form className="snd-yt" onSubmit={(e) => (e.preventDefault(), play())}>
          <input dir="ltr" value={link} placeholder="https://www.youtube.com/watch?v=…" aria-label="קישור ליוטיוב" onChange={(e) => setLink(e.target.value)} />
          {s.youtubeOn ? (
            <button type="button" className="btn ghost" onClick={() => setYoutubeOn(false)}>
              עצירה
            </button>
          ) : (
            <button type="submit" className="btn">
              ניגון
            </button>
          )}
        </form>
        {err && <div className="snd-err">{err}</div>}
        {!s.youtubeOn && s.settings.recentYoutube.length > 0 && (
          <div className="snd-recent">
            {s.settings.recentYoutube.map((u) => (
              <button key={u} className="pp-chip" dir="ltr" title={u} onClick={() => (setLink(u), play(u))}>
                {u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 34)}
              </button>
            ))}
          </div>
        )}
        {src && (
          <>
            <div className="snd-player">
              {createElement('webview', {
                ref,
                key: src,
                src,
                partition: 'persist:music',
                className: 'webview',
                webpreferences: 'contextIsolation=yes,sandbox=yes'
              })}
            </div>
            {note && <div className="snd-note">{note}</div>}
            <button
              className="ib snd-plain"
              title="אם הסרטון לא מתנגן כאן, פותחים אותו כדף יוטיוב רגיל בתוך החלון"
              onClick={() => {
                rememberPlain(!plain)
                setNote(null)
                setPlain(!plain)
              }}
            >
              {plain ? 'חזרה לנגן הקטן' : 'לא מתנגן? פתיחה כדף יוטיוב רגיל'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
