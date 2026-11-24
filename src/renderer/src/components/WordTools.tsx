// Round 10, "כלי כתיבה בעברית": the synonyms panel (43) and automatic niqqud in the niqqud panel (55).
import { useEffect, useMemo, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { niqqudChanges, type SynonymSense } from '@shared/wordtools'
import { api } from '../api'
import { useAiKey } from '../ai'
import { AiSettingsDialog } from './Review'
import { Popover } from './HebrewTools'
import { applyNiqqud, closeSynonyms, textForNiqqud, useSynonymTarget, type PlacedWord, type SynonymTarget } from '../wordtools'

// ---------------------------------------------------------------------------
// Synonyms (43)
// ---------------------------------------------------------------------------

/** Opens under the word when "מילים נרדפות" is picked in the right-click menu, or with Shift+F7 */
export function SynonymsHost() {
  const t = useSynonymTarget()
  if (!t || t.editor.isDestroyed) return null
  return <SynonymsPanel key={`${t.from}-${t.word}`} target={t} />
}

function SynonymsPanel({ target }: { target: SynonymTarget }) {
  const key = useAiKey()
  const [senses, setSenses] = useState<SynonymSense[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [tick, setTick] = useState(0)
  const at = useMemo(() => {
    try {
      const c = target.editor.view.coordsAtPos(target.from)
      const e = target.editor.view.coordsAtPos(target.to)
      return { x: (c.left + e.left) / 2, y: Math.max(c.bottom, e.bottom) }
    } catch {
      return { x: window.innerWidth / 2, y: 120 }
    }
  }, [target])

  useEffect(() => {
    if (!key.has) return
    let alive = true
    setErr(null)
    setSenses(null)
    void api.synonyms(target.word, target.sentence).then((r) => {
      if (!alive) return
      if (r.ok) setSenses(r.value ?? [])
      else setErr(r.error ?? 'לא הצלחתי להביא מילים נרדפות')
    })
    return () => {
      alive = false
    }
  }, [target, key.has, tick])

  const replace = (w: string) => {
    const { editor, from, to, word } = target
    // only if the word is still where it was
    if (editor.state.doc.textBetween(from, to) === word) {
      editor.chain().focus().command(({ tr }) => (tr.insertText(w, from, to), true)).run()
    }
    closeSynonyms()
  }

  return (
    <Popover anchor={null} at={at} label={`מילים נרדפות ל${target.word}`} width={340} onClose={closeSynonyms}>
      <div className="synpanel">
        <div className="lp-h">
          מילים נרדפות ל<span className="syn-word">"{target.word}"</span>
        </div>
        {!key.has && (
          <>
            <p className="lp-note">המילים הנרדפות מגיעות מ־Claude, עם מפתח ה־API של ביקורת הכתיבה. עדיין לא הוגדר מפתח.</p>
            <button className="btn ghost" onClick={() => setAiOpen(true)}>
              הגדרת מפתח…
            </button>
          </>
        )}
        {key.has && !senses && !err && <div className="lp-note syn-wait">מחפש מילים נרדפות…</div>}
        {err && (
          <>
            <div className="err">{err}</div>
            <button className="btn ghost" onClick={() => setTick((n) => n + 1)}>
              לנסות שוב
            </button>
          </>
        )}
        {senses && !senses.length && <div className="lp-note">לא נמצאו מילים נרדפות.</div>}
        {senses?.map((s, i) => (
          <div key={i} className="syn-sense">
            {s.meaning && <div className="fp-sub">{s.meaning}</div>}
            <div className="syn-words">
              {s.words.map((w) => (
                <button key={w.w} className="syn-w" title={w.note ? `${w.w} (${w.note})` : `החלפה ב"${w.w}"`} onMouseDown={(e) => e.preventDefault()} onClick={() => replace(w.w)}>
                  {w.w}
                  {w.note && <small>{w.note}</small>}
                </button>
              ))}
            </div>
          </div>
        ))}
        {senses && senses.length > 0 && <div className="lp-note">לחיצה על מילה מחליפה אותה בטקסט. Ctrl+Z מחזיר.</div>}
      </div>
      {aiOpen && <AiSettingsDialog onClose={() => setAiOpen(false)} />}
    </Popover>
  )
}

// ---------------------------------------------------------------------------
// Automatic niqqud (55)
// ---------------------------------------------------------------------------

/** "נקד אוטומטית" in the niqqud panel: the selection (or the paragraph) gets niqqud from Dicta */
export function AutoNiqqud({ editor }: { editor: Editor }) {
  const key = useAiKey()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [words, setWords] = useState<PlacedWord[]>([])
  const [picked, setPicked] = useState<number | null>(null)

  // the words with several readings follow the text as it changes
  useEffect(() => {
    if (!words.length) return
    const on = ({ transaction: tr }: { transaction: import('@tiptap/pm/state').Transaction }) => {
      if (!tr.docChanged) return
      setWords((ws) => ws.map((w) => ({ ...w, from: tr.mapping.map(w.from, -1), to: tr.mapping.map(w.to, 1) })).filter((w) => w.to > w.from))
    }
    editor.on('transaction', on)
    return () => void editor.off('transaction', on)
  }, [editor, words.length])

  const run = async (by: 'dicta' | 'claude') => {
    const map = textForNiqqud(editor.state)
    if (!/[א-ת]/.test(map.text)) return setErr('אין כאן טקסט עברי לנקד. אפשר לסמן קטע, או לעמוד בפסקה.')
    if (map.text.length > 20000) return setErr('הקטע ארוך מדי לניקוד בבת אחת. אפשר לסמן חלק ממנו.')
    setBusy(true)
    setErr(null)
    setNote(null)
    setWords([])
    setPicked(null)
    const r = await api.nakdan(map.text, by)
    setBusy(false)
    if (!r.ok || !r.value) return setErr(r.error ?? 'הניקוד לא הצליח')
    // the text may have changed while waiting: give niqqud only if it is still the same
    const now = textForNiqqud(editor.state)
    if (now.text !== map.text) return setErr('הטקסט השתנה בזמן הניקוד. אפשר ללחוץ שוב.')
    const changes = niqqudChanges(map.text, r.value)
    const placed = applyNiqqud(editor, map, changes)
    setWords(placed)
    setNote(changes.length ? `נוקדו ${changes.length} מילים${by === 'claude' ? ' (על ידי Claude)' : ''}. Ctrl+Z מחזיר.` : 'לא היה מה לנקד.')
  }

  const choose = (i: number, option: string) => {
    const w = words[i]
    if (!w) return
    editor.chain().focus().command(({ tr }) => (tr.insertText(option, w.from, w.to), true)).run()
    setWords((ws) => ws.map((x, j) => (j === i ? { ...x, text: option, to: x.from + option.length } : x)))
  }
  const show = (i: number) => {
    const w = words[i]
    setPicked(picked === i ? null : i)
    if (w) editor.chain().setTextSelection({ from: w.from, to: w.to }).scrollIntoView().run()
  }

  return (
    <div className="nq-auto">
      <div className="fp-sub">ניקוד אוטומטי</div>
      <div className="nq-row">
        <button className="btn" disabled={busy} onMouseDown={(e) => e.preventDefault()} onClick={() => void run('dicta')}>
          {busy ? 'מנקד…' : 'נקד אוטומטית'}
        </button>
        <span className="lp-note">הטקסט המסומן, או הפסקה שבה הסמן. בעזרת הנקדן של דיקטה, צריך אינטרנט.</span>
      </div>
      {err && (
        <div className="err">
          {err}
          {key.has && !busy && (
            <button className="ib" onMouseDown={(e) => e.preventDefault()} onClick={() => void run('claude')}>
              לנקד עם Claude במקום
            </button>
          )}
        </div>
      )}
      {note && <div className="lp-note">{note}</div>}
      {words.length > 0 && (
        <div className="nq-amb">
          <div className="fp-sub">מילים עם יותר מקריאה אחת ({words.length}). לחיצה מראה את המילה בטקסט ואת האפשרויות:</div>
          <div className="nq-amb-list">
            {words.map((w, i) => (
              <button key={i} className={`chip nq-amb-w${picked === i ? ' on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => show(i)}>
                {w.text}
              </button>
            ))}
          </div>
          {picked !== null && words[picked] && (
            <div className="nq-amb-opts" role="listbox" aria-label="קריאות אפשריות">
              {words[picked].options.map((o) => (
                <button key={o} className={`syn-w${o === words[picked].text ? ' on' : ''}`} role="option" aria-selected={o === words[picked].text} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(picked, o)}>
                  {o}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
