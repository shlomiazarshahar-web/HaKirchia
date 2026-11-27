// Round 14 "תכנון מראש": the cards and the table, with the idea pile at the side (feature 59) and
// the trial chapter order (feature 61). While a trial order exists, the cards and the table show
// it; the book (binder, master, files) keeps its order until "להחיל על הספר".

import { useMemo, useState, type ReactNode } from 'react'
import type { Book, Chapter, ChapterStatus, OutlineNode, PartNode } from '@shared/types'
import { withOutline, type DropTarget } from '@shared/outline'
import { sameOutline, type Idea, type TableColumn } from '@shared/plan'
import { api } from '../api'
import { CorkBoard } from './CorkBoard'
import { PlanTable } from './PlanTable'
import { IdeasPile } from './IdeasPile'
import { Icon } from './Icons'

type Meta = { status?: ChapterStatus; synopsis?: string; custom?: Record<string, string> }

interface Props {
  mode: 'cards' | 'table'
  modeSwitch: ReactNode
  book: Book
  onBook: (b: Book) => void
  show: (msg: string, error?: boolean) => void
  /** Saves open editors before chapter files are renamed */
  flushAll: () => Promise<void>
  onOpen: (id: string) => void
  onMeta: (id: string, meta: Meta) => void
  onOutline: (outline: OutlineNode[]) => void
  onAdd: (partId?: string) => void
  onContextMenu: (ch: Chapter, x: number, y: number) => void
  onPartMenu: (part: PartNode, x: number, y: number) => void
  onWords: (total: number) => void
  renamingId: string | null
  onRename: (id: string, title: string) => void
  onStartRename: (id: string | null) => void
  /** A new chapter was made from an idea: start renaming it, select it */
  onChapterFromIdea: (id: string) => void
}

