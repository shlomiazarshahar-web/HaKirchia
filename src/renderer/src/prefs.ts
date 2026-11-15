// Writing preferences shared by every editor on screen: added fonts and Hebrew typography.
// A tiny store, so the format bar, the settings dialog and the editors all see changes at once.
import { useSyncExternalStore } from 'react'
import type { CustomFont, Settings } from '@shared/types'
import { DEFAULT_TYPOGRAPHY, type TypographySettings } from '@shared/hebrew'
import { api } from './api'

interface Prefs {
  customFonts: CustomFont[]
  typography: TypographySettings
}

let prefs: Prefs = { customFonts: [], typography: DEFAULT_TYPOGRAPHY }
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
async function registerFonts(list: CustomFont[]): Promise<void> {
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
  prefs = { customFonts: s.customFonts ?? [], typography: { ...DEFAULT_TYPOGRAPHY, ...s.typography } }
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
