// Round 11: the side bars can be made wider or narrower by dragging their edge (שלומי: the binder
// could not be resized). The width is a CSS variable on the app, kept on this computer.
import { useEffect, useRef } from 'react'

const read = (k: string): number | null => {
  try {
    const v = Number(localStorage.getItem(k))
    return v > 0 ? v : null
  } catch {
    return null
  }
}

export function SideResizer({ cssVar, storageKey, min, max, side, label }: { cssVar: string; storageKey: string; min: number; max: number; side: 'start' | 'end'; label: string }) {
  const drag = useRef<{ x: number; w: number } | null>(null)
  const root = () => document.querySelector('.app') as HTMLElement | null
  const apply = (w: number) => root()?.style.setProperty(cssVar, `${Math.round(w)}px`)
  useEffect(() => {
    const w = read(storageKey)
    if (w) apply(Math.min(max, Math.max(min, w)))
  }, [])
  const current = (el: HTMLElement): number => {
    const panel = (side === 'start' ? el.previousElementSibling : el.nextElementSibling) as HTMLElement | null
    return panel?.getBoundingClientRect().width ?? min
  }
  const setW = (w: number) => {
    const v = Math.min(max, Math.max(min, w))
    apply(v)
    try {
      localStorage.setItem(storageKey, String(Math.round(v)))
    } catch {
      /* not kept */
    }
  }
  // Which way is "wider": the bar at the start side (the right in RTL) grows toward the end side
  const sign = (el: HTMLElement) => {
    const rtl = getComputedStyle(el).direction === 'rtl'
    return (side === 'start' ? 1 : -1) * (rtl ? -1 : 1)
  }
  return (
    <div
      className="side-rz"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={`${label}. לחיצה כפולה: רוחב רגיל`}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, w: current(e.currentTarget) }
        document.body.classList.add('side-resizing')
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        setW(d.w + (e.clientX - d.x) * sign(e.currentTarget))
      }}
      onPointerUp={() => {
        drag.current = null
        document.body.classList.remove('side-resizing')
      }}
      onPointerCancel={() => {
        drag.current = null
        document.body.classList.remove('side-resizing')
      }}
      onDoubleClick={() => {
        root()?.style.removeProperty(cssVar)
        try {
          localStorage.removeItem(storageKey)
        } catch {
          /* nothing kept */
        }
      }}
      onKeyDown={(e) => {
        const k = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
        if (!k) return
        e.preventDefault()
        setW(current(e.currentTarget) + k * 20 * sign(e.currentTarget))
      }}
    />
  )
}
