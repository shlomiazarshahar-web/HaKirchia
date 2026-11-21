// Background materials (round 7): a background page in a pane (feature 11), where a name appears
// (feature 34) and images on pages and chapters (feature 37).

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Editor } from '@tiptap/react'
import type { PMNode } from '@shared/types'
import { KIND_ICON, KIND_LABEL, KIND_ONE, namesOf, occurrences, splitList, type InspirationImage, type Material, type MaterialField } from '@shared/background'
import { api } from '../api'
import { droppedImagePaths, jumpFor, useBookTexts, useImageUrl } from '../background'
import { ChapterBody, type SaveState } from './ChapterEditor'
import { useBg } from './bgctx'
import { Icon } from './Icons'

// ---------------------------------------------------------------------------
// A background page
// ---------------------------------------------------------------------------

interface PageProps {
  material: Material
  onEditor: (e: Editor | null) => void
  onRelease: (e: Editor) => void
  onWords: (n: number) => void
  onSaveState: (s: SaveState) => void
  onError: (msg: string) => void
}

export function MaterialPane({ material: m, ...props }: PageProps) {
  const bg = useBg()
  const { book } = bg
  const [loaded, setLoaded] = useState<{ doc: PMNode; warnings: string[] } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api.loadMaterial(book.path, m.id).then((r) => {
      if (!alive) return
      if (r.ok && r.value) setLoaded(r.value)
      else setLoadError(r.error ?? 'שגיאה בפתיחת הדף')
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.path, m.id])

  const update = async (patch: Partial<Material>) => {
    const r = await api.updateMaterial(book.path, m.id, patch)
    if (!r.ok || !r.value) return bg.show(r.error ?? 'השמירה נכשלה', true)
    bg.onBook(r.value.book)
    if (r.value.value) bg.show(r.value.value, true)
  }

  const attach = async (paths?: string[]) => {
    const r = await api.attachFiles(book.path, m.id, paths)
    if (!r.ok) return bg.show(r.error ?? 'לא הצלחתי לצרף', true)
    if (r.value) bg.onBook(r.value.book)
  }

  return (
    <main className="desk">
      <article className="paper sheet">
        <div className="docfile">
          <Icon name={KIND_ICON[m.kind]} />
          <span className="fname">
            חומרי רקע / {KIND_LABEL[m.kind]}
          </span>
          <span className="grow" />
          <button className="ib icon" title="הצגת קובץ ה-Word של הדף בתיקייה" aria-label="הצגה בתיקייה" onClick={() => void api.showMaterialFile(book.path, m.id)}>
            <Icon name="folder" />
          </button>
          <button className="ib icon" title="מחיקת הדף" aria-label="מחיקת הדף" onClick={() => bg.deleteMaterial(m.id)}>
            <Icon name="trash" />
          </button>
        </div>
        <NameInput key={m.id} value={m.name} label={`שם ה${KIND_ONE[m.kind]}`} autoFocus={bg.freshMaterial === m.id} onDone={(name) => void update({ name })} />
        <ChipsEditor items={m.tags} placeholder="+ תווית (למשל דמות ראשית)" label="תוויות" onChange={(tags) => void update({ tags })} />

        <ImageStrip link={{ materialId: m.id }} empty={m.kind === 'research' ? 'תמונות, מפות ומסמכים סרוקים' : m.kind === 'place' ? 'תמונות של המקום' : 'איך היא נראית'} />

        <FieldsEditor key={`f-${m.id}`} fields={m.fields} onChange={(fields) => void update({ fields })} />

        {m.kind !== 'research' && (
          <div className="mnames">
            <label>
              <span>שמות נוספים בטקסט</span>
              <ListInput value={m.aliases} placeholder="כינוי, שם משפחה… (פסיק בין שמות)" onDone={(aliases) => void update({ aliases })} />
            </label>
            <label>
              <span>השם במקור</span>
              <TextInput value={m.original ?? ''} dir="auto" placeholder="לספרים בתרגום (לא חובה)" onDone={(original) => void update({ original })} />
            </label>
          </div>
        )}

        {m.kind === 'research' && (
          <section className="msec">
            <h4>
              קבצים מצורפים
              <button className="ib" onClick={() => void attach()}>
                <Icon name="plus" /> צירוף קובץ
              </button>
            </h4>
            {m.attachments.length === 0 ? (
              <div className="bempty">PDF, מסמכים, הקלטות… נפתחים בתוכנה הרגילה של Windows. נשמרים בתיקייה "חומרי רקע/קבצים" של הספר.</div>
            ) : (
              <ul className="attach">
                {m.attachments.map((a) => (
                  <li key={a}>
                    <button className="alink" title="פתיחה" onClick={() => void api.openAttachment(book.path, a).then((r) => r.ok && r.value && bg.show(`לא הצלחתי לפתוח: ${r.value}`, true))}>
                      <Icon name={/\.pdf$/i.test(a) ? 'pdf' : 'file'} />
                      {a}
                    </button>
                    <button
                      className="ib icon"
                      title="הסרה מהדף"
                      aria-label={`הסרת ${a}`}
                      onClick={() => void api.detachFile(book.path, m.id, a).then((r) => (r.ok && r.value ? bg.onBook(r.value.book) : bg.show(r.error ?? '', true)))}
                    >
                      <Icon name="close" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {m.kind !== 'research' && (
          <section className="msec">
            <h4>איפה {m.kind === 'character' ? 'הדמות מופיעה' : 'המקום מופיע'}</h4>
            <OccurrenceList names={namesOf(m)} />
          </section>
        )}

        <section className="msec mtext">
          <h4>הערות</h4>
          {loadError && <div className="paper-state">לא הצלחתי לפתוח את הדף: {loadError}</div>}
          {!loaded && !loadError && <div className="paper-state">פותח…</div>}
          {loaded && (
            <ChapterBody
              bookPath={book.path}
              chapterId={m.id}
              materialId={m.id}
              title={m.name}
              initial={loaded.doc}
              warnings={loaded.warnings}
              autoFocus={false}
              activateOn="focus"
              onEditor={props.onEditor}
              onRelease={props.onRelease}
              onWords={props.onWords}
              onSaveState={props.onSaveState}
              onError={props.onError}
            />
          )}
        </section>
      </article>
    </main>
  )
}

function NameInput({ value, label, autoFocus, onDone }: { value: string; label: string; autoFocus: boolean; onDone: (v: string) => void }) {
  const [v, setV] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => setV(value), [value])
  useEffect(() => {
    if (autoFocus) {
      ref.current?.focus()
      ref.current?.select()
    }
  }, [autoFocus])
  const commit = () => {
    const t = v.trim()
    if (!t) setV(value)
    else if (t !== value) onDone(t)
  }
  return (
    <input
      ref={ref}
      className="ch-title"
      value={v}
      aria-label={label}
      placeholder={label}
      dir="auto"
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setV(value)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

/** A text field saved when leaving it (or Enter) */
export function TextInput({ value, onDone, multiline, ...rest }: { value: string; onDone: (v: string) => void; multiline?: boolean; placeholder?: string; dir?: string; className?: string; autoFocus?: boolean; 'aria-label'?: string }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const t = ref.current
    if (!t) return
    t.style.height = 'auto'
    t.style.height = `${t.scrollHeight}px`
  }, [v])
  const commit = () => v !== value && onDone(v)
  if (multiline)
    return (
      <textarea
        ref={ref}
        rows={1}
        dir="auto"
        {...rest}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setV(value)
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (e.target as HTMLTextAreaElement).blur()
        }}
      />
    )
  return (
    <input
      dir="auto"
      {...rest}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setV(value)
      }}
    />
  )
}

/** A comma-separated list in one field */
export function ListInput({ value, onDone, placeholder }: { value: string[]; onDone: (v: string[]) => void; placeholder?: string }) {
  return <TextInput value={value.join(', ')} placeholder={placeholder} onDone={(s) => onDone(splitList(s))} />
}

function ChipsEditor({ items, placeholder, label, onChange }: { items: string[]; placeholder: string; label: string; onChange: (v: string[]) => void }) {
  const [v, setV] = useState('')
  const add = () => {
    const t = v.trim()
    setV('')
    if (t && !items.includes(t)) onChange([...items, t])
  }
  return (
    <div className="tags" role="group" aria-label={label}>
      {items.map((t) => (
        <span key={t} className="tag">
          {t}
          <button aria-label={`הסרת ${t}`} title="הסרה" onClick={() => onChange(items.filter((x) => x !== t))}>
            ×
          </button>
        </span>
      ))}
      <input className="tag-new" value={v} dir="auto" placeholder={placeholder} aria-label={placeholder} onChange={(e) => setV(e.target.value)} onBlur={add} onKeyDown={(e) => e.key === 'Enter' && add()} />
    </div>
  )
}

function FieldsEditor({ fields, onChange }: { fields: MaterialField[]; onChange: (f: MaterialField[]) => void }) {
  const [list, setList] = useState(fields)
  const sig = JSON.stringify(fields)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setList(fields), [sig])
  const commit = (next: MaterialField[]) => {
    setList(next)
    if (JSON.stringify(next) !== sig) onChange(next)
  }
  return (
    <dl className="mfields">
      {list.map((f, i) => (
        <div key={i} className="mfield">
          <dt>
            <TextInput value={f.label} aria-label="שם השדה" placeholder="שדה" onDone={(label) => commit(list.map((x, j) => (j === i ? { ...x, label } : x)))} />
          </dt>
          <dd>
            <TextInput multiline value={f.value} aria-label={f.label || 'ערך'} placeholder="…" onDone={(value) => commit(list.map((x, j) => (j === i ? { ...x, value } : x)))} />
          </dd>
          <button className="ib icon" title="הסרת השדה" aria-label={`הסרת השדה ${f.label}`} onClick={() => commit(list.filter((_, j) => j !== i))}>
            <Icon name="close" />
          </button>
        </div>
      ))}
      <button className="ib addfield" onClick={() => setList([...list, { label: '', value: '' }])}>
        <Icon name="plus" /> שדה
      </button>
    </dl>
  )
}

// ---------------------------------------------------------------------------
// Where a name appears (feature 34)
// ---------------------------------------------------------------------------

/** The chapters where any of the names appears; a click jumps to the first place in that chapter */
export function OccurrenceList({ names, compact = false }: { names: string[]; compact?: boolean }) {
  const bg = useBg()
  const { book } = bg
  const { texts } = useBookTexts(book)
  const key = names.join('|')
  const occ = useMemo(() => (texts ? occurrences(texts.chapters, names) : null), [texts, key]) // eslint-disable-line react-hooks/exhaustive-deps
  const num = new Map(book.chapters.map((c, i) => [c.id, i + 1]))
  const title = new Map(book.chapters.map((c) => [c.id, c.title]))
  if (!names.length) return null
  if (!occ) return <div className="bempty">מחפש בפרקים…</div>
  if (!occ.length) return <div className="bempty">{`"${names[0]}"`} לא מופיע עדיין באף פרק{names.length > 1 ? ' (גם לא בשמות הנוספים)' : ''}.</div>
  const total = occ.reduce((n, o) => n + o.count, 0)
  return (
    <div className={`occ${compact ? ' compact' : ''}`}>
      {!compact && (
        <div className="occ-sum">
          {occ.length === 1 ? 'בפרק אחד' : `ב־${occ.length} פרקים`}, {total === 1 ? 'פעם אחת' : `${total.toLocaleString('he-IL')} פעמים`}
        </div>
      )}
      <ul>
        {occ.map((o) => (
          <li key={o.chapterId}>
            <button title="מעבר למקום הראשון בפרק" onClick={() => texts && bg.goTo(o.chapterId, jumpFor(texts, o.chapterId, o.first))}>
              <span className="occ-n">{num.get(o.chapterId)}</span>
              <span className="occ-t" dir="auto">
                {title.get(o.chapterId)}
              </span>
              <span className="occ-c">{o.count}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Images (feature 37)
// ---------------------------------------------------------------------------

/** Images of one chapter or page, with "add" and dropping images from Explorer */
export function ImageStrip({ link, empty }: { link: { chapterId?: string; materialId?: string }; empty: string }) {
  const bg = useBg()
  const { book } = bg
  const list = book.images.filter((im) => (link.chapterId ? im.chapterId === link.chapterId : im.materialId === link.materialId))
  const [open, setOpen] = useState<InspirationImage | null>(null)
  const [over, setOver] = useState(false)
  const add = async (paths?: string[]) => {
    const r = await api.addImages(book.path, link, paths)
    if (!r.ok) return bg.show(r.error ?? 'לא הצלחתי להוסיף', true)
    if (r.value) bg.onBook(r.value.book)
  }
  return (
    <div
      className={`imstrip${over ? ' over' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false)
        const paths = droppedImagePaths(e.dataTransfer)
        if (!paths.length) return
        e.preventDefault()
        void add(paths)
      }}
    >
      {list.map((im) => (
        <Thumb key={im.id} image={im} onOpen={() => setOpen(im)} />
      ))}
      <button className="imadd" title="הוספת תמונה (אפשר גם לגרור תמונות מהמחשב לכאן)" onClick={() => void add()}>
        <Icon name="image" />
        <span>{list.length ? 'עוד תמונה' : empty}</span>
      </button>
      {open && <Lightbox image={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

export function Thumb({ image, onOpen, children }: { image: InspirationImage; onOpen: () => void; children?: ReactNode }) {
  const { book } = useBg()
  const url = useImageUrl(book.path, image.file)
  return (
    <figure className="thumb">
      <button className="thumb-img" title={image.caption || image.file} onClick={onOpen}>
        {url ? <img src={url} alt={image.caption || ''} draggable={false} /> : <span className="thumb-missing">…</span>}
      </button>
      {children}
    </figure>
  )
}

/** One image, big, with its caption and what it belongs to */
export function Lightbox({ image, onClose }: { image: InspirationImage; onClose: () => void }) {
  const bg = useBg()
  const { book } = bg
  const url = useImageUrl(book.path, image.file)
  const live = book.images.find((i) => i.id === image.id) ?? image
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  const save = async (list: InspirationImage[]) => {
    const r = await api.setImages(book.path, list)
    if (!r.ok || !r.value) return bg.show(r.error ?? 'השמירה נכשלה', true)
    bg.onBook(r.value.book)
  }
  return (
    <div className="scrim lightbox" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="lb-box" role="dialog" aria-label="תמונה">
        {url && <img src={url} alt={live.caption} />}
        <div className="lb-bar">
          <TextInput value={live.caption} placeholder="כיתוב לתמונה" aria-label="כיתוב לתמונה" onDone={(caption) => void save(book.images.map((i) => (i.id === live.id ? { ...i, caption } : i)))} />
          <LinkPicker image={live} onChange={(l) => void save(book.images.map((i) => (i.id === live.id ? { id: i.id, file: i.file, caption: i.caption, at: i.at, ...l } : i)))} />
          <button
            className="ib danger"
            title="הסרת התמונה (הקובץ עובר לסל המחזור)"
            onClick={() => {
              void save(book.images.filter((i) => i.id !== live.id))
              onClose()
            }}
          >
            <Icon name="trash" /> הסרה
          </button>
          <button className="ib" onClick={onClose}>
            סגירה
          </button>
        </div>
      </div>
    </div>
  )
}

/** What an image belongs to: the board in general, a chapter, or a background page */
export function LinkPicker({ image, onChange }: { image: InspirationImage; onChange: (l: { chapterId?: string; materialId?: string }) => void }) {
  const { book } = useBg()
  const value = image.chapterId ? `c:${image.chapterId}` : image.materialId ? `m:${image.materialId}` : ''
  return (
    <select
      className="ppick"
      aria-label="שייכות התמונה"
      title="למה התמונה שייכת"
      value={value}
      onChange={(e) => {
        const v = e.target.value
        onChange(v.startsWith('c:') ? { chapterId: v.slice(2) } : v.startsWith('m:') ? { materialId: v.slice(2) } : {})
      }}
    >
      <option value="">כללי (לוח ההשראה)</option>
      <optgroup label="פרקים">
        {book.chapters.map((c, i) => (
          <option key={c.id} value={`c:${c.id}`}>
            {i + 1}. {c.title}
          </option>
        ))}
      </optgroup>
      {book.materials.length > 0 && (
        <optgroup label="חומרי רקע">
          {book.materials.map((m) => (
            <option key={m.id} value={`m:${m.id}`}>
              {m.name} ({KIND_ONE[m.kind]})
            </option>
          ))}
        </optgroup>
      )}
    </select>
  )
}

/** "על הפרק": the characters and places that appear in this chapter, and its images */
export function InChapter({ chapterId }: { chapterId: string }) {
  const bg = useBg()
  const { book } = bg
  const { texts } = useBookTexts(book, 5000)
  const ch = texts?.chapters.find((c) => c.id === chapterId)
  const here = useMemo(
    () => (ch ? book.materials.filter((m) => m.kind !== 'research').map((m) => ({ m, n: occurrences([ch], namesOf(m))[0]?.count ?? 0 })).filter((x) => x.n > 0) : []),
    [ch, book.materials]
  )
  return (
    <div className="isec">
      <h3>בפרק הזה</h3>
      {book.materials.some((m) => m.kind !== 'research') ? (
        here.length ? (
          <div className="inch">
            {here.map(({ m, n }) => (
              <button key={m.id} className="chip mat" title={`${n} פעמים בפרק · פתיחת הדף`} onClick={() => bg.openMaterial(m.id)}>
                <Icon name={KIND_ICON[m.kind]} size={13} /> {m.name}
              </button>
            ))}
          </div>
        ) : (
          <div className="field">אף דמות או מקום מחומרי הרקע לא מוזכרים בפרק</div>
        )
      ) : (
        <div className="field">דמויות ומקומות מחומרי הרקע יופיעו כאן כשיוזכרו בפרק</div>
      )}
      <ImageStrip link={{ chapterId }} empty="תמונת השראה לפרק" />
    </div>
  )
}
