// Translation (features 12, 13, 28), the window's side: loading the original PDF once per book,
// finding its paragraphs, the live paragraph counts of the chapters, and "send to Google Translate".
import { useSyncExternalStore } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { Node as PMDoc } from '@tiptap/pm/model'
import { countsAsParagraph, linkPages, pageBlocks, type PageBlock, type SourcePara, type TextPiece } from '@shared/translation'
import { api } from './api'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

// ---------------------------------------------------------------------------
// The PDF and its paragraphs (read once, kept while the app is open)
// ---------------------------------------------------------------------------

export interface LoadedPdf {
  doc: PDFDocumentProxy
  /** Size of each page in PDF units (index 0 = page 1) */
  sizes: { w: number; h: number }[]
}

const pdfs = new Map<string, Promise<LoadedPdf>>()
const analyses = new Map<string, Promise<SourcePara[]>>()

export function loadPdf(bookPath: string, name: string): Promise<LoadedPdf> {
  const key = `${bookPath}|${name}`
  let p = pdfs.get(key)
  if (!p) {
    p = (async () => {
      const r = await api.readSourcePdf(bookPath, name)
      if (!r.ok || !r.value) throw new Error(r.error ?? 'לא ניתן לקרוא את הקובץ')
      const base = (d: string) => new URL(`./pdfjs/${d}/`, document.baseURI).href
      const doc = await pdfjs.getDocument({ data: r.value, cMapUrl: base('cmaps'), standardFontDataUrl: base('standard_fonts'), wasmUrl: base('wasm') }).promise
      const sizes: LoadedPdf['sizes'] = []
      for (let i = 1; i <= doc.numPages; i++) {
        const vp = (await doc.getPage(i)).getViewport({ scale: 1 })
        sizes.push({ w: vp.width, h: vp.height })
      }
      return { doc, sizes }
    })()
    p.catch(() => pdfs.delete(key))
    pdfs.set(key, p)
  }
  return p
}

/** Text pieces of a page, in PDF units with y up from the bottom */
async function pagePieces(doc: PDFDocumentProxy, n: number): Promise<{ pieces: TextPiece[]; w: number; h: number }> {
  const page = await doc.getPage(n)
  const vp = page.getViewport({ scale: 1 })
  const tc = await page.getTextContent()
  // The page may not start at (0, 0)
  const [x0, y0] = page.view
  const pieces: TextPiece[] = []
  for (const it of tc.items) {
    if (!('str' in it)) continue
    const t = it.transform as number[]
    pieces.push({ str: it.str, x: t[4] - x0, y: t[5] - y0, w: it.width, h: it.height || Math.hypot(t[2], t[3]), dir: it.dir })
  }
  return { pieces, w: vp.width, h: vp.height }
}

/** All the paragraphs of the PDF. Reading a long book takes a few seconds, so it is done once. */
export function pdfParagraphs(bookPath: string, name: string): Promise<SourcePara[]> {
  const key = `${bookPath}|${name}`
  let p = analyses.get(key)
  if (!p) {
    p = (async () => {
      const { doc } = await loadPdf(bookPath, name)
      const pages: PageBlock[][] = []
      for (let i = 1; i <= doc.numPages; i++) {
        const { pieces, w, h } = await pagePieces(doc, i)
        pages.push(pageBlocks(pieces, w, h))
      }
      return linkPages(pages, 1)
    })()
    p.catch(() => analyses.delete(key))
    analyses.set(key, p)
  }
  return p
}

// ---------------------------------------------------------------------------
// Paragraphs of the chapters (feature 28): from the files on disk, and live from open editors
// ---------------------------------------------------------------------------

let counts: Record<string, number> = {}
let countsBook = ''
let countsVersion = 0
const countListeners = new Set<() => void>()
const changed = () => {
  countsVersion++
  countListeners.forEach((l) => l())
}

export async function loadParagraphCounts(bookPath: string): Promise<void> {
  const r = await api.paragraphCounts(bookPath)
  if (!r.ok || !r.value) return
  // Counts reported live while this was loading are newer than the files
  counts = countsBook === bookPath ? { ...r.value, ...live } : r.value
  if (countsBook !== bookPath) live = {}
  countsBook = bookPath
  changed()
}
let live: Record<string, number> = {}

/** Paragraphs in an open chapter's document (the title counts as one, like chapterParagraphCount) */
export function editorParagraphCount(doc: PMDoc): number {
  let n = 1
  doc.forEach((node) => {
    if (countsAsParagraph(node.textContent)) n++
  })
  return n
}

export function reportParagraphs(bookPath: string, chapterId: string, n: number): void {
  if (bookPath !== countsBook || counts[chapterId] === n) return
  counts = { ...counts, [chapterId]: n }
  live[chapterId] = n
  changed()
}

export function useParagraphCounts(bookPath: string | undefined): Record<string, number> {
  useSyncExternalStore(
    (l) => (countListeners.add(l), () => countListeners.delete(l)),
    () => countsVersion
  )
  return bookPath === countsBook ? counts : {}
}

// ---------------------------------------------------------------------------
// "Send to Google Translate": the PDF pane (or the chapter) asks, the Google Translate pane listens
// ---------------------------------------------------------------------------

type SendFn = (text: string) => void
const sendListeners = new Set<SendFn>()
let pendingSend: string | null = null

/** Sends text to the Google Translate pane. Returns false when no such pane is open (the text waits for one). */
export function sendToTranslate(text: string): boolean {
  if (!sendListeners.size) {
    pendingSend = text
    return false
  }
  sendListeners.forEach((fn) => fn(text))
  return true
}
export function onSendToTranslate(fn: SendFn): () => void {
  sendListeners.add(fn)
  if (pendingSend !== null) {
    const t = pendingSend
    pendingSend = null
    fn(t)
  }
  return () => sendListeners.delete(fn)
}
