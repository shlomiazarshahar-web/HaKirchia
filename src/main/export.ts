// Export (feature 16): the whole book as one PDF for printing, one Word file, or an ePub.
// The chapters are read from their files, so the export is exactly what is saved.
//
// The PDF is printed by Chromium in a hidden window that loads the app's own page (so it has the
// same fonts as the editor, also fonts the user added). That window lays the book out, prints it
// once to find on which page each chapter starts, adds empty pages where a chapter must start on a
// left-hand page, fills in the page numbers of the table of contents, and prints again.

import { BrowserWindow, ipcMain, type WebContents } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import JSZip from 'jszip'
import type { Book } from '../shared/types'
import { bookCss, bookSections, esc, pageGeometry, printBody, printCss, sectionTag, tocEntries, type BookData, type Section } from '../shared/bookhtml'
import { bookToDocx, type DocxBookItem } from '../shared/docx'
import { backPages, frontPages, MATTER_KINDS, matterLines, PAGE_SIZES } from '../shared/publish'
import * as project from './project'

export type ExportFormat = 'pdf' | 'docx' | 'epub'

export const EXPORT_FILTERS: Record<ExportFormat, { name: string; extensions: string[] }> = {
  pdf: { name: 'PDF', extensions: ['pdf'] },
  docx: { name: 'Word', extensions: ['docx'] },
  epub: { name: 'ePub', extensions: ['epub'] }
}

async function bookData(bookPath: string): Promise<{ book: Book; data: BookData }> {
  const { book, docs } = await project.exportData(bookPath)
  return {
    book,
    data: {
      title: book.title,
      chapters: book.chapters.map((c) => ({ id: c.id, title: c.title, doc: docs[c.id] })),
      outline: book.outline,
      publish: book.publish
    }
  }
}

// ---------------------------------------------------------------------------
// Word
// ---------------------------------------------------------------------------

export async function exportDocx(bookPath: string, out: string): Promise<void> {
  const { book, data } = await bookData(bookPath)
  const { info, matter, layout } = book.publish
  const items: DocxBookItem[] = []
  const matterItem = (m: (typeof matter)[number]): DocxBookItem => {
    if (m.kind === 'title') return { kind: 'title', title: book.title, subtitle: info.subtitle.trim(), author: info.author.trim(), extra: matterLines(m.text).filter((l) => l.trim()) }
    if (m.kind === 'toc') return { kind: 'toc', heading: m.heading.trim() || MATTER_KINDS.toc.heading, entries: tocEntries(data).map((e) => (e.level ? '    ' : '') + e.title) }
    return { kind: 'matter', heading: m.heading.trim(), lines: matterLines(m.text), centered: MATTER_KINDS[m.kind].centered }
  }
  if (layout.matter) items.push(...frontPages(matter).map(matterItem))
  const byId = new Map(data.chapters.map((c) => [c.id, c]))
  for (const n of data.outline) {
    if (n.type === 'part') {
      items.push({ kind: 'part', title: n.title })
      for (const id of n.children) {
        const c = byId.get(id)
        if (c) items.push({ kind: 'chapter', title: c.title, doc: c.doc })
      }
    } else {
      const c = byId.get(n.id)
      if (c) items.push({ kind: 'chapter', title: c.title, doc: c.doc })
    }
  }
  if (layout.matter) items.push(...backPages(matter).map(matterItem))
  const g = pageGeometry(layout)
  const bytes = await bookToDocx(items, book.title, {
    pageW: g.w,
    pageH: g.h,
    margin: { top: g.top, bottom: g.bottom, side: Math.round((g.inner + g.outer) / 2) },
    font: layout.font,
    fontSize: layout.fontSize
  })
  await fs.writeFile(out, bytes)
}

// ---------------------------------------------------------------------------
// ePub
// ---------------------------------------------------------------------------

