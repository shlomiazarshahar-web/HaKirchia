// Background materials round (features 11, 20, 34, 37), the window's side: the text of every chapter
// (for "where it appears" and the glossary check), glossary marks in the editors, and images.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMDoc } from '@tiptap/pm/model'
import type { Book } from '@shared/types'
import { buildTermIndex, checkTerms, findFlags, KIND_ONE, matchAll, namesOf, type ChapterText, type Occurrence, type TermIndex } from '@shared/background'
import { api } from './api'
import { completionsFor } from '@shared/wordtools'
import { setCompletions } from './wordtools'
import { docFromJSON, editorsFor, poke, textBlocks, type Block, type JumpTarget } from './nav'

// ---------------------------------------------------------------------------
// The text of every chapter: from its editor when it is open (newest), otherwise from its file
// ---------------------------------------------------------------------------

export interface BookTexts {
  chapters: ChapterText[]
  /** Paragraphs with their positions, to jump to a match */
  blocks: Map<string, Block[]>
  /** Each chapter's document (for the review, which needs the footnotes' text) */
  docs: Map<string, PMDoc>
}

let diskCache: { bookPath: string; at: number; docs: Promise<Record<string, PMDoc>> } | null = null

/** Every chapter's paragraphs. Files are read at most every few seconds; open editors are always live. */
export async function bookTexts(book: Book, fresh = false): Promise<BookTexts> {
  const needDisk = book.chapters.some((c) => !editorsFor(book.path, c.id).length)
  let disk: Record<string, PMDoc> = {}
  if (needDisk) {
    if (fresh || !diskCache || diskCache.bookPath !== book.path || Date.now() - diskCache.at > 4000) {
      diskCache = {
        bookPath: book.path,
        at: Date.now(),
        docs: api.exportData(book.path).then((r) => {
          const out: Record<string, PMDoc> = {}
          if (r.ok && r.value)
            for (const [id, json] of Object.entries(r.value.docs)) {
              try {
                out[id] = docFromJSON(json)
              } catch {
                /* a chapter that cannot be read is left out */
              }
            }
          return out
        })
      }
    }
    disk = await diskCache.docs
  }
  const chapters: ChapterText[] = []
  const blocks = new Map<string, Block[]>()
  const docs = new Map<string, PMDoc>()
  for (const c of book.chapters) {
    const doc = editorsFor(book.path, c.id)[0]?.state.doc ?? disk[c.id]
    if (!doc) continue
    docs.set(c.id, doc)
    const bs = textBlocks(doc)
    blocks.set(c.id, bs)
    chapters.push({ id: c.id, paras: bs.map((b) => b.text) })
  }
  return { chapters, blocks, docs }
}

/** Where to jump for a match found by occurrences() */
export function jumpFor(texts: BookTexts, chapterId: string, first: Occurrence['first']): JumpTarget | undefined {
  const b = texts.blocks.get(chapterId)?.[first.para]
  return b ? { pos: b.pos + 1 + first.start, to: b.pos + 1 + first.end } : undefined
}

