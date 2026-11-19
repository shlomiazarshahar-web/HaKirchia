// The whole book as HTML (features 31, 16, 36): the front pages, the parts, the chapters and the
// back pages, in order. One builder for the reading view, the PDF and the ePub, so they all show the
// same book. The output is also valid XHTML (ePub needs that): every tag is closed and only the
// five XML entities are used.

import type { OutlineNode, PMMark, PMNode } from './types'
import { isSceneBreak } from './scenes'
import { isIndented, guessDir } from './docx'
import { backPages, frontPages, MATTER_KINDS, matterLines, PAGE_SIZES, type BookInfo, type BookLayout, type MatterPage, type PublishSettings } from './publish'

export interface BookChapterData {
  id: string
  title: string
  doc: PMNode
}

export interface BookData {
  title: string
  chapters: BookChapterData[]
  outline: OutlineNode[]
  publish: PublishSettings
}

export type Section =
  | { kind: 'matter'; id: string; page: MatterPage; html: string }
  | { kind: 'part'; id: string; title: string; html: string }
  | { kind: 'chapter'; id: string; title: string; html: string; partTitle?: string }

export interface TocEntry {
  /** The section it points to */
  id: string
  title: string
  /** 0 = part, or a chapter outside parts; 1 = a chapter inside a part */
  level: 0 | 1
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export function esc(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** A CSS string literal ("…"), for running heads */
export function cssString(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r]+/g, ' ') + '"'
}

