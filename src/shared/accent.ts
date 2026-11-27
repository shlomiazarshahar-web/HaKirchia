// The app's accent color (round 13): the color of the selected tab, buttons, the chapter being
// written and so on. The default is the deep green of the "בד כריכה" look; the writer can pick
// another bookcloth color, or any color of their own.

import type { Theme } from './types'

export interface AccentPreset {
  id: string
  name: string
  /** The accent on the light look, and on the dark look (lighter, so it shows on dark grey) */
  light: string
  dark: string
}

export const DEFAULT_ACCENT = 'green'

export const ACCENTS: AccentPreset[] = [
  { id: 'green', name: 'ירוק כהה', light: '#0f3b33', dark: '#5aa493' },
  { id: 'blue', name: 'כחול', light: '#23406e', dark: '#7fa3dc' },
  { id: 'teal', name: 'טורקיז', light: '#12525a', dark: '#5fb3bb' },
  { id: 'burgundy', name: 'בורדו', light: '#6b2337', dark: '#d9899c' },
  { id: 'purple', name: 'סגול', light: '#4a2f6b', dark: '#ab8fd8' },
  { id: 'brown', name: 'חום עור', light: '#5c3b1f', dark: '#cf9f70' },
  { id: 'ink', name: 'דיו', light: '#2c3a47', dark: '#93a9bd' },
  { id: 'olive', name: 'זית', light: '#46511f', dark: '#a7b56a' }
]

const HEX = /^#[0-9a-f]{6}$/i

/** A saved value that the app can use: a preset id or a color like #1a2b3c; anything else is the default */
export function normalizeAccent(v: unknown): string {
  if (typeof v !== 'string') return DEFAULT_ACCENT
  if (ACCENTS.some((a) => a.id === v)) return v
  return HEX.test(v) ? v.toLowerCase() : DEFAULT_ACCENT
}

/** How light a color is (0 black … 1 white), as the eye sees it */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const lin = (c: number) => {
    const x = c / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
}

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (s: number) => Math.round(((pa >> s) & 255) * t + ((pb >> s) & 255) * (1 - t))
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`
}

/**
 * The CSS variables that change for this accent on this look, or null for the default green (whose
 * colors are in the stylesheet as they were designed). `--w-soft` is the pale tint of the accent
 * used for hover and the selected tab.
 */
export function accentVars(accent: string, theme: Theme): Record<string, string> | null {
  const v = normalizeAccent(accent)
  if (v === DEFAULT_ACCENT) return null
  const preset = ACCENTS.find((a) => a.id === v)
  if (theme === 'light') {
    // a custom color that is too light to read white text on is darkened
    let c = preset ? preset.light : v
    while (luminance(c) > 0.18) c = mix(c, '#000000', 0.85)
    return { '--w-accent': c, '--w-on-accent': '#ffffff', '--w-soft': mix(c, '#fcfcfa', 0.17) }
  }
  let c = preset ? preset.dark : v
  while (luminance(c) < 0.22) c = mix(c, '#ffffff', 0.85)
  return { '--w-accent': c, '--w-on-accent': '#0b1714', '--w-soft': mix(c, '#121716', 0.22) }
}

/** The color shown on the setting's swatch */
export function accentSwatch(accent: string): string {
  const v = normalizeAccent(accent)
  return ACCENTS.find((a) => a.id === v)?.light ?? v
}
