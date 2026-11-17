// Quick jump (feature 33, Ctrl+P): type a few letters, get the matching chapters, parts and
// bookmarks. Ignores niqqud and case; whole-word starts rank above matches inside a word.

import { stripNiqqud } from './hebrew'

export interface QuickItem {
  id: string
  label: string
  /** More text that may match (e.g. the chapter's number), shown smaller */
  extra?: string
}

const norm = (s: string) => stripNiqqud(s).toLowerCase().replace(/[־\-_]/g, ' ').replace(/\s+/g, ' ').trim()

/** How well an item matches; 0 = not at all. */
export function scoreItem(item: QuickItem, query: string): number {
  const q = norm(query)
  if (!q) return 1
  const label = norm(item.label)
  const extra = norm(item.extra ?? '')
  if (label === q) return 100
  if (label.startsWith(q)) return 80
  if ((' ' + label).includes(' ' + q)) return 60
  if (label.includes(q)) return 40
  if (extra && ((' ' + extra).includes(' ' + q) || extra === q)) return 35
  if (extra.includes(q)) return 20
  // every word of the query appears somewhere
  const words = q.split(' ')
  if (words.length > 1 && words.every((w) => label.includes(w) || extra.includes(w))) return 15
  // letters in order (e.g. "מכחי" for "מכתבים מחיפה")
  const hay = label.replace(/ /g, '')
  let k = 0
  for (const ch of q.replace(/ /g, '')) {
    k = hay.indexOf(ch, k)
    if (k < 0) return 0
    k++
  }
  return 5
}

/** The matching items, best first; with an empty query, all of them in their order. */
export function rankItems<T extends QuickItem>(items: T[], query: string, limit = 50): T[] {
  return items
    .map((it, i) => ({ it, i, s: scoreItem(it, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.it)
}