export function PlanArea(p: Props) {
  const { book, onBook, show } = p
  const [showReal, setShowReal] = useState(false)
  const [busy, setBusy] = useState(false)
  const trial = book.trialOutline
  const inTrial = !!trial && !showReal
  const trialBook = useMemo(() => (trial ? withOutline(book, trial) : book), [book, trial])
  const shownBook = inTrial ? trialBook : book
  const realNumber = useMemo(() => new Map(book.chapters.map((c, i) => [c.id, i + 1])), [book.chapters])
  const changed = !!trial && !sameOutline(trial, book.outline)

  const savePlan = async (patch: { ideas?: Idea[]; tableColumns?: TableColumn[]; trialOutline?: OutlineNode[] | null }, optimistic: Partial<Book>) => {
    onBook({ ...book, ...optimistic })
    const r = await api.setPlan(book.path, patch)
    if (!r.ok || !r.value) {
      show(r.error ?? 'השמירה נכשלה', true)
      onBook(book)
      return
    }
    onBook(r.value)
  }

  const saveIdeas = (ideas: Idea[]) => void savePlan({ ideas }, { ideas })
  const saveColumns = (tableColumns: TableColumn[]) => void savePlan({ tableColumns }, { tableColumns })
  const saveTrial = (o: OutlineNode[]) => void savePlan({ trialOutline: o }, { trialOutline: o })

  const startTrial = () => {
    setShowReal(false)
    void savePlan({ trialOutline: book.outline }, { trialOutline: book.outline })
    show('סדר ניסיוני: אפשר לגרור בחופשיות. הספר עצמו לא ישתנה עד שתלחצו "להחיל על הספר".')
  }
  const cancelTrial = () => {
    setShowReal(false)
    void savePlan({ trialOutline: null }, { trialOutline: undefined })
    show('הסדר הניסיוני בוטל. הספר נשאר כמו שהיה.')
  }
  const applyTrial = async () => {
    if (busy) return
    setBusy(true)
    try {
      await p.flushAll()
      const r = await api.applyTrialOrder(book.path)
      if (!r.ok || !r.value) return show(r.error ?? 'לא הצלחתי להחיל את הסדר', true)
      onBook(r.value)
      setShowReal(false)
      show(r.notice ?? 'הסדר החדש הוחל על הספר: העץ, המאסטר ומספרי הקבצים עודכנו.', !!r.notice)
    } finally {
      setBusy(false)
    }
  }

  const ideaToChapter = async (id: string, target?: DropTarget) => {
    await p.flushAll()
    const r = await api.ideaToChapter(book.path, id, target)
    if (!r.ok || !r.value) return show(r.error ?? 'לא הצלחתי להפוך את הרעיון לפרק', true)
    onBook(r.value.book)
    if (r.notice) show(r.notice, true)
    else show('הרעיון הפך לפרק. התקציר שלו הוא מה שנכתב ברעיון.')
    p.onChapterFromIdea(r.value.chapterId)
  }

  const trialBar = trial ? (
    <div className={`trialbar${showReal ? ' real' : ''}`} role="group" aria-label="סדר ניסיוני">
      <Icon name="flask" size={15} />
      <span className="tb-t">{showReal ? 'מוצג הסדר של הספר. יש סדר ניסיוני שמור' : changed ? 'סדר ניסיוני · הספר עצמו לא השתנה' : 'סדר ניסיוני · עוד לא הזזתם כלום'}</span>
      <button className="ib" aria-pressed={showReal} title="מעבר בין הסדר הניסיוני לסדר שבספר, להשוואה" onClick={() => setShowReal(!showReal)}>
        {showReal ? 'חזרה לניסיוני' : 'להציג את הסדר בספר'}
      </button>
      <button className="btn" disabled={!changed || busy} title="הסדר הזה יהיה הסדר של הספר: בעץ, במאסטר ובמספרי הקבצים" onClick={() => void applyTrial()}>
        להחיל על הספר
      </button>
      <button className="btn ghost" onClick={cancelTrial}>
        לבטל את הניסיון
      </button>
    </div>
  ) : (
    <button className="fchip trial-start" title="לנסות סדר פרקים אחר בלי לשנות את הספר. אם הוא טוב, מחילים אותו; אם לא, מבטלים" onClick={startTrial}>
      <Icon name="flask" size={14} /> סדר ניסיוני
    </button>
  )

  const trialFrom = inTrial ? realNumber : undefined
  const outlineSave = inTrial ? saveTrial : p.onOutline
  // in the book's own order an idea can be dropped where it goes; during a trial only by the button
  const ideaDrop = inTrial || showReal ? undefined : (id: string, t: DropTarget) => void ideaToChapter(id, t)

  return (
    <div className="plan-wrap">
      {p.mode === 'cards' ? (
        <CorkBoard
          modeSwitch={p.modeSwitch}
          barExtra={trialBar}
          book={shownBook}
          trialFrom={trialFrom}
          onIdeaDrop={ideaDrop}
          onOpen={p.onOpen}
          onMeta={p.onMeta}
          onOutline={outlineSave}
          onAdd={p.onAdd}
          onContextMenu={p.onContextMenu}
          onPartMenu={p.onPartMenu}
          onWords={p.onWords}
          renamingId={p.renamingId}
          onRename={p.onRename}
          onStartRename={p.onStartRename}
        />
      ) : (
        <PlanTable
          modeSwitch={p.modeSwitch}
          barExtra={trialBar}
          book={shownBook}
          trialFrom={trialFrom}
          onIdeaDrop={ideaDrop}
          onOpen={p.onOpen}
          onMeta={p.onMeta}
          onOutline={outlineSave}
          onRename={p.onRename}
          onContextMenu={p.onContextMenu}
          onColumns={saveColumns}
        />
      )}
      <IdeasPile ideas={book.ideas ?? []} onSave={saveIdeas} onToChapter={(id) => void ideaToChapter(id)} canPlace={!!ideaDrop} />
    </div>
  )
}
