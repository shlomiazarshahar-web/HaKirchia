// Scene breaks (feature 29). A scene break is an ordinary paragraph whose whole text is a break
// sign, like "* * *", "***", "⁂" or "#". So the chapter file stays a plain Word document, and
// breaks typed in Word are recognized too.

const BREAK_RE = /^\s*(?:(?:[*•·∗✱]\s*){3,}|⁂|#|~\s*~\s*~)\s*$/u

/** The sign the app inserts for a new scene break */
export const SCENE_BREAK_TEXT = '* * *'

export function isSceneBreak(text: string): boolean {
  return BREAK_RE.test(text)
}

export interface SceneInfo {
  /** Index of the paragraph where the scene starts (the first one after the break) */
  block: number
  /** The first words of the scene, to show in lists */
  label: string
}

/** First words of a paragraph, for a short label */
export function firstWords(text: string, words = 6, chars = 42): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return ''
  const w = t.split(' ')
  let out = w.slice(0, words).join(' ')
  if (out.length > chars) out = out.slice(0, chars).replace(/\s+\S*$/, '')
  return out + (out.length < t.length ? '…' : '')
}

/**
 * The scenes of a chapter, from the texts of its paragraphs. A chapter without breaks is one scene.
 * Breaks at the very start or end, or two breaks in a row, do not make empty scenes.
 */
export function scenesOf(blocks: string[]): SceneInfo[] {
  const out: SceneInfo[] = []
  let start = 0
  const close = (end: number) => {
    // a scene needs at least one paragraph with text
    for (let i = start; i < end; i++) {
      if (blocks[i].trim()) {
        out.push({ block: start, label: firstWords(blocks[i]) })
        return
      }
    }
  }
  for (let i = 0; i < blocks.length; i++) {
    if (isSceneBreak(blocks[i])) {
      close(i)
      start = i + 1
    }
  }
  close(blocks.length)
  return out
}
