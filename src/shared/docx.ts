// Converts between the editor's document (TipTap / ProseMirror JSON) and Word .docx files.
//
// Supported today: paragraphs, chapter title (Heading 1), headings (Heading 2/3),
// bold, italic, underline, font, font size, alignment, paragraph direction (RTL/LTR),
// line breaks and tabs. Anything else found in a file opened from Word (images, tables,
// footnotes, comments, lists...) is reported in `warnings`, so the UI can protect it.

import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import type { PMMark, PMNode } from './types'

export const DEFAULT_FONT = 'Frank Ruhl Libre'
export const DEFAULT_SIZE_PT = 14
export const APP_MARKER = 'HaKirchia'

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

type Align = 'left' | 'right' | 'center' | 'justify' | null
type Dir = 'rtl' | 'ltr'

const HEBREW_RE = /[֐-׿؀-ۿיִ-ﭏ]/
const STRONG_LTR_RE = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/

/** Direction of the first strong character, or null if there is none. */
export function guessDir(text: string): Dir | null {
  for (const ch of text) {
    if (HEBREW_RE.test(ch)) return 'rtl'
    if (STRONG_LTR_RE.test(ch)) return 'ltr'
  }
  return null
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s
    // characters that are not allowed in XML 1.0
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function ptToHalfPoints(v: unknown): number | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  const n = parseFloat(String(v))
  if (!isFinite(n) || n <= 0) return null
  const s = String(v)
  const pt = s.endsWith('px') ? n * 0.75 : n
  return Math.round(pt * 2)
}

