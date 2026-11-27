// Color labels for chapters (feature 44): the writer's own labels, such as the narrating character
// or a plot line, each with a color. A chapter can have several. They show as colored marks in the
// binder, as chips on the planning cards, and the cards can be filtered by them.
// Pure logic, used by both the main process (the book's file) and the window.

export const LABEL_COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'brown', 'gray'] as const
export type LabelColor = (typeof LABEL_COLORS)[number]

export const LABEL_COLOR_NAMES: Record<LabelColor, string> = {
  red: 'אדום',
  orange: 'כתום',
  yellow: 'צהוב',
  green: 'ירוק',
  teal: 'טורקיז',
  blue: 'כחול',
  purple: 'סגול',
  pink: 'ורוד',
  brown: 'חום',
  gray: 'אפור'
}

export interface ChapterLabel {
  id: string
  name: string
  color: LabelColor
}

const isColor = (c: unknown): c is LabelColor => LABEL_COLORS.includes(c as LabelColor)

/** The labels as saved in the book's file, made safe: names trimmed, unknown colors replaced, no duplicate ids */
export function normalizeLabels(raw: unknown): ChapterLabel[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: ChapterLabel[] = []
  raw.forEach((l, i) => {
    if (!l || typeof l !== 'object') return
    const r = l as Record<string, unknown>
    if (typeof r.id !== 'string' || !r.id || seen.has(r.id)) return
    seen.add(r.id)
    out.push({ id: r.id, name: typeof r.name === 'string' ? r.name.trim() : '', color: isColor(r.color) ? r.color : LABEL_COLORS[i % LABEL_COLORS.length] })
  })
  return out
}

/** A chapter's label ids that still exist, in the order of the book's label list */
export function chapterLabels(ids: string[] | undefined, labels: ChapterLabel[]): ChapterLabel[] {
  if (!ids?.length) return []
  const have = new Set(ids)
  return labels.filter((l) => have.has(l.id))
}

/** Adds the label to the chapter's list, or takes it off */
export function toggleLabelId(ids: string[] | undefined, id: string): string[] {
  const list = ids ?? []
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
}

/** The first color not used yet (for a new label) */
export function nextLabelColor(labels: ChapterLabel[]): LabelColor {
  return LABEL_COLORS.find((c) => !labels.some((l) => l.color === c)) ?? LABEL_COLORS[labels.length % LABEL_COLORS.length]
}

export const newLabelId = (): string => `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
