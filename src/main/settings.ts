import { app } from 'electron'
import { promises as fs, readFileSync } from 'fs'
import { join } from 'path'
import type { Settings } from '../shared/types'

const file = () => join(app.getPath('userData'), 'settings.json')
let cache: Settings | null = null

export function getSettings(): Settings {
  if (cache) return cache
  try {
    cache = { theme: 'light', recent: [], lastChapter: {}, ...JSON.parse(readFileSync(file(), 'utf8')) }
  } catch {
    cache = { theme: 'light', recent: [], lastChapter: {} }
  }
  return cache!
}

let writing = Promise.resolve()
export function updateSettings(patch: Partial<Settings>): Settings {
  cache = { ...getSettings(), ...patch }
  const snapshot = JSON.stringify(cache, null, 2)
  writing = writing.then(() => fs.writeFile(file(), snapshot, 'utf8')).catch(() => undefined)
  return cache
}

export function rememberBook(path: string, title: string, chapterCount: number): void {
  const s = getSettings()
  // opening a book takes it out of the archive; archived books are kept however many there are
  const others = s.recent.filter((r) => r.path !== path)
  const recent = [{ path, title, chapterCount, lastOpened: Date.now() }, ...others.filter((r) => !r.archived)].slice(0, 30).concat(others.filter((r) => r.archived))
  updateSettings({ recent })
}
