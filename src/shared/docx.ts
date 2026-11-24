// Converts between the editor's document (TipTap / ProseMirror JSON) and Word .docx files.
//
// Supported today: paragraphs, chapter title (Heading 1), headings (Heading 2/3),
// bold, italic, underline, font, font size, alignment, paragraph direction (RTL/LTR),
// line breaks, tabs and footnotes (feature 15, plain text). Anything else found in a file opened
// from Word (images, tables, endnotes, comments, lists...) is reported in `warnings`, so the UI can
// protect it.

import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import type { PMMark, PMNode } from './types'
import { splitByDirection } from './hebrew'

export const DEFAULT_FONT = 'Frank Ruhl Libre'
export const DEFAULT_SIZE_PT = 14
export const APP_MARKER = 'HaKirchia'
/** First-line indent of body paragraphs, like printed books (1.5em at 14pt = 21pt). */
export const FIRST_LINE_INDENT_TWIPS = 420
/** Style for a body paragraph without the first-line indent (first after a heading, etc.) */
export const FIRST_PARAGRAPH_STYLE = 'FirstParagraph'

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
  // Mixed Hebrew and English: a run per direction, so Word lays out each piece correctly
  return splitByDirection(text, paraRtl)
    .map(({ text: piece, rtl }) => {
      const rPr = runProps(marks, rtl)
      // Tabs become <w:tab/> inside the run
      const inner = piece
        .split('\t')
        .map((t, i) => (i > 0 ? '<w:tab/>' : '') + (t ? `<w:t xml:space="preserve">${esc(t)}</w:t>` : ''))
        .join('')
      return `<w:r>${rPr}${inner}</w:r>`
    })
    .join('')
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

/** Footnote texts collected while writing a chapter; the n-th note gets id n (1, 2, ...). */
type Notes = string[]

function footnoteRun(notes: Notes | null, text: string): string {
  if (!notes) return ''
  notes.push(text)
  return `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${notes.length}"/></w:r>`
}

function paragraphXml(node: PMNode, styleId: string | null, notes: Notes | null = null, opts: { pageBreak?: boolean; before?: number } = {}): string {
  const dir: Dir = node.attrs?.dir === 'ltr' ? 'ltr' : 'rtl'
  const align = (node.attrs?.textAlign as Align) ?? null
  const pPr: string[] = []
  if (styleId) pPr.push(`<w:pStyle w:val="${styleId}"/>`)
  if (opts.pageBreak) pPr.push('<w:pageBreakBefore/>')
  pPr.push(dir === 'rtl' ? '<w:bidi/>' : '<w:bidi w:val="0"/>')
  if (opts.before) pPr.push(`<w:spacing w:before="${opts.before}"/>`)
  const jc = jcFor(align, dir)
  if (jc) pPr.push(`<w:jc w:val="${jc}"/>`)
  let runs = ''
  for (const child of node.content ?? []) {
    if (child.type === 'text' && child.text) runs += textRuns(child.text, child.marks, dir === 'rtl')
    else if (child.type === 'hardBreak') runs += '<w:r><w:br/></w:r>'
    else if (child.type === 'footnote') runs += footnoteRun(notes, String(child.attrs?.text ?? ''))
  }
  return `<w:p><w:pPr>${pPr.join('')}</w:pPr>${runs}</w:p>`
}

const isCentered = (n: PMNode) => n.attrs?.textAlign === 'center'
const hasText = (n: PMNode) => (n.content?.length ?? 0) > 0

/**
 * Book typesetting rule (the editor's CSS follows the same rule): a body paragraph gets a
 * first-line indent only when it follows another, non-empty, non-centered body paragraph.
 * So the first paragraph of a chapter, after a heading, after an empty line (scene break) or after
 * a centered line like "* * *" starts flush, and centered paragraphs are never indented.
 */
export function isIndented(node: PMNode, prev: PMNode | undefined): boolean {
  if (node.type !== 'paragraph' || isCentered(node)) return false
  return !!prev && prev.type === 'paragraph' && hasText(prev) && !isCentered(prev)
}

