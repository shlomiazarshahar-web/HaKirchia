// Reading and export (features 31, 36, 16): what is stored in the book about how it is printed.
// The front and back pages (title page, dedication, motto, contents, thanks…) and the page layout
// are kept in book.hakirchia.json under `publish`. They are never chapters: they are not counted,
// not numbered and not in the binder, but they are part of the reading view and of every export.

/** The editor's and Word's default font (same as DEFAULT_FONT in docx.ts) */
const DEFAULT_FONT = 'Frank Ruhl Libre'

export type MatterKind = 'title' | 'copyright' | 'dedication' | 'motto' | 'toc' | 'thanks' | 'about' | 'other'

/** A front or back page (feature 36) */
export interface MatterPage {
  id: string
  kind: MatterKind
  /** Before the first chapter or after the last one */
  where: 'front' | 'back'
  /** Heading shown on the page (the title page and the dedication usually have none) */
  heading: string
  /** The page's text; each line is a paragraph */
  text: string
}

export interface MatterKindInfo {
  label: string
  /** What the page is for, shown when adding one */
  hint: string
  where: 'front' | 'back'
  heading: string
  /** The text is centered on the page, a little above the middle */
  centered: boolean
}

export const MATTER_KINDS: Record<MatterKind, MatterKindInfo> = {
  title: { label: 'שער', hint: 'שם הספר, כותרת משנה ושם הכותב', where: 'front', heading: '', centered: true },
  copyright: { label: 'זכויות יוצרים', hint: 'שנה, זכויות, הוצאה', where: 'front', heading: '', centered: false },
  dedication: { label: 'הקדשה', hint: 'למי הספר מוקדש', where: 'front', heading: '', centered: true },
  motto: { label: 'מוטו', hint: 'ציטוט שפותח את הספר, והמקור שלו בשורה האחרונה', where: 'front', heading: '', centered: true },
  toc: { label: 'תוכן העניינים', hint: 'נבנה לבד מהחלקים והפרקים', where: 'front', heading: 'תוכן העניינים', centered: false },
  thanks: { label: 'תודות', hint: 'תודות בסוף הספר', where: 'back', heading: 'תודות', centered: false },
  about: { label: 'על הכותב', hint: 'כמה מילים על הכותב', where: 'back', heading: 'על הכותב', centered: false },
  other: { label: 'עמוד אחר', hint: 'כל עמוד אחר, עם כותרת לבחירתכם', where: 'front', heading: '', centered: false }
}

/** Page sizes, in millimetres */
export const PAGE_SIZES = {
  a5: { label: 'A5 (14.8×21 ס״מ)', w: 148, h: 210 },
  '15x22': { label: '15×22 ס״מ', w: 150, h: 220 },
  '17x24': { label: '17×24 ס״מ', w: 170, h: 240 },
  a4: { label: 'A4 (21×29.7 ס״מ)', w: 210, h: 297 }
} as const
export type PageSize = keyof typeof PAGE_SIZES

/** How the book is laid out on pages: the reading view and the PDF follow it (the switches of feature 31) */
export interface BookLayout {
  pageSize: PageSize
  /** Body text size in points */
  fontSize: number
  /** Body font; text with a font of its own keeps it */
  font: string
  /** Space between lines (1.5 = one and a half) */
  lineHeight: number
  /** Justified text, like most printed books */
  justify: boolean
  /** Each part's title on a page of its own, in the middle of the page */
  partPage: boolean
  /** Each chapter starts on a new page */
  chapterNewPage: boolean
  /** Each chapter starts on a left-hand page (the odd page of a Hebrew book); an empty page is added when needed */
  chapterOdd: boolean
  /** Page numbers at the bottom of the page */
  pageNumbers: boolean
  /** Book title and chapter title at the top of the pages */
  runningHeads: boolean
  /** Show the front and back pages */
  matter: boolean
  /** Footnotes at the bottom of the page their mark is on, or at the end of each chapter (in Word and ePub they stay real footnotes) */
  notesAt: 'page' | 'chapter'
  /** How each element looks (font, size, placement); what is missing follows the body text */
  styles: Partial<Record<ElementKey, Partial<ElementStyle>>>
  /** Feature 48: an image shown instead of the scene break sign (* * *) in reading mode, the PDF and the ePub. A file in the book's "עיצוב" folder; '' = the sign */
  sceneImage: string
  /** The image's height, in lines of text */
  sceneImageSize: number
  /** Changes when the image file is replaced (same name), so views read it again */
  sceneImageTick?: number
}

