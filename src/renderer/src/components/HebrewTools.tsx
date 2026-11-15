import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Editor } from '@tiptap/react'
import type { SpellStatus } from '@shared/types'
import { GERESH, GERSHAYIM, MAQAF, NIQQUD_MARKS, QUOTE_STYLES, type TypographySettings } from '@shared/hebrew'
import { api } from '../api'
import { EDITOR_FONTS } from '../fonts'
import { setCustomFonts, setTypography, usePrefs } from '../prefs'

/** A small panel under a toolbar button. Closes on Escape or a click outside. */
export function Popover({ anchor, onClose, children, label, width = 300 }: { anchor: HTMLElement | null; onClose: () => void; children: ReactNode; label: string; width?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  useEffect(() => {
    if (!anchor) return
    const r = anchor.getBoundingClientRect()
    // the panel opens under the button, its right edge on the button's right edge (RTL)
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, r.right - width))
    setPos({ top: r.bottom + 6, left })
  }, [anchor, width])
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
  { char: '‏', name: 'סימן כיוון ימין לשמאל (RLM), עוזר כשסימן פיסוק נדחק לצד הלא נכון', show: 'RLM' },
  { char: '‎', name: 'סימן כיוון שמאל לימין (LRM)', show: 'LRM' }
]

/** Niqqud marks: a click adds the mark to the letter before the cursor. */
export function NiqqudPanel({ editor }: { editor: Editor }) {
  const add = (c: string) => editor.chain().focus().insertContent(c).run()
  return (
    <div className="nqpanel">
      <div className="lp-h">ניקוד</div>
      <div className="lp-note">מקלידים אות, ואז לוחצים על הסימן כדי להוסיף אותו לאות שלפני הסמן.</div>
      <div className="nq-grid">
        {NIQQUD_MARKS.map((m) => (
          <button key={m.char} className="nq" title={m.name} aria-label={m.name} onMouseDown={(e) => e.preventDefault()} onClick={() => add(m.char)}>
            <span className="nq-glyph">{(m.char === 'ׁ' || m.char === 'ׂ' ? 'ש' : 'ב') + m.char}</span>
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
  const { typography: t, customFonts } = usePrefs()
  const [spell, setSpell] = useState<SpellStatus | null>(null)
  const [word, setWord] = useState('')
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

        <div className="actions">
          <button className="btn" onClick={onClose} autoFocus>
            סגירה
          </button>
        </div>
      </div>
    </div>
  )
}
