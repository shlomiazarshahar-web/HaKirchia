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
  /** Footnotes at the end of each chapter (in Word and ePub they stay real footnotes) */
  notesAtEnd: boolean
  /** Chapter titles: font ('' = the body font), size in points, bold, and where on the line */
  titleFont: string
  titleSize: number
  titleBold: boolean
  titleAlign: 'center' | 'start'
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
  notesAtEnd: true,
  titleFont: '',
  titleSize: 22,
  titleBold: false,
  titleAlign: 'center'
}

export interface BookInfo {
  author: string
  subtitle: string
}

/** Everything under `publish` in book.hakirchia.json */
export interface PublishSettings {
  info: BookInfo
  matter: MatterPage[]
  layout: BookLayout
}

export const DEFAULT_INFO: BookInfo = { author: '', subtitle: '' }

/** Fills in what is missing (older books, or settings added in later versions) */
export function normalizePublish(p: Partial<PublishSettings> | undefined): PublishSettings {
  const layout = { ...DEFAULT_LAYOUT, ...(p?.layout ?? {}) }
  if (!(layout.pageSize in PAGE_SIZES)) layout.pageSize = DEFAULT_LAYOUT.pageSize
  layout.fontSize = clamp(Number(layout.fontSize) || DEFAULT_LAYOUT.fontSize, 8, 20)
  layout.titleSize = clamp(Number(layout.titleSize) || DEFAULT_LAYOUT.titleSize, 12, 40)
  layout.titleFont = typeof layout.titleFont === 'string' ? layout.titleFont : ''
  layout.titleAlign = layout.titleAlign === 'start' ? 'start' : 'center'
  layout.titleBold = !!layout.titleBold
  layout.lineHeight = clamp(Number(layout.lineHeight) || DEFAULT_LAYOUT.lineHeight, 1, 2.5)
  const matter = Array.isArray(p?.matter)
    ? p!.matter.filter((m) => m && typeof m.id === 'string' && m.kind in MATTER_KINDS).map((m) => ({ ...m, where: m.where === 'back' ? ('back' as const) : ('front' as const), heading: m.heading ?? '', text: m.text ?? '' }))
    : defaultMatter()
  return { info: { ...DEFAULT_INFO, ...(p?.info ?? {}) }, matter, layout }
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
