import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BackupSettingsFields } from './Safety'
import type { Editor } from '@tiptap/react'
import type { SpellStatus } from '@shared/types'
import { GERESH, GERSHAYIM, MAQAF, NIQQUD_MARKS, QUOTE_STYLES, hebrewLetterOf, keysFor, nextNiqqud, pressesFor, type NiqqudTurn, type TypographySettings } from '@shared/hebrew'
import { api } from '../api'
import { EDITOR_FONTS } from '../fonts'
import { setAccent, setAskStopNote, setCustomFonts, setTypography, usePrefs } from '../prefs'
import { ACCENTS, DEFAULT_ACCENT, accentSwatch } from '@shared/accent'
import { AiSettingsDialog } from './Review'
import { useAiKey } from '../ai'
import { AutoNiqqud } from './WordTools'

/** A small panel under a toolbar button. Closes on Escape or a click outside. */
export function Popover({
  anchor,
  at,
  onClose,
  children,
  label,
  width = 300
}: {
  anchor: HTMLElement | null
  /** instead of under a button: under this point of the screen (e.g. the cursor) */
  at?: { x: number; y: number }
  onClose: () => void
  children: ReactNode
  label: string
  width?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  useEffect(() => {
    if (at) {
      const h = ref.current?.offsetHeight ?? 360
      const top = at.y + h + 12 > window.innerHeight ? Math.max(8, at.y - h - 30) : at.y + 8
      setPos({ top, left: Math.max(8, Math.min(window.innerWidth - width - 8, at.x - width / 2)) })
      return
    }
    if (!anchor) return
    const r = anchor.getBoundingClientRect()
    // the panel opens under the button, its right edge on the button's right edge (RTL)
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, r.right - width))
    setPos({ top: r.bottom + 6, left })
  }, [anchor, at, width])
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
    }
  }, [anchor, onClose])
  return (
    <div ref={ref} className="pop" role="dialog" aria-label={label} style={{ top: pos.top, left: pos.left, width }}>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

const PREVIEW = 'אבגד הוזח abc'

/** Adding fonts: one installed in Windows, or a font file (ttf, otf, woff). */
export function FontPanel({ onPick }: { onPick: (family: string) => void }) {
  const { customFonts } = usePrefs()
  const [system, setSystem] = useState<string[] | null>(null)
  const [q, setQ] = useState('')
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    api.systemFonts().then(setSystem)
  }, [])
  const have = useMemo(() => new Set([...EDITOR_FONTS, ...customFonts.map((f) => f.family)]), [customFonts])
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (system ?? []).filter((f) => !t || f.toLowerCase().includes(t)).slice(0, 300)
  }, [system, q])

  const addSystem = async (family: string) => {
    setCustomFonts(await api.addSystemFont(family))
    onPick(family)
  }
  const addFile = async () => {
    setErr(null)
    const r = await api.addFontFile()
    if (!r.ok) return setErr(r.error ?? 'לא הצלחתי לטעון את הגופן')
    if (!r.value) return
    setCustomFonts(r.value.fonts)
    // give the new font a moment to load before applying it
    setTimeout(() => onPick(r.value!.family), 150)
  }

  return (
    <div className="fontpanel">
      <div className="lp-h">הוספת גופן</div>
      <button className="btn ghost" onClick={addFile}>
        טעינת קובץ גופן (ttf, otf, woff)…
      </button>
      {err && <div className="err">{err}</div>}
      <div className="fp-sub">מותקנים ב־Windows</div>
      <input className="fp-search" placeholder="חיפוש גופן…" value={q} onChange={(e) => setQ(e.target.value)} dir="auto" aria-label="חיפוש גופן" autoFocus />
      <div className="fp-list" role="listbox" aria-label="גופנים מותקנים">
        {system === null && <div className="lp-note">טוען את רשימת הגופנים…</div>}
        {system && !system.length && <div className="lp-note">לא נמצאו גופנים מותקנים. אפשר לטעון קובץ גופן.</div>}
        {shown.map((f) => (
          <button key={f} className="fp-item" role="option" aria-selected={have.has(f)} disabled={have.has(f)} onClick={() => addSystem(f)} title={have.has(f) ? 'כבר ברשימה' : `הוספת ${f}`}>
            <span className="fp-name">{f}</span>
            <span className="fp-prev" style={{ fontFamily: `"${f}"` }}>
              {PREVIEW}
            </span>
          </button>
        ))}
      </div>
      <div className="lp-note">גופן שנוסף זמין בכל הספרים. את הגופנים שהוספת אפשר להסיר בהגדרות.</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Niqqud
// ---------------------------------------------------------------------------

const MARKS_EXTRA = [
  { char: MAQAF, name: 'מקף עברי', show: MAQAF },
  { char: GERESH, name: 'גרש', show: GERESH },
  { char: GERSHAYIM, name: 'גרשיים', show: GERSHAYIM },
  { char: '\u200F', name: 'סימן כיוון ימין לשמאל (RLM), עוזר כשסימן פיסוק נדחק לצד הלא נכון', show: 'RLM' },
  { char: '\u200E', name: 'סימן כיוון שמאל לימין (LRM)', show: 'LRM' }
]

/** The keyboard shortcut that opens the niqqud panel at the cursor */
export const NIQQUD_SHORTCUT = 'Ctrl+Shift+נ'
/** Width of the niqqud panel: big enough to read the marks easily */
export const NIQQUD_WIDTH = 460

/**
 * Niqqud marks: a click adds the mark to the letter before the cursor. Opened from the keyboard
 * (keyboard = true), the first letter of a mark's name types it: ס → סגול. Pressing the same letter
 * again swaps the mark for the next one with that letter (ח → חיריק, ח → חולם, ח → חטף פתח...).
 * Esc, Enter, a space or any other key closes the panel (that key is typed as usual).
 */
export function NiqqudPanel({ editor, keyboard = false, onClose }: { editor: Editor; keyboard?: boolean; onClose?: () => void }) {
  const add = (c: string) => editor.chain().focus().insertContent(c).run()
  const [turn, setTurn] = useState<NiqqudTurn | null>(null)
  const last = useRef<{ turn: NiqqudTurn; pos: number } | null>(null)
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    if (!keyboard) return
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return
      if (['Shift', 'CapsLock'].includes(e.key)) return
      const letter = hebrewLetterOf(e.key, e.code)
      const step = letter ? nextNiqqud(last.current && last.current.pos === editor.state.selection.head ? last.current.turn : null, letter) : null
      if (!step) {
        // any other key closes the panel; Esc is only for closing, the rest are typed as usual
        if (e.key === 'Escape') e.preventDefault()
        e.stopPropagation()
        close.current?.()
        return
      }
      e.preventDefault()
      e.stopPropagation()
      const { state } = editor
      const head = state.selection.head
      let chain = editor.chain().focus()
      if (step.replace && head > 1) chain = chain.deleteRange({ from: head - 1, to: head })
      chain.insertContent(step.mark.char).run()
      last.current = { turn: step.turn, pos: editor.state.selection.head }
      setTurn(step.turn)
    }
    window.addEventListener('keydown', down, true)
    return () => window.removeEventListener('keydown', down, true)
  }, [keyboard, editor])

  const lit = turn ? NIQQUD_MARKS.filter((m) => m.letter === turn.letter)[turn.index] : null
  return (
    <div className="nqpanel">
      <div className="lp-h">ניקוד</div>
      <div className="lp-note">
        {keyboard
          ? 'מקלידים את האות הראשונה של שם הסימן (ס = סגול). אותה אות שוב מחליפה לסימן הבא באותה אות. Esc סוגר.'
          : `מקלידים אות, ואז לוחצים על הסימן כדי להוסיף אותו לאות שלפני הסמן. מהמקלדת: ${NIQQUD_SHORTCUT}.`}
      </div>
      <AutoNiqqud editor={editor} />
      <div className="nq-grid">
        {NIQQUD_MARKS.map((m) => (
          <button
            key={m.char}
            className={`nq${lit === m ? ' lit' : ''}`}
            title={`${m.name} (במקלדת: ${pressesFor(m) === 1 ? m.letter : `${m.letter}, ${pressesFor(m)} פעמים`})`}
            aria-label={m.name}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => add(m.char)}
          >
            <kbd className="nq-key">{keysFor(m)}</kbd>
            <span className="nq-glyph">{(m.char === '\u05C1' || m.char === '\u05C2' ? 'ש' : 'ב') + m.char}</span>
            <span className="nq-name">{m.name}</span>
          </button>
        ))}
      </div>
      <div className="fp-sub">סימנים נוספים</div>
      <div className="nq-row">
        {MARKS_EXTRA.map((m) => (
          <button key={m.show} className="ib" title={m.name} onMouseDown={(e) => e.preventDefault()} onClick={() => add(m.char)}>
            {m.show}
          </button>
        ))}
      </div>
      <button className="btn ghost" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().removeNiqqud().run()}>
        הסרת ניקוד
      </button>
      <div className="lp-note">מהטקסט המסומן, או מכל הפרק אם לא סומן כלום.</div>
    </div>
  )
}