function bodyXml(doc: PMNode, title: string, notes: Notes, pageBreak = false, titleStyle = 'Heading1'): string {
  const out: string[] = []
  out.push(
    paragraphXml(
      { type: 'heading', attrs: { dir: guessDir(title) === 'ltr' ? 'ltr' : 'rtl' }, content: title ? [{ type: 'text', text: title }] : [] },
      titleStyle,
      null,
      { pageBreak }
    )
  )
  let prev: PMNode | undefined
  for (const node of doc.content ?? []) {
    if (node.type === 'paragraph') out.push(paragraphXml(node, isIndented(node, prev) ? null : FIRST_PARAGRAPH_STYLE, notes))
    else if (node.type === 'heading') {
      const level = Number(node.attrs?.level ?? 2)
      out.push(paragraphXml(node, level <= 2 ? 'Heading2' : 'Heading3', notes))
    } else if (node.content) {
      // Unknown block (should not happen with our editor schema): keep its text
      for (const c of node.content) if (c.type === 'paragraph' || c.type === 'heading') out.push(paragraphXml(c, null, notes))
    }
    prev = node
  }
  return out.join('')
}

/** word/footnotes.xml: the two separators Word expects, then one footnote per note. */
function footnotesXml(notes: Notes): string {
  const sep = `<w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>`
  const body = notes
    .map((text, i) => {
      const lines = text.split('\n')
      const paras = lines
        .map((line, k) => {
          const rtl = (guessDir(text) ?? 'rtl') === 'rtl'
          const ref = k === 0 ? '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>' : ''
          return `<w:p><w:pPr><w:pStyle w:val="FootnoteText"/>${rtl ? '<w:bidi/>' : '<w:bidi w:val="0"/>'}</w:pPr>${ref}${line ? textRuns(line, undefined, rtl) : ''}</w:p>`
        })
        .join('')
      return `<w:footnote w:id="${i + 1}">${paras}</w:footnote>`
    })
    .join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="${W_NS}">${sep}${body}</w:footnotes>`
}

const FOOTNOTES_CT = '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>'
const FOOTNOTES_REL = '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>'
const FOOTNOTE_PR = '<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>'

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>`

const SETTINGS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="${W_NS}"><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/>__FOOTNOTE_PR__<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat><w:themeFontLang w:val="he-IL" w:bidi="he-IL"/></w:settings>`

function stylesXml(font = DEFAULT_FONT, sizePt = DEFAULT_SIZE_PT, extra = ''): string {
  const f = esc(font)
  const sz = Math.round(sizePt * 2)
  const heading = (id: string, name: string, size: number, before: number, after: number, outline: number) =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="${FIRST_PARAGRAPH_STYLE}"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${before}" w:after="${after}"/><w:ind w:firstLine="0"/><w:outlineLvl w:val="${outline}"/></w:pPr><w:rPr><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W_NS}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:eastAsia="${f}" w:cs="${f}"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="he-IL"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:bidi/><w:spacing w:after="160" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:bidi/><w:ind w:firstLine="${FIRST_LINE_INDENT_TWIPS}"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="${FIRST_PARAGRAPH_STYLE}"><w:name w:val="First Paragraph"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:firstLine="0"/></w:pPr></w:style>${heading('Heading1', 'heading 1', 40, 240, 480, 0)}${heading('Heading2', 'heading 2', 32, 360, 160, 1)}${heading('Heading3', 'heading 3', 30, 280, 120, 2)}<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style><w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>${extra}<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style></w:styles>`
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
  const notes: Notes = []
  const body = bodyXml(doc, title, notes)
  const hasNotes = notes.length > 0
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W_NS}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/><w:bidi/></w:sectPr></w:body></w:document>`
  zip.file('[Content_Types].xml', hasNotes ? CONTENT_TYPES.replace('</Types>', `${FOOTNOTES_CT}</Types>`) : CONTENT_TYPES)
  zip.file('_rels/.rels', ROOT_RELS)
  zip.file('word/document.xml', documentXml)
  zip.file('word/_rels/document.xml.rels', hasNotes ? DOC_RELS.replace('</Relationships>', `${FOOTNOTES_REL}</Relationships>`) : DOC_RELS)
  zip.file('word/styles.xml', stylesXml())
  zip.file('word/settings.xml', SETTINGS.replace('__FOOTNOTE_PR__', hasNotes ? FOOTNOTE_PR : ''))
  if (hasNotes) zip.file('word/footnotes.xml', footnotesXml(notes))
  zip.file('docProps/core.xml', coreXml(title))
  zip.file('docProps/app.xml', APP_XML)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

// ---------------------------------------------------------------------------
// The whole book as one Word file (export, feature 16)
// ---------------------------------------------------------------------------

/** One piece of the exported book. Each piece starts on a new page. */
export type DocxBookItem =
  | { kind: 'title'; title: string; subtitle: string; author: string; extra: string[] }
  | { kind: 'matter'; heading: string; lines: string[]; centered: boolean }
  | { kind: 'toc'; heading: string; entries: string[] }
  | { kind: 'part'; title: string }
  | { kind: 'chapter'; title: string; doc: PMNode }

export interface DocxBookOptions {
  /** Page size in millimetres */
  pageW: number
  pageH: number
  /** Margins in millimetres */
  margin: { top: number; bottom: number; side: number }
  font: string
  fontSize: number
  /** How titles look (the layout's element styles) */
  styles?: Partial<Record<'chapterTitle' | 'partTitle' | 'bookTitle' | 'matterTitle', { font: string; size: number; bold: boolean; align: string }>>
}

/** A style that changes another one's font, size, weight and placement */
function overrideStyle(id: string, name: string, basedOn: string, t: { font: string; size: number; bold: boolean; align: string }, outline?: number): string {
  const f = t.font ? esc(t.font) : ''
  const sz = Math.round(t.size * 2)
  // in a right-to-left paragraph Word's "start" is the right side
  const jc = t.align === 'center' ? 'center' : t.align === 'end' ? 'end' : t.align === 'start' ? 'start' : ''
  return `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="${basedOn}"/><w:next w:val="${FIRST_PARAGRAPH_STYLE}"/><w:qFormat/><w:pPr><w:keepNext/>${jc ? `<w:jc w:val="${jc}"/>` : ''}${outline !== undefined ? `<w:outlineLvl w:val="${outline}"/>` : ''}</w:pPr><w:rPr>${f ? `<w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:cs="${f}"/>` : ''}${t.bold ? '<w:b/><w:bCs/>' : ''}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr></w:style>`
}

const BOOK_STYLES =
  '<w:style w:type="paragraph" w:styleId="PartTitle"><w:name w:val="Part Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="3600" w:after="240"/><w:ind w:firstLine="0"/><w:jc w:val="center"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:sz w:val="52"/><w:szCs w:val="52"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="BookTitle"><w:name w:val="Book Title Page"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="60"/><w:szCs w:val="60"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="MatterHeading"><w:name w:val="Matter Heading"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="720" w:after="360"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="MatterText"><w:name w:val="Matter Text"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="120"/><w:ind w:firstLine="0"/></w:pPr></w:style>'

const textPara = (text: string, styleId: string, opts: { pageBreak?: boolean; before?: number; center?: boolean } = {}) =>
  paragraphXml(
    { type: 'paragraph', attrs: { dir: guessDir(text) === 'ltr' ? 'ltr' : 'rtl', ...(opts.center ? { textAlign: 'center' } : {}) }, content: text ? [{ type: 'text', text }] : [] },
    styleId,
    null,
    opts
  )

/**
 * An empty paragraph that starts a new page and leaves room above what follows. (Space before a
 * paragraph at the top of a page is dropped by some programs; space after an empty one is kept.)
 */
const spacer = (pageBreak: boolean, after: number) =>
  `<w:p><w:pPr><w:pStyle w:val="MatterText"/>${pageBreak ? '<w:pageBreakBefore/>' : ''}<w:spacing w:before="0" w:after="${after}"/></w:pPr></w:p>`

const mmToTwips = (mm: number) => Math.round(mm * 56.6929)

function itemXml(item: DocxBookItem, first: boolean, notes: Notes, titleStyle = 'Heading1', styleFor: (base: string) => string = (b) => b): string {
  const pageBreak = !first
  switch (item.kind) {
    case 'title': {
      const out = [spacer(pageBreak, 2800), textPara(item.title, styleFor('BookTitle'))]
      if (item.subtitle) out.push(textPara(item.subtitle, 'MatterText', { center: true }))
      if (item.author) out.push(textPara(item.author, 'MatterText', { center: true, before: 1800 }))
      item.extra.forEach((l, i) => out.push(textPara(l, 'MatterText', { center: true, before: i === 0 ? 1800 : 0 })))
      return out.join('')
    }
    case 'matter': {
      const out: string[] = []
      if (item.heading) out.push(textPara(item.heading, styleFor('MatterHeading'), { pageBreak }))
      else out.push(spacer(pageBreak, item.centered ? 3000 : 0))
      item.lines.forEach((l) => out.push(textPara(l, 'MatterText', { center: item.centered })))
      return out.join('')
    }
    case 'toc': {
      // A real Word table of contents (a field); Word offers to update it, with page numbers, when the file opens
      const head = textPara(item.heading, styleFor('MatterHeading'), { pageBreak })
      const begin = '<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-1" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>'
      const end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
      const lines = item.entries.length ? item.entries : ['']
      const paras = lines.map((l, i) => {
        const rtl = guessDir(l) !== 'ltr'
        return `<w:p><w:pPr><w:pStyle w:val="MatterText"/>${rtl ? '<w:bidi/>' : '<w:bidi w:val="0"/>'}</w:pPr>${i === 0 ? begin : ''}${l ? textRuns(l, undefined, rtl) : ''}${i === lines.length - 1 ? end : ''}</w:p>`
      })
      return head + paras.join('')
    }
    case 'part':
      return textPara(item.title, styleFor('PartTitle'), { pageBreak })
    case 'chapter':
      return bodyXml(item.doc, item.title, notes, pageBreak, titleStyle)
  }
}

export async function bookToDocx(items: DocxBookItem[], title: string, opts: DocxBookOptions): Promise<Uint8Array> {
  const zip = new JSZip()
  const notes: Notes = []
  const st = opts.styles ?? {}
  const titleStyle = st.chapterTitle ? 'ChapterTitle' : 'Heading1'
  const ids: Record<string, string> = { partTitle: 'PartTitleX', bookTitle: 'BookTitleX', matterTitle: 'MatterHeadingX' }
  const extra =
    (st.chapterTitle ? overrideStyle('ChapterTitle', 'Chapter Title', 'Heading1', st.chapterTitle, 0) : '') +
    (st.partTitle ? overrideStyle(ids.partTitle, 'Part Title (book)', 'PartTitle', st.partTitle, 0) : '') +
    (st.bookTitle ? overrideStyle(ids.bookTitle, 'Book Title (book)', 'BookTitle', st.bookTitle) : '') +
    (st.matterTitle ? overrideStyle(ids.matterTitle, 'Matter Heading (book)', 'MatterHeading', st.matterTitle) : '')
  const styleFor = (base: string) => (base === 'PartTitle' && st.partTitle ? ids.partTitle : base === 'BookTitle' && st.bookTitle ? ids.bookTitle : base === 'MatterHeading' && st.matterTitle ? ids.matterTitle : base)
  const body = items.map((it, i) => itemXml(it, i === 0, notes, titleStyle, styleFor)).join('')
  const hasNotes = notes.length > 0
  const side = mmToTwips(opts.margin.side)
  const sect = `<w:sectPr><w:pgSz w:w="${mmToTwips(opts.pageW)}" w:h="${mmToTwips(opts.pageH)}"/><w:pgMar w:top="${mmToTwips(opts.margin.top)}" w:right="${side}" w:bottom="${mmToTwips(opts.margin.bottom)}" w:left="${side}" w:header="567" w:footer="567" w:gutter="0"/><w:bidi/></w:sectPr>`
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W_NS}"><w:body>${body}${sect}</w:body></w:document>`
  const hasToc = items.some((i) => i.kind === 'toc')
  zip.file('[Content_Types].xml', hasNotes ? CONTENT_TYPES.replace('</Types>', `${FOOTNOTES_CT}</Types>`) : CONTENT_TYPES)
  zip.file('_rels/.rels', ROOT_RELS)
  zip.file('word/document.xml', documentXml)
  zip.file('word/_rels/document.xml.rels', hasNotes ? DOC_RELS.replace('</Relationships>', `${FOOTNOTES_REL}</Relationships>`) : DOC_RELS)
  zip.file('word/styles.xml', stylesXml(opts.font, opts.fontSize, BOOK_STYLES + extra))
  // updateFields: Word asks to update the table of contents (page numbers) when the file opens
  zip.file('word/settings.xml', SETTINGS.replace('__FOOTNOTE_PR__', (hasToc ? '<w:updateFields w:val="true"/>' : '') + (hasNotes ? FOOTNOTE_PR : '')))
  if (hasNotes) zip.file('word/footnotes.xml', footnotesXml(notes))
  zip.file('docProps/core.xml', coreXml(title))
  // Not marked as made by the app: this file is for others (and is not a chapter file)
  zip.file('docProps/app.xml', APP_XML.replace(APP_MARKER, `${APP_MARKER} export`))
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
  if (name === 'title') return 0
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

