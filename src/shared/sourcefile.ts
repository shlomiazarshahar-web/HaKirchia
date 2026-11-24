// Round 11, feature 52: the original of a translation may be an ePub or a Word file, not only a PDF.
// Such a file is turned into a PDF once, when it is added (main/sourcefile.ts prints it), so
// everything the PDF pane does (paragraph sync, chapter detection, scene breaks, progress) works the
// same. This module builds the HTML that is printed: the book's text with its own simple, book-like
// look (first-line indents and headings, which the paragraph finder in translation.ts relies on).

import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import type { PMNode } from './types'
import { guessDir } from './docx'

export const SOURCE_EXTENSIONS = ['pdf', 'epub', 'docx'] as const
export type SourceKind = (typeof SOURCE_EXTENSIONS)[number]

export function sourceKind(fileName: string): SourceKind | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? ''
  return (SOURCE_EXTENSIONS as readonly string[]).includes(ext) ? (ext as SourceKind) : null
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ---------------------------------------------------------------------------
// Word: from the blocks the Word import already reads (docx.ts docxBlocks)
// ---------------------------------------------------------------------------

function inlineHtml(nodes: PMNode[] | undefined): string {
  let out = ''
  for (const n of nodes ?? []) {
    if (n.type === 'hardBreak') {
      out += '<br>'
      continue
    }
    if (n.type === 'footnote' || n.type === 'image') continue
    if (typeof n.text === 'string') {
      let t = esc(n.text)
      for (const m of n.marks ?? []) {
        if (m.type === 'bold') t = `<b>${t}</b>`
        else if (m.type === 'italic') t = `<i>${t}</i>`
      }
      out += t
    } else out += inlineHtml(n.content)
  }
  return out
}

/** A Word file's text as HTML: headings stay headings, a page break starts a new page */
export function blocksToHtml(blocks: PMNode[]): string {
  const out: string[] = []
  for (const b of blocks) {
    const inner = inlineHtml(b.content)
    const brk = b.attrs?.pageBreak ? ' class="pb"' : ''
    if (b.type === 'heading') {
      const lv = Math.min(3, Math.max(1, Number(b.attrs?.level ?? 1) || 1))
      out.push(`<h${lv}${brk}>${inner}</h${lv}>`)
    } else if (b.type === 'horizontalRule' || b.type === 'sceneBreak') out.push('<p class="sc">* * *</p>')
    else if (b.type === 'paragraph') {
      if (!inner.replace(/<br>/g, '').trim()) {
        if (brk) out.push('<div class="pb"></div>')
        continue
      }
      out.push(`<p${brk}>${inner}</p>`)
    } else if (inner.trim()) out.push(`<p${brk}>${inner}</p>`)
  }
  return out.join('\n')
}

// ---------------------------------------------------------------------------
// ePub: the reading order (spine) of the book, each part from a new page
// ---------------------------------------------------------------------------

type El = {
  nodeType: number
  nodeName: string
  localName?: string
  nodeValue: string | null
  childNodes: ArrayLike<El>
  getAttribute?: (n: string) => string | null
  getAttributeNS?: (ns: string, n: string) => string | null
}

const BLOCK_PASS = new Set(['div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav', 'body', 'figure', 'blockquote', 'ul', 'ol', 'table', 'tbody', 'thead', 'tr', 'center'])
const BLOCK_TEXT = new Set(['p', 'li', 'td', 'th', 'dt', 'dd', 'figcaption', 'pre', 'address'])
const DROP = new Set(['script', 'style', 'head', 'title', 'noscript', 'iframe', 'object', 'embed', 'audio', 'video', 'svg', 'math', 'rt', 'rp', 'form', 'button', 'input', 'select', 'textarea'])
const INLINE_KEEP: Record<string, string> = { i: 'i', em: 'i', cite: 'i', b: 'b', strong: 'b', sup: 'sup', sub: 'sub', small: 'small' }

