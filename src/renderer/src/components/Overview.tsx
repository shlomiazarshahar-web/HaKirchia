// Round 15 "מבט על הספר": four ways to look at the whole book in the planning tab.
//  62 קווי עלילה: rows for story lines (or characters), a column per chapter, a note in each cell
//  63 הופעות: characters (or places) × chapters, filled by itself from where each name appears (34)
//  64 קצב: a bar for the length of each chapter, colored by status or label (statistics only)
//  65 רמזים: hints planted in one chapter that pay off in another; the ones still waiting

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Book, Chapter, OutlineNode } from '@shared/types'
import { STATUS_LABELS } from '@shared/types'
import { KIND_ICON, KIND_LABEL, materialsOf, namesOf, occurrences, type MaterialKind, type Occurrence } from '@shared/background'
import { LABEL_COLOR_NAMES, LABEL_COLORS, chapterLabels } from '@shared/labels'
import {
  appearanceLevel,
  gapAt,
  GAP_MIN,
  lineGaps,
  moveItem,
  nextLineColor,
  niceMax,
  paceStats,
  setupState,
  sortSetups,
  type PlotLine,
  type PlotNotes,
  type Setup,
  type SetupState,
  type StoryPlace
} from '@shared/overview'
import { api } from '../api'
import { jumpFor, useBookTexts } from '../background'
import { useWordCounts } from '../wordcounts'
import { useBg } from './bgctx'
import { TextInput } from './Background'
import { Icon } from './Icons'

const fmt = (n: number) => n.toLocaleString('he-IL')

function useStored<T extends string>(key: string, fallback: T, allowed: readonly T[]): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key) as T | null
      return s && allowed.includes(s) ? s : fallback
    } catch {
      return fallback
    }
  })
  const set = (x: T) => {
    setV(x)
    try {
      localStorage.setItem(key, x)
    } catch {
      /* not remembered, fine */
    }
  }
  return [v, set]
}

/** The chapters in book order, grouped by part (a chapter outside a part is a group of its own without a title) */
function partSpans(outline: OutlineNode[], chapters: Chapter[]): { title?: string; count: number }[] {
  const index = new Map(chapters.map((c, i) => [c.id, i]))
  const out: { title?: string; count: number }[] = []
  for (const n of outline) {
    if (n.type === 'part') {
      const count = n.children.filter((id) => index.has(id)).length
      if (count) out.push({ title: n.title, count })
    } else if (out.length && out[out.length - 1].title === undefined) out[out.length - 1].count++
    else out.push({ count: 1 })
  }
  return out
}

/** Saves round-15 fields of the book (optimistic, then the answer from disk) */
function usePlanSave() {
  const bg = useBg()
  return async (patch: { plotLines?: PlotLine[]; plotNotes?: PlotNotes; setups?: Setup[] }) => {
    const before = bg.book
    bg.onBook({ ...before, ...patch })
    const r = await api.setPlan(before.path, patch)
    if (!r.ok || !r.value) {
      bg.show(r.error ?? 'השמירה נכשלה', true)
      bg.onBook(before)
      return
    }
    bg.onBook(r.value)
  }
}

/** The chapter header of a grid column */
function ChapterHead({ ch, n }: { ch: Chapter; n: number }) {
  const bg = useBg()
  return (
    <th className="ov-ch" scope="col">
      <button title={`${ch.title} · פתיחת הפרק`} onClick={() => bg.goTo(ch.id)}>
        <span className="num">{n}</span>
        <span className="t">{ch.title || 'ללא שם'}</span>
      </button>
    </th>
  )
}

function PartRow({ book, lead }: { book: Book; lead: ReactNode }) {
  const spans = partSpans(book.outline, book.chapters)
  if (!spans.some((s) => s.title !== undefined)) return null
  return (
    <tr className="ov-parts">
      {lead}
      {spans.map((s, i) => (
        <th key={i} colSpan={s.count} className={s.title !== undefined ? 'part' : ''} scope="colgroup">
          {s.title !== undefined && <span>{s.title}</span>}
        </th>
      ))}
    </tr>
  )
}

const gapTitle = (len: number, who: string) => `${who} לא מופיע/ה ב־${len} פרקים ברצף`

// ---------------------------------------------------------------------------
// Feature 62: plot lines
// ---------------------------------------------------------------------------

