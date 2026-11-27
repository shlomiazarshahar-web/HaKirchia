// The planning tab (was "לוח שעם"): next to the chapter cards, the story timeline (feature 21) and
// the inspiration board (feature 37).

import { useCallback, useEffect, useRef, useState, type ReactNode, type PointerEvent as RPointerEvent } from 'react'
import { chaptersInStoryOrder, GROUP_COLORS, groupAt, groupBoxes, groupDepth, groupTree, KIND_ICON, KIND_ONE, moveEvent, placeNew, ungroup, type Box, type GroupColor, type InspirationGroup, type InspirationImage, type TimelineEvent } from '@shared/background'
import { api } from '../api'
import { droppedImagePaths, useImageUrl } from '../background'
import { useBg } from './bgctx'
import { Lightbox, TextInput } from './Background'
import { Icon } from './Icons'

export type PlanMode = 'cards' | 'timeline' | 'inspiration'

/** Switches between the three ways to look at the plan of the book */
export function PlanSwitch({ mode, onMode, onBeside }: { mode: PlanMode; onMode: (m: PlanMode) => void; onBeside?: () => void }) {
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
      {onBeside && mode !== 'inspiration' && (
        <button className="seg-beside" title="התצוגה הזאת בחלון צר ליד הכתיבה (תכנון בצד)" onClick={onBeside}>
          <Icon name="cards" size={15} />
          ליד הכתיבה
        </button>
      )}
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
// Inspiration board (feature 37): a free canvas, like a pin board. Images can be moved, resized and
// gathered in named groups; the view pans and zooms. Ctrl+I adds images, Ctrl+V pastes one.
// ---------------------------------------------------------------------------

type Filter = 'all' | 'general' | 'chapters' | 'character' | 'place' | 'research'
type View = { x: number; y: number; z: number }
type Drag =
  | { kind: 'pan'; sx: number; sy: number; v: View }
  | { kind: 'img'; id: string; sx: number; sy: number; x: number; y: number; frozen: Map<string, Box> }
  | { kind: 'size'; id: string; sx: number; w: number }
  | { kind: 'group'; id: string; sx: number; sy: number; tree: Set<string>; imgs: Map<string, { x: number; y: number }>; gs: Map<string, { x: number; y: number }>; frozen: Map<string, Box> }
  | { kind: 'gsize'; id: string; sx: number; sy: number; g: InspirationGroup }

const COLOR_LABEL: Record<GroupColor, string> = { amber: 'חום-זהב', green: 'ירוק', blue: 'כחול', purple: 'סגול', red: 'אדום', gray: 'אפור' }
/** How long a dragged image or group rests over a group before it joins it */
const JOIN_MS = 450

const VIEW_KEY = (path: string) => `hakirchia.canvas.${path}`
const DEFAULT_W = 220

export function Inspiration({ bar, onOpenChapter }: { bar: ReactNode; onOpenChapter: (id: string) => void }) {
  const bg = useBg()
  const { book } = bg
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<InspirationImage | null>(null)
  const [over, setOver] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const [imgs, setImgs] = useState<InspirationImage[]>(book.images)
  const [groups, setGroups] = useState<InspirationGroup[]>(book.groups)
  const [aspect, setAspect] = useState<Record<string, number>>({})
  const [view, setView] = useState<View>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(VIEW_KEY(book.path)) ?? 'null')
      if (v && typeof v.z === 'number') return v
    } catch {
      /* default view */
    }
    return { x: 40, y: 30, z: 1 }
  })
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const [dragging, setDragging] = useState(false)
  /** The group a dragged item is resting over (it joins after a moment) */
  const [hoverG, setHoverG] = useState<string | null>(null)
  const [palette, setPalette] = useState<string | null>(null)
  const hoverTimer = useRef<{ target: string; timer: ReturnType<typeof setTimeout> } | null>(null)
  const state = useRef({ imgs, groups, view })
  state.current = { imgs, groups, view }

  // the book changed (saved, an image linked in the big view…): take it, unless a drag is on
  const sig = JSON.stringify([book.images, book.groups])
  useEffect(() => {
    if (drag.current) return
    setImgs(book.images)
    setGroups(book.groups)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY(book.path), JSON.stringify(view))
    } catch {
      /* not remembered */
    }
  }, [view, book.path])

  const save = useCallback(
    async (list: InspirationImage[], gs: InspirationGroup[]) => {
      const r = await api.setImages(book.path, list, gs)
      if (!r.ok || !r.value) return bg.show(r.error ?? 'השמירה נכשלה', true)
      bg.onBook(r.value.book)
    },
    [book.path, bg]
  )

  const ratio = (file: string) => aspect[file] ?? 0.75
  const sizeOf = (im: InspirationImage) => {
    const w = im.w ?? DEFAULT_W
    return { w, h: w * ratio(im.file) + (im.caption || im.chapterId || im.materialId ? 26 : 0) }
  }
  const boxes = groupBoxes(imgs, groups, sizeOf)
  /** Saves, with each group's box as it is now (an emptied group stays where it was) */
  const saveNow = (list: InspirationImage[], gs: InspirationGroup[]) => {
    const b = groupBoxes(list, gs, sizeOf)
    const next = gs.map((g) => ({ ...g, ...b.get(g.id) }))
    setGroups(next)
    return save(list, next)
  }
  // images that have no place yet get one, in rows under the others
  useEffect(() => {
    if (!imgs.some((i) => i.x === undefined)) return
    const next = placeNew(imgs, ratio, DEFAULT_W)
    setImgs(next)
    void save(next, groups)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgs])

  const matById = new Map(book.materials.map((m) => [m.id, m]))
  const num = new Map(book.chapters.map((c, i) => [c.id, i + 1]))
  const chTitle = new Map(book.chapters.map((c) => [c.id, c.title]))
  const kindOf = (im: InspirationImage): Exclude<Filter, 'all'> => (im.chapterId ? 'chapters' : im.materialId ? (matById.get(im.materialId)?.kind ?? 'general') : 'general')
  const count = (f: Filter) => (f === 'all' ? imgs.length : imgs.filter((im) => kindOf(im) === f).length)

  /** Screen point → canvas point */
  const toCanvas = (cx: number, cy: number) => {
    const r = root.current!.getBoundingClientRect()
    const v = state.current.view
    return { x: (cx - r.left - v.x) / v.z, y: (cy - r.top - v.y) / v.z }
  }
  const centre = () => {
    const r = root.current?.getBoundingClientRect()
    return r ? toCanvas(r.left + r.width / 2, r.top + r.height / 2) : { x: 0, y: 0 }
  }

  /** New images go where they were dropped, or in the middle of what is on screen */
  const placeAt = (added: InspirationImage[], at: { x: number; y: number }, list: InspirationImage[]) => {
    const ids = new Set(added.map((a) => a.id))
    let k = 0
    return list.map((i) => (ids.has(i.id) ? { ...i, x: at.x - DEFAULT_W / 2 + 30 * k, y: at.y - 80 + 30 * k++, w: DEFAULT_W } : i))
  }
  const add = async (paths?: string[], at?: { x: number; y: number }) => {
    const r = await api.addImages(book.path, {}, paths)
    if (!r.ok) return bg.show(r.error ?? 'לא הצלחתי להוסיף', true)
    if (!r.value) return
    const list = placeAt(r.value.value, at ?? centre(), r.value.book.images)
    setImgs(list)
    await save(list, groups)
    setFilter('all')
  }
  const addRef = useRef(add)
  addRef.current = add

  // Ctrl+I adds images, Ctrl+V pastes an image, Delete removes the one selected
  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('input, textarea, select, [contenteditable="true"]')
    const key = (e: KeyboardEvent) => {
      if (document.querySelector('.scrim')) return
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'KeyI') {
        e.preventDefault()
        void addRef.current()
      } else if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'KeyG') {
        e.preventDefault()
        addGroupRef.current()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selRef.current && !typing(e.target)) {
        e.preventDefault()
        removeRef.current(selRef.current)
      }
    }
    const paste = async (e: ClipboardEvent) => {
      if (typing(e.target) || document.querySelector('.scrim')) return
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'))
      if (!item) return
      e.preventDefault()
      const file = item.getAsFile()
      if (!file) return
      const bytes = new Uint8Array(await file.arrayBuffer())
      const c = centreRef.current()
      const r = await api.addImageData(book.path, bytes, item.type.split('/')[1] ?? 'png', {}, { x: c.x - DEFAULT_W / 2, y: c.y - 80 })
      if (!r.ok || !r.value) return bg.show(r.error ?? 'לא הצלחתי להדביק', true)
      const list = r.value.book.images.map((i) => (i.id === r.value!.value.id ? { ...i, w: DEFAULT_W } : i))
      setImgs(list)
      void save(list, state.current.groups)
      bg.show('התמונה הודבקה ללוח')
    }
    window.addEventListener('keydown', key)
    window.addEventListener('paste', paste)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('paste', paste)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.path])
  const selRef = useRef(sel)
  selRef.current = sel
  const centreRef = useRef(centre)
  centreRef.current = centre
  const remove = (id: string) => {
    const im = state.current.imgs.find((i) => i.id === id)
    const list = state.current.imgs.filter((i) => i.id !== id)
    setImgs(list)
    setSel(null)
    void saveNow(list, state.current.groups)
    if (im) bg.show('התמונה הוסרה מהלוח. הקובץ עבר לסל המחזור')
  }
  const removeRef = useRef(remove)
  removeRef.current = remove

  // ---- dragging: pan, move, resize ----
  const begin = (e: RPointerEvent, d: Drag) => {
    if (e.button !== 0 && !(e.button === 1 && d.kind === 'pan')) return
    e.preventDefault()
    e.stopPropagation()
    drag.current = d
    setDragging(true)
  }
  /** Membership while dragging: out of the group's frame → out of the group; resting over another group → into it */
  const regroup = (p: { x: number; y: number }, frozen: Map<string, Box>, cur: string | undefined, skip: Set<string>, setTo: (g: string | undefined) => void) => {
    const gs = state.current.groups
    const byId = new Map(gs.map((g) => [g.id, g]))
    const inside = (id: string) => {
      const b = frozen.get(id)
      return !!b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h
    }
    let now = cur
    if (now && !inside(now)) {
      // left its group: it belongs to the closest group around that still holds the pointer
      let up = byId.get(now)?.parentId
      while (up && !inside(up)) up = byId.get(up)?.parentId
      now = up
      setTo(now)
    }
    const target = groupAt(gs, frozen, p, skip)
    const deeper = target && target !== now && (!now || groupDepth(gs, target) > groupDepth(gs, now) || !groupTree(gs, now).has(target))
    if (!deeper) {
      if (hoverTimer.current) clearTimeout(hoverTimer.current.timer)
      hoverTimer.current = null
      setHoverG(null)
      return
    }
    if (hoverTimer.current?.target === target) return
    if (hoverTimer.current) clearTimeout(hoverTimer.current.timer)
    setHoverG(target)
    hoverTimer.current = {
      target,
      timer: setTimeout(() => {
        hoverTimer.current = null
        setHoverG(null)
        setTo(target)
      }, JOIN_MS)
    }
  }

  useEffect(() => {
    if (!dragging) return
    const move = (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const z = state.current.view.z
      if (d.kind === 'pan') return setView({ ...d.v, x: d.v.x + e.clientX - d.sx, y: d.v.y + e.clientY - d.sy })
      const dx = (e.clientX - d.sx) / z
      const dy = d.kind === 'size' ? 0 : (e.clientY - d.sy) / z
      if (d.kind === 'img') {
        setImgs((l) => l.map((i) => (i.id === d.id ? { ...i, x: d.x + dx, y: d.y + dy } : i)))
        const cur = state.current.imgs.find((i) => i.id === d.id)?.groupId
        return regroup(toCanvas(e.clientX, e.clientY), d.frozen, cur, new Set(), (g) =>
          setImgs((l) => l.map((i) => (i.id === d.id ? (g ? { ...i, groupId: g } : { ...i, groupId: undefined }) : i)))
        )
      }
      if (d.kind === 'size') return setImgs((l) => l.map((i) => (i.id === d.id ? { ...i, w: Math.max(50, d.w + dx) } : i)))
      if (d.kind === 'group') {
        setGroups((gs) => gs.map((g) => (d.gs.has(g.id) ? { ...g, x: d.gs.get(g.id)!.x + dx, y: d.gs.get(g.id)!.y + dy } : g)))
        setImgs((l) => l.map((i) => (d.imgs.has(i.id) ? { ...i, x: d.imgs.get(i.id)!.x + dx, y: d.imgs.get(i.id)!.y + dy } : i)))
        const cur = state.current.groups.find((g) => g.id === d.id)?.parentId
        return regroup(toCanvas(e.clientX, e.clientY), d.frozen, cur, d.tree, (p) =>
          setGroups((gs) => gs.map((g) => (g.id === d.id ? (p ? { ...g, parentId: p } : { ...g, parentId: undefined }) : g)))
        )
      }
      setGroups((gs) => gs.map((g) => (g.id === d.id ? { ...g, w: Math.max(120, d.g.w + dx), h: Math.max(80, d.g.h + dy) } : g)))
    }
    const up = () => {
      const d = drag.current
      drag.current = null
      setDragging(false)
      if (hoverTimer.current) clearTimeout(hoverTimer.current.timer)
      hoverTimer.current = null
      setHoverG(null)
      // let the last membership change land before saving
      if (d && d.kind !== 'pan') setTimeout(() => void saveNow(state.current.imgs, state.current.groups), 0)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, save])

  const wheel = (e: React.WheelEvent) => {
    const r = root.current!.getBoundingClientRect()
    const cx = e.clientX - r.left
    const cy = e.clientY - r.top
    setView((v) => {
      const z = Math.min(4, Math.max(0.08, v.z * Math.exp(-e.deltaY * 0.0015)))
      return { z, x: cx - (cx - v.x) * (z / v.z), y: cy - (cy - v.y) * (z / v.z) }
    })
  }
  const zoomBy = (f: number) => {
    const r = root.current!.getBoundingClientRect()
    setView((v) => {
      const z = Math.min(4, Math.max(0.08, v.z * f))
      return { z, x: r.width / 2 - (r.width / 2 - v.x) * (z / v.z), y: r.height / 2 - (r.height / 2 - v.y) * (z / v.z) }
    })
  }
  /** Shows everything on the board */
  const fit = () => {
    const r = root.current?.getBoundingClientRect()
    const boxes = [
      ...imgs.filter((i) => i.x !== undefined).map((i) => ({ x: i.x!, y: i.y!, w: i.w ?? DEFAULT_W, h: (i.w ?? DEFAULT_W) * ratio(i.file) })),
      ...groups
    ]
    if (!r || !boxes.length) return setView({ x: 40, y: 30, z: 1 })
    const x0 = Math.min(...boxes.map((b) => b.x))
    const y0 = Math.min(...boxes.map((b) => b.y))
    const x1 = Math.max(...boxes.map((b) => b.x + b.w))
    const y1 = Math.max(...boxes.map((b) => b.y + b.h))
    const z = Math.min(2, Math.max(0.08, Math.min((r.width - 60) / (x1 - x0 || 1), (r.height - 60) / (y1 - y0 || 1))))
    setView({ z, x: (r.width - (x1 - x0) * z) / 2 - x0 * z, y: (r.height - (y1 - y0) * z) / 2 - y0 * z })
  }

  /** A new group: around the selected image, or empty in the middle of the screen (Ctrl+G) */
  const addGroup = () => {
    const { imgs: list, groups: gs0 } = state.current
    const im = list.find((i) => i.id === selRef.current && i.x !== undefined)
    const c = centreRef.current()
    const id = crypto.randomUUID()
    const g: InspirationGroup = im
      ? { id, title: 'קבוצה חדשה', x: im.x!, y: im.y!, w: 200, h: 160, ...(im.groupId ? { parentId: im.groupId } : {}) }
      : { id, title: 'קבוצה חדשה', x: c.x - 220 + 30 * (gs0.length % 6), y: c.y - 160 + 30 * (gs0.length % 6), w: 440, h: 320 }
    const nextImgs = im ? list.map((i) => (i.id === im.id ? { ...i, groupId: id } : i)) : list
    setImgs(nextImgs)
    void saveNow(nextImgs, [...gs0, g])
    setFreshGroup(id)
  }
  const addGroupRef = useRef(addGroup)
  addGroupRef.current = addGroup
  const [freshGroup, setFreshGroup] = useState<string | null>(null)
  const removeGroup = (id: string) => {
    const r = ungroup(imgs, groups, id)
    setImgs(r.images)
    void saveNow(r.images, r.groups)
  }
  const setColor = (id: string, color: GroupColor) => {
    setPalette(null)
    void saveNow(imgs, groups.map((x) => (x.id === id ? { ...x, color } : x)))
  }
  const startGroupDrag = (e: RPointerEvent, g: InspirationGroup) => {
    const tree = groupTree(groups, g.id)
    begin(e, {
      kind: 'group',
      id: g.id,
      sx: e.clientX,
      sy: e.clientY,
      tree,
      imgs: new Map(imgs.filter((i) => i.groupId && tree.has(i.groupId) && i.x !== undefined).map((i) => [i.id, { x: i.x!, y: i.y! }])),
      gs: new Map(groups.filter((x) => tree.has(x.id)).map((x) => [x.id, { x: boxes.get(x.id)?.x ?? x.x, y: boxes.get(x.id)?.y ?? x.y }])),
      frozen: groupBoxes(imgs, groups, sizeOf, { group: g.id })
    })
  }
  const memberCount = (id: string) => imgs.filter((i) => i.groupId === id).length + groups.filter((x) => x.parentId === id).length

  const filters: [Filter, string][] = [
    ['all', 'הכול'],
    ['general', 'כללי'],
    ['chapters', 'פרקים'],
    ['character', 'דמויות'],
    ['place', 'מקומות'],
    ['research', 'מחקר']
  ]

  return (
    <section className={`board plan canvas-board${over ? ' dropping' : ''}`} aria-label="לוח השראה">
      <div className="bbar">
        {bar}
        <div className="fchips" role="group" aria-label="הדגשה">
          {filters.map(([f, label]) =>
            count(f) || f === 'all' ? (
              <button key={f} className="fchip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {label} <span className="cnt">{count(f)}</span>
              </button>
            ) : null
          )}
        </div>
        <span className="grow" />
        <button className="ib" title="קבוצה חדשה (Ctrl+G). אם תמונה בחורה, הקבוצה נפתחת סביבה. גוררים תמונה ומשהים מעל קבוצה כדי להכניס אותה" onClick={addGroup}>
          <Icon name="part-plus" /> קבוצה <kbd>Ctrl+G</kbd>
        </button>
        <button className="btn" title="הוספת תמונות (Ctrl+I). אפשר גם להדביק תמונה (Ctrl+V) או לגרור מהמחשב" onClick={() => void add()}>
          <Icon name="plus" size={16} /> תמונות <kbd>Ctrl+I</kbd>
        </button>
      </div>
      <div
        ref={root}
        className={`canvas${dragging && drag.current?.kind === 'pan' ? ' panning' : ''}`}
        onPointerDown={(e) => {
          setSel(null)
          begin(e, { kind: 'pan', sx: e.clientX, sy: e.clientY, v: view })
        }}
        onWheel={wheel}
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
          void add(paths, toCanvas(e.clientX, e.clientY))
        }}
      >
        <div className="plane" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
          {[...groups]
            .sort((a, b) => groupDepth(groups, a.id) - groupDepth(groups, b.id))
            .map((g) => {
              const b = boxes.get(g.id) ?? g
              const empty = memberCount(g.id) === 0
              return (
                <div key={g.id} className={`cgroup${hoverG === g.id ? ' joining' : ''}`} data-color={g.color ?? 'amber'} style={{ left: b.x, top: b.y, width: b.w, height: b.h }}>
                  <div className="cg-head" title="גרירה מזיזה את הקבוצה עם מה שבתוכה. השהיה מעל קבוצה אחרת מכניסה לתוכה" onPointerDown={(e) => startGroupDrag(e, g)}>
                    <span onPointerDown={(e) => e.stopPropagation()}>
                      <TextInput
                        value={g.title}
                        aria-label="שם הקבוצה"
                        autoFocus={freshGroup === g.id}
                        onDone={(title) => {
                          setFreshGroup(null)
                          void saveNow(imgs, groups.map((x) => (x.id === g.id ? { ...x, title } : x)))
                        }}
                      />
                    </span>
                    <span className="grow" />
                    <button className="cg-dot" title="צבע הקבוצה" aria-label="צבע הקבוצה" aria-expanded={palette === g.id} onPointerDown={(e) => e.stopPropagation()} onClick={() => setPalette(palette === g.id ? null : g.id)} />
                    <button className="ib icon" title="הסרת הקבוצה (מה שבתוכה נשאר)" aria-label="הסרת הקבוצה" onPointerDown={(e) => e.stopPropagation()} onClick={() => removeGroup(g.id)}>
                      <Icon name="close" />
                    </button>
                    {palette === g.id && (
                      <div className="cg-palette" role="menu" onPointerDown={(e) => e.stopPropagation()}>
                        {GROUP_COLORS.map((c) => (
                          <button key={c} role="menuitemradio" aria-checked={(g.color ?? 'amber') === c} data-color={c} title={COLOR_LABEL[c]} aria-label={COLOR_LABEL[c]} onClick={() => setColor(g.id, c)} />
                        ))}
                      </div>
                    )}
                  </div>
                  {empty && <span className="cg-size" title="שינוי גודל" onPointerDown={(e) => begin(e, { kind: 'gsize', id: g.id, sx: e.clientX, sy: e.clientY, g })} />}
                </div>
              )
            })}
          {imgs.map((im) =>
            im.x === undefined ? null : (
              <CanvasImage
                key={im.id}
                image={im}
                selected={sel === im.id}
                dim={filter !== 'all' && kindOf(im) !== filter}
                label={
                  im.chapterId
                    ? { text: `פרק ${num.get(im.chapterId)}: ${chTitle.get(im.chapterId)}`, icon: 'file', go: () => onOpenChapter(im.chapterId!) }
                    : im.materialId && matById.get(im.materialId)
                      ? { text: matById.get(im.materialId)!.name, icon: KIND_ICON[matById.get(im.materialId)!.kind], go: () => bg.openMaterial(im.materialId!) }
                      : null
                }
                onAspect={(a) => setAspect((m) => (m[im.file] === a ? m : { ...m, [im.file]: a }))}
                onDown={(e) => {
                  setSel(im.id)
                  // the one picked comes to the front
                  setImgs((l) => (l[l.length - 1]?.id === im.id ? l : [...l.filter((x) => x.id !== im.id), im]))
                  begin(e, { kind: 'img', id: im.id, sx: e.clientX, sy: e.clientY, x: im.x!, y: im.y!, frozen: groupBoxes(imgs, groups, sizeOf, { image: im.id }) })
                }}
                onSize={(e) => begin(e, { kind: 'size', id: im.id, sx: e.clientX, w: im.w ?? DEFAULT_W })}
                onOpen={() => setOpen(im)}
              />
            )
          )}
        </div>
        {!imgs.length && !groups.length && (
          <div className="plan-empty canvas-empty" onPointerDown={(e) => e.stopPropagation()}>
            <Icon name="image" size={32} />
            <p>לוח ההשראה הוא משטח חופשי: גוררים לכאן תמונות מהמחשב, מדביקים (Ctrl+V) או מוסיפים (Ctrl+I), ומסדרים אותן איך שרוצים. אפשר לאסוף תמונות לקבוצות עם שם.</p>
            <p>גלגלת מקרבת ומרחיקה, גרירה על רקע ריק מזיזה את הלוח. לחיצה כפולה על תמונה פותחת אותה, ושם אפשר לשייך אותה לפרק (היא תופיע על הכרטיס שלו) או לדף רקע.</p>
            <button className="btn" onClick={() => void add()}>
              <Icon name="plus" size={16} /> הוספת תמונות
            </button>
          </div>
        )}
        <div className="czoom" onPointerDown={(e) => e.stopPropagation()}>
          <button className="ib icon" title="הרחקה" aria-label="הרחקה" onClick={() => zoomBy(1 / 1.25)}>
            <Icon name="minus" />
          </button>
          <button className="ib" title="חזרה ל-100%" onClick={() => zoomBy(1 / view.z)}>
            {Math.round(view.z * 100)}%
          </button>
          <button className="ib icon" title="קירוב" aria-label="קירוב" onClick={() => zoomBy(1.25)}>
            <Icon name="plus" />
          </button>
          <button className="ib" title="להציג את כל הלוח" onClick={fit}>
            הכול
          </button>
        </div>
        {over && <div className="pdrop">שחררו כאן כדי להוסיף את התמונות ללוח</div>}
      </div>
      {open && <Lightbox image={open} onClose={() => setOpen(null)} />}
    </section>
  )
}