/** Feature 45: the manuscript for publishers (a plain Word file in the format publishers ask for) */
export interface ManuscriptSettings {
  font: string
  fontSize: number
  /** 2 = double spacing */
  lineSpacing: number
  /** A first page with the title, the author, the word count and how to reach the writer */
  cover: boolean
  /** Contact details for the cover page; each line is a line */
  contact: string
  /** What replaces a scene break */
  sceneSign: string
  /** The author's name and the book's title at the top of every page */
  header: boolean
}

export const DEFAULT_MANUSCRIPT: ManuscriptSettings = { font: 'David', fontSize: 12, lineSpacing: 2, cover: true, contact: '', sceneSign: '#', header: true }
export const MANUSCRIPT_FONTS = ['David', 'Times New Roman', 'Arial', 'Frank Ruhl Libre', 'Narkisim', 'Miriam']

/** The parts of the book that have a look of their own */
export type ElementKey = 'chapterTitle' | 'partTitle' | 'bookTitle' | 'subtitle' | 'author' | 'matterTitle' | 'matterText' | 'toc' | 'notes' | 'heads' | ParaStyleKey | 'h2' | 'h3'

/** Feature 50: paragraph styles for prose. Stored on the paragraph (attrs.pstyle) and as a Word paragraph style */
export type ParaStyle = 'letter' | 'poem' | 'quote' | 'sign'
export type ParaStyleKey = 'pLetter' | 'pPoem' | 'pQuote' | 'pSign'
export const PARA_STYLES: ParaStyle[] = ['letter', 'poem', 'quote', 'sign']
export const paraKey = (p: ParaStyle): ParaStyleKey => ('p' + p[0].toUpperCase() + p.slice(1)) as ParaStyleKey
export const isParaStyle = (v: unknown): v is ParaStyle => typeof v === 'string' && (PARA_STYLES as string[]).includes(v)
export const PARA_LABEL: Record<ParaStyle, string> = { letter: 'מכתב', poem: 'שיר', quote: 'ציטוט', sign: 'שלט / הודעה' }
/** How far each style is set in from both sides, in em (Word: the same in twips) */
export const PARA_INDENT: Record<ParaStyle, number> = { letter: 1.5, poem: 2.5, quote: 2, sign: 0 }
/** Word style ids of the paragraph styles */
export const PARA_WORD_ID: Record<ParaStyle, string> = { letter: 'Letter', poem: 'Poem', quote: 'Quote', sign: 'Sign' }
export type ElementAlign = 'start' | 'center' | 'end' | 'auto'

export interface ElementStyle {
  /** '' = the body font */
  font: string
  /** In points; 0 = in proportion to the body text */
  size: number
  align: ElementAlign
  bold: boolean
  italic?: boolean
}

export interface ElementInfo {
  label: string
  /** Size in proportion to the body text, when no size was chosen */
  ratio: number
  align: ElementAlign
  bold: boolean
  italic?: boolean
  /** The placements that make sense for it (none: it has no placement setting) */
  aligns: ElementAlign[]
}