export function PlotGrid({ bar }: { bar: ReactNode }) {
  const bg = useBg()
  const { book } = bg
  const save = usePlanSave()
  const lines = book.plotLines ?? []
  const notes = book.plotNotes ?? {}
  const [editing, setEditing] = useState<{ line: string; ch: string } | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  const [sure, setSure] = useState<string | null>(null)
  const chapters = book.chapters

  const setNote = (line: string, ch: string, text: string) => {
    const row = { ...(notes[line] ?? {}) }
    if (text.trim()) row[ch] = text
    else delete row[ch]
    void save({ plotNotes: { ...notes, [line]: row } })
  }
  const patchLine = (id: string, p: Partial<PlotLine>) => void save({ plotLines: lines.map((l) => (l.id === id ? { ...l, ...p } : l)) })
  const addLine = (name = '', materialId?: string) => {
    const id = crypto.randomUUID()
    if (!name) setFresh(id)
    void save({ plotLines: [...lines, { id, name, color: nextLineColor(lines), ...(materialId ? { materialId } : {}) }] })
  }
  const removeLine = (id: string) => {
    const { [id]: _gone, ...rest } = notes
    void save({ plotLines: lines.filter((l) => l.id !== id), plotNotes: rest })
  }
  const nextColor = (l: PlotLine) => LABEL_COLORS[(LABEL_COLORS.indexOf(l.color) + 1) % LABEL_COLORS.length]
  const free = book.materials.filter((m) => m.kind !== 'research' && !lines.some((l) => l.materialId === m.id))

  const addBar = (
    <>
      <button className="btn" onClick={() => addLine()}>
        <Icon name="plus" size={16} /> קו עלילה
      </button>
      {free.length > 0 && (
        <select
          className="ov-select"
          aria-label="שורה לדמות או למקום"
          value=""
          onChange={(e) => {
            const m = book.materials.find((x) => x.id === e.target.value)
            if (m) addLine(m.name, m.id)
          }}
        >
          <option value="">+ שורה לדמות או מקום…</option>
          {free.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      )}
    </>
  )

  return (
    <section className="board plan ov" aria-label="קווי עלילה">
      <div className="bbar">
        {bar}
        <span className="grow" />
        {lines.length > 0 && addBar}
      </div>
      {!chapters.length ? (
        <div className="plan-empty">
          <Icon name="lines" size={32} />
          <p>עוד אין פרקים בספר. כשיהיו, כל פרק יהיה עמודה כאן.</p>
        </div>
      ) : !lines.length ? (
        <div className="plan-empty">
          <Icon name="lines" size={32} />
          <p>שורה לכל קו עלילה (או לכל דמות), ועמודה לכל פרק. בכל משבצת כותבים בקצרה מה קורה לקו הזה בפרק הזה.</p>
          <p>כך רואים קו שנעלם להרבה פרקים, או פרק שכל הקווים עוברים בו בבת אחת.</p>
          <div className="ov-empty-actions">{addBar}</div>
        </div>
      ) : (
        <div className="ov-scroll">
          <table className="ov-grid pg">
            <thead>
              <PartRow book={book} lead={<th className="ov-lead" />} />
              <tr>
                <th className="ov-lead" scope="col">
                  קו עלילה
                </th>
                {chapters.map((c, i) => (
                  <ChapterHead key={c.id} ch={c} n={i + 1} />
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, li) => {
                const row = notes[l.id] ?? {}
                const gaps = lineGaps(chapters.map((c) => !!row[c.id]?.trim()))
                const inGap = gapAt(gaps, chapters.length)
                const mat = l.materialId ? book.materials.find((m) => m.id === l.materialId) : undefined
                return (
                  <tr key={l.id} className={`lc-${l.color}`}>
                    <th className="ov-lead pg-line" scope="row">
                      <div className="pg-head">
                        <button className="pg-color" title={`צבע: ${LABEL_COLOR_NAMES[l.color]} · לחיצה מחליפה צבע`} aria-label="החלפת צבע" onClick={() => patchLine(l.id, { color: nextColor(l) })} />
                        <TextInput className="pg-name" value={l.name} placeholder="שם הקו" aria-label="שם קו העלילה" autoFocus={fresh === l.id} onDone={(name) => patchLine(l.id, { name })} />
                        {gaps.length > 0 && (
                          <span className="pg-gapflag" title={`הקו נעלם ל־${Math.max(...gaps.map((g) => g.to - g.from + 1))} פרקים ברצף (או יותר) לפחות פעם אחת`}>
                            <Icon name="info" size={14} />
                          </span>
                        )}
                      </div>
                      <div className="pg-tools">
                        {mat && (
                          <button className="ib icon" title={`פתיחת הדף של ${mat.name}`} aria-label={`פתיחת הדף של ${mat.name}`} onClick={() => bg.openMaterial(mat.id)}>
                            <Icon name={KIND_ICON[mat.kind]} size={14} />
                          </button>
                        )}
                        <button className="ib icon" title="למעלה" aria-label="להזיז למעלה" disabled={li === 0} onClick={() => void save({ plotLines: moveItem(lines, li, li - 1) })}>
                          <Icon name="up" size={14} />
                        </button>
                        <button className="ib icon" title="למטה" aria-label="להזיז למטה" disabled={li === lines.length - 1} onClick={() => void save({ plotLines: moveItem(lines, li, li + 1) })}>
                          <Icon name="down" size={14} />
                        </button>
                        {sure === l.id ? (
                          <button className="ib danger" autoFocus onBlur={() => setSure(null)} onClick={() => (setSure(null), removeLine(l.id))}>
                            למחוק עם הפתקים?
                          </button>
                        ) : (
                          <button className="ib icon" title="מחיקת הקו" aria-label="מחיקת הקו" onClick={() => (Object.keys(row).length ? setSure(l.id) : removeLine(l.id))}>
                            <Icon name="trash" size={14} />
                          </button>
                        )}
                      </div>
                    </th>
                    {chapters.map((c, ci) => {
                      const text = row[c.id] ?? ''
                      const gap = inGap[ci]
                      const isEditing = editing?.line === l.id && editing.ch === c.id
                      return (
                        <td key={c.id} className={`pg-cell${text ? ' has' : ''}${gap ? ' gap' : ''}`} title={gap ? gapTitle(gap.to - gap.from + 1, l.name || 'הקו') : undefined}>
                          {isEditing ? (
                            <CellEditor
                              value={text}
                              label={`${l.name || 'הקו'} בפרק ${ci + 1}`}
                              onDone={(v) => {
                                setEditing(null)
                                if (v !== text) setNote(l.id, c.id, v)
                              }}
                              onCancel={() => setEditing(null)}
                            />
                          ) : (
                            <button className="pg-note" aria-label={`${l.name || 'הקו'} בפרק ${ci + 1}${text ? `: ${text}` : ', ריק'}`} onClick={() => setEditing({ line: l.id, ch: c.id })}>
                              {text || (gap && ci === gap.from ? <span className="pg-gone">נעלם ל־{gap.to - gap.from + 1} פרקים</span> : null)}
                            </button>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="ov-hint">לחיצה על משבצת כותבת בה. קו שלא מופיע ב־{GAP_MIN} פרקים ברצף או יותר מסומן בקו מקווקו.</p>
        </div>
      )}
    </section>
  )
}

function CellEditor({ value, label, onDone, onCancel }: { value: string; label: string; onDone: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(value)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const t = ref.current
    if (!t) return
    t.focus()
    t.setSelectionRange(t.value.length, t.value.length)
  }, [])
  return (
    <textarea
      ref={ref}
      className="pg-edit"
      dir="auto"
      value={v}
      aria-label={label}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onDone(v)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        } else if (e.key === 'Enter' && (e.ctrlKey || !e.shiftKey)) {
          e.preventDefault()
          onDone(v)
        }
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// Feature 63: appearance map
// ---------------------------------------------------------------------------

const APPEAR_KINDS = ['character', 'place'] as const
const APPEAR_SORTS = ['name', 'count', 'first'] as const

export function AppearanceMap({ bar }: { bar: ReactNode }) {
  const bg = useBg()
  const { book } = bg
  const { texts } = useBookTexts(book, 8000)
  const [kind, setKind] = useStored<MaterialKind & (typeof APPEAR_KINDS)[number]>('hakirchia.appear.kind', 'character', APPEAR_KINDS)
  const [sort, setSort] = useStored<(typeof APPEAR_SORTS)[number]>('hakirchia.appear.sort', 'name', APPEAR_SORTS)
  const chapters = book.chapters
  const order = useMemo(() => new Map(chapters.map((c, i) => [c.id, i])), [chapters])

  const rows = useMemo(() => {
    if (!texts) return []
    const list = materialsOf(book.materials, kind).map((m) => {
      const occ = new Map<string, Occurrence>(occurrences(texts.chapters, namesOf(m)).map((o) => [o.chapterId, o]))
      const total = [...occ.values()].reduce((n, o) => n + o.count, 0)
      const first = Math.min(...[...occ.keys()].map((id) => order.get(id) ?? 9999), 9999)
      return { m, occ, total, first }
    })
    if (sort === 'count') list.sort((a, b) => b.total - a.total)
    else if (sort === 'first') list.sort((a, b) => a.first - b.first)
    return list
  }, [texts, book.materials, kind, sort, order])

  const kindSwitch = (
    <div className="seg small" role="tablist" aria-label="מה להציג">
      {APPEAR_KINDS.map((k) => (
        <button key={k} role="tab" aria-selected={kind === k} onClick={() => setKind(k)}>
          <Icon name={KIND_ICON[k]} size={14} />
          {KIND_LABEL[k]}
        </button>
      ))}
    </div>
  )
  const anyOfKind = book.materials.some((m) => m.kind === kind)

  return (
    <section className="board plan ov" aria-label="מפת הופעות">
      <div className="bbar">
        {bar}
        <span className="grow" />
        {kindSwitch}
        {anyOfKind && (
          <select className="ov-select" aria-label="סדר השורות" value={sort} onChange={(e) => setSort(e.target.value as (typeof APPEAR_SORTS)[number])}>
            <option value="name">לפי השם</option>
            <option value="count">לפי מספר ההופעות</option>
            <option value="first">לפי ההופעה הראשונה</option>
          </select>
        )}
      </div>
      {!chapters.length ? (
        <div className="plan-empty">
          <Icon name="heat" size={32} />
          <p>עוד אין פרקים בספר.</p>
        </div>
      ) : !anyOfKind ? (
        <div className="plan-empty">
          <Icon name={KIND_ICON[kind]} size={32} />
          <p>המפה ממלאת את עצמה: לכל {kind === 'character' ? 'דמות' : 'מקום'} שיש לו דף בחומרי הרקע, היא בודקת באילו פרקים השם מופיע וכמה פעמים.</p>
          <p>{kind === 'character' ? 'עוד אין דפי דמויות. אפשר ליצור אחד מהעץ (חומרי רקע) או בלחיצה ימנית על שם בטקסט.' : 'עוד אין דפי מקומות. אפשר ליצור אחד מהעץ (חומרי רקע) או בלחיצה ימנית על שם בטקסט.'}</p>
          <button className="btn" onClick={() => bg.newMaterial(kind)}>
            <Icon name="plus" size={16} /> {kind === 'character' ? 'דמות חדשה' : 'מקום חדש'}
          </button>
        </div>
      ) : !texts ? (
        <div className="plan-empty">
          <p>קורא את הפרקים…</p>
        </div>
      ) : (
        <div className="ov-scroll">
          <table className="ov-grid am">
            <thead>
              <PartRow book={book} lead={<th className="ov-lead" />} />
              <tr>
                <th className="ov-lead" scope="col">
                  {kind === 'character' ? 'דמות' : 'מקום'}
                </th>
                {chapters.map((c, i) => (
                  <ChapterHead key={c.id} ch={c} n={i + 1} />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ m, occ, total }) => {
                const inGap = gapAt(
                  lineGaps(chapters.map((c) => occ.has(c.id))),
                  chapters.length
                )
                return (
                  <tr key={m.id}>
                    <th className="ov-lead am-name" scope="row">
                      <button title={`פתיחת הדף של ${m.name}`} onClick={() => bg.openMaterial(m.id)}>
                        {m.name || 'ללא שם'}
                      </button>
                      <span className="am-sum" title={`${fmt(total)} הופעות ב־${occ.size} פרקים`}>
                        {occ.size}/{chapters.length}
                      </span>
                    </th>
                    {chapters.map((c, ci) => {
                      const o = occ.get(c.id)
                      const gap = inGap[ci]
                      if (!o)
                        return (
                          <td key={c.id} className={`am-cell lv-0${gap ? ' gap' : ''}`} title={gap ? gapTitle(gap.to - gap.from + 1, m.name) : undefined}>
                            <span className="am-none" aria-label={`${m.name} לא מופיע/ה בפרק ${ci + 1}`} />
                          </td>
                        )
                      return (
                        <td key={c.id} className={`am-cell lv-${appearanceLevel(o.count)}`}>
                          <button
                            title={`${m.name} · ${o.count === 1 ? 'פעם אחת' : `${fmt(o.count)} פעמים`} בפרק ${ci + 1} (${c.title}) · לחיצה קופצת להופעה הראשונה`}
                            onClick={() => bg.goTo(c.id, jumpFor(texts, c.id, o.first))}
                          >
                            {o.count}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="am-legend" aria-hidden="true">
            <span>גוון כהה יותר = השם מופיע יותר פעמים בפרק:</span>
            {[1, 2, 3, 4].map((lv) => (
              <span key={lv} className={`am-sw lv-${lv}`}>
                {['1', '2–4', '5–14', '15+'][lv - 1]}
              </span>
            ))}
          </div>
          <p className="ov-hint">
            נספר לבד מהטקסט, לפי השם והכינויים שבדף ({kind === 'character' ? 'דמות' : 'מקום'}), גם עם אותיות כמו ו, ה, ל בתחילת המילה. היעדרות של {GAP_MIN} פרקים ברצף או יותר מסומנת בקו מקווקו.
          </p>
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Feature 64: pace
// ---------------------------------------------------------------------------

const PACE_COLORS = ['status', 'label'] as const

/** Fractions of the top for the scale lines, so each line is a round number (2,500 → 500, 1,000, …) */
function axisTicks(top: number): number[] {
  for (const k of [4, 5, 3, 2]) {
    const s = top / k
    const p = Math.pow(10, Math.floor(Math.log10(s)))
    if (Number.isInteger(s) && s % (p / 2) === 0) return Array.from({ length: k + 1 }, (_, i) => i / k)
  }
  return [0, 0.25, 0.5, 0.75, 1]
}

export function PaceView({ bar }: { bar: ReactNode }) {
  const bg = useBg()
  const { book } = bg
  const words = useWordCounts(book)
  const [colorBy, setColorBy] = useStored<(typeof PACE_COLORS)[number]>('hakirchia.pace.color', 'status', PACE_COLORS)
  const chapters = book.chapters
  const ids = chapters.map((c) => c.id)
  const stats = paceStats(ids, words)
  const top = niceMax(Math.max(0, ...ids.map((id) => words[id] ?? 0)))
  const ticks = axisTicks(top)
  const spans = partSpans(book.outline, chapters)
  const loaded = Object.keys(words).length > 0
  const num = new Map(chapters.map((c, i) => [c.id, i + 1]))
  const usedLabels = book.labels.filter((l) => chapters.some((c) => c.labels?.includes(l.id)))

  const colorSwitch = (
    <div className="seg small" role="tablist" aria-label="צבע העמודות">
      <button role="tab" aria-selected={colorBy === 'status'} onClick={() => setColorBy('status')}>
        לפי סטטוס
      </button>
      <button role="tab" aria-selected={colorBy === 'label'} onClick={() => setColorBy('label')}>
        <Icon name="tag" size={14} />
        לפי תווית
      </button>
    </div>
  )

  return (
    <section className="board plan ov" aria-label="קצב הספר">
      <div className="bbar">
        {bar}
        <span className="grow" />
        {chapters.length > 0 && colorSwitch}
      </div>
      {!chapters.length ? (
        <div className="plan-empty">
          <Icon name="chart" size={32} />
          <p>עוד אין פרקים בספר. כשיהיו, כל פרק יהיה עמודה בגובה האורך שלו.</p>
        </div>
      ) : (
        <div className="pace">
          <div className="pace-stats">
            <span>
              <b>{fmt(stats.total)}</b> מילים ב־{chapters.length} פרקים
            </span>
            {stats.average > 0 && (
              <span>
                ממוצע לפרק: <b>{fmt(stats.average)}</b>
              </span>
            )}
            {stats.longest && (
              <button className="alink" onClick={() => bg.goTo(stats.longest!.id)}>
                הארוך ביותר: פרק {num.get(stats.longest.id)} ({fmt(stats.longest.words)})
              </button>
            )}
            {stats.shortest && stats.shortest.id !== stats.longest?.id && (
              <button className="alink" onClick={() => bg.goTo(stats.shortest!.id)}>
                הקצר ביותר: פרק {num.get(stats.shortest.id)} ({fmt(stats.shortest.words)})
              </button>
            )}
          </div>
          <div className="pace-chart" style={{ ['--cols' as string]: chapters.length }}>
            <div className="pace-axis" aria-hidden="true">
              {ticks.map((f) => (
                <span key={f} style={{ bottom: `${f * 100}%` }}>
                  {fmt(Math.round(top * f))}
                </span>
              ))}
            </div>
            <div className="pace-plot">
              {ticks.filter((f) => f > 0).map((f) => (
                <span key={f} className="pace-grid" style={{ bottom: `${f * 100}%` }} aria-hidden="true" />
              ))}
              {stats.average > 0 && (
                <span className="pace-avg" style={{ bottom: `${(stats.average / top) * 100}%` }} title={`ממוצע: ${fmt(stats.average)} מילים`}>
                  <span>ממוצע</span>
                </span>
              )}
              <div className="pace-bars">
                {chapters.map((c, i) => {
                  const w = words[c.id] ?? 0
                  const label = chapterLabels(c.labels, book.labels)[0]
                  const cls = colorBy === 'status' ? `st-${c.status}` : label ? `lc-${label.color} by-label` : 'no-label'
                  const what = colorBy === 'status' ? STATUS_LABELS[c.status] : label ? label.name || LABEL_COLOR_NAMES[label.color] : 'בלי תווית'
                  return (
                    <button key={c.id} className="pace-col" title={`פרק ${i + 1}: ${c.title}\n${loaded ? `${fmt(w)} מילים` : '…'} · ${what}${c.noExport ? ' · לא נכלל בייצוא' : ''}`} onClick={() => bg.goTo(c.id)}>
                      <span className={`pace-bar ${cls}${w === 0 ? ' empty' : ''}`} style={{ height: `${Math.max(w ? 1.5 : 0, (w / top) * 100)}%` }} />
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="pace-nums" aria-hidden="true">
              {chapters.map((c, i) => (
                <span key={c.id}>{i + 1}</span>
              ))}
            </div>
            {spans.some((s) => s.title !== undefined) && (
              <div className="pace-parts" aria-hidden="true">
                {spans.map((s, i) => (
                  <span key={i} className={s.title !== undefined ? 'part' : ''} style={{ flex: s.count }}>
                    {s.title}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="pace-legend">
            {colorBy === 'status'
              ? (['draft', 'writing', 'editing', 'done'] as const).map((s) => (
                  <span key={s}>
                    <span className={`dot st-${s}`} /> {STATUS_LABELS[s]}
                  </span>
                ))
              : (
                <>
                  {usedLabels.map((l) => (
                    <span key={l.id}>
                      <span className={`ldot big lc-${l.color}`} /> {l.name || LABEL_COLOR_NAMES[l.color]}
                    </span>
                  ))}
                  <span>
                    <span className="ldot big no-label" /> בלי תווית
                  </span>
                  {usedLabels.length === 0 && <span className="muted">עוד אין לפרקים תוויות. מוסיפים מהתפריט של הפרק (לחיצה ימנית).</span>}
                </>
              )}
          </div>
          <p className="ov-hint">סטטיסטיקה בלבד, בלי יעד. גובה העמודה = מספר המילים בפרק. לחיצה על עמודה פותחת את הפרק.{colorBy === 'label' ? ' לפרק עם כמה תוויות הצבע הוא של הראשונה.' : ''}</p>
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Feature 65: setups & payoffs
// ---------------------------------------------------------------------------

const SETUP_FILTERS = ['all', 'open', 'paid'] as const
const STATE_LABEL: Record<SetupState, string> = { open: 'מחכה לתשלום', paid: 'שולם', early: 'התשלום לפני השתילה' }

export function SetupsView({ bar }: { bar: ReactNode }) {
  const bg = useBg()
  const { book } = bg
  const save = usePlanSave()
  const list = book.setups ?? []
  const order = useMemo(() => new Map(book.chapters.map((c, i) => [c.id, i])), [book.chapters])
  const [filter, setFilter] = useStored<(typeof SETUP_FILTERS)[number]>('hakirchia.setups.filter', 'all', SETUP_FILTERS)
  const [fresh, setFresh] = useState<string | null>(null)
  const [sure, setSure] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)

  const sorted = sortSetups(list, order)
  const state = (s: Setup) => setupState(s, order)
  const openCount = list.filter((s) => state(s) !== 'paid').length
  const shown = sorted.filter((s) => filter === 'all' || (filter === 'open' ? state(s) !== 'paid' : state(s) === 'paid'))

  const patch = (id: string, p: Partial<Setup>) => void save({ setups: list.map((s) => (s.id === id ? { ...s, ...p } : s)) })
  const setEnd = (s: Setup, end: 'plant' | 'payoff', chapterId: string) => {
    const next = { ...s }
    if (!chapterId) delete next[end]
    else if (s[end]?.chapterId !== chapterId) next[end] = { chapterId }
    void save({ setups: list.map((x) => (x.id === s.id ? next : x)) })
  }
  const add = () => {
    const id = crypto.randomUUID()
    setFresh(id)
    setFilter('all')
    void save({ setups: [{ id, title: '', note: '', at: Date.now() }, ...list] })
  }
  const jump = (p: StoryPlace) => bg.goTo(p.chapterId, p.pos !== undefined ? { pos: p.pos, to: p.pos + (p.quote?.length ?? 0), before: p.before, after: p.after } : undefined)

  const chapterSelect = (s: Setup, end: 'plant' | 'payoff') => (
    <select className="ov-select" aria-label={end === 'plant' ? 'נשתל בפרק' : 'משתלם בפרק'} value={s[end]?.chapterId ?? ''} onChange={(e) => setEnd(s, end, e.target.value)}>
      <option value="">{end === 'plant' ? 'באיזה פרק?' : 'עוד לא'}</option>
      {book.chapters.map((c, i) => (
        <option key={c.id} value={c.id}>
          {i + 1}. {c.title}
        </option>
      ))}
    </select>
  )
  const quote = (p: StoryPlace | undefined) =>
    p?.quote ? (
      <button className="sp-quote" title="קפיצה למקום בטקסט" onClick={() => jump(p)}>
        “{p.quote}”
      </button>
    ) : p ? (
      <button className="ib" title="פתיחת הפרק" onClick={() => jump(p)}>
        <Icon name="jump" size={14} /> לפרק
      </button>
    ) : null

  return (
    <section className="board plan ov" aria-label="שתילה ותשלום">
      <div className="bbar">
        {bar}
        <span className="grow" />
        {list.length > 0 && (
          <>
            {SETUP_FILTERS.map((f) => (
              <button key={f} className="fchip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === 'all' ? 'הכול' : f === 'open' ? 'מחכים לתשלום' : 'שולמו'}
                <span className="cnt">{f === 'all' ? list.length : f === 'open' ? openCount : list.length - openCount}</span>
              </button>
            ))}
            <button className="btn" onClick={add}>
              <Icon name="plus" size={16} /> רמז
            </button>
          </>
        )}
      </div>
      {!list.length ? (
        <div className="plan-empty">
          <Icon name="seed" size={32} />
          <p>רמז שנשתל בפרק אחד צריך להשתלם בפרק מאוחר יותר: אקדח על הקיר, מכתב שלא נפתח, משפט שחוזר.</p>
          <p>מסמנים בטקסט את המילים, לוחצים לחיצה ימנית ובוחרים "שתילת רמז". אחר כך, במקום שבו הוא משתלם, מסמנים ובוחרים "תשלום של רמז". כאן רואים את כולם, ואת אלה שעוד מחכים.</p>
          <button className="btn" onClick={add}>
            <Icon name="plus" size={16} /> רמז ראשון (בלי לסמן בטקסט)
          </button>
        </div>
      ) : (
        <>
          <SetupArcs book={book} list={list} order={order} hover={hover} onHover={setHover} />
          <ol className="sp-list">
            {shown.map((s) => {
              const st = state(s)
              return (
                <li key={s.id} className={`sp-item sp-${st}${hover === s.id ? ' hot' : ''}`} onMouseEnter={() => setHover(s.id)} onMouseLeave={() => setHover(null)}>
                  <div className="sp-top">
                    <Icon name="seed" size={16} />
                    <TextInput className="sp-title" value={s.title} placeholder="מה הרמז?" aria-label="מה הרמז" autoFocus={fresh === s.id} onDone={(title) => patch(s.id, { title })} />
                    <span className={`sp-state ${st}`}>{STATE_LABEL[st]}</span>
                    {sure === s.id ? (
                      <button className="ib danger" autoFocus onBlur={() => setSure(null)} onClick={() => (setSure(null), void save({ setups: list.filter((x) => x.id !== s.id) }))}>
                        למחוק?
                      </button>
                    ) : (
                      <button className="ib icon" title="מחיקת הרמז" aria-label="מחיקת הרמז" onClick={() => (s.title.trim() || s.plant || s.payoff ? setSure(s.id) : void save({ setups: list.filter((x) => x.id !== s.id) }))}>
                        <Icon name="trash" size={14} />
                      </button>
                    )}
                  </div>
                  <div className="sp-ends">
                    <div className="sp-end">
                      <span className="lbl">נשתל</span>
                      {chapterSelect(s, 'plant')}
                      {quote(s.plant)}
                    </div>
                    <span className="sp-arrow" aria-hidden="true">
                      ←
                    </span>
                    <div className="sp-end">
                      <span className="lbl">משתלם</span>
                      {chapterSelect(s, 'payoff')}
                      {quote(s.payoff)}
                    </div>
                  </div>
                  <TextInput className="sp-note" multiline value={s.note} placeholder="הערה (לא חובה)" aria-label="הערה" onDone={(note) => patch(s.id, { note })} />
                </li>
              )
            })}
            {!shown.length && <li className="sp-none">{filter === 'open' ? 'כל הרמזים כבר קיבלו תשלום.' : 'עוד אין רמזים ששולמו.'}</li>}
          </ol>
          <p className="ov-hint">מסמנים מילים בפרק ולוחצים לחיצה ימנית: "שתילת רמז" או "תשלום של רמז". לחיצה על הציטוט קופצת למקום.</p>
        </>
      )}
    </section>
  )
}

/** The chapters in a row, with an arc from where each hint is planted to where it pays off */
function SetupArcs({ book, list, order, hover, onHover }: { book: Book; list: Setup[]; order: Map<string, number>; hover: string | null; onHover: (id: string | null) => void }) {
  const n = book.chapters.length
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(Math.max(200, el.clientWidth - 28)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  if (!n) return null
  // never wider than the box; with many chapters it scrolls sideways (at least 22px for each)
  const W = Math.max(width, n * 22)
  const H = 96
  const base = H - 22
  // chapter 1 at the right (Hebrew reading order)
  const x = (i: number) => W - (i + 0.5) * (W / n)
  return (
    <div className="sp-arcs" ref={box}>
      <svg className="sp-svg" style={{ width: W, height: H }} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="הרמזים לאורך הספר: קשת מהפרק שבו נשתל לפרק שבו משתלם">
        <line x1={0} x2={W} y1={base} y2={base} className="sp-axis" />
        {list.map((s) => {
          const a = s.plant ? order.get(s.plant.chapterId) : undefined
          const b = s.payoff ? order.get(s.payoff.chapterId) : undefined
          const st = setupState(s, order)
          const cls = `sp-arc ${st}${hover === s.id ? ' hot' : ''}`
          const title = `${s.title || 'רמז'} · ${STATE_LABEL[st]}`
          if (a === undefined && b === undefined) return null
          if (a !== undefined && b !== undefined && a !== b) {
            const x1 = x(a),
              x2 = x(b)
            const h = Math.min(base - 6, 16 + (Math.abs(b - a) / Math.max(1, n - 1)) * (base - 22))
            return (
              <path key={s.id} className={cls} d={`M${x1},${base} C${x1},${base - h} ${x2},${base - h} ${x2},${base}`} onMouseEnter={() => onHover(s.id)} onMouseLeave={() => onHover(null)}>
                <title>{title}</title>
              </path>
            )
          }
          const i = (a ?? b)!
          return (
            <g key={s.id} className={cls} onMouseEnter={() => onHover(s.id)} onMouseLeave={() => onHover(null)}>
              <title>{title}</title>
              {st === 'open' && a !== undefined && <line x1={x(a)} x2={x(n - 1) - 4} y1={base - 8} y2={base - 8} className="sp-wait" />}
              <circle cx={x(i)} cy={base - 8} r={4} />
            </g>
          )
        })}
        {book.chapters.map((c, i) => (
          <text key={c.id} x={x(i)} y={H - 6} className="sp-num" textAnchor="middle">
            {i + 1}
            <title>{c.title}</title>
          </text>
        ))}
      </svg>
    </div>
  )
}

// ---------------------------------------------------------------------------
// From the right-click menu: the payoff of which hint?
// ---------------------------------------------------------------------------

export function PayoffDialog({ book, place, onPick, onNew, onCancel }: { book: Book; place: StoryPlace; onPick: (id: string) => void; onNew: () => void; onCancel: () => void }) {
  const order = new Map(book.chapters.map((c, i) => [c.id, i]))
  const list = sortSetups(book.setups ?? [], order)
  const num = (id?: string) => (id && order.has(id) ? order.get(id)! + 1 : undefined)
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => first.current?.focus(), [])
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dialog payoff-dlg" role="dialog" aria-label="התשלום של איזה רמז?" onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
        <h2>התשלום של איזה רמז?</h2>
        {place.quote && <p className="muted">“{place.quote}” · פרק {num(place.chapterId)}</p>}
        <ul className="payoff-list">
          {list.map((s, i) => {
            const st = setupState(s, order)
            return (
              <li key={s.id}>
                <button ref={i === 0 ? first : undefined} onClick={() => onPick(s.id)}>
                  <Icon name="seed" size={14} />
                  <span className="t">{s.title || s.plant?.quote || 'רמז ללא שם'}</span>
                  <span className="muted">{s.plant ? `נשתל בפרק ${num(s.plant.chapterId)}` : 'בלי מקום שתילה'}</span>
                  {st !== 'open' && <span className="sp-state paid">יש כבר תשלום, יוחלף</span>}
                </button>
              </li>
            )
          })}
        </ul>
        <div className="actions">
          <button className="btn ghost" onClick={onNew}>
            רמז חדש שמשתלם כאן
          </button>
          <button className="btn ghost" onClick={onCancel}>
            ביטול
          </button>
        </div>
      </div>
    </div>
  )
}
