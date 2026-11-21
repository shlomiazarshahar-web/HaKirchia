// The glossary of terms and names (feature 20), in a pane: how each term is written in the book and
// its original, a check of the whole book for terms written differently (also full/defective
// spelling), and, in translated books, chapters where the original uses a term the translation does not.

import { useEffect, useMemo, useState } from 'react'
import { chapterRange } from '@shared/translation'
import { checkTerms, inconsistencies, occurrences, KIND_ICON, KIND_ONE, namesOf, translationGaps, type GlossaryEntry, type Inconsistency, type TranslationGap } from '@shared/background'
import { api } from '../api'
import { jumpFor, useBookTexts, useGlossaryMarks } from '../background'
import { pdfParagraphs } from '../translate'
import { useBg } from './bgctx'
import { ListInput, OccurrenceList, TextInput } from './Background'
import { Icon } from './Icons'

export function GlossaryPane() {
  const bg = useBg()
  const { book } = bg
  const [marks, setMarks] = useGlossaryMarks()
  const [openRow, setOpenRow] = useState<string | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  const { texts, refresh } = useBookTexts(book, 8000)

  const save = async (list: GlossaryEntry[]) => {
    bg.onBook({ ...book, glossary: list })
    const r = await api.setGlossary(book.path, list)
    if (!r.ok || !r.value) return bg.show(r.error ?? 'השמירה נכשלה', true)
    bg.onBook(r.value.book)
  }
  const patch = (id: string, p: Partial<GlossaryEntry>) => void save(book.glossary.map((g) => (g.id === id ? { ...g, ...p } : g)))
  const add = () => {
    const id = crypto.randomUUID()
    setFresh(id)
    void save([...book.glossary, { id, term: '', original: '', variants: [], accepted: [], note: '' }])
  }

  const terms = useMemo(() => checkTerms(book.glossary, book.materials), [book.glossary, book.materials])
  const issues = useMemo(() => (texts ? inconsistencies(texts.chapters, terms) : null), [texts, terms])

  // Translation: the original paragraphs of each translated chapter (read from its PDF once)
  const [sources, setSources] = useState<Record<string, string[]> | null>(null)
  const hasOriginals = book.glossary.some((g) => g.original.trim()) || book.materials.some((m) => m.original)
  const srcKey = JSON.stringify(book.sources)
  useEffect(() => {
    if (!hasOriginals || !Object.keys(book.sources).length) return setSources(null)
    let alive = true
    void (async () => {
      const out: Record<string, string[]> = {}
      for (const [id, src] of Object.entries(book.sources)) {
        try {
          const st = await pdfParagraphs(book.path, src.pdf)
          const [from, to] = chapterRange(st.paras, src)
          out[id] = st.paras.slice(from, to + 1).map((p) => p.text)
        } catch {
          /* an original that cannot be read is skipped */
        }
      }
      if (alive) setSources(out)
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.path, srcKey, hasOriginals])
  const gaps = useMemo<TranslationGap[]>(() => {
    if (!texts || !sources) return []
    const entries = [
      ...book.glossary.map((g) => ({ id: g.id, term: g.term, original: g.original, accepted: g.accepted })),
      ...book.materials.filter((m) => m.original).map((m) => ({ id: m.id, term: m.name, original: m.original!, accepted: m.aliases }))
    ]
    return translationGaps(texts.chapters, sources, entries)
  }, [texts, sources, book.glossary, book.materials])

  const num = new Map(book.chapters.map((c, i) => [c.id, i + 1]))
  const titleOf = new Map(book.chapters.map((c) => [c.id, c.title]))

  /** "That's fine": this spelling is another word, or an accepted form */
  const accept = (it: Inconsistency) => {
    const g = book.glossary.find((x) => x.id === it.termId)
    if (g) return patch(g.id, { accepted: [...g.accepted, it.spelled], variants: g.variants.filter((v) => v !== it.spelled) })
    const m = book.materials.find((x) => x.id === it.termId)
    if (m)
      void api.updateMaterial(book.path, m.id, { aliases: [...m.aliases, it.spelled] }).then((r) => {
        if (r.ok && r.value) bg.onBook(r.value.book)
      })
  }

  const names = book.materials.filter((m) => m.kind !== 'research')

  return (
    <main className="desk">
      <article className="paper sheet glossary">
        <div className="docfile">
          <Icon name="glossary" />
          <span className="fname">חומרי רקע / מילון מונחים ושמות</span>
          <span className="grow" />
          <label className="switch" title="קו מנוקד מתחת למונח שנכתב אחרת מהמילון, בכל הפרקים">
            <input type="checkbox" checked={marks} onChange={(e) => setMarks(e.target.checked)} />
            סימון בטקסט
          </label>
        </div>
        <h2 className="ch-title">מילון מונחים ושמות</h2>
        <p className="lp-note">איך כל מונח נכתב בספר, ומה הוא במקור כשמתרגמים. הכריכייה מסמנת בפרקים מונח שנכתב אחרת, גם בכתיב מלא או חסר, ושמות הדמויות והמקומות מדפי הרקע נבדקים גם הם.</p>

        <div className="gl-table" role="table" aria-label="מונחים">
          <div className="gl-row gl-head" role="row">
            <span role="columnheader">בספר</span>
            <span role="columnheader">במקור</span>
            <span role="columnheader">כתיב שגוי לסימון</span>
            <span role="columnheader">הערה</span>
            <span role="columnheader">מופיע</span>
            <span />
          </div>
          {book.glossary.map((g) => (
            <div key={g.id} className="gl-entry">
              <div className="gl-row" role="row">
                <TextInput value={g.term} aria-label="המונח בספר" placeholder="המונח" autoFocus={fresh === g.id || (bg.freshTerm === g.id && !g.term)} onDone={(term) => patch(g.id, { term: term.trim() })} />
                <TextInput value={g.original} dir="auto" aria-label="המונח במקור" placeholder="—" autoFocus={bg.freshTerm === g.id && !!g.term && !g.original} onDone={(original) => patch(g.id, { original: original.trim() })} />
                <ListInput value={g.variants} placeholder="בפסיקים" onDone={(variants) => patch(g.id, { variants })} />
                <TextInput value={g.note} aria-label="הערה" placeholder="" onDone={(note) => patch(g.id, { note })} />
                <button className="ib gl-occ" aria-expanded={openRow === g.id} disabled={!g.term.trim()} title="באילו פרקים המונח מופיע" onClick={() => setOpenRow(openRow === g.id ? null : g.id)}>
                  {texts && g.term.trim() ? <CountIn names={[g.term, ...g.accepted]} texts={texts.chapters} /> : '—'}
                </button>
                <button className="ib icon" title="מחיקת המונח" aria-label={`מחיקת ${g.term}`} onClick={() => void save(book.glossary.filter((x) => x.id !== g.id))}>
                  <Icon name="trash" />
                </button>
              </div>
              {openRow === g.id && g.term.trim() && (
                <div className="gl-more">
                  <OccurrenceList names={[g.term, ...g.accepted]} />
                </div>
              )}
            </div>
          ))}
          <button className="ib gl-add" onClick={add}>
            <Icon name="plus" /> מונח חדש
          </button>
        </div>

        {names.length > 0 && (
          <section className="msec">
            <h4>שמות מדפי הרקע</h4>
            <div className="gl-names">
              {names.map((m) => (
                <button key={m.id} className="gl-name" title={`פתיחת הדף של ${m.name}`} onClick={() => bg.openMaterial(m.id)}>
                  <Icon name={KIND_ICON[m.kind]} />
                  <b dir="auto">{m.name}</b>
                  {m.original && <span dir="auto">{m.original}</span>}
                  {m.aliases.length > 0 && <small dir="auto">גם: {m.aliases.join(', ')}</small>}
                  <small className="kind">{KIND_ONE[m.kind]}</small>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="msec">
          <h4>
            בדיקת עקביות
            <button className="ib" title="לבדוק שוב את כל הפרקים" onClick={refresh}>
              <Icon name="reload" /> בדיקה מחדש
            </button>
          </h4>
          {!terms.length ? (
            <div className="bempty">אחרי שמוסיפים מונחים, או דפים של דמויות ומקומות, כאן יופיעו מקומות שבהם הם נכתבו אחרת.</div>
          ) : !issues ? (
            <div className="bempty">בודק את הפרקים…</div>
          ) : !issues.length && !gaps.length ? (
            <div className="bempty ok">הכול עקבי: לא נמצא מונח או שם שנכתב אחרת.</div>
          ) : (
            <ul className="issues">
              {issues.map((it) => (
                <li key={`${it.termId}|${it.spelled}`}>
                  <div className="iss-t">
                    <b dir="auto">"{it.spelled}"</b> במקום <b dir="auto">"{it.term}"</b>
                    <small>{it.why === 'spelling' ? ' · כתיב מלא/חסר' : ' · כתיב שגוי מהמילון'}</small>
                  </div>
                  <div className="iss-where">
                    {it.places.map((p) => (
                      <button key={p.chapterId} className="chip" title={titleOf.get(p.chapterId)} onClick={() => texts && bg.goTo(p.chapterId, jumpFor(texts, p.chapterId, p.first))}>
                        פרק {num.get(p.chapterId)}
                        {p.count > 1 ? ` (${p.count})` : ''}
                      </button>
                    ))}
                  </div>
                  <div className="iss-act">
                    <button className="ib" title="פותח את החיפוש וההחלפה בכל הספר, מוכן להחלפה" onClick={() => bg.findReplace(it.spelled, it.term)}>
                      החלפה…
                    </button>
                    <button className="ib" title="הכתיב הזה בסדר (מילה אחרת, או צורה מקובלת): לא לסמן אותו" onClick={() => accept(it)}>
                      זה בסדר
                    </button>
                  </div>
                </li>
              ))}
              {gaps.map((g) => (
                <li key={`${g.termId}|${g.chapterId}`} className="gap">
                  <div className="iss-t">
                    <Icon name="translate" size={14} /> בפרק {num.get(g.chapterId)} המקור מזכיר את <b dir="auto">"{g.original}"</b> {g.inSource === 1 ? 'פעם אחת' : `${g.inSource} פעמים`}, ו<b dir="auto">"{g.term}"</b>{' '}
                    {g.inChapter === 0 ? 'לא מופיע בתרגום' : `מופיע רק ${g.inChapter === 1 ? 'פעם אחת' : `${g.inChapter} פעמים`}`}
                  </div>
                  <div className="iss-act">
                    <button className="ib" onClick={() => bg.goTo(g.chapterId)}>
                      מעבר לפרק
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {hasOriginals && Object.keys(book.sources).length > 0 && !sources && <div className="bempty">קורא את המקור כדי לבדוק גם את התרגום…</div>}
        </section>
      </article>
    </main>
  )
}

function CountIn({ names, texts }: { names: string[]; texts: { id: string; paras: string[] }[] }) {
  const n = useMemo(() => occurrences(texts, names).length, [names.join('|'), texts]) // eslint-disable-line react-hooks/exhaustive-deps
  return <>{n === 0 ? 'לא מופיע' : n === 1 ? 'בפרק אחד' : `ב־${n} פרקים`}</>
}