/** Footnotes of a Word file: id → plain text (paragraphs joined by line breaks). */
async function readFootnotes(zip: JSZip): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const xml = await zip.file('word/footnotes.xml')?.async('string')
  if (!xml) return out
  const dom = new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document
  for (const fn of kids(dom.documentElement as unknown as El)) {
    if (local(fn) !== 'footnote') continue
    const type = wAttr(fn, 'type')
    if (type && type !== 'normal') continue
    const lines: string[] = []
    const walk = (el: El, acc: { s: string }) => {
      for (const k of kids(el)) {
        const n = local(k)
        if (n === 't') acc.s += k.textContent ?? ''
        else if (n === 'tab') acc.s += '\t'
        else if (n === 'br') acc.s += '\n'
        else if (n !== 'rPr' && n !== 'pPr' && n !== 'footnoteRef') walk(k, acc)
      }
    }
    for (const p of kids(fn)) {
      if (local(p) !== 'p') continue
      const acc = { s: '' }
      walk(p, acc)
      lines.push(acc.s)
    }
    // Word puts a space after the note's number; it is not part of the note
    out.set(wAttr(fn, 'id') ?? '', lines.join('\n').replace(/^\s+/, '').replace(/\s+$/, ''))
  }
  return out
}

/**
 * The paragraphs of a Word file as they are, before any chapter rules: headings keep their Word
 * level (the "Title" style is level 0). With `splitPages`, a page break ends its paragraph and the
 * block after it gets attrs.pageBreak = true (used to split a whole manuscript into chapters).
 */
