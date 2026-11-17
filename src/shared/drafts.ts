// Saving and drafts round (features 14, 27, 35, 15): small pure rules shared by the window and the
// main process, kept here so they can be tested.

import { isSceneBreak, scenesOf } from './scenes'

/** Text cut with Ctrl+X always goes to the drawer; deleted text only when it has this many words. */
export const DRAWER_MIN_DELETED_WORDS = 4
/** Pieces kept automatically in the drawer of a book (the oldest automatic ones go first) */
export const DRAWER_MAX_AUTO = 300

export type DrawerHow = 'cut' | 'delete' | 'manual'

const wordCount = (t: string) => t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length

/** Should text that just left the chapter be kept in the drawer? */
export function drawerWorthy(text: string, how: DrawerHow): boolean {
  const n = wordCount(text)
  if (how === 'delete') return n >= DRAWER_MIN_DELETED_WORDS
  return n >= 1
}

/** The text of a drawer piece for showing: no empty lines, single spaces */
export function cleanDrawerText(text: string): string {
  return text
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

/**
 * Paragraphs (by index, end not included) of scene number `index`, as the scenes list counts them.
 * null when the chapter has no such scene.
 */
export function sceneRange(paragraphs: string[], index: number): { start: number; end: number } | null {
  const scene = scenesOf(paragraphs)[index]
  if (!scene) return null
  let end = scene.block
  while (end < paragraphs.length && !isSceneBreak(paragraphs[end])) end++
  return { start: scene.block, end }
}

/** Automatic versions: at most one every this many minutes while writing in a chapter */
export const AUTO_VERSION_MINUTES = 30
/** Automatic versions kept per chapter (named versions are never deleted automatically) */
export const MAX_AUTO_VERSIONS = 40
