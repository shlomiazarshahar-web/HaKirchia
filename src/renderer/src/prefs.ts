// Writing preferences shared by every editor on screen: added fonts and Hebrew typography.
// A tiny store, so the format bar, the settings dialog and the editors all see changes at once.
import { useSyncExternalStore } from 'react'
import { DEFAULT_FOCUS, type CustomFont, type FocusSettings, type Settings } from '@shared/types'
import { DEFAULT_TYPOGRAPHY, type TypographySettings } from '@shared/hebrew'
import { api } from './api'

interface Prefs {
  customFonts: CustomFont[]
  typography: TypographySettings
  /** Focused writing mode settings (saved) */
  focus: FocusSettings
  /** Ask "what next?" when closing a book */
  askStopNote: boolean
  /** Right now: keep the line being written in the middle of the screen (focus mode is on and wants it) */
  typewriterNow: boolean
}

let prefs: Prefs = { customFonts: [], typography: DEFAULT_TYPOGRAPHY, focus: DEFAULT_FOCUS, askStopNote: true, typewriterNow: false }
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function getPrefs(): Prefs {
  return prefs
}
export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => prefs
  )
}

const loaded = new Set<string>()
/** Makes font files the user added usable in the window (fonts installed in Windows just work). */
export async function registerFonts(list: CustomFont[]): Promise<void> {
  for (const f of list) {
    if (!f.file || loaded.has(f.file)) continue
    loaded.add(f.file)
    try {
      const bytes = await api.readFontFile(f.file)
      if (!bytes) continue
      const face = new FontFace(f.family, new Uint8Array(bytes))
      await face.load()
      document.fonts.add(face)
    } catch {
      loaded.delete(f.file)
    }
  }
}

export function initPrefs(s: Settings): void {
  prefs = {
    ...prefs,
    customFonts: s.customFonts ?? [],
    typography: { ...DEFAULT_TYPOGRAPHY, ...s.typography },
    focus: { ...DEFAULT_FOCUS, ...s.focus },
    askStopNote: s.askStopNote ?? true
  }
  emit()
  void registerFonts(prefs.customFonts)
}

export function setCustomFonts(list: CustomFont[]): void {
  prefs = { ...prefs, customFonts: list }
  emit()
  void registerFonts(list)
}

export function setTypography(patch: Partial<TypographySettings>): void {
  prefs = { ...prefs, typography: { ...prefs.typography, ...patch } }
  emit()
  void api.setTypography(prefs.typography)
}

export function setFocusSettings(patch: Partial<FocusSettings>): void {
  prefs = { ...prefs, focus: { ...prefs.focus, ...patch } }
  emit()
  void api.setFocusSettings(prefs.focus)
}

export function setAskStopNote(on: boolean): void {
  prefs = { ...prefs, askStopNote: on }
  emit()
  void api.setAskStopNote(on)
}

/** Turned on by the app while focus mode is on with typewriter scrolling; read by every editor. */
export function setTypewriterNow(on: boolean): void {
  if (prefs.typewriterNow === on) return
  prefs = { ...prefs, typewriterNow: on }
  emit()
}
