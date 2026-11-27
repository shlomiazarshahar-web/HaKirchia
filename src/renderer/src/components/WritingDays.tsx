// Writing days (feature 47): how much was written each day. Statistics only, no goals, no streaks.
// A small "today" figure in the status bar opens the window with the last month as bars, half a
// year as a calendar, and the days as a table.

import { useEffect, useMemo, useState } from 'react'
import { dayKey, lastDays, parseDay, summarize, type WritingLog } from '@shared/writinglog'
import { api } from '../api'
import { Icon } from './Icons'

/** The book's log, read again every half minute (saves keep adding to it) */
export function useWritingLog(bookPath: string | null, tick = 0): WritingLog | null {
  const [log, setLog] = useState<WritingLog | null>(null)
  useEffect(() => {
    if (!bookPath) return setLog(null)
    let alive = true
    const load = () => void api.writingLog(bookPath).then((r) => alive && r.ok && r.value && setLog(r.value))
    load()
    const t = setInterval(load, 30000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [bookPath, tick])
  return log
}

const fmt = (n: number) => n.toLocaleString('he-IL')
// the sign stays in front of the number in right-to-left text (LRI … PDI)
const signed = (n: number) => `\u2066${n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '0'}\u2069`
const daysWord = (n: number) => (n === 1 ? 'יום כתיבה אחד' : `${n} ימי כתיבה`)
const DAY_NAMES = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳']
function dateLabel(key: string, withYear = false): string {
  const d = parseDay(key)
  return `יום ${DAY_NAMES[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}${withYear ? `.${d.getFullYear()}` : ''}`
}

/** The status bar's figure */
export function TodayWords({ log, onOpen }: { log: WritingLog | null; onOpen: () => void }) {
  const today = log?.[dayKey()]
  return (
    <button className="sb-btn" title="ימי כתיבה: כמה נכתב בכל יום (סטטיסטיקה בלבד)" onClick={onOpen}>
      <Icon name="chart" size={13} />
      היום: {today ? signed(today.net) : '0'} מילים
    </button>
  )
}

export function WritingDaysDialog({ bookPath, bookTitle, onClose }: { bookPath: string; bookTitle: string; onClose: () => void }) {
  const log = useWritingLog(bookPath)
  const [hover, setHover] = useState<{ day: string; net: number; added: number; x: number; y: number } | null>(null)
  const [table, setTable] = useState(false)
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  const today = new Date()
  const todayKey = dayKey(today)
  const month = useMemo(() => (log ? lastDays(log, 30, today) : []), [log]) // eslint-disable-line react-hooks/exhaustive-deps
  const week = log ? summarize(log, dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6)), todayKey) : null
  const last30 = log ? summarize(log, month[0]?.day ?? todayKey, todayKey) : null
  const all = log ? summarize(log, '0000-00-00', '9999-99-99') : null
  const t = log?.[todayKey]

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog wdays" role="dialog" aria-label="ימי כתיבה" tabIndex={-1}>
        <div className="wd-head">
          <h2>ימי כתיבה · {bookTitle}</h2>
          <span className="grow" />
          <button className="ib icon" aria-label="סגירה" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <p>כמה מילים נוספו לספר בכל יום. סטטיסטיקה בלבד, בלי יעדים. נספר מכל שמירה בהכריכייה (שינויים שנעשו ב-Word לא נספרים).</p>
        {!log ? (
          <p>טוען…</p>
        ) : (
          <>
            <div className="wd-tiles">
              <Tile label="היום" value={t ? signed(t.net) : '0'} sub={t && t.added !== t.net ? `נכתבו ${fmt(t.added)}, השאר נמחק או שוכתב` : 'מילים'} />
              <Tile label="7 הימים האחרונים" value={signed(week!.words)} sub={daysWord(week!.days)} />
              <Tile label="30 הימים האחרונים" value={signed(last30!.words)} sub={daysWord(last30!.days)} />
              <Tile label="מאז שהתחילה הספירה" value={signed(all!.words)} sub={all!.best ? `היום הכי פורה: ${dateLabel(all!.best.day, true)}, ${fmt(all!.best.net)}` : 'עדיין אין ימים'} />
            </div>
            <section className="wd-sec">
              <h3>30 הימים האחרונים</h3>
              <MonthBars days={month} onHover={setHover} />
            </section>
            <section className="wd-sec">
              <h3>חצי שנה</h3>
              <Calendar log={log} today={today} onHover={setHover} />
            </section>
            <button className="ib wd-tbl" aria-expanded={table} onClick={() => setTable(!table)}>
              <Icon name="chev" size={12} /> {table ? 'הסתרת הטבלה' : 'כל הימים כטבלה'}
            </button>
            {table && <DayTable log={log} />}
          </>
        )}
        {hover && (
          <div className="wd-tip" style={{ top: hover.y, left: hover.x }} role="tooltip">
            <b>{dateLabel(hover.day, true)}</b>
            <span>{signed(hover.net)} מילים</span>
            {hover.added !== hover.net && hover.added > 0 && <small>נכתבו {fmt(hover.added)}</small>}
          </div>
        )}
      </div>
    </div>
  )
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="wd-tile">
      <span className="wd-tl">{label}</span>
      <span className="wd-tv">{value}</span>
      <span className="wd-ts">{sub}</span>
    </div>
  )
}

type Hover = (h: { day: string; net: number; added: number; x: number; y: number } | null) => void
const tipAt = (e: React.MouseEvent, host: Element | null) => {
  const r = (e.currentTarget as Element).getBoundingClientRect()
  const box = host?.getBoundingClientRect() ?? { left: 0, top: 0 }
  // the window scrolls: the tip is placed inside its content
  return { x: r.left + r.width / 2 - box.left, y: r.top - box.top + (host?.scrollTop ?? 0) - 8 }
}