const xhtml = (title: string, body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="he" lang="he" dir="rtl">
<head><meta charset="UTF-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="book.css"/></head>
<body>
${body}
</body>
</html>`

/** ePub readers choose their own text size, so sizes are relative; page numbers mean nothing there */
const EPUB_CSS = `
body { margin: 0; padding: 0 0.4em; }
.bk-sec { font-size: 1em !important; }
.bk-toc-list .dots, .bk-toc-list .pg { display: none; }
.bk-matter.centered, .bk-part.own-page { display: block; margin-top: 30%; text-align: center; }
.bk-copyright { display: block; margin-top: 50%; }
aside.bk-note { font-size: 0.85em; }
`

export async function exportEpub(bookPath: string, out: string): Promise<void> {
  const { book, data } = await bookData(bookPath)
  const { layout, info } = book.publish
  const sections = bookSections(data, 'epub')
  const fileOf = new Map<string, string>()
  sections.forEach((s, i) => fileOf.set(s.id, `s${String(i).padStart(3, '0')}.xhtml`))
  // Links between files (the table of contents page)
  const linkFix = (html: string) => html.replace(/href="#sec-([^"]+)"/g, (all, id: string) => (fileOf.has(id) ? `href="${fileOf.get(id)}#sec-${id}"` : all))
  const sectionTitle = (s: Section) => (s.kind === 'matter' ? s.page.heading || MATTER_KINDS[s.page.kind].label : s.title)

  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE', createFolders: false })
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    { createFolders: false }
  )
  const add = (name: string, text: string) => zip.file(name, text, { createFolders: false })
  add('OEBPS/book.css', bookCss(layout) + EPUB_CSS)
  sections.forEach((s, i) => add(`OEBPS/${fileOf.get(s.id)}`, xhtml(sectionTitle(s), linkFix(sectionTag(s, layout, i)))))

  // The reader's own table of contents (nav), with chapters inside their parts
  const entries = tocEntries(data)
  let nav = ''
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const a = `<a href="${fileOf.get(e.id)}#sec-${esc(e.id)}">${esc(e.title)}</a>`
    if (e.level === 0) {
      const kids: string[] = []
      while (entries[i + 1]?.level === 1) {
        const k = entries[++i]
        kids.push(`<li><a href="${fileOf.get(k.id)}#sec-${esc(k.id)}">${esc(k.title)}</a></li>`)
      }
      nav += `<li>${a}${kids.length ? `<ol>${kids.join('')}</ol>` : ''}</li>`
    } else nav += `<li>${a}</li>`
  }
  const first = sections.find((s) => s.kind === 'chapter')
  add(
    'OEBPS/nav.xhtml',
    xhtml(
      'תוכן העניינים',
      `<nav epub:type="toc" id="toc"><h1>תוכן העניינים</h1><ol>${nav}</ol></nav>${first ? `<nav epub:type="landmarks" hidden=""><ol><li><a epub:type="bodymatter" href="${fileOf.get(first.id)}">${esc(first.title)}</a></li></ol></nav>` : ''}`
    )
  )
  const manifest = sections.map((s) => `<item id="${fileOf.get(s.id)!.replace('.xhtml', '')}" href="${fileOf.get(s.id)}" media-type="application/xhtml+xml"/>`).join('')
  const spine = sections.map((s) => `<itemref idref="${fileOf.get(s.id)!.replace('.xhtml', '')}"/>`).join('')
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  add(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="he" dir="rtl">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">urn:uuid:${randomUUID()}</dc:identifier>
<dc:title>${esc(book.title)}</dc:title>
<dc:language>he</dc:language>
${info.author.trim() ? `<dc:creator>${esc(info.author.trim())}</dc:creator>` : ''}
<meta property="dcterms:modified">${modified}</meta>
</metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="book.css" media-type="text/css"/>${manifest}</manifest>
<spine page-progression-direction="rtl">${spine}</spine>
</package>`
  )
  await fs.writeFile(out, await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/epub+zip' }))
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

export interface PrintJob {
  html: string
  css: string
  /** Add empty pages so chapters start on odd pages */
  oddPages: boolean
  /** The section indices that are the front/back table of contents (page numbers to fill in) */
  hasToc: boolean
  partPage: boolean
  /** Section kinds in order, for the empty-page plan */
  kinds: Section['kind'][]
  /** Chapter / part ids in order (for the table of contents numbers) */
  ids: string[]
}

interface Running {
  job: PrintJob
  out: string
  resolve: () => void
  reject: (e: Error) => void
  win: BrowserWindow
}
const running = new Map<number, Running>()

const PRINT_OPTIONS = { preferCSSPageSize: true, printBackground: true, generateDocumentOutline: true, generateTaggedPDF: true } as const

export function registerPrintIpc(): void {
  const of = (wc: WebContents) => running.get(wc.id)
  ipcMain.handle('print:job', (e) => of(e.sender)?.job ?? null)
  ipcMain.handle('print:render', async (e) => {
    const r = of(e.sender)
    if (!r) throw new Error('no print job')
    return new Uint8Array(await e.sender.printToPDF(PRINT_OPTIONS))
  })
  ipcMain.handle('print:finish', async (e, bytes: Uint8Array | null, error?: string) => {
    const r = of(e.sender)
    if (!r) return
    running.delete(e.sender.id)
    try {
      if (!bytes) throw new Error(error || 'ההדפסה נכשלה')
      await fs.writeFile(r.out, bytes)
      r.resolve()
    } catch (err) {
      r.reject(err instanceof Error ? err : new Error(String(err)))
    } finally {
      if (!r.win.isDestroyed()) r.win.destroy()
    }
  })
}

export async function exportPdf(bookPath: string, out: string, preload: string, loadPage: (w: BrowserWindow, hash: string) => Promise<void>): Promise<void> {
  const { book, data } = await bookData(bookPath)
  const layout = book.publish.layout
  const sections = bookSections(data, 'end')
  const job: PrintJob = {
    html: printBody(sections, layout),
    css: bookCss(layout) + '\n' + printCss(layout, sections, book.title),
    oddPages: layout.chapterNewPage && layout.chapterOdd,
    hasToc: sections.some((s) => s.kind === 'matter' && s.page.kind === 'toc'),
    partPage: layout.partPage,
    kinds: sections.map((s) => s.kind),
    ids: sections.map((s) => s.id)
  }
  const size = PAGE_SIZES[layout.pageSize]
  const win = new BrowserWindow({
    show: false,
    width: Math.round(size.w * 3.78) + 40,
    height: 900,
    webPreferences: { preload, sandbox: false, contextIsolation: true, spellcheck: false }
  })
  const id = win.webContents.id
  await new Promise<void>((resolve, reject) => {
    running.set(id, { job, out, resolve, reject, win })
    const timer = setTimeout(() => {
      if (!running.delete(id)) return
      if (!win.isDestroyed()) win.destroy()
      reject(new Error('הכנת ה־PDF לקחה יותר מדי זמן'))
    }, 300_000)
    win.on('closed', () => {
      clearTimeout(timer)
      if (running.delete(id)) reject(new Error('ההדפסה הופסקה'))
    })
    loadPage(win, 'print').catch((e) => {
      if (!running.delete(id)) return
      if (!win.isDestroyed()) win.destroy()
      reject(e instanceof Error ? e : new Error(String(e)))
    })
  })
}

export const exportPath = (dir: string, title: string, f: ExportFormat) => join(dir, `${project.safeName(title)}.${f}`)