const nameOf = (e: El) => (e.localName || e.nodeName || '').toLowerCase().replace(/^.*:/, '')

/** Pictures in the ePub, resolved by their path inside the zip */
export type ImageLookup = (path: string) => string | null

function resolvePath(base: string, rel: string): string {
  if (/^[a-z]+:/i.test(rel)) return ''
  const parts = (base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : '').split('/').filter(Boolean)
  for (const p of decodeURIComponent(rel.split('#')[0]).split('/')) {
    if (!p || p === '.') continue
    if (p === '..') parts.pop()
    else parts.push(p)
  }
  return parts.join('/')
}

function hasDirectText(e: El): boolean {
  for (let i = 0; i < e.childNodes.length; i++) {
    const c = e.childNodes[i]
    if (c.nodeType === 3 && (c.nodeValue ?? '').trim()) return true
    if (c.nodeType === 1 && !BLOCK_PASS.has(nameOf(c)) && !BLOCK_TEXT.has(nameOf(c)) && !/^h[1-6]$/.test(nameOf(c)) && nameOf(c) !== 'hr' && !DROP.has(nameOf(c))) {
      if (nameOf(c) === 'img' || nameOf(c) === 'image' || textOf(c).trim()) return true
    }
  }
  return false
}

function textOf(e: El): string {
  if (e.nodeType === 3) return e.nodeValue ?? ''
  if (e.nodeType !== 1 || DROP.has(nameOf(e))) return ''
  let s = ''
  for (let i = 0; i < e.childNodes.length; i++) s += textOf(e.childNodes[i])
  return s
}

function imgTag(e: El, file: string, images: ImageLookup): string {
  const src = e.getAttribute?.('src') || e.getAttributeNS?.('http://www.w3.org/1999/xlink', 'href') || e.getAttribute?.('xlink:href') || e.getAttribute?.('href') || ''
  const url = src ? images(resolvePath(file, src)) : null
  return url ? `<img src="${url}" alt="">` : ''
}

function inlineOf(e: El, file: string, images: ImageLookup): string {
  if (e.nodeType === 3) return esc((e.nodeValue ?? '').replace(/\s+/g, ' '))
  if (e.nodeType !== 1) return ''
  const n = nameOf(e)
  if (DROP.has(n)) return ''
  if (n === 'br') return '<br>'
  if (n === 'img' || n === 'image') return imgTag(e, file, images)
  let inner = ''
  for (let i = 0; i < e.childNodes.length; i++) inner += inlineOf(e.childNodes[i], file, images)
  const tag = INLINE_KEEP[n]
  return tag && inner.trim() ? `<${tag}>${inner}</${tag}>` : inner
}

function blocksOf(e: El, file: string, images: ImageLookup, out: string[]): void {
  if (e.nodeType === 3) {
    const t = (e.nodeValue ?? '').trim()
    if (t) out.push(`<p>${esc(t.replace(/\s+/g, ' '))}</p>`)
    return
  }
  if (e.nodeType !== 1) return
  const n = nameOf(e)
  if (DROP.has(n)) return
  if (/^h[1-6]$/.test(n)) {
    const inner = inlineOf(e, file, images).trim()
    if (inner) out.push(`<h${Math.min(3, Number(n[1]))}>${inner}</h${Math.min(3, Number(n[1]))}>`)
    return
  }
  if (n === 'hr') {
    out.push('<p class="sc">* * *</p>')
    return
  }
  if (n === 'img' || n === 'image') {
    const t = imgTag(e, file, images)
    if (t) out.push(`<p class="im">${t}</p>`)
    return
  }
  // a <div> written like a paragraph (text right inside it) is a paragraph
  if (BLOCK_TEXT.has(n) || (BLOCK_PASS.has(n) && n !== 'body' && hasDirectText(e) && !hasBlockChild(e))) {
    const inner = inlineOf(e, file, images).trim()
    if (inner.replace(/<br>/g, '').trim()) out.push(`<p>${inner}</p>`)
    return
  }
  if (BLOCK_PASS.has(n) || n === 'html') {
    // inline pieces between blocks are gathered into paragraphs of their own
    let run = ''
    const flush = () => {
      if (run.replace(/<br>/g, '').trim()) out.push(`<p>${run.trim()}</p>`)
      run = ''
    }
    for (let i = 0; i < e.childNodes.length; i++) {
      const c = e.childNodes[i]
      const cn = c.nodeType === 1 ? nameOf(c) : ''
      const isBlock = c.nodeType === 1 && (BLOCK_PASS.has(cn) || BLOCK_TEXT.has(cn) || /^h[1-6]$/.test(cn) || cn === 'hr')
      if (isBlock) {
        flush()
        blocksOf(c, file, images, out)
      } else run += inlineOf(c, file, images)
    }
    flush()
    return
  }
  const inner = inlineOf(e, file, images).trim()
  if (inner) out.push(`<p>${inner}</p>`)
}