function cleanFontName(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null
  // "Frank Ruhl Libre", serif -> Frank Ruhl Libre
  const first = v.split(',')[0].trim().replace(/^["']|["']$/g, '')
  return first || null
}

function runProps(marks: PMMark[] | undefined, rtl: boolean): string {
  const p: string[] = []
  let font: string | null = null
  let size: number | null = null
  let bold = false
  let italic = false
  let underline = false
  for (const m of marks ?? []) {
    if (m.type === 'bold') bold = true
    else if (m.type === 'italic') italic = true
    else if (m.type === 'underline') underline = true
    else if (m.type === 'textStyle') {
      font = cleanFontName(m.attrs?.fontFamily) ?? font
      size = ptToHalfPoints(m.attrs?.fontSize) ?? size
    }
  }
  // Order follows the schema (CT_RPr sequence).
  if (font) p.push(`<w:rFonts w:ascii="${esc(font)}" w:hAnsi="${esc(font)}" w:cs="${esc(font)}"/>`)
  if (bold) p.push('<w:b/><w:bCs/>')
  if (italic) p.push('<w:i/><w:iCs/>')
  if (size) p.push(`<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`)
  if (underline) p.push('<w:u w:val="single"/>')
  if (rtl) p.push('<w:rtl/>')
  return p.length ? `<w:rPr>${p.join('')}</w:rPr>` : ''
}

function textRuns(text: string, marks: PMMark[] | undefined, paraRtl: boolean): string {
  const rtl = paraRtl ? !(guessDir(text) === 'ltr') : HEBREW_RE.test(text)
  const rPr = runProps(marks, rtl)
  // Tabs become <w:tab/> inside the run
  const parts = text.split('\t')
  const inner = parts
    .map((t, i) => (i > 0 ? '<w:tab/>' : '') + (t ? `<w:t xml:space="preserve">${esc(t)}</w:t>` : ''))
    .join('')
  return `<w:r>${rPr}${inner}</w:r>`
}

function jcFor(align: Align, dir: Dir): string | null {
  // Word reverses "left"/"right" inside an RTL (bidi) paragraph, so the side opposite to where the
  // text starts is written as "right" in both directions. The usual case (start side) writes nothing.
  if (!align) return null
  if (align === 'center') return 'center'
  if (align === 'justify') return 'both'
  const visualStart = dir === 'rtl' ? 'right' : 'left'
  if (align === visualStart) return null // same as the default
  return 'right'
}

function paragraphXml(node: PMNode, styleId: string | null): string {
  const dir: Dir = node.attrs?.dir === 'ltr' ? 'ltr' : 'rtl'
  const align = (node.attrs?.textAlign as Align) ?? null
  const pPr: string[] = []
  if (styleId) pPr.push(`<w:pStyle w:val="${styleId}"/>`)
  pPr.push(dir === 'rtl' ? '<w:bidi/>' : '<w:bidi w:val="0"/>')
  const jc = jcFor(align, dir)
  if (jc) pPr.push(`<w:jc w:val="${jc}"/>`)
  let runs = ''
  for (const child of node.content ?? []) {
    if (child.type === 'text' && child.text) runs += textRuns(child.text, child.marks, dir === 'rtl')
    else if (child.type === 'hardBreak') runs += '<w:r><w:br/></w:r>'
  }
  return `<w:p><w:pPr>${pPr.join('')}</w:pPr>${runs}</w:p>`
}

function bodyXml(doc: PMNode, title: string): string {
  const out: string[] = []
  out.push(
    paragraphXml(
      { type: 'heading', attrs: { dir: guessDir(title) === 'ltr' ? 'ltr' : 'rtl' }, content: title ? [{ type: 'text', text: title }] : [] },
      'Heading1'
    )
  )
  for (const node of doc.content ?? []) {
    if (node.type === 'paragraph') out.push(paragraphXml(node, null))
    else if (node.type === 'heading') {
      const level = Number(node.attrs?.level ?? 2)
      out.push(paragraphXml(node, level <= 2 ? 'Heading2' : 'Heading3'))
    } else if (node.content) {
      // Unknown block (should not happen with our editor schema): keep its text
      for (const c of node.content) if (c.type === 'paragraph' || c.type === 'heading') out.push(paragraphXml(c, null))
    }
  }
  return out.join('')
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>`

const SETTINGS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="${W_NS}"><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat><w:themeFontLang w:val="he-IL" w:bidi="he-IL"/></w:settings>`

function stylesXml(): string {
  const f = esc(DEFAULT_FONT)
  const sz = DEFAULT_SIZE_PT * 2
  const heading = (id: string, name: string, size: number, before: number, after: number, outline: number) =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${before}" w:after="${after}"/><w:outlineLvl w:val="${outline}"/></w:pPr><w:rPr><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W_NS}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:eastAsia="${f}" w:cs="${f}"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="he-IL"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:bidi/><w:spacing w:after="160" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:bidi/></w:pPr></w:style>${heading('Heading1', 'heading 1', 40, 240, 480, 0)}${heading('Heading2', 'heading 2', 32, 360, 160, 1)}${heading('Heading3', 'heading 3', 30, 280, 120, 2)}<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style></w:styles>`
}

function coreXml(title: string): string {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:language>he-IL</dc:language><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`
}

const APP_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>${APP_MARKER}</Application></Properties>`

export async function docToDocx(doc: PMNode, title: string): Promise<Uint8Array> {
  const zip = new JSZip()
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W_NS}"><w:body>${bodyXml(doc, title)}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/><w:bidi/></w:sectPr></w:body></w:document>`
  zip.file('[Content_Types].xml', CONTENT_TYPES)
  zip.file('_rels/.rels', ROOT_RELS)
  zip.file('word/document.xml', documentXml)
  zip.file('word/_rels/document.xml.rels', DOC_RELS)
  zip.file('word/styles.xml', stylesXml())
  zip.file('word/settings.xml', SETTINGS)
  zip.file('docProps/core.xml', coreXml(title))
  zip.file('docProps/app.xml', APP_XML)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

type El = Element

function kids(el: El | Document): El[] {
  const out: El[] = []
  const nodes = el.childNodes
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i] as unknown as El
    if (n.nodeType === 1) out.push(n)
  }
  return out
}
const local = (el: El) => el.localName || el.nodeName.replace(/^.*:/, '')
const child = (el: El | null | undefined, name: string) => (el ? kids(el).find((k) => local(k) === name) : undefined)
const wAttr = (el: El | null | undefined, name: string) =>
  el ? el.getAttributeNS(W_NS, name) ?? el.getAttribute('w:' + name) ?? null : null

/** Toggle properties like <w:b/>, <w:b w:val="0"/>, <w:b w:val="false"/> */
function isOn(el: El | undefined): boolean | undefined {
  if (!el) return undefined
  const v = wAttr(el, 'val')
  return !(v === '0' || v === 'false' || v === 'off' || v === 'none')
}

interface StyleInfo {
  name: string
  basedOn?: string
  bidi?: boolean
}

function parseStyles(xml: string | null): { styles: Map<string, StyleInfo>; defaultBidi?: boolean; defaultPara?: string } {
  const styles = new Map<string, StyleInfo>()
  if (!xml) return { styles }
  const doc = new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document
  const root = doc.documentElement as unknown as El
  let defaultBidi: boolean | undefined
  let defaultPara: string | undefined
  const dd = child(root, 'docDefaults')
  const pPrDef = child(child(dd, 'pPrDefault'), 'pPr')
  defaultBidi = isOn(child(pPrDef, 'bidi'))
  for (const s of kids(root)) {
    if (local(s) !== 'style' || wAttr(s, 'type') !== 'paragraph') continue
    const id = wAttr(s, 'styleId') ?? ''
    const name = (wAttr(child(s, 'name'), 'val') ?? id).toLowerCase()
    const basedOn = wAttr(child(s, 'basedOn'), 'val') ?? undefined
    const bidi = isOn(child(child(s, 'pPr'), 'bidi'))
    styles.set(id, { name, basedOn, bidi })
    if (wAttr(s, 'default') === '1' || wAttr(s, 'default') === 'true') defaultPara = id
  }
  return { styles, defaultBidi, defaultPara }
}

function styleBidi(id: string | undefined, ctx: ReturnType<typeof parseStyles>): boolean | undefined {
  let cur = id ?? ctx.defaultPara
  for (let guard = 0; cur && guard < 20; guard++) {
    const s = ctx.styles.get(cur)
    if (!s) break
    if (s.bidi !== undefined) return s.bidi
    cur = s.basedOn
  }
  if (id && ctx.defaultPara && id !== ctx.defaultPara) {
    const s = ctx.styles.get(ctx.defaultPara)
    if (s?.bidi !== undefined) return s.bidi
  }
  return ctx.defaultBidi
}

function headingLevel(id: string | undefined, ctx: ReturnType<typeof parseStyles>): number | null {
  if (!id) return null
  const name = ctx.styles.get(id)?.name ?? id.toLowerCase()
  if (name === 'title') return 1
  const m = /^heading\s*(\d)$/.exec(name) ?? /^heading(\d)$/.exec(id.toLowerCase())
  return m ? Number(m[1]) : null
}

interface RunFmt {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  font?: string
  sizePt?: number
}

function marksFor(f: RunFmt): PMMark[] | undefined {
  const marks: PMMark[] = []
  if (f.bold) marks.push({ type: 'bold' })
  if (f.italic) marks.push({ type: 'italic' })
  if (f.underline) marks.push({ type: 'underline' })
  if (f.font || f.sizePt) {
    const attrs: Record<string, unknown> = {}
    attrs.fontFamily = f.font ?? null
    attrs.fontSize = f.sizePt ? `${f.sizePt}pt` : null
    marks.push({ type: 'textStyle', attrs })
  }
  return marks.length ? marks : undefined
}

function readRunFmt(r: El): RunFmt {
  const rPr = child(r, 'rPr')
  if (!rPr) return {}
  const f: RunFmt = {}
  const b = isOn(child(rPr, 'b')) ?? isOn(child(rPr, 'bCs'))
  const i = isOn(child(rPr, 'i')) ?? isOn(child(rPr, 'iCs'))
  if (b) f.bold = true
  if (i) f.italic = true
  const u = child(rPr, 'u')
  if (u && wAttr(u, 'val') !== 'none') f.underline = true
  const rFonts = child(rPr, 'rFonts')
  const font = wAttr(rFonts, 'cs') || wAttr(rFonts, 'ascii') || wAttr(rFonts, 'hAnsi')
  if (font) f.font = font
  const sz = wAttr(child(rPr, 'szCs'), 'val') ?? wAttr(child(rPr, 'sz'), 'val')
  if (sz && isFinite(Number(sz))) f.sizePt = Number(sz) / 2
  return f
}

function sameMarks(a?: PMMark[], b?: PMMark[]): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? [])
}