const fontName = (v: unknown): string | null => {
  if (typeof v !== 'string' || !v.trim()) return null
  return v.split(',')[0].trim().replace(/^["']|["']$/g, '') || null
}
const fontSize = (v: unknown): string | null => {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  const s = String(v).trim()
  const n = parseFloat(s)
  if (!isFinite(n) || n <= 0) return null
  return s.endsWith('px') ? `${n * 0.75}pt` : `${n}pt`
}

function wrapMarks(html: string, marks: PMMark[] | undefined): string {
  let out = html
  const style: string[] = []
  for (const m of marks ?? []) {
    if (m.type === 'bold') out = `<b>${out}</b>`
    else if (m.type === 'italic') out = `<i>${out}</i>`
    else if (m.type === 'underline') out = `<u>${out}</u>`
    else if (m.type === 'textStyle') {
      const f = fontName(m.attrs?.fontFamily)
      const s = fontSize(m.attrs?.fontSize)
      if (f) style.push(`font-family: '${f.replace(/'/g, '')}'`)
      if (s) style.push(`font-size: ${s}`)
    }
  }
  return style.length ? `<span style="${esc(style.join('; '))}">${out}</span>` : out
}

/** Footnotes of one chapter while it is being written out */
export interface NoteCollector {
  /** Prefix for the anchors, unique per chapter */
  prefix: string
  notes: string[]
  /** 'end': numbered notes at the end of the chapter (reading view, PDF). 'epub': ePub pop-up notes. */
  mode: 'end' | 'epub'
}

function noteRef(c: NoteCollector, text: string): string {
  c.notes.push(text)
  const n = c.notes.length
  const id = `${c.prefix}-n${n}`
  const extra = c.mode === 'epub' ? ' epub:type="noteref"' : ''
  return `<sup class="fn"><a href="#${id}" id="${id}-ref"${extra}>${n}</a></sup>`
}

export function inlineHtml(nodes: PMNode[] | undefined, notes: NoteCollector | null): string {
  let out = ''
  for (const n of nodes ?? []) {
    if (n.type === 'text' && n.text) out += wrapMarks(esc(n.text).replace(/\t/g, '<span class="tab">\t</span>'), n.marks)
    else if (n.type === 'hardBreak') out += '<br/>'
    else if (n.type === 'footnote' && notes) out += noteRef(notes, String(n.attrs?.text ?? ''))
    else if (n.content) out += inlineHtml(n.content, notes)
  }
  return out
}

const plain = (n: PMNode): string => (typeof n.text === 'string' ? n.text : (n.content ?? []).map(plain).join(''))

function alignStyle(node: PMNode): string {
  const a = node.attrs?.textAlign
  if (a === 'center' || a === 'justify') return ` style="text-align: ${a}"`
  if (a === 'left' || a === 'right') {
    // "right" in a right-to-left paragraph is its start; only the opposite side needs a style
    const dir = node.attrs?.dir === 'ltr' ? 'ltr' : 'rtl'
    if ((dir === 'rtl' && a === 'left') || (dir === 'ltr' && a === 'right')) return ` style="text-align: ${a}"`
  }
  return ''
}

/** The body of a chapter (without its title). Paragraph indents follow the editor's (and Word's) book rule. */
export function chapterBodyHtml(doc: PMNode, notes: NoteCollector | null): string {
  const out: string[] = []
  let prev: PMNode | undefined
  for (const node of doc.content ?? []) {
    const dir = node.attrs?.dir === 'ltr' ? ' dir="ltr"' : ''
    if (node.type === 'paragraph') {
      const text = plain(node)
      if (isSceneBreak(text)) out.push(`<p class="scene"${dir}>${esc(text.trim())}</p>`)
      else if (!(node.content ?? []).length) out.push('<p class="empty">&#160;</p>')
      else out.push(`<p class="${isIndented(node, prev) && !isSceneBreak(prev ? plain(prev) : '') ? 'ind' : 'flush'}"${dir}${alignStyle(node)}>${inlineHtml(node.content, notes)}</p>`)
    } else if (node.type === 'heading') {
      const tag = Number(node.attrs?.level ?? 2) <= 2 ? 'h2' : 'h3'
      out.push(`<${tag}${dir}${alignStyle(node)}>${inlineHtml(node.content, notes)}</${tag}>`)
    } else if (node.content) {
      for (const c of node.content) if (c.type === 'paragraph' || c.type === 'heading') out.push(`<p class="flush">${inlineHtml(c.content, notes)}</p>`)
    }
    prev = node
  }
  return out.join('\n')
}

function notesHtml(c: NoteCollector): string {
  if (!c.notes.length) return ''
  if (c.mode === 'epub') {
    return c.notes
      .map((t, i) => {
        const id = `${c.prefix}-n${i + 1}`
        return `<aside epub:type="footnote" id="${id}" class="bk-note"><p><a href="#${id}-ref">${i + 1}</a>. ${esc(t).replace(/\n/g, '<br/>')}</p></aside>`
      })
      .join('\n')
  }
  const items = c.notes.map((t, i) => `<li id="${c.prefix}-n${i + 1}">${esc(t).replace(/\n/g, '<br/>')}</li>`).join('')
  return `<div class="bk-notes"><div class="bk-notes-h">הערות</div><ol>${items}</ol></div>`
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

const dirOf = (t: string) => (guessDir(t) === 'ltr' ? ' dir="ltr"' : '')

export function titlePageHtml(title: string, info: BookInfo): string {
  return [
    `<div class="bk-t"${dirOf(title)}>${esc(title)}</div>`,
    info.subtitle.trim() ? `<div class="bk-sub"${dirOf(info.subtitle)}>${esc(info.subtitle.trim())}</div>` : '',
    info.author.trim() ? `<div class="bk-author"${dirOf(info.author)}>${esc(info.author.trim())}</div>` : ''
  ].join('')
}

/** The table of contents. `pages` (section id → page number) fills in the numbers when they are known. */
export function tocHtml(entries: TocEntry[], pages?: Record<string, number>, links = true): string {
  const items = entries
    .map((e) => {
      const t = links ? `<a href="#sec-${e.id}">${esc(e.title)}</a>` : esc(e.title)
      const pg = pages?.[e.id]
      return `<li class="lvl${e.level}"><span class="t">${t}</span><span class="dots"></span><span class="pg" data-toc="${e.id}">${pg ? pg : ''}</span></li>`
    })
    .join('')
  return `<ol class="bk-toc-list">${items}</ol>`
}

export function matterHtml(page: MatterPage, title: string, info: BookInfo, toc: TocEntry[], pages?: Record<string, number>): string {
  if (page.kind === 'title') {
    const extra = page.text.trim() ? `<div class="bk-title-extra">${linesHtml(page.text)}</div>` : ''
    return titlePageHtml(title, info) + extra
  }
  const heading = page.heading.trim() ? `<h1 class="bk-m-title"${dirOf(page.heading)}>${esc(page.heading.trim())}</h1>` : ''
  if (page.kind === 'toc') return heading + tocHtml(toc, pages)
  return heading + `<div class="bk-m-text">${linesHtml(page.text)}</div>`
}

function linesHtml(text: string): string {
  return matterLines(text)
    .map((l) => (l.trim() ? `<p${dirOf(l)}>${esc(l)}</p>` : '<p class="empty">&#160;</p>'))
    .join('')
}

export function tocEntries(data: BookData): TocEntry[] {
  const out: TocEntry[] = []
  const title = (id: string) => data.chapters.find((c) => c.id === id)?.title
  for (const n of data.outline) {
    if (n.type === 'part') {
      out.push({ id: n.id, title: n.title, level: 0 })
      for (const id of n.children) {
        const t = title(id)
        if (t !== undefined) out.push({ id, title: t, level: 1 })
      }
    } else {
      const t = title(n.id)
      if (t !== undefined) out.push({ id: n.id, title: t, level: 0 })
    }
  }
  return out
}

/**
 * The book's sections, in reading order. Each section's html is its inside; `sectionTag` wraps it.
 * `noteMode` decides how footnotes come out.
 */
export function bookSections(data: BookData, noteMode: 'end' | 'epub' = 'end', pages?: Record<string, number>): Section[] {
  const { publish } = data
  const toc = tocEntries(data)
  const out: Section[] = []
  const withMatter = publish.layout.matter
  const matter = (p: MatterPage): Section => ({ kind: 'matter', id: p.id, page: p, html: matterHtml(p, data.title, publish.info, toc, pages) })
  if (withMatter) out.push(...frontPages(publish.matter).map(matter))
  const byId = new Map(data.chapters.map((c) => [c.id, c]))
  const chapter = (id: string, partTitle?: string) => {
    const c = byId.get(id)
    if (!c) return
    const notes: NoteCollector = { prefix: `c${out.length}`, notes: [], mode: noteMode }
    const body = chapterBodyHtml(c.doc, notes)
    const html = `<h1 class="bk-ch-title"${dirOf(c.title)}>${esc(c.title)}</h1>\n${body}\n${notesHtml(notes)}`
    out.push({ kind: 'chapter', id: c.id, title: c.title, html, ...(partTitle ? { partTitle } : {}) })
  }
  for (const n of data.outline) {
    if (n.type === 'part') {
      out.push({ kind: 'part', id: n.id, title: n.title, html: `<h1 class="bk-part-title"${dirOf(n.title)}>${esc(n.title)}</h1>` })
      n.children.forEach((id) => chapter(id, n.title))
    } else chapter(n.id)
  }
  if (withMatter) out.push(...backPages(publish.matter).map(matter))
  return out
}

/** Classes of a section's wrapper */
export function sectionClass(s: Section, layout: BookLayout): string {
  if (s.kind === 'matter') return `bk-sec bk-matter bk-${s.page.kind}${MATTER_KINDS[s.page.kind].centered ? ' centered' : ''}`
  if (s.kind === 'part') return `bk-sec bk-part${layout.partPage ? ' own-page' : ''}`
  return `bk-sec bk-chapter${layout.chapterNewPage ? ' new-page' : ''}`
}

export function sectionTag(s: Section, layout: BookLayout, index: number, extraAttrs = ''): string {
  return `<section class="${sectionClass(s, layout)}" id="sec-${esc(s.id)}" data-sec="${index}"${extraAttrs}>\n${s.html}\n</section>`
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

/** The page's printable area, in millimetres: margins grow a little with the page */
export function pageGeometry(layout: BookLayout): { w: number; h: number; top: number; bottom: number; inner: number; outer: number } {
  const s = PAGE_SIZES[layout.pageSize]
  const k = s.w / 148
  return { w: s.w, h: s.h, top: Math.round(18 * k), bottom: Math.round(20 * k), inner: Math.round(20 * k), outer: Math.round(15 * k) }
}

/**
 * The look of the book's text, shared by the reading view, the PDF and the ePub.
 * `scope` is a selector the rules are put under (the reading view puts the book inside the app).
 */
export function bookCss(layout: BookLayout, scope = ''): string {
  const s = scope ? scope + ' ' : ''
  const font = `'${layout.font.replace(/'/g, '')}', 'Frank Ruhl Libre', serif`
  return `
${s}.bk-sec { font-family: ${font}; font-size: ${layout.fontSize}pt; line-height: ${layout.lineHeight}; color: #1a1a1a; text-align: ${layout.justify ? 'justify' : 'start'}; hyphens: manual; orphans: 2; widows: 2; }
${s}.bk-sec p { margin: 0; }
${s}.bk-sec p.ind { text-indent: 1.5em; }
${s}.bk-sec p.scene { text-align: center; text-indent: 0; margin: 0.8em 0; letter-spacing: 0.3em; break-after: avoid; }
${s}.bk-sec .tab { white-space: pre; }
${s}.bk-sec h2 { font-size: 1.25em; font-weight: 600; margin: 1.2em 0 0.5em; text-align: start; break-after: avoid; }
${s}.bk-sec h3 { font-size: 1.1em; font-weight: 600; margin: 1em 0 0.4em; text-align: start; break-after: avoid; }
${s}.bk-sec sup.fn { font-size: 0.7em; line-height: 0; }
${s}.bk-sec sup.fn a { color: inherit; text-decoration: none; }
${s}.bk-ch-title { font-size: 1.9em; font-weight: 500; line-height: 1.25; text-align: center; margin: 3.2em 0 2em; break-after: avoid; }
${s}.bk-part-title { font-size: 2.2em; font-weight: 500; line-height: 1.25; text-align: center; margin: 0; }
${s}.bk-part { text-align: center; padding: 2em 0; }
${s}.bk-part.own-page { display: flex; flex-direction: column; justify-content: center; align-items: center; }
${s}.bk-notes { margin-top: 2em; font-size: 0.85em; line-height: 1.4; text-align: start; break-inside: auto; }
${s}.bk-notes-h { font-weight: 600; margin-bottom: 0.4em; border-top: 1px solid #999; padding-top: 0.6em; width: 40%; }
${s}.bk-notes ol { margin: 0; padding-inline-start: 1.6em; }
${s}.bk-notes li { margin-bottom: 0.3em; }
${s}.bk-matter { text-align: start; }
${s}.bk-matter.centered { display: flex; flex-direction: column; justify-content: center; text-align: center; }
${s}.bk-matter.centered .bk-m-text { margin-bottom: 15%; }
${s}.bk-title .bk-t { font-size: 2.6em; font-weight: 500; line-height: 1.2; }
${s}.bk-title .bk-sub { font-size: 1.3em; margin-top: 0.6em; }
${s}.bk-title .bk-author { font-size: 1.3em; margin-top: 3em; }
${s}.bk-title .bk-title-extra { margin-top: 4em; font-size: 0.9em; }
${s}.bk-copyright { display: flex; flex-direction: column; justify-content: flex-end; font-size: 0.85em; }
${s}.bk-motto .bk-m-text { font-style: italic; }
${s}.bk-motto .bk-m-text p:last-child:not(:first-child) { font-style: normal; font-size: 0.9em; margin-top: 0.6em; }
${s}.bk-m-title { font-size: 1.6em; font-weight: 500; text-align: center; margin: 2em 0 1.4em; }
${s}.bk-m-text p { margin: 0 0 0.5em; }
${s}.bk-toc-list { list-style: none; margin: 0; padding: 0; text-align: start; }
${s}.bk-toc-list li { display: flex; align-items: baseline; gap: 0.4em; margin: 0 0 0.45em; }
${s}.bk-toc-list li.lvl0 { font-weight: 600; margin-top: 0.8em; }
${s}.bk-toc-list li.lvl1 { padding-inline-start: 1.4em; }
${s}.bk-toc-list li:first-child { margin-top: 0; }
${s}.bk-toc-list .t a { color: inherit; text-decoration: none; }
${s}.bk-toc-list .dots { flex: 1; border-bottom: 1px dotted #888; transform: translateY(-0.3em); min-width: 1em; }
${s}.bk-toc-list .pg { min-width: 1.5em; text-align: end; font-variant-numeric: tabular-nums; }
${s}.bk-sec a { color: inherit; }
`
}

// ---------------------------------------------------------------------------
// Printing (the PDF export)
// ---------------------------------------------------------------------------

/**
 * Page rules for the PDF. In a right-to-left book Chromium puts the first page on the left, like a
 * Hebrew book: odd pages are left-hand pages (binding on their right side), even pages are right-hand.
 * Odd pages show the chapter's title at the top and even pages the book's title.
 */
export function printCss(layout: BookLayout, sections: Section[], bookTitle: string): string {
  const g = pageGeometry(layout)
  const contentH = g.h - g.top - g.bottom
  const font = `'${layout.font.replace(/'/g, '')}', 'Frank Ruhl Libre', serif`
  const box = `font-family: ${font}; font-size: ${Math.max(7, layout.fontSize - 3)}pt; color: #555;`
  const num = layout.pageNumbers ? `@bottom-center { content: counter(page); ${box} }` : ''
  const rules: string[] = [
    `@page { size: ${g.w}mm ${g.h}mm; margin: ${g.top}mm ${g.outer}mm ${g.bottom}mm ${g.inner}mm; ${num} }`,
    `@page :left { margin-left: ${g.outer}mm; margin-right: ${g.inner}mm; }`,
    `@page :right { margin-left: ${g.inner}mm; margin-right: ${g.outer}mm; }`,
    `@page matter { @bottom-center { content: none; } @top-center { content: none; } }`,
    `@page part { @bottom-center { content: none; } @top-center { content: none; } }`,
    `@page blank { @bottom-center { content: none; } @top-center { content: none; } }`,
    `html, body, #root { margin: 0 !important; padding: 0; height: auto !important; overflow: visible !important; background: #fff !important; }`,
    `.bk-matter { page: matter; break-before: page; }`,
    `.bk-matter.centered, .bk-copyright { height: ${contentH - 2}mm; box-sizing: border-box; }`,
    `.bk-part { break-before: page; }`,
    `.bk-part.own-page { page: part; break-after: page; height: ${contentH - 2}mm; box-sizing: border-box; padding: 0; }`,
    `.bk-chapter.new-page { break-before: page; }`,
    `.bk-chapter:not(.new-page) .bk-ch-title { margin-top: 2em; }`,
    `.bk-blank { page: blank; break-before: page; height: 1px; }`,
    `.bk-sec:first-child { break-before: auto; }`,
    `.bk-toc-list .t a, .bk-sec sup.fn a { text-decoration: none; }`,
    `.pmk { position: absolute; top: 0; right: 0; font-size: 2px; line-height: 1; color: #fff; white-space: nowrap; }`,
    `.bk-sec { position: relative; }`
  ]
  if (layout.runningHeads) {
    const head = (text: string) => `@top-center { content: ${cssString(text)}; ${box} }`
    if (layout.chapterNewPage) {
      sections.forEach((s, i) => {
        if (s.kind !== 'chapter') return
        rules.push(`@page ch${i}:left { ${head(s.title)} }`, `@page ch${i}:right { ${head(bookTitle)} }`)
        rules.push(`[data-sec="${i}"] { page: ch${i}; }`)
      })
    } else {
      rules.push(`@page body:right { ${head(bookTitle)} }`, `.bk-chapter { page: body; }`)
    }
  }
  return rules.join('\n')
}

/** The PDF's whole page: every section, with a hidden marker at the start of each (for page numbers) */
export function printBody(sections: Section[], layout: BookLayout): string {
  return sections.map((s, i) => sectionTag(s, layout, i).replace('>\n', `>\n<span class="pmk" dir="ltr">QZQ${i}QZQ</span>`)).join('\n')
}

/** Finds the markers in the text of each page of a printed PDF: section index → page number (from 1) */
export function findMarkers(pageTexts: string[]): Record<number, number> {
  const out: Record<number, number> = {}
  pageTexts.forEach((t, k) => {
    for (const m of t.replace(/\s+/g, '').matchAll(/QZQ(\d+)QZQ/g)) {
      const i = Number(m[1])
      if (!(i in out)) out[i] = k + 1
    }
  })
  return out
}

/**
 * Which chapters (and part pages) need an empty page before them so they start on an odd (left-hand) page, given the
 * page each section starts on before any empty page was added. Returns the section indices, and the
 * pages of every section after adding them.
 */
export function oddPagePlan(sections: Pick<Section, 'kind'>[], starts: Record<number, number>, layout: Pick<BookLayout, 'partPage'>): { blanks: number[]; pages: Record<number, number> } {
  const blanks: number[] = []
  const pages: Record<number, number> = {}
  let shift = 0
  sections.forEach((s, i) => {
    if (!(i in starts)) return
    let p = starts[i] + shift
    const opens = s.kind === 'chapter' || (s.kind === 'part' && layout.partPage)
    if (opens && p % 2 === 0) {
      blanks.push(i)
      shift++
      p++
    }
    pages[i] = p
  })
  return { blanks, pages }
}