/** Recomputes something from the chapters' text when the book changes, and every few seconds while shown */
export function useBookTexts(book: Book, every = 6000): { texts: BookTexts | null; refresh: () => void } {
  const [texts, setTexts] = useState<BookTexts | null>(null)
  const [tick, setTick] = useState(0)
  const chapterKey = book.chapters.map((c) => c.id).join()
  useEffect(() => {
    let alive = true
    void bookTexts(book, tick > 0).then((t) => alive && setTexts(t))
    const timer = setInterval(() => void bookTexts(book).then((t) => alive && setTexts(t)), every)
    return () => {
      alive = false
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.path, chapterKey, tick])
  return { texts, refresh: () => setTick((t) => t + 1) }
}

// ---------------------------------------------------------------------------
// Glossary marks (feature 20): a dotted line under a term written differently, in every chapter editor
// ---------------------------------------------------------------------------

const MARKS_KEY = 'hakirchia.glossaryMarks'
let marksOn = (() => {
  try {
    return localStorage.getItem(MARKS_KEY) !== '0'
  } catch {
    return true
  }
})()
let index: { bookPath: string; idx: TermIndex } = { bookPath: '', idx: buildTermIndex([]) }
let marksVersion = 0
const marksListeners = new Set<() => void>()
const glKey = new PluginKey('glossaryFlags')

/** The open book's glossary and names changed: the marks follow */
/** A term or name to show in the text: its right spellings, and what hovering it says */
interface Shown {
  ref: string
  names: string[]
  tip: string
}
let shown: Shown[] = []
/** Ctrl+click on a marked term: opens its glossary entry or background page */
let onTermClick: ((ref: string) => void) | null = null
export function setTermClick(fn: ((ref: string) => void) | null): void {
  onTermClick = fn
}

/** The open book's glossary and names changed: the marks follow */
export function setGlossaryTerms(book: Book, open: string[] = []): void {
  setCompletions(completionsFor(book.glossary, book.materials))
  const want = new Set(open)
  const terms = checkTerms(book.glossary, book.materials)
  const next: Shown[] = [
    ...book.glossary
      .filter((g) => g.term.trim() && want.has('glossary'))
      .map((g) => ({
        ref: `g:${g.id}`,
        names: [g.term, ...g.accepted],
        tip: `מילון המונחים: ${g.term}${g.original ? ` ← ${g.original}` : ''}${g.note ? ` · ${g.note}` : ''} (Ctrl+לחיצה פותחת)`
      })),
    ...book.materials
      .filter((m) => want.has(m.id))
      .map((m) => ({ ref: `m:${m.id}`, names: namesOf(m), tip: `${KIND_ONE[m.kind]}: ${m.name}${m.original ? ` ← ${m.original}` : ''} (Ctrl+לחיצה פותחת את הדף)` }))
  ]
  const sig = JSON.stringify([terms, next])
  if (index.bookPath === book.path && (index as { sig?: string }).sig === sig) return
  index = Object.assign({ bookPath: book.path, idx: buildTermIndex(terms) }, { sig })
  shown = next
  poke(glKey, book.path)
}

export function useGlossaryMarks(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(
    (l) => (marksListeners.add(l), () => marksListeners.delete(l)),
    () => marksVersion
  )
  void on
  return [
    marksOn,
    (v: boolean) => {
      marksOn = v
      try {
        localStorage.setItem(MARKS_KEY, v ? '1' : '0')
      } catch {
        /* not remembered */
      }
      marksVersion++
      marksListeners.forEach((l) => l())
      poke(glKey)
    }
  ]
}

function flagDecorations(doc: PMDoc, bookPath: string): DecorationSet {
  if (index.bookPath !== bookPath || ((!marksOn || !index.idx.terms.length) && !shown.length)) return DecorationSet.empty
  const decos: Decoration[] = []
  for (const b of textBlocks(doc)) {
    const flags = marksOn ? findFlags(b.text, index.idx) : []
    // the terms and names as they should be written: a light line, and what they are on hover
    const taken = flags.map((f) => [f.start, f.end])
    for (const t of shown) {
      for (const m of matchAll(b.text, t.names)) {
        if (taken.some(([s, e]) => m.start < e && m.end > s)) continue
        taken.push([m.start, m.end])
        decos.push(Decoration.inline(b.pos + 1 + m.start, b.pos + 1 + m.end, { class: 'bg-mark', title: t.tip, 'data-bg': t.ref }))
      }
    }
    for (const f of flags) {
      decos.push(
        Decoration.inline(b.pos + 1 + f.start, b.pos + 1 + f.end, {
          class: 'gl-flag',
          title: f.why === 'variant' ? `במילון המונחים: "${f.term}"` : `אולי "${f.term}"? (במילון המונחים או בדפי הרקע)`
        })
      )
      if (decos.length > 1500) break
    }
  }
  return DecorationSet.create(doc, decos)
}

/** Marks terms written differently from the glossary, in one chapter editor */
export function glossaryFlags(bookPath: string) {
  return Extension.create({
    name: 'glossaryFlags',
    addProseMirrorPlugins() {
      let timer: ReturnType<typeof setTimeout> | null = null
      return [
        new Plugin({
          key: glKey,
          state: {
            init: (_, state) => flagDecorations(state.doc, bookPath),
            apply: (tr, old) => (tr.getMeta(glKey) ? flagDecorations(tr.doc, bookPath) : tr.docChanged ? old.map(tr.mapping, tr.doc) : old)
          },
          props: {
            decorations: (state) => glKey.getState(state),
            handleClick: (_view, _pos, e) => {
              if (!(e.ctrlKey || e.metaKey) || !onTermClick) return false
              const ref = (e.target as HTMLElement).closest?.('[data-bg]')?.getAttribute('data-bg')
              if (!ref) return false
              onTermClick(ref)
              return true
            }
          },
          // after typing stops, look again (cheap enough for a chapter, too much on every key)
          view: () => ({
            update: (view, prev) => {
              if (view.state.doc === prev.doc) return
              if (timer) clearTimeout(timer)
              timer = setTimeout(() => {
                if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(glKey, true).setMeta('addToHistory', false))
              }, 700)
            },
            destroy: () => {
              if (timer) clearTimeout(timer)
            }
          })
        })
      ]
    }
  })
}

// ---------------------------------------------------------------------------
// Images (feature 37): read once, shown from memory
// ---------------------------------------------------------------------------

const urls = new Map<string, Promise<string>>()

export function imageUrl(bookPath: string, file: string): Promise<string> {
  const key = `${bookPath}|${file}`
  let p = urls.get(key)
  if (!p) {
    p = api.readImage(bookPath, file).then((r) => {
      if (!r.ok || !r.value) throw new Error(r.error ?? 'התמונה לא נמצאה')
      const ext = file.split('.').pop()?.toLowerCase() ?? 'png'
      const type = ext === 'jpg' ? 'image/jpeg' : `image/${ext === 'svg' ? 'svg+xml' : ext}`
      return URL.createObjectURL(new Blob([r.value as BlobPart], { type }))
    })
    p.catch(() => urls.delete(key))
    urls.set(key, p)
  }
  return p
}

export function useImageUrl(bookPath: string, file: string): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    imageUrl(bookPath, file).then(
      (u) => alive && setUrl(u),
      () => alive && setUrl(null)
    )
    return () => {
      alive = false
    }
  }, [bookPath, file])
  return url
}

/** Image files dropped from Explorer, as paths on disk */
export function droppedImagePaths(dt: DataTransfer): string[] {
  return [...dt.files].filter((f) => /^image\//.test(f.type) || /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(f.name)).map((f) => api.pathForFile(f)).filter(Boolean)
}