export const ELEMENTS: Record<ElementKey, ElementInfo> = {
  chapterTitle: { label: 'כותרות הפרקים', ratio: 1.9, align: 'center', bold: false, aligns: ['start', 'center', 'end'] },
  partTitle: { label: 'כותרות החלקים', ratio: 2.2, align: 'center', bold: false, aligns: ['start', 'center', 'end'] },
  bookTitle: { label: 'שם הספר בשער', ratio: 2.6, align: 'center', bold: false, aligns: ['start', 'center', 'end'] },
  subtitle: { label: 'כותרת המשנה בשער', ratio: 1.3, align: 'center', bold: false, aligns: ['start', 'center', 'end'] },
  author: { label: 'שם הכותב בשער', ratio: 1.3, align: 'center', bold: false, aligns: ['start', 'center', 'end'] },
  matterTitle: { label: 'כותרות עמודי הפתיחה והסיום', ratio: 1.6, align: 'center', bold: false, aligns: ['start', 'center', 'end'] },
  matterText: { label: 'טקסט עמודי הפתיחה והסיום', ratio: 1, align: 'auto', bold: false, aligns: ['auto', 'start', 'center', 'end'] },
  toc: { label: 'תוכן העניינים', ratio: 1, align: 'start', bold: false, aligns: [] },
  notes: { label: 'הערות שוליים', ratio: 0.8, align: 'start', bold: false, aligns: [] },
  heads: { label: 'מספרי עמודים וכותרות רצות', ratio: 0.75, align: 'center', bold: false, aligns: [] },
  h2: { label: 'כותרות בתוך הפרק', ratio: 1.25, align: 'start', bold: true, aligns: ['start', 'center', 'end'] },
  h3: { label: 'כותרות משנה בתוך הפרק', ratio: 1.1, align: 'start', bold: true, aligns: ['start', 'center', 'end'] },
  pLetter: { label: 'סגנון: מכתב', ratio: 1, align: 'auto', bold: false, italic: false, aligns: ['auto', 'start', 'center', 'end'] },
  pPoem: { label: 'סגנון: שיר', ratio: 1, align: 'start', bold: false, italic: false, aligns: ['start', 'center', 'end'] },
  pQuote: { label: 'סגנון: ציטוט', ratio: 0.92, align: 'auto', bold: false, italic: false, aligns: ['auto', 'start', 'center', 'end'] },
  pSign: { label: 'סגנון: שלט / הודעה', ratio: 1, align: 'center', bold: true, italic: false, aligns: ['start', 'center', 'end'] }
}
export const ELEMENT_KEYS = Object.keys(ELEMENTS) as ElementKey[]
export const ALIGN_LABEL: Record<ElementAlign, string> = { auto: 'לפי העמוד', start: 'בצד ימין', center: 'במרכז', end: 'בצד שמאל' }

/** An element's look, with what was not chosen filled in */
export function elStyle(layout: Pick<BookLayout, 'fontSize' | 'styles'>, key: ElementKey): ElementStyle & { auto: boolean } {
  const info = ELEMENTS[key]
  const s = layout.styles?.[key] ?? {}
  const size = s.size && s.size > 0 ? s.size : Math.round(info.ratio * layout.fontSize * 2) / 2
  return { font: s.font ?? '', size, align: s.align && (info.aligns.includes(s.align) || !info.aligns.length) ? s.align : info.align, bold: s.bold ?? info.bold, italic: s.italic ?? info.italic ?? false, auto: !(s.size && s.size > 0) }
}

export const DEFAULT_LAYOUT: BookLayout = {
  pageSize: 'a5',
  fontSize: 12,
  font: DEFAULT_FONT,
  lineHeight: 1.5,
  justify: true,
  partPage: true,
  chapterNewPage: true,
  chapterOdd: false,
  pageNumbers: true,
  runningHeads: true,
  matter: true,
  notesAt: 'page',
  styles: {},
  sceneImage: '',
  sceneImageSize: 2
}

export interface BookInfo {
  author: string
  subtitle: string
  /** The name printed on the title page and at the top of pages, when it differs from the book's (folder) name */
  coverTitle?: string
}

/** The book's name as printed: the title page's own name, or the book's name */
export const printedTitle = (bookTitle: string, info: BookInfo): string => info.coverTitle?.trim() || bookTitle

/** Everything under `publish` in book.hakirchia.json */
export interface PublishSettings {
  info: BookInfo
  matter: MatterPage[]
  layout: BookLayout
  manuscript: ManuscriptSettings
}

export const DEFAULT_INFO: BookInfo = { author: '', subtitle: '' }