function hasBlockChild(e: El): boolean {
  for (let i = 0; i < e.childNodes.length; i++) {
    const c = e.childNodes[i]
    if (c.nodeType !== 1) continue
    const cn = nameOf(c)
    if (BLOCK_PASS.has(cn) || BLOCK_TEXT.has(cn) || /^h[1-6]$/.test(cn)) return true
  }
  return false
}

/** One XHTML part of an ePub as our simple HTML */
export function xhtmlToHtml(xml: string, file: string, images: ImageLookup): string {
  const doc = new DOMParser({ onError: () => {} }).parseFromString(xml, xml.includes('<?xml') || /xmlns=/.test(xml) ? 'application/xhtml+xml' : 'text/html')
  const all = (doc as unknown as { getElementsByTagName(n: string): ArrayLike<El> }).getElementsByTagName('body')
  const body = all.length ? all[0] : (doc as unknown as { documentElement: El }).documentElement
  if (!body) return ''
  const out: string[] = []
  blocksOf(body, file, images, out)
  return out.join('\n')
}

const IMAGE_TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }

export interface ReadSource {
  html: string
  dir: 'rtl' | 'ltr'
  lang: string
  title: string
}

/** The text of an ePub, in reading order, each part of the spine from a new page */
export async function epubToHtml(data: Uint8Array | ArrayBuffer): Promise<ReadSource> {
  const zip = await JSZip.loadAsync(data)
  const read = async (p: string) => {
    const f = zip.file(p)
    if (!f) throw new Error(`חסר בקובץ: ${p}`)
    return f.async('string')
  }
  const parse = (xml: string) => new DOMParser({ onError: () => {} }).parseFromString(xml, 'application/xml') as unknown as { getElementsByTagName(n: string): ArrayLike<El & { getAttribute(n: string): string | null; textContent: string | null }> }
  let container: string
  try {
    container = await read('META-INF/container.xml')
  } catch {
    throw new Error('הקובץ לא נראה כמו ePub תקין (חסר בו META-INF/container.xml)')
  }
  const rootfile = parse(container).getElementsByTagName('rootfile')[0]?.getAttribute('full-path')
  if (!rootfile) throw new Error('הקובץ לא נראה כמו ePub תקין')
  const opf = parse(await read(rootfile))
  const byTag = (t: string) => {
    const a = opf.getElementsByTagName(t)
    return a.length ? a : opf.getElementsByTagName(`opf:${t}`)
  }
  const manifest = new Map<string, { href: string; type: string; props: string }>()
  const items = byTag('item')
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const id = it.getAttribute('id')
    const href = it.getAttribute('href')
    if (id && href) manifest.set(id, { href: resolvePath(rootfile, href), type: it.getAttribute('media-type') ?? '', props: it.getAttribute('properties') ?? '' })
  }
  const spine: string[] = []
  const refs = byTag('itemref')
  for (let i = 0; i < refs.length; i++) {
    const r = refs[i]
    if (r.getAttribute('linear') === 'no') continue
    const m = manifest.get(r.getAttribute('idref') ?? '')
    if (m && /x?html/.test(m.type) && !m.props.includes('nav')) spine.push(m.href)
  }
  if (!spine.length) throw new Error('לא נמצא טקסט בקובץ ה־ePub')
  const langEl = opf.getElementsByTagName('dc:language')[0] ?? opf.getElementsByTagName('language')[0]
  const titleEl = opf.getElementsByTagName('dc:title')[0] ?? opf.getElementsByTagName('title')[0]
  const lang = (langEl?.textContent ?? '').trim()

  // pictures become part of the page itself (the printed page cannot reach into the zip)
  const imgCache = new Map<string, string | null>()
  const wanted = new Set<string>()
  const lookup: ImageLookup = (p) => {
    wanted.add(p)
    return imgCache.get(p) ?? `@@IMG:${p}@@`
  }
  const parts: string[] = []
  for (const href of spine) {
    let xml: string
    try {
      xml = await read(href)
    } catch {
      continue
    }
    const h = xhtmlToHtml(xml, href, lookup)
    if (h.trim()) parts.push(`<section class="part">\n${h}\n</section>`)
  }
  for (const p of wanted) {
    const f = zip.file(p)
    const type = IMAGE_TYPES[p.toLowerCase().split('.').pop() ?? '']
    if (!f || !type) {
      imgCache.set(p, null)
      continue
    }
    const b64 = await f.async('base64')
    imgCache.set(p, `data:${type};base64,${b64}`)
  }
  let html = parts.join('\n')
  html = html.replace(/<img src="@@IMG:(.*?)@@" alt="">/g, (_m, p: string) => {
    const url = imgCache.get(p)
    return url ? `<img src="${url}" alt="">` : ''
  })
  html = html.replace(/<p class="im"><\/p>\n?/g, '')
  const rtlLang = /^(he|iw|ar|fa|ur|yi)\b/i.test(lang)
  const sample = html.replace(/<[^>]+>/g, ' ').slice(0, 4000)
  const dir = rtlLang ? 'rtl' : lang ? 'ltr' : (guessDir(sample) ?? 'ltr')
  return { html, dir, lang, title: (titleEl?.textContent ?? '').trim() }
}

