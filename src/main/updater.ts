import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { RELEASES_PAGE, type UpdateState } from '../shared/update'

/**
 * Auto-update (version 1.1). The installed app looks for a newer version on the public
 * releases page a few seconds after it opens and then every few hours, downloads it quietly,
 * and installs it when the app closes (or right away, when the writer asks for a restart).
 * The portable copy cannot replace itself, so it only says that a new version exists.
 */

let state: UpdateState = { kind: 'idle' }
let getWin: () => BrowserWindow | null = () => null
const portable = !!process.env['PORTABLE_EXECUTABLE_DIR']

function set(s: UpdateState): void {
  state = s
  const w = getWin()
  if (w && !w.isDestroyed()) w.webContents.send('update:state', s)
}

export const updateState = (): UpdateState => state

/** A short Hebrew explanation; the technical message is kept for the log */
function friendlyError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  console.error('update failed:', m)
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EAI_AGAIN|net::ERR_/i.test(m)) return 'אין חיבור לאינטרנט, אז לא בדקתי אם יש גרסה חדשה.'
  if (/404|latest\.yml|No published versions/i.test(m)) return 'עדיין אין גרסה שפורסמה לעדכון אוטומטי.'
  return 'לא הצלחתי לבדוק אם יש גרסה חדשה. אפשר לנסות שוב מאוחר יותר.'
}

let checking: Promise<unknown> | null = null
export function checkForUpdates(): void {
  if (!app.isPackaged) return set({ kind: 'dev' })
  // once downloaded there is nothing more to look for until the app restarts
  if (state.kind === 'ready' || state.kind === 'downloading' || checking) return
  set({ kind: 'checking' })
  checking = autoUpdater
    .checkForUpdates()
    .catch((e) => set({ kind: 'error', message: friendlyError(e) }))
    .finally(() => (checking = null))
}

export function setupUpdater(win: () => BrowserWindow | null): void {
  getWin = win
  if (!app.isPackaged) return set({ kind: 'dev' })
  // test builds carry versions like 1.1.0-test.7; they still take the next normal version
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false
  autoUpdater.autoDownload = !portable
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-available', (info) => {
    if (portable) set({ kind: 'available-portable', version: info.version, url: RELEASES_PAGE })
    else set({ kind: 'downloading', version: info.version, percent: 0 })
  })
  autoUpdater.on('update-not-available', () => set({ kind: 'latest', at: Date.now() }))
  autoUpdater.on('download-progress', (p) => {
    if (state.kind === 'downloading') set({ ...state, percent: Math.round(p.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => set({ kind: 'ready', version: info.version }))
  autoUpdater.on('error', (e) => {
    if (state.kind !== 'ready') set({ kind: 'error', message: friendlyError(e) })
  })
  setTimeout(checkForUpdates, 8000)
  setInterval(checkForUpdates, 4 * 60 * 60 * 1000)
}

/** Closes the app and runs the installer, which opens the new version when done */
export function installNow(): void {
  if (state.kind !== 'ready') return
  autoUpdater.quitAndInstall(true, true)
}