/** Fills in what is missing (older books, or settings added in later versions) */
export function normalizePublish(p: Partial<PublishSettings> | undefined): PublishSettings {
  const layout = { ...DEFAULT_LAYOUT, ...(p?.layout ?? {}) }
  if (!(layout.pageSize in PAGE_SIZES)) layout.pageSize = DEFAULT_LAYOUT.pageSize
  layout.fontSize = clamp(Number(layout.fontSize) || DEFAULT_LAYOUT.fontSize, 8, 20)
  layout.notesAt = layout.notesAt === 'chapter' ? 'chapter' : 'page'
  delete (layout as Partial<BookLayout> & { notesAtEnd?: boolean }).notesAtEnd
  const styles: BookLayout['styles'] = {}
  for (const k of ELEMENT_KEYS) {
    const v = (layout.styles as Record<string, Partial<ElementStyle>> | undefined)?.[k]
    if (!v || typeof v !== 'object') continue
    const o: Partial<ElementStyle> = {}
    if (typeof v.font === 'string' && v.font) o.font = v.font
    if (Number(v.size) > 0) o.size = clamp(Number(v.size), 6, 72)
    if (v.align && ['start', 'center', 'end', 'auto'].includes(v.align)) o.align = v.align
    if (typeof v.bold === 'boolean') o.bold = v.bold
    if (typeof v.italic === 'boolean') o.italic = v.italic
    if (Object.keys(o).length) styles[k] = o
  }
  layout.styles = styles
  layout.lineHeight = clamp(Number(layout.lineHeight) || DEFAULT_LAYOUT.lineHeight, 1, 2.5)
  layout.sceneImage = typeof layout.sceneImage === 'string' ? layout.sceneImage : ''
  layout.sceneImageSize = clamp(Number(layout.sceneImageSize) || DEFAULT_LAYOUT.sceneImageSize, 1, 8)
  const ms = { ...DEFAULT_MANUSCRIPT, ...(p?.manuscript ?? {}) }
  ms.fontSize = clamp(Number(ms.fontSize) || DEFAULT_MANUSCRIPT.fontSize, 10, 16)
  ms.lineSpacing = clamp(Number(ms.lineSpacing) || DEFAULT_MANUSCRIPT.lineSpacing, 1, 3)
  if (typeof ms.font !== 'string' || !ms.font.trim()) ms.font = DEFAULT_MANUSCRIPT.font
  if (typeof ms.contact !== 'string') ms.contact = ''
  if (typeof ms.sceneSign !== 'string') ms.sceneSign = DEFAULT_MANUSCRIPT.sceneSign
  ms.cover = ms.cover !== false
  ms.header = ms.header !== false
  const matter = Array.isArray(p?.matter)
    ? p!.matter.filter((m) => m && typeof m.id === 'string' && m.kind in MATTER_KINDS).map((m) => ({ ...m, where: m.where === 'back' ? ('back' as const) : ('front' as const), heading: m.heading ?? '', text: m.text ?? '' }))
    : defaultMatter()
  return { info: { ...DEFAULT_INFO, ...(p?.info ?? {}) }, matter, layout, manuscript: ms }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

let idCounter = 0
export const newMatterId = (): string => `m${Date.now().toString(36)}${(idCounter++).toString(36)}`

export function newMatterPage(kind: MatterKind, info?: BookInfo): MatterPage {
  const k = MATTER_KINDS[kind]
  const year = new Date().getFullYear()
  const text = kind === 'copyright' ? `© כל הזכויות שמורות${info?.author ? ` ל${info.author}` : ''}, ${year}` : ''
  return { id: newMatterId(), kind, where: k.where, heading: k.heading, text }
}

/** A new book starts with a title page and a table of contents */
export function defaultMatter(): MatterPage[] {
  // fixed ids, so a book that never saved its pages gets the same ones every time it is read
  return [
    { ...newMatterPage('title'), id: 'default-title' },
    { ...newMatterPage('toc'), id: 'default-toc' }
  ]
}

/** The front pages, then the back pages, each in their order */
export function frontPages(list: MatterPage[]): MatterPage[] {
  return list.filter((m) => m.where === 'front')
}
export function backPages(list: MatterPage[]): MatterPage[] {
  return list.filter((m) => m.where === 'back')
}

/** Moves a page up or down among the pages on its side (front / back) */
export function moveMatter(list: MatterPage[], id: string, delta: -1 | 1): MatterPage[] {
  const page = list.find((m) => m.id === id)
  if (!page) return list
  const side = list.filter((m) => m.where === page.where)
  const i = side.indexOf(page)
  const j = i + delta
  if (j < 0 || j >= side.length) return list
  const reordered = [...side]
  ;[reordered[i], reordered[j]] = [reordered[j], reordered[i]]
  const other = list.filter((m) => m.where !== page.where)
  return page.where === 'front' ? [...reordered, ...other] : [...other, ...reordered]
}

/** Lines of a page's text, as paragraphs (empty lines are kept as space between paragraphs) */
export function matterLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n')
}
