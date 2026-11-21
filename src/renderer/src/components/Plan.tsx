// The planning tab (was "לוח שעם"): next to the chapter cards, the story timeline (feature 21) and
// the inspiration board (feature 37).

import { useState, type ReactNode } from 'react'
import { chaptersInStoryOrder, KIND_ICON, KIND_ONE, moveEvent, type InspirationImage, type TimelineEvent } from '@shared/background'
import { api } from '../api'
import { droppedImagePaths } from '../background'
import { useBg } from './bgctx'
import { Lightbox, TextInput, Thumb } from './Background'
import { Icon } from './Icons'

export type PlanMode = 'cards' | 'timeline' | 'inspiration'

/** Switches between the three ways to look at the plan of the book */
export function PlanSwitch({ mode, onMode }: { mode: PlanMode; onMode: (m: PlanMode) => void }) {
  const opts: [PlanMode, string, string, string][] = [
    ['cards', 'כרטיסים', 'grid', 'כרטיס לכל פרק, עם תקציר וסטטוס'],
    ['timeline', 'ציר זמן', 'timeline', 'אירועי הסיפור לפי סדר הזמן, מקושרים לפרקים'],
    ['inspiration', 'השראה', 'image', 'תמונות לדמויות, למקומות ולפרקים']
  ]
  return (
    <div className="seg" role="tablist" aria-label="תצוגת התכנון">
      {opts.map(([m, label, icon, title]) => (
        <button key={m} role="tab" aria-selected={mode === m} title={title} onClick={() => onMode(m)}>
          <Icon name={icon} size={15} />
          {label}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Timeline (feature 21)
// ---------------------------------------------------------------------------

export function Timeline({ bar, onOpenChapter }: { bar: ReactNode; onOpenChapter: (id: string) => void }) {
  const bg = useBg()
  const { book } = bg
  const [drag, setDrag] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  const list = book.timeline
  const num = new Map(book.chapters.map((c, i) => [c.id, i + 1]))
  const chTitle = new Map(book.chapters.map((c) => [c.id, c.title]))
  const matById = new Map(book.materials.map((m) => [m.id, m]))

  const save = async (next: TimelineEvent[]) => {
    bg.onBook({ ...book, timeline: next })
    const r = await api.setTimeline(book.path, next)
    if (!r.ok || !r.value) return bg.show(r.error ?? 'השמירה נכשלה', true)
    bg.onBook(r.value.book)
  }
  const patch = (id: string, p: Partial<TimelineEvent>) => void save(list.map((e) => (e.id === id ? { ...e, ...p } : e)))
  const add = (at = list.length) => {
    const id = crypto.randomUUID()
    setFresh(id)
    const next = [...list]
    next.splice(at, 0, { id, when: '', title: '', text: '', chapterIds: [], materialIds: [] })
    void save(next)
  }
  const strip = chaptersInStoryOrder(list, book.chapters.map((c) => c.id))

  return (
    <section className="board plan" aria-label="ציר זמן">
      <div className="bbar">
        {bar}
        <span className="grow" />
        <button className="btn" onClick={() => add()}>
          <Icon name="plus" size={16} /> אירוע
        </button>
      </div>
      {strip.length > 1 && (
        <div className="tl-strip" aria-label="הפרקים לפי זמן הסיפור">
          <span className="lbl">הפרקים לפי זמן הסיפור:</span>
          {strip.map((s, i) => (
            <span key={s.id} className="tl-s">
              {i > 0 && <span className="arr">←</span>}
              <button className={`chip${s.back ? ' back' : ''}`} title={`${chTitle.get(s.id)}${s.back ? ' · קורה לפני פרקים שקודמים לו בספר (קפיצה אחורה בזמן)' : ''}`} onClick={() => onOpenChapter(s.id)}>
                {s.number}
              </button>
            </span>
          ))}
        </div>
      )}
      {!list.length ? (
        <div className="plan-empty">
          <Icon name="timeline" size={32} />
          <p>ציר הזמן מסדר את אירועי הסיפור לפי מתי שהם קורים, לא לפי הסדר בספר.</p>
          <p>לכל אירוע: מתי (במילים שלכם, למשל "אביב 1947" או "שלוש שנים קודם"), מה קרה, ובאילו פרקים ומי מהדמויות. גוררים כדי לשנות את הסדר.</p>
          <button className="btn" onClick={() => add()}>
            <Icon name="plus" size={16} /> האירוע הראשון
          </button>
        </div>
      ) : (
        <ol className="tl">
          {list.map((e, i) => (
            <li
              key={e.id}
              className={`tl-ev${drag === i ? ' dragging' : ''}${over === i && drag !== null && drag !== i ? (drag < i ? ' over-after' : ' over-before') : ''}`}
              onDragOver={(ev) => {
                if (drag === null) return
                ev.preventDefault()
                setOver(i)
              }}
              onDrop={(ev) => {
                ev.preventDefault()
                if (drag !== null) void save(moveEvent(list, drag, i))
                setDrag(null)
                setOver(null)
              }}
            >
              <span
                className="tl-dot"
                draggable
                title="גרירה לשינוי המקום בזמן"
                onDragStart={(ev) => {
                  setDrag(i)
                  ev.dataTransfer.effectAllowed = 'move'
                  ev.dataTransfer.setData('text/plain', e.id)
                }}
                onDragEnd={() => (setDrag(null), setOver(null))}
              />
              <div className="tl-card">
                <div className="tl-top">
                  <TextInput className="tl-when" value={e.when} placeholder="מתי?" aria-label="מתי" autoFocus={fresh === e.id} onDone={(when) => patch(e.id, { when })} />
                  <TextInput className="tl-title" value={e.title} placeholder="מה קורה" aria-label="מה קורה" onDone={(title) => patch(e.id, { title })} />
                  <span className="tl-btns">
                    <button className="ib icon" title="מוקדם יותר" aria-label="מוקדם יותר" disabled={i === 0} onClick={() => void save(moveEvent(list, i, i - 1))}>
                      <Icon name="up" />
                    </button>
                    <button className="ib icon" title="מאוחר יותר" aria-label="מאוחר יותר" disabled={i === list.length - 1} onClick={() => void save(moveEvent(list, i, i + 1))}>
                      <Icon name="down" />
                    </button>
                    <button className="ib icon" title="אירוע חדש אחרי זה" aria-label="אירוע חדש אחרי זה" onClick={() => add(i + 1)}>
                      <Icon name="plus" />
                    </button>
                    <button className="ib icon" title="מחיקת האירוע" aria-label="מחיקת האירוע" onClick={() => void save(list.filter((x) => x.id !== e.id))}>
                      <Icon name="trash" />
                    </button>
                  </span>
                </div>
                <TextInput multiline className="tl-text" value={e.text} placeholder="פרטים (לא חובה)" aria-label="פרטים" onDone={(text) => patch(e.id, { text })} />
                <div className="tl-links">
                  {e.chapterIds.map((id) => (
                    <span key={id} className="chip">
                      <button title={`פתיחת ${chTitle.get(id)}`} onClick={() => onOpenChapter(id)}>
                        <Icon name="file" size={13} /> פרק {num.get(id)}: {chTitle.get(id)}
                      </button>
                      <button className="x" aria-label="הסרת הקישור" onClick={() => patch(e.id, { chapterIds: e.chapterIds.filter((x) => x !== id) })}>
                        ×
                      </button>
                    </span>
                  ))}
                  {e.materialIds.map((id) => {
                    const m = matById.get(id)
                    return m ? (
                      <span key={id} className="chip mat">
                        <button title={`פתיחת הדף של ${m.name}`} onClick={() => bg.openMaterial(id)}>
                          <Icon name={KIND_ICON[m.kind]} size={13} /> {m.name}
                        </button>
                        <button className="x" aria-label="הסרת הקישור" onClick={() => patch(e.id, { materialIds: e.materialIds.filter((x) => x !== id) })}>
                          ×
                        </button>
                      </span>
                    ) : null
                  })}
                  <select
                    className="addlink"
                    aria-label="קישור לפרק או לדף רקע"
                    value=""
                    onChange={(ev) => {
                      const v = ev.target.value
                      if (v.startsWith('c:')) patch(e.id, { chapterIds: [...e.chapterIds, v.slice(2)] })
                      if (v.startsWith('m:')) patch(e.id, { materialIds: [...e.materialIds, v.slice(2)] })
                    }}
                  >
                    <option value="">+ פרק, דמות או מקום</option>
                    <optgroup label="פרקים">
                      {book.chapters
                        .filter((c) => !e.chapterIds.includes(c.id))
                        .map((c, k) => (
                          <option key={c.id} value={`c:${c.id}`}>
                            {num.get(c.id) ?? k + 1}. {c.title}
                          </option>
                        ))}
                    </optgroup>
                    {book.materials.some((m) => m.kind !== 'research') && (
                      <optgroup label="דמויות ומקומות">
                        {book.materials
                          .filter((m) => m.kind !== 'research' && !e.materialIds.includes(m.id))
                          .map((m) => (
                            <option key={m.id} value={`m:${m.id}`}>
                              {m.name} ({KIND_ONE[m.kind]})
                            </option>
                          ))}
                      </optgroup>
                    )}
                  </select>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Inspiration board (feature 37)
// ---------------------------------------------------------------------------

type Filter = 'all' | 'general' | 'chapters' | 'character' | 'place' | 'research'

export function Inspiration({ bar, onOpenChapter }: { bar: ReactNode; onOpenChapter: (id: string) => void }) {
  const bg = useBg()
  const { book } = bg
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<InspirationImage | null>(null)
  const [over, setOver] = useState(false)
  const matById = new Map(book.materials.map((m) => [m.id, m]))
  const num = new Map(book.chapters.map((c, i) => [c.id, i + 1]))
  const chTitle = new Map(book.chapters.map((c) => [c.id, c.title]))
  const kindOf = (im: InspirationImage): Exclude<Filter, 'all'> => (im.chapterId ? 'chapters' : im.materialId ? (matById.get(im.materialId)?.kind ?? 'general') : 'general')
  const shown = book.images.filter((im) => filter === 'all' || kindOf(im) === filter)
  const count = (f: Filter) => (f === 'all' ? book.images.length : book.images.filter((im) => kindOf(im) === f).length)

  const add = async (paths?: string[]) => {
    const r = await api.addImages(book.path, {}, paths)
    if (!r.ok) return bg.show(r.error ?? 'לא הצלחתי להוסיף', true)
    if (r.value) {
      bg.onBook(r.value.book)
      setFilter((f) => (f === 'all' || f === 'general' ? f : 'all'))
    }
  }

  const filters: [Filter, string][] = [
    ['all', 'הכול'],
    ['general', 'כללי'],
    ['chapters', 'פרקים'],
    ['character', 'דמויות'],
    ['place', 'מקומות'],
    ['research', 'מחקר']
  ]

  return (
    <section
      className={`board plan${over ? ' dropping' : ''}`}
      aria-label="לוח השראה"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
      onDrop={(e) => {
        setOver(false)
        const paths = droppedImagePaths(e.dataTransfer)
        if (!paths.length) return
        e.preventDefault()
        void add(paths)
      }}
    >
      <div className="bbar">
        {bar}
        <div className="fchips" role="group" aria-label="סינון">
          {filters.map(([f, label]) =>
            count(f) || f === 'all' ? (
              <button key={f} className="fchip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {label} <span className="cnt">{count(f)}</span>
              </button>
            ) : null
          )}
        </div>
        <span className="grow" />
        <button className="btn" onClick={() => void add()}>
          <Icon name="plus" size={16} /> תמונות
        </button>
      </div>
      {!book.images.length ? (
        <div className="plan-empty">
          <Icon name="image" size={32} />
          <p>לוח ההשראה אוסף תמונות לספר: איך הדמויות נראות, המקומות, האווירה של כל פרק.</p>
          <p>אפשר לגרור לכאן תמונות מהמחשב, או להוסיף בכפתור. כל תמונה אפשר לשייך לפרק (היא תופיע על הכרטיס שלו) או לדף רקע.</p>
          <button className="btn" onClick={() => void add()}>
            <Icon name="plus" size={16} /> הוספת תמונות
          </button>
        </div>
      ) : (
        <div className="mood">
          {shown.map((im) => {
            const m = im.materialId ? matById.get(im.materialId) : undefined
            return (
              <Thumb key={im.id} image={im} onOpen={() => setOpen(im)}>
                <figcaption>
                  {im.caption && <span dir="auto">{im.caption}</span>}
                  {im.chapterId && (
                    <button className="chip" onClick={() => onOpenChapter(im.chapterId!)}>
                      <Icon name="file" size={12} /> פרק {num.get(im.chapterId)}: {chTitle.get(im.chapterId)}
                    </button>
                  )}
                  {m && (
                    <button className="chip mat" onClick={() => bg.openMaterial(m.id)}>
                      <Icon name={KIND_ICON[m.kind]} size={12} /> {m.name}
                    </button>
                  )}
                </figcaption>
              </Thumb>
            )
          })}
        </div>
      )}
      {over && <div className="pdrop">שחררו כאן כדי להוסיף את התמונות ללוח</div>}
      {open && <Lightbox image={open} onClose={() => setOpen(null)} />}
    </section>
  )
}
