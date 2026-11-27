// Music and background sounds while writing (feature 56): a small panel opened from the status bar
// (or the focused-writing bar). Built-in sounds work without internet; a YouTube link (for example a
// Lofi Girl stream) plays in a small player inside the panel. Closing the panel leaves everything
// playing; "השתקת הכול" stops it all.

import { createElement, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { anyPlaying, setMaster, setVolume, setYoutube, setYoutubeOn, SOUNDS, stopAll, toggleSound, useSounds, volumeOf } from '../sounds'
import { PLAYER_SCHEME, PLAYER_WAYS, youtubeParts, youtubePlayer, youtubeWatch } from '@shared/sounds'
import { api } from '../api'
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

/**
 * The small player's page is served from a real web address, in one of two ways (main/music.ts).
 * The way that last played is remembered and tried first next time.
 */
const WAY_KEY = 'hakirchia.youtube.way'
const rememberedWay = (): number => {
  try {
    // the old "always open the normal YouTube page" choice (round 14) is no longer kept
    localStorage.removeItem('hakirchia.youtube.plain')
    const w = Number(localStorage.getItem(WAY_KEY))
    return w >= 1 && w <= PLAYER_WAYS ? w : 1
  } catch {
    return 1
  }
}
const rememberWay = (way: number) => {
  try {
    localStorage.setItem(WAY_KEY, String(way))
  } catch {
    /* fine */
  }
}

/** What to tell the writer when YouTube refused to play in every way */
function refusedNote(code: string): string {
  if (code === '100') return 'הסרטון לא נמצא ביוטיוב (אולי נמחק או שהוא פרטי).'
  if (code === '101' || code === '150') return 'בעלי הסרטון הזה לא מרשים לנגן אותו מחוץ ליוטיוב. אפשר לנסות סרטון אחר, או לפתוח אותו כדף יוטיוב רגיל.'
  return `יוטיוב לא הסכים לנגן בנגן הקטן (קוד ${code}). אפשר לפתוח את הסרטון כדף יוטיוב רגיל.`
}

/**
 * The panel. It stays mounted while anything plays (the YouTube player must not be closed), and is
 * only moved out of sight when "closed".
 */
export function SoundsPanel({ open, onClose, focus }: { open: boolean; onClose: () => void; focus: boolean }) {
  const s = useSounds()
  const [link, setLink] = useState(s.settings.youtube)
  const [err, setErr] = useState<string | null>(null)
  const [plain, setPlain] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  // which way to try: the remembered one first, then the others
  const [first] = useState(rememberedWay)
  const [tried, setTried] = useState(0)
  const [base, setBase] = useState<{ way: number; url: string } | null>(null)
  const way = ((first - 1 + tried) % PLAYER_WAYS) + 1
  const ref = useRef<WebviewEl | null>(null)
  const embed = s.youtubeOn && base?.way === way ? youtubePlayer(s.settings.youtube, base.url) : null
  const src = s.youtubeOn && plain ? youtubeWatch(s.settings.youtube) : embed

  // Where the small player's page is, for the way being tried
  useEffect(() => {
    if (!s.youtubeOn || plain || tried >= PLAYER_WAYS || base?.way === way) return
    let live = true
    void api.musicPlayer(way).then((url) => {
      if (!live) return
      if (url) return setBase({ way, url })
      if (tried + 1 >= PLAYER_WAYS) setNote('הנגן הקטן לא הצליח לעלות. אפשר לפתוח את הסרטון כדף יוטיוב רגיל.')
      setTried(tried + 1)
    })
    return () => {
      live = false
    }
  }, [s.youtubeOn, plain, tried, way, base])

  // The small player says on its console whether YouTube agreed to play; if not, the next way
  useEffect(() => {
    const wv = ref.current
    if (!wv || !src || plain) return
    const onMsg = (e: Event) => {
      const m = String((e as Event & { message?: string }).message ?? '')
      if (!m.startsWith(`${PLAYER_SCHEME}:`)) return
      const what = m.slice(PLAYER_SCHEME.length + 1)
      if (what === 'playing') {
        rememberWay(way)
        return setNote(null)
      }
      if (!what.startsWith('error:')) return
      const code = what.slice('error:'.length)
      if (code === 'offline') return setNote('אין חיבור ליוטיוב. צריך אינטרנט כדי לנגן.')
      // 100: no such video, 2: a bad link. Another way would not help.
      if (code === '100' || code === '2') return setNote(refusedNote(code))
      if (tried + 1 < PLAYER_WAYS) setTried(tried + 1)
      else setNote(refusedNote(code))
    }
    wv.addEventListener('console-message', onMsg)
    return () => wv.removeEventListener('console-message', onMsg)
  }, [src, plain, way, tried])

  // Round 14: the panel opens right above the button that opened it (status bar or focus bar)
  const [place, setPlace] = useState<CSSProperties | undefined>(undefined)
  useLayoutEffect(() => {
    if (!open) return
    const btn = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null
    if (!btn) return
    const r = btn.getBoundingClientRect()
    const w = Math.min(340, window.innerWidth - 24)
    const left = Math.max(12, Math.min(r.right - w, window.innerWidth - w - 12))
    setPlace({ left, bottom: Math.max(12, window.innerHeight - r.top + 8), width: w })
  }, [open])
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
    setPlain(false)
    setTried(0)
    setYoutube(u, true)
  }

  if (!open && !s.youtubeOn) return null
  return (
    <div className={`sounds-pop${open ? '' : ' away'}${focus && !place ? ' infocus' : ''}`} style={place} role="dialog" aria-label="מוזיקה וצלילי רקע" aria-hidden={!open} onClick={(e) => e.stopPropagation()}>
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
        {s.youtubeOn && !src && note && (
          <>
            <div className="snd-note">{note}</div>
            <button className="ib snd-plain" onClick={() => (setNote(null), setPlain(true))}>
              פתיחה כדף יוטיוב רגיל
            </button>
          </>
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
                setNote(null)
                setTried(0)
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
