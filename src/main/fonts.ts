// Fonts the user adds: fonts installed in Windows (read from the registry) or font files, which are
// copied into the app's own folder so they keep working even if the original file moves.
import { app, dialog, type BrowserWindow } from 'electron'
import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import { basename, extname, join } from 'path'
import { inflateSync } from 'zlib'
import type { CustomFont } from '../shared/types'
import { familyFromRegistryName, fontFamilyName } from '../shared/fontname'
import { getSettings, sharedFontsDir, updateSettings } from './settings'

const fontsDir = () => join(app.getPath('userData'), 'fonts')

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', timeout: 20000 }, (_err, stdout) => resolve(stdout ?? ''))
  })
}

let systemCache: Promise<string[]> | null = null
/** Font families installed in Windows (for all users and for this user). */
export function listSystemFonts(): Promise<string[]> {
  systemCache ??= (async () => {
    if (process.platform !== 'win32') return []
    // The exact family names, as Word shows them
    const ps = await run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }'
    ])
    const families = new Set(ps.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))
    // Fallback: the fonts list in the registry
    if (!families.size) {
      const out = await Promise.all([
        run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts']),
        run('reg', ['query', 'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'])
      ])
      for (const line of out.join('\n').split(/\r?\n/)) {
        const m = /^\s{2,}(.+?)\s{2,}REG_SZ\s{2,}/.exec(line)
        if (m) for (const f of familyFromRegistryName(m[1])) families.add(f)
      }
    }
    return [...families].sort((a, b) => a.localeCompare(b, 'he'))
  })()
  return systemCache
}

const saveList = (list: CustomFont[]) => updateSettings({ customFonts: list }).customFonts ?? []

export function addSystemFont(family: string): CustomFont[] {
  const list = getSettings().customFonts ?? []
  if (list.some((f) => f.family === family)) return list
  return saveList([...list, { family }])
}

/** Asks for a font file, copies it, and adds it. Returns null when the user cancels. */
export async function addFontFile(win: BrowserWindow): Promise<{ fonts: CustomFont[]; family: string } | null> {
  const res = await dialog.showOpenDialog(win, {
    title: 'בחירת קובץ גופן',
    properties: ['openFile'],
    filters: [{ name: 'קובצי גופן', extensions: ['ttf', 'otf', 'ttc', 'woff', 'woff2'] }]
  })
  if (res.canceled || !res.filePaths[0]) return null
  const src = res.filePaths[0]
  const bytes = new Uint8Array(await fs.readFile(src))
  const family = fontFamilyName(bytes, (d) => new Uint8Array(inflateSync(d))) ?? basename(src, extname(src))
  await fs.mkdir(fontsDir(), { recursive: true })
  const safe = `${Date.now().toString(36)}-${basename(src).replace(/[^\w.\-֐-׿ ]/g, '_')}`
  await fs.copyFile(src, join(fontsDir(), safe))
  // round 16: also into the shared folder, so the other computers get the font too
  const shared = sharedFontsDir()
  if (shared) await fs.mkdir(shared, { recursive: true }).then(() => fs.copyFile(src, join(shared, safe))).catch(() => undefined)
  const list = (getSettings().customFonts ?? []).filter((f) => f.family !== family)
  return { fonts: saveList([...list, { family, file: safe }]), family }
}

export async function readFontFile(file: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await fs.readFile(join(fontsDir(), basename(file))))
  } catch {
    // round 16: a font added on another computer comes from the shared folder, and is kept here from now on
    const shared = sharedFontsDir()
    if (!shared) return null
    try {
      const bytes = await fs.readFile(join(shared, basename(file)))
      await fs.mkdir(fontsDir(), { recursive: true })
      await fs.writeFile(join(fontsDir(), basename(file)), bytes).catch(() => undefined)
      return new Uint8Array(bytes)
    } catch {
      return null
    }
  }
}

export async function removeFont(family: string): Promise<CustomFont[]> {
  const list = getSettings().customFonts ?? []
  const gone = list.find((f) => f.family === family)
  if (gone?.file) {
    await fs.rm(join(fontsDir(), basename(gone.file)), { force: true }).catch(() => undefined)
    const shared = sharedFontsDir()
    if (shared) await fs.rm(join(shared, basename(gone.file)), { force: true }).catch(() => undefined)
  }
  return saveList(list.filter((f) => f.family !== family))
}