export async function docxBlocks(data: Uint8Array | ArrayBuffer, opts: { splitPages?: boolean } = {}): Promise<{ blocks: PMNode[]; warnings: string[] }> {
  const zip = await JSZip.loadAsync(data)
  const docFile = zip.file('word/document.xml')
  if (!docFile) throw new Error('הקובץ אינו מסמך Word תקין (חסר word/document.xml)')
  const xml = await docFile.async('string')
  const stylesXmlStr = (await zip.file('word/styles.xml')?.async('string')) ?? null
  const ctx = parseStyles(stylesXmlStr)
  const footnotes = await readFootnotes(zip)
  const dom = new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document
  const body = child(dom.documentElement as unknown as El, 'body')
  const warnings = new Set<string>()
  const blocks: PMNode[] = []

  const readParagraph = (p: El): PMNode[] => {
    const pPr = child(p, 'pPr')
    const styleId = wAttr(child(pPr, 'pStyle'), 'val') ?? undefined
    const level = headingLevel(styleId, ctx)
    const inline: PMNode[] = []
    /** where page breaks were, as positions in `inline` (only with splitPages) */
    const pageBreakAt: number[] = []
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
            else if (rn === 'br' && opts.splitPages && wAttr(rc, 'type') === 'page') pageBreakAt.push(inline.length)
            else if (rn === 'br' || rn === 'cr') inline.push({ type: 'hardBreak' })
            else if (rn === 'noBreakHyphen') pushText('‑', marks)
            else if (rn === 'drawing' || rn === 'pict' || rn === 'object') warnings.add('תמונה או אובייקט')
            else if (rn === 'footnoteReference') {
              const id = wAttr(rc, 'id') ?? ''
              const text = footnotes.get(id)
              if (text === undefined) warnings.add('הערת שוליים')
              else inline.push({ type: 'footnote', attrs: { text } })
            } else if (rn === 'endnoteReference') warnings.add('הערת סיום')
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
    const make = (content: PMNode[], extra?: Record<string, unknown>): PMNode => {
      const a = { ...attrs, ...extra }
      // a hard line break left at the edge of a piece (around a page break) means nothing
      while (content[0]?.type === 'hardBreak') content = content.slice(1)
      while (content[content.length - 1]?.type === 'hardBreak') content = content.slice(0, -1)
      if (level !== null) return { type: 'heading', attrs: { ...a, level }, content: content.length ? content : undefined }
      return { type: 'paragraph', attrs: a, content: content.length ? content : undefined }
    }
    if (!opts.splitPages) return [make(inline)]
    const before = isOn(child(pPr, 'pageBreakBefore')) ? { pageBreak: true } : undefined
    if (!pageBreakAt.length) return [make(inline, before)]
    // a page break inside the paragraph: the text after it starts a new page
    const out: PMNode[] = []
    let from = 0
    let flag = before
    for (const at of [...pageBreakAt, inline.length]) {
      const piece = inline.slice(from, at)
      if (piece.some((n) => n.type !== 'hardBreak') || from === 0) out.push(make(piece, flag))
      flag = { pageBreak: true }
      from = at
    }
    // a paragraph that ends with a page break: the next paragraph starts the new page
    if (pageBreakAt[pageBreakAt.length - 1] === inline.length && out.length) {
      pendingBreak = true
      if (!out[out.length - 1].content && out.length > 1) out.pop()
    }
    return out.filter((b, i) => i === 0 || b.content)
  }
  let pendingBreak = false

  const walkBlocks = (el: El) => {
    for (const k of kids(el)) {
      const name = local(k)
      if (name === 'p') {
        const got = readParagraph(k)
        if (pendingBreak && got.length) {
          // the break ended the previous paragraph; this one starts the new page
          const carry = !got[0].attrs?.pageBreak
          pendingBreak = false
          if (carry) got[0].attrs = { ...got[0].attrs, pageBreak: true }
        }
        blocks.push(...got)
      }
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
  return { blocks, warnings: [...warnings] }
}

export async function docxToDoc(data: Uint8Array | ArrayBuffer): Promise<{ doc: PMNode; title: string | null; warnings: string[] }> {
  const { blocks, warnings } = await docxBlocks(data)
  // the "Title" style counts as a chapter title, like Heading 1
  for (const b of blocks) if (b.type === 'heading' && b.attrs?.level === 0) b.attrs = { ...b.attrs, level: 1 }

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
  return { doc: { type: 'doc', content: blocks }, title, warnings }
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

/** The plain text of a document, one line per paragraph (for word counts outside the editor). */
export function docText(node: PMNode): string {
  if (typeof node.text === 'string') return node.text
  if (node.type === 'hardBreak') return '\n'
  const inner = (node.content ?? []).map(docText)
  return node.type === 'doc' || node.type === 'blockquote' || node.type === 'bulletList' || node.type === 'orderedList' || node.type === 'listItem' ? inner.join('\n') : inner.join('')
}

/** Word count for the status bar: tokens that contain a letter or digit. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
}
