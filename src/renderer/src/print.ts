// The print window of the PDF export (feature 16). The main process opens the app's page hidden,
// with "#print"; this screen takes the book's HTML, lays it out and has it printed. See
// main/export.ts for the whole flow.
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { findMarkers, oddPagePlan } from '@shared/bookhtml'
import type { Section } from '@shared/bookhtml'
import { api } from './api'
import { registerFonts } from './prefs'
import { fixPageStarts, PAGE_SLACK, placeFootnotes } from './footnotes'
import { numberLines } from './linenumbers'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/** The text of every page of a PDF */
async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const base = (d: string) => new URL(`./pdfjs/${d}/`, document.baseURI).href
  const doc = await pdfjs.getDocument({ data: bytes.slice(), cMapUrl: base('cmaps'), standardFontDataUrl: base('standard_fonts'), wasmUrl: base('wasm') }).promise
  const out: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent()
    out.push(tc.items.map((it) => ('str' in it ? it.str : '')).join(''))
  }
  await doc.loadingTask.destroy()
  return out
}

const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

export async function runPrint(): Promise<void> {
  const job = await api.printJob()
  if (!job) return
  try {
    document.documentElement.lang = 'he'
    document.documentElement.dir = 'rtl'
    const style = document.createElement('style')
    style.textContent = job.css
    document.head.append(style)
    const root = document.getElementById('root')!
    root.innerHTML = job.html
    const settings = await api.getSettings()
    await registerFonts(settings.customFonts ?? [])
    await document.fonts.ready
    await frame()

    if (job.notesAtPage) {
      // footnotes at the bottom of their page: lay the book out in columns of one page, place them,
      // fix where each page starts, then print as pages
      const { colW, gap } = job.notesAtPage
      const colH = job.notesAtPage.colH - PAGE_SLACK
      root.classList.add('paginating')
      Object.assign(root.style, { width: `${2 * colW + gap}px`, columnWidth: `${colW}px`, columnGap: `${gap}px`, columnFill: 'auto', position: 'relative' })
      // the print rules give #root an automatic height; the columns need the page's
      root.style.setProperty('height', `${colH}px`, 'important')
      root.style.setProperty('overflow', 'visible', 'important')
      root.style.setProperty('--ch', `${colH}px`)
      await frame()
      placeFootnotes(root, { colW, colH, stride: colW + gap })
      fixPageStarts(root, { colW, colH, stride: colW + gap })
      root.classList.remove('paginating')
      root.removeAttribute('style')
      await frame()
    }

    if (job.oddPages || job.hasToc) {
      // First printing: on which page does each section start?
      const starts = findMarkers(await pageTexts(await api.printRender()))
      const plan = job.oddPages ? oddPagePlan(job.kinds.map((kind) => ({ kind: kind as Section['kind'] })), starts, { partPage: job.partPage }) : { blanks: [], pages: starts }
      for (const i of plan.blanks) {
        const sec = root.querySelector(`[data-sec="${i}"]`)
        const blank = document.createElement('div')
        blank.className = 'bk-blank'
        sec?.before(blank)
      }
      root.querySelectorAll<HTMLElement>('.pg[data-toc]').forEach((el) => {
        const i = job.ids.indexOf(el.dataset.toc ?? '')
        const p = plan.pages[i]
        el.textContent = p ? String(p) : ''
      })
    }
    root.querySelectorAll('.pmk').forEach((el) => el.remove())
    if (job.lineNumbers) {
      await frame()
      numberLines(root)
    }
    await frame()
    await api.printFinish(await api.printRender())
  } catch (e) {
    await api.printFinish(null, e instanceof Error ? e.message : String(e))
  }
}