/** The niqqud panel opened from the keyboard, right under the cursor. */
export function NiqqudAtCursor({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const at = useMemo(() => {
    try {
      const c = editor.view.coordsAtPos(editor.state.selection.head)
      return { x: c.left, y: c.bottom }
    } catch {
      return { x: window.innerWidth / 2, y: 120 }
    }
  }, [editor])
  return (
    <Popover anchor={null} at={at} label="ניקוד" width={NIQQUD_WIDTH} onClose={onClose}>
      <NiqqudPanel editor={editor} keyboard onClose={onClose} />
    </Popover>
  )
}

// ---------------------------------------------------------------------------
// Writing settings (Hebrew typography, spelling, added fonts)
// ---------------------------------------------------------------------------

const RULES: { key: Exclude<keyof TypographySettings, 'quotes'>; label: string; ex: string }[] = [
  { key: 'geresh', label: 'גרש וגרשיים', ex: `צה"ל ← צה${GERSHAYIM}ל,  ג'ירפה ← ג${GERESH}ירפה` },
  { key: 'maqaf', label: 'מקף עברי בין מילים', ex: `בית-ספר ← בית${MAQAF}ספר` },
  { key: 'dashes', label: 'קו מפריד', ex: 'מילה - מילה ← מילה – מילה' },
  { key: 'ellipsis', label: 'שלוש נקודות', ex: '... ← …' }
]

export function WritingSettings({ onClose }: { onClose: () => void }) {
  const { typography: t, customFonts, askStopNote: askStop } = usePrefs()
  const [spell, setSpell] = useState<SpellStatus | null>(null)
  const [word, setWord] = useState('')
  const [aiOpen, setAiOpen] = useState(false)
  const aiKey = useAiKey()
  useEffect(() => {
    api.spellStatus().then(setSpell)
  }, [])
  const addWord = async () => {
    const w = word.trim()
    if (!w) return
    setSpell(await api.addDictionaryWord(w))
    setWord('')
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog settings" role="dialog" aria-label="הגדרות כתיבה" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h2>הגדרות כתיבה</h2>

        <AccentSection />

        <section>
          <h3>טיפוגרפיה עברית בזמן הקלדה</h3>
          <div className="set-sub">מירכאות</div>
          <div className="qstyles" role="radiogroup" aria-label="מירכאות">
            {QUOTE_STYLES.map((q) => (
              <label key={q.id} className="qstyle">
                <input type="radio" name="quotes" checked={t.quotes === q.id} onChange={() => setTypography({ quotes: q.id })} />
                <span className="qs-sample">{q.sample}</span>
                <span>{q.label}</span>
              </label>
            ))}
          </div>
          {RULES.map((r) => (
            <label key={r.key} className="set-row">
              <input type="checkbox" checked={t[r.key]} onChange={(e) => setTypography({ [r.key]: e.target.checked })} />
              <span>{r.label}</span>
              <span className="set-ex">{r.ex}</span>
            </label>
          ))}
          <p className="lp-note">בפסקה באנגלית המירכאות הן “כאלה”. Backspace מיד אחרי שינוי מחזיר את מה שהוקלד.</p>
        </section>

        <section>
          <h3>כלי כתיבה</h3>
          <label className="set-row">
            <input type="checkbox" checked={t.autocomplete} onChange={(e) => setTypography({ autocomplete: e.target.checked })} />
            <span>השלמת שמות בזמן הקלדה</span>
            <span className="set-ex">נוע ← נועה (Tab)</span>
          </label>
          <p className="lp-note">שמות של דמויות ומקומות (כולל שמות נוספים) ומונחים ממילון המונחים. אחרי שתי אותיות ההמשך מופיע באפור; Tab משלים, ↑↓ בוחרים כשיש כמה, Esc מסתיר. גם עם אותיות שימוש: ולנו ← ולנועה.</p>
          <p className="lp-note">מילים נרדפות: לחיצה ימנית על מילה ← "מילים נרדפות", או Shift+F7 כמו בוורד. מגיעות מ־Claude עם מפתח ה־API שלמטה.</p>
          <p className="lp-note">ניקוד אוטומטי: בפאנל הניקוד ({NIQQUD_SHORTCUT}) ← "נקד אוטומטית".</p>
        </section>

        <section>
          <h3>בדיקת איות</h3>
          <label className="set-row">
            <input type="checkbox" checked={!!spell?.enabled} disabled={!spell} onChange={async (e) => setSpell(await api.setSpellcheck(e.target.checked))} />
            <span>קו אדום מתחת למילים שגויות (עברית ואנגלית)</span>
          </label>
          {spell?.enabled && spell.hebrewMissing && (
            <p className="lp-note warn">המילון העברי עוד לא הורד. בפעם הראשונה צריך חיבור לאינטרנט, ואחר כך הוא עובד גם בלי.</p>
          )}
          <p className="lp-note">לחיצה ימנית על מילה מסומנת מציעה תיקונים ומאפשרת להוסיף אותה למילון האישי.</p>
          <div className="set-sub">המילון האישי (שמות ומילים מומצאות)</div>
          <div className="dict-add">
            <input value={word} dir="auto" placeholder="מילה להוספה" aria-label="מילה להוספה למילון" onChange={(e) => setWord(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addWord()} />
            <button className="btn ghost" onClick={addWord} disabled={!word.trim()}>
              הוספה
            </button>
          </div>
          <div className="chips">
            {spell && !spell.words.length && <span className="lp-note">עוד אין מילים במילון האישי.</span>}
            {spell?.words.map((w) => (
              <span key={w} className="chip">
                {w}
                <button title={`הסרת "${w}"`} aria-label={`הסרת ${w}`} onClick={async () => setSpell(await api.removeDictionaryWord(w))}>
                  ×
                </button>
              </span>
            ))}
          </div>
        </section>

        <section>
          <h3>נקודת עצירה</h3>
          <label className="set-row">
            <input type="checkbox" checked={askStop} onChange={(e) => setAskStopNote(e.target.checked)} />
            <span>לשאול "מה הלאה?" כשסוגרים ספר</span>
          </label>
          <p className="lp-note">המקום שבו עצרת נשמר תמיד, וכשפותחים את הספר שוב הסמן חוזר אליו.</p>
        </section>

        <section>
          <h3>גופנים שהוספתי</h3>
          <div className="chips">
            {!customFonts.length && <span className="lp-note">עוד לא הוספת גופנים. מוסיפים מרשימת הגופנים שבסרגל העיצוב.</span>}
            {customFonts.map((f) => (
              <span key={f.family} className="chip" style={{ fontFamily: `"${f.family}"` }}>
                {f.family}
                <button title={`הסרת ${f.family}`} aria-label={`הסרת ${f.family}`} onClick={async () => setCustomFonts(await api.removeFont(f.family))}>
                  ×
                </button>
              </span>
            ))}
          </div>
          <p className="lp-note">הסרה מהרשימה לא משנה טקסט שכבר נכתב בגופן הזה.</p>
        </section>

        <section>
          <h3>גיבוי יומי</h3>
          <BackupSettingsFields />
          <div className="set-row">
            <span className="lp-note">את הגיבויים של ספר פותחים מהשורה "גיבוי" שבתחתית המסך כשהספר פתוח.</span>
            <span className="grow" />
            <button className="ib" onClick={() => void api.openBackups()}>
              פתיחת תיקיית הגיבויים
            </button>
          </div>
        </section>

        <section>
          <h3>ביקורת כתיבה עם Claude</h3>
          <div className="set-row">
            <span>{aiKey.has ? `מוגדר מפתח API (${aiKey.hint})` : 'עדיין לא הוגדר מפתח API'}</span>
            <span className="grow" />
            <button className="ib" onClick={() => setAiOpen(true)}>
              הגדרות ביקורת…
            </button>
          </div>
          <p className="lp-note">מפתח, מודל, הנחיות וסוגי ביקורת. הביקורת עצמה נפתחת מהכפתור "ביקורת" בסרגל העליון כשספר פתוח, או מתוך תרגיל בסדנה.</p>
        </section>
        {aiOpen && <AiSettingsDialog onClose={() => setAiOpen(false)} />}

        <div className="actions">
          <button className="btn" onClick={onClose} autoFocus>
            סגירה
          </button>
        </div>
      </div>
    </div>
  )
}

/** Round 13: the app's accent color. The default is the deep green; any other bookcloth color, or one of your own. */
function AccentSection() {
  const { accent } = usePrefs()
  const custom = !ACCENTS.some((a) => a.id === accent)
  return (
    <section>
      <h3>צבע הדגשה של האפליקציה</h3>
      <p className="lp-note">הצבע של הלשונית הפעילה, הכפתורים והפרק שכותבים עכשיו. במצב כהה הוא נעשה בהיר יותר מעצמו.</p>
      <div className="accents" role="radiogroup" aria-label="צבע הדגשה">
        {ACCENTS.map((a) => (
          <button key={a.id} type="button" role="radio" aria-checked={accent === a.id} className="accent-sw" title={a.id === DEFAULT_ACCENT ? `${a.name} (ברירת המחדל)` : a.name} onClick={() => setAccent(a.id)}>
            <span style={{ background: a.light }} />
            <small>{a.name}</small>
          </button>
        ))}
        <label className="accent-sw" title="צבע משלך" aria-checked={custom} role="radio">
          <span className="accent-custom" style={custom ? { background: accentSwatch(accent) } : undefined}>
            <input type="color" aria-label="בחירת צבע משלך" value={custom ? accent : '#7a3b2e'} onChange={(e) => setAccent(e.target.value)} />
          </span>
          <small>משלי…</small>
        </label>
      </div>
      {accent !== DEFAULT_ACCENT && (
        <button type="button" className="ib" style={{ alignSelf: 'flex-start' }} onClick={() => setAccent(DEFAULT_ACCENT)}>
          חזרה לירוק הכהה
        </button>
      )}
    </section>
  )
}