function CanvasImage(props: {
  image: InspirationImage
  selected: boolean
  dim: boolean
  label: { text: string; icon: string; go: () => void } | null
  onAspect: (a: number) => void
  onDown: (e: RPointerEvent) => void
  onSize: (e: RPointerEvent) => void
  onOpen: () => void
}) {
  const { book } = useBg()
  const { image: im } = props
  const url = useImageUrl(book.path, im.file)
  return (
    <figure
      className={`cimg${props.selected ? ' sel' : ''}${props.dim ? ' dim' : ''}`}
      style={{ left: im.x, top: im.y, width: im.w ?? DEFAULT_W }}
      title={im.caption || 'לחיצה כפולה: פתיחה, כיתוב ושיוך'}
      onPointerDown={props.onDown}
      onDoubleClick={props.onOpen}
    >
      {url ? (
        <img
          src={url}
          alt={im.caption}
          draggable={false}
          onLoad={(e) => {
            const t = e.currentTarget
            if (t.naturalWidth) props.onAspect(t.naturalHeight / t.naturalWidth)
          }}
        />
      ) : (
        <div className="cimg-wait" />
      )}
      {(im.caption || props.label) && (
        <figcaption>
          {im.caption && <span dir="auto">{im.caption}</span>}
          {props.label && (
            <button className="chip" onPointerDown={(e) => e.stopPropagation()} onClick={props.label.go}>
              <Icon name={props.label.icon} size={12} /> {props.label.text}
            </button>
          )}
        </figcaption>
      )}
      {props.selected && <span className="cimg-size" title="שינוי גודל" onPointerDown={(e) => (e.stopPropagation(), props.onSize(e))} />}
    </figure>
  )
}