/** The page that is printed to PDF: plain, book-like, easy for the paragraph finder to read */
export function sourceDocument(src: ReadSource): string {
  return `<!doctype html>
<html lang="${esc(src.lang || (src.dir === 'rtl' ? 'he' : 'en'))}" dir="${src.dir}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>${esc(src.title)}</title>
<style>
@page { size: 148mm 210mm; margin: 18mm 16mm 20mm 16mm; }
html { font-family: Georgia, 'Times New Roman', 'Frank Ruhl Libre', 'David', serif; font-size: 11pt; line-height: 1.45; color: #000; }
body { margin: 0; }
p { margin: 0; text-indent: 1.6em; text-align: start; orphans: 2; widows: 2; }
h1, h2, h3 + p, h1 + p, h2 + p, .sc + p, .part > p:first-child { text-indent: 0; }
h1, h2, h3 { font-weight: bold; margin: 0 0 1.4em; line-height: 1.25; break-after: avoid; }
h1 { font-size: 18pt; margin-top: 3em; }
h2 { font-size: 15pt; margin-top: 2.4em; }
h3 { font-size: 13pt; margin-top: 1.6em; }
.part { break-before: page; }
.part:first-child { break-before: auto; }
.pb { break-before: page; }
.sc { text-align: center; text-indent: 0; margin: 0.8em 0; }
.im { text-align: center; text-indent: 0; margin: 0.6em 0; }
img { max-width: 100%; max-height: 160mm; }
</style>
</head>
<body>
${src.html}
</body>
</html>`
}
