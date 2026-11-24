// Round 11, feature 52: an ePub or Word original is printed to a PDF once, when it is added, so the
// PDF pane works with it like with any PDF. The page is built by shared/sourcefile.ts; it is shown
// in a hidden window with scripts off and printed by Chromium.
import { BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { docxBlocks, guessDir } from '../shared/docx'
import { blocksToHtml, epubToHtml, sourceDocument, sourceKind, type ReadSource } from '../shared/sourcefile'

async function readSource(file: string): Promise<ReadSource> {
  const data = new Uint8Array(await fs.readFile(file))
  const kind = sourceKind(file)
  if (kind === 'epub') return epubToHtml(data)
  if (kind === 'docx') {
    const { blocks } = await docxBlocks(data, { splitPages: true })
    const html = blocksToHtml(blocks)
    if (!html.trim()) throw new Error('לא נמצא טקסט בקובץ ה־Word')
    const dir = guessDir(html.replace(/<[^>]+>/g, ' ').slice(0, 4000)) ?? 'ltr'
    return { html, dir, lang: dir === 'rtl' ? 'he' : '', title: '' }
  }
  throw new Error('אפשר להוסיף מקור מסוג PDF, ePub או Word (docx)')
}

/** The file as a PDF, ready to be kept in the book's "מקור" folder */
export async function sourceToPdf(file: string): Promise<Uint8Array> {
  const page = sourceDocument(await readSource(file))
  const tmp = join(tmpdir(), `hakirchia-source-${randomUUID()}.html`)
  await fs.writeFile(tmp, page, 'utf8')
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true, spellcheck: false, webSecurity: true }
  })
  // nothing in the book may open other pages or reach the internet
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  try {
    await win.loadFile(tmp)
    const pdf = await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: false, displayHeaderFooter: false })
    return new Uint8Array(pdf)
  } finally {
    if (!win.isDestroyed()) win.destroy()
    void fs.unlink(tmp).catch(() => {})
  }
}