/** One bar a day, oldest on the right (reading order). Days that removed words dip below the line. */
function MonthBars({ days, onHover }: { days: { day: string; net: number; added: number }[]; onHover: Hover }) {
  const W = 600
  const H = 150
  const max = Math.max(1, ...days.map((d) => d.net))
  const min = Math.min(0, ...days.map((d) => d.net))
  const span = max - min || 1
  const base = 8 + ((H - 28) * max) / span
  const slot = W / days.length
  const bw = Math.max(4, slot - 6)
  const y = (v: number) => base - ((H - 28) * v) / span
  return (
    <svg className="wd-bars" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="מילים בכל יום ב-30 הימים האחרונים" onMouseLeave={() => onHover(null)}>
      <line x1="0" x2={W} y1={base} y2={base} className="wd-base" />
      <text x={W - 2} y={14} className="wd-ax" textAnchor="end">
        {fmt(max)}
      </text>
      {days.map((d, i) => {
        // the oldest day is at the right, so the month reads like a Hebrew line
        const x = W - (i + 1) * slot + (slot - bw) / 2
        const h = Math.abs(y(d.net) - base)
        const up = d.net >= 0
        const top = up ? base - h : base
        const r = Math.min(4, bw / 2, h)
        const path = !d.net
          ? ''
          : up
            ? `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${base} Z`
            : `M${x},${base} V${base + h - r} Q${x},${base + h} ${x + r},${base + h} H${x + bw - r} Q${x + bw},${base + h} ${x + bw},${base + h - r} V${base} Z`
        const isToday = i === days.length - 1
        const d0 = parseDay(d.day)
        return (
          <g key={d.day} onMouseEnter={(e) => onHover({ ...d, ...tipAt(e, (e.currentTarget as Element).closest('.wdays')) })}>
            <rect x={W - (i + 1) * slot} y={0} width={slot} height={H} fill="transparent" />
            {path && <path d={path} className={up ? 'wd-bar' : 'wd-bar neg'} />}
            {(d0.getDate() === 1 || isToday || i === 0) && (
              <text x={x + bw / 2} y={H - 4} className={`wd-ax${isToday ? ' today' : ''}`} textAnchor="middle">
                {isToday ? 'היום' : `${d0.getDate()}.${d0.getMonth() + 1}`}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/** Half a year, a column per week (the newest on the left), a row per weekday; darker = more words */
function Calendar({ log, today, onHover }: { log: WritingLog; today: Date; onHover: Hover }) {
  const weeks = 26
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + (6 - today.getDay()))
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - weeks * 7 + 1)
  const cells: { day: string; net: number; added: number; col: number; row: number; future: boolean }[] = []
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    const k = dayKey(d)
    cells.push({ day: k, net: log[k]?.net ?? 0, added: log[k]?.added ?? 0, col: Math.floor(i / 7), row: d.getDay(), future: d > today })
  }
  // shades by the writer's own best day in this half year, never a fixed target
  const top = Math.max(0, ...cells.map((c) => c.net))
  const level = (n: number) => (n <= 0 || !top ? 0 : Math.max(1, Math.ceil((4 * n) / top)))
  const S = 14
  const G = 3
  const W = 22 + weeks * (S + G)
  const H = 7 * (S + G) + 18
  let lastMonth = -1
  return (
    <div className="wd-cal-wrap">
      <svg className="wd-cal" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="ימי כתיבה בחצי השנה האחרונה" onMouseLeave={() => onHover(null)}>
        {[0, 2, 4, 6].map((r) => (
          <text key={r} x={W - 2} y={18 + r * (S + G) + S - 3} className="wd-ax" textAnchor="end">
            {DAY_NAMES[r]}
          </text>
        ))}
        {cells.map((c) => {
          const x = W - 22 - (c.col + 1) * (S + G)
          const yy = 18 + c.row * (S + G)
          const d = parseDay(c.day)
          let label = null
          if (c.row === 0 && d.getMonth() !== lastMonth) {
            lastMonth = d.getMonth()
            label = (
              <text x={x + S} y={11} className="wd-ax" textAnchor="end">
                {d.toLocaleDateString('he-IL', { month: 'short' })}
              </text>
            )
          }
          return (
            <g key={c.day}>
              {label}
              {!c.future && (
                <rect
                  x={x}
                  y={yy}
                  width={S}
                  height={S}
                  rx={3}
                  className={`wd-c l${level(c.net)}${c.day === dayKey(today) ? ' today' : ''}`}
                  onMouseEnter={(e) => onHover({ day: c.day, net: c.net, added: c.added, ...tipAt(e, (e.currentTarget as Element).closest('.wdays')) })}
                />
              )}
            </g>
          )
        })}
      </svg>
      <div className="wd-legend" aria-hidden="true">
        פחות <i className="wd-c l0" />
        <i className="wd-c l1" />
        <i className="wd-c l2" />
        <i className="wd-c l3" />
        <i className="wd-c l4" /> יותר
      </div>
    </div>
  )
}

function DayTable({ log }: { log: WritingLog }) {
  const rows = Object.entries(log)
    .filter(([, e]) => e.net || e.added)
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
  if (!rows.length) return <p>עדיין אין ימים רשומים.</p>
  return (
    <div className="wd-table-wrap">
      <table className="wd-table">
        <thead>
          <tr>
            <th>יום</th>
            <th>מילים (נטו)</th>
            <th>נכתבו</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, e]) => (
            <tr key={k}>
              <td>{dateLabel(k, true)}</td>
              <td>{signed(e.net)}</td>
              <td>{fmt(e.added)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