export async function docxToDoc(data: Uint8Array | ArrayBuffer): Promise<{ doc: PMNode; title: string | null; warnings: string[] }> {
  const zip = await JSZip.loadAsync(data)
  const docFile = zip.file('word/document.xml')
  if (!docFile) throw new Error('הקובץ אינו מסמך Word תקין (חסר word/document.xml)')
  const xml = await docFile.async('string')
  const stylesXmlStr = (await zip.file('word/styles.xml')?.async('string')) ?? null
  const ctx = parseStyles(stylesXmlStr)
  const dom = new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document
  const body = child(dom.documentElement as unknown as El, 'body')
  const warnings = new Set<string>()
  const blocks: PMNode[] = []

  const readParagraph = (p: El): PMNode => {
    const pPr = child(p, 'pPr')
    const styleId = wAttr(child(pPr, 'pStyle'), 'val') ?? undefined
    const level = headingLevel(styleId, ctx)
    const inline: PMNode[] = []
    let plain = ''

    const pushText = (text: string, marks?: PMMark[]) => {
      if (!text) return
      plain += text
      const last = inline[inline.length - 1]
      if (last && last.type === 'text' && sameMarks(last.marks, marks)) last.text += text
      else inline.push(marks ? { type: 'text', text, marks } : { type: 'text', text })
    }

    const walk = (el: El) => {
      for (const k of kids(el)) {
        const name = local(k)
        if (name === 'r') {
          const marks = marksFor(readRunFmt(k))
          for (const rc of kids(k)) {
            const rn = local(rc)
            if (rn === 't') pushText(rc.textContent ?? '', marks)
            else if (rn === 'tab') pushText('\t', marks)
            else if (rn === 'br' || rn === 'cr') inline.push({ type: 'hardBreak' })
            else if (rn === 'noBreakHyphen') pushText('‑', marks)
            else if (rn === 'drawing' || rn === 'pict' || rn === 'object') warnings.add('תמונה או אובייקט')
            else if (rn === 'footnoteReference' || rn === 'endnoteReference') warnings.add('הערת שוליים')
            else if (rn === 'commentReference') warnings.add('הערה של Word')
          }
        } else if (['hyperlink', 'ins', 'moveTo', 'smartTag', 'fldSimple', 'customXml', 'sdt', 'sdtContent'].includes(name)) {
          walk(k)
        } else if (name === 'del' || name === 'moveFrom') {
          warnings.add('שינויים במעקב')
        }
      }
    }
    walk(p)
    if (child(pPr, 'numPr')) warnings.add('רשימה ממוספרת או תבליטים')

    const explicitBidi = isOn(child(pPr, 'bidi'))
    const bidi = explicitBidi ?? styleBidi(styleId, ctx) ?? (guessDir(plain) ?? 'rtl') === 'rtl'
    const dir: Dir = bidi ? 'rtl' : 'ltr'

    let textAlign: Align = null
    const jc = wAttr(child(pPr, 'jc'), 'val')
    if (jc === 'center') textAlign = 'center'
    else if (jc === 'both' || jc === 'distribute') textAlign = 'justify'
    else if (jc === 'start') textAlign = null
    else if (jc === 'end') textAlign = dir === 'rtl' ? 'left' : 'right'
    else if (jc === 'left') textAlign = dir === 'rtl' ? null : null // in RTL, Word's "left" is the start side
    else if (jc === 'right') textAlign = dir === 'rtl' ? 'left' : 'right'

    const attrs: Record<string, unknown> = { dir, textAlign }
    if (level) {
      attrs.level = level
      return { type: 'heading', attrs, content: inline.length ? inline : undefined }
    }
    return { type: 'paragraph', attrs, content: inline.length ? inline : undefined }
  }

  const walkBlocks = (el: El) => {
    for (const k of kids(el)) {
      const name = local(k)
      if (name === 'p') blocks.push(readParagraph(k))
      else if (name === 'tbl') {
        warnings.add('טבלה')
        // keep the text of the table, cell by cell
        for (const tr of kids(k).filter((x) => local(x) === 'tr'))
          for (const tc of kids(tr).filter((x) => local(x) === 'tc')) walkBlocks(tc)
      } else if (name === 'sdt') walkBlocks(child(k, 'sdtContent') ?? k)
      else if (name === 'customXml' || name === 'ins') walkBlocks(k)
    }
  }
  if (body) walkBlocks(body)

  // The first Heading 1 is the chapter title (that's how we write it). Other headings map to 2/3.
  let title: string | null = null
  const firstContentIdx = blocks.findIndex((b) => (b.content?.length ?? 0) > 0)
  if (firstContentIdx >= 0 && blocks[firstContentIdx].type === 'heading' && blocks[firstContentIdx].attrs?.level === 1) {
    title = (blocks[firstContentIdx].content ?? []).map((n) => n.text ?? '').join('').trim()
    blocks.splice(0, firstContentIdx + 1)
  }
  for (const b of blocks) {
    if (b.type === 'heading') {
      const lvl = Number(b.attrs?.level)
      b.attrs = { ...b.attrs, level: lvl <= 2 ? 2 : 3 }
    }
  }
  if (!blocks.length) blocks.push({ type: 'paragraph', attrs: { dir: 'rtl', textAlign: null } })
  return { doc: { type: 'doc', content: blocks }, title, warnings: [...warnings] }
}

/** True if this file was last written by הכריכייה (so overwriting it loses nothing). */
export async function isOurFile(data: Uint8Array): Promise<boolean> {
  try {
    const zip = await JSZip.loadAsync(data)
    const app = await zip.file('docProps/app.xml')?.async('string')
    return !!app && app.includes(`<Application>${APP_MARKER}</Application>`)
  } catch {
    return false
  }
}

export function emptyDoc(): PMNode {
  return { type: 'doc', content: [{ type: 'paragraph', attrs: { dir: 'rtl', textAlign: null } }] }
}

/** Word count for the status bar: tokens that contain a letter or digit. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
}
