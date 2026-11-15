import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import type { Book, OpResult, OutlineNode, PMNode, RecentBook, Theme } from '../shared/types'
import * as project from './project'
import { getSettings, rememberBook, updateSettings } from './settings'

let win: BrowserWindow | null = null
let allowClose = false

const overlayColors = (theme: Theme) =>
  theme === 'dark' ? { color: '#121716', symbolColor: '#E2E8E5', height: 34 } : { color: '#DDE3E0', symbolColor: '#1B2321', height: 34 }

function createWindow(): void {
  const theme = getSettings().theme
  nativeTheme.themeSource = theme
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 560,
    show: false,
    title: 'הכריכייה',
    backgroundColor: theme === 'dark' ? '#121716' : '#DDE3E0',
    titleBarStyle: 'hidden',
    titleBarOverlay: overlayColors(theme),
    icon: join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      spellcheck: true
    }
  })
  win.webContents.session.setSpellCheckerLanguages(['he', 'en-US'].filter((l) => win!.webContents.session.availableSpellCheckerLanguages.includes(l)))
  win.once('ready-to-show', () => win?.show())
  // Links open in the normal browser, never inside the app window
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  // Before closing, ask the window to save anything still pending
  win.on('close', (e) => {
    if (allowClose) return
    e.preventDefault()
    win?.webContents.send('app:flush-before-close')
    setTimeout(() => {
      allowClose = true
      win?.close()
    }, 4000)
  })
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

async function wrap<T>(fn: () => Promise<T> | T): Promise<OpResult<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (e) {
    return { ok: false, error: errText(e) }
  }
}

/** For operations that change the chapter list: returns the updated book plus an optional notice. */
async function wrapBook(fn: () => Promise<{ book: Book; notice?: string }>): Promise<OpResult<Book>> {
  try {
    const { book, notice } = await fn()
    rememberBook(book.path, book.title, book.chapters.length)
    return { ok: true, value: book, notice }
  } catch (e) {
    return { ok: false, error: errText(e) }
  }
}

function registerIpc(): void {
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:theme', (_e, theme: Theme) => {
    updateSettings({ theme })
    nativeTheme.themeSource = theme
    try {
      win?.setTitleBarOverlay(overlayColors(theme))
    } catch {
      /* not supported on this platform */
    }
    return true
  })
  ipcMain.handle('settings:lastChapter', (_e, bookPath: string, chapterId: string) => {
    updateSettings({ lastChapter: { ...getSettings().lastChapter, [bookPath]: chapterId } })
  })
  ipcMain.on('app:flushed', () => {
    allowClose = true
    win?.close()
  })

  ipcMain.handle('library:list', (): RecentBook[] =>
    getSettings().recent.map((r) => ({ ...r, exists: project.isBookFolder(r.path) }))
  )
  ipcMain.handle('library:forget', (_e, path: string) => {
    updateSettings({ recent: getSettings().recent.filter((r) => r.path !== path) })
  })

  ipcMain.handle('dialog:chooseFolder', async (_e, purpose: 'parent' | 'open') => {
    const res = await dialog.showOpenDialog(win!, {
      title: purpose === 'open' ? 'פתיחת תיקיית ספר' : 'איפה לשמור את הספר?',
      defaultPath: getSettings().defaultFolder ?? app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory']
    })
    return res.canceled ? null : res.filePaths[0]
  })
  ipcMain.handle('app:defaultFolder', () => getSettings().defaultFolder ?? join(app.getPath('documents'), 'הכריכייה'))

  const opened = (book: Book) => {
    rememberBook(book.path, book.title, book.chapters.length)
    project.watchBook(book.path, (id) => win?.webContents.send('chapter:disk-changed', book.path, id))
    return book
  }

  ipcMain.handle('book:create', (_e, parentDir: string, title: string) =>
    wrap(async () => {
      updateSettings({ defaultFolder: parentDir })
      return opened(await project.createBook(parentDir, title))
    })
  )
  ipcMain.handle('book:open', (_e, folder: string) =>
    wrap(async () => {
      if (!project.isBookFolder(folder)) {
        throw new Error('בתיקייה הזו אין ספר של הכריכייה. יש לבחור את התיקייה הראשית של הספר (זו שיש בה את התיקייה "פרקים").')
      }
      return opened(await project.openBook(folder))
    })
  )
  ipcMain.handle('chapter:add', async (_e, bookPath: string, title: string, partId?: string) => {
    try {
      const { book, chapter, notice } = await project.addChapter(bookPath, title, partId)
      rememberBook(book.path, book.title, book.chapters.length)
      return { ok: true, value: { book, chapterId: chapter.id }, notice }
    } catch (e) {
      return { ok: false, error: errText(e) }
    }
  })
  ipcMain.handle('chapter:rename', (_e, b: string, id: string, title: string) => wrapBook(() => project.renameChapter(b, id, title)))
  ipcMain.handle('book:outline', (_e, b: string, outline: OutlineNode[]) => wrapBook(() => project.saveOutline(b, outline)))
  ipcMain.handle('chapter:delete', (_e, b: string, id: string) => wrapBook(() => project.deleteChapter(b, id)))
  ipcMain.handle('chapter:meta', (_e, b: string, id: string, meta) => wrap(() => project.updateChapterMeta(b, id, meta)))
  ipcMain.handle('chapter:load', (_e, b: string, id: string) => wrap(() => project.loadChapter(b, id)))
  ipcMain.handle('chapter:save', (_e, b: string, id: string, doc: PMNode) => wrap(() => project.saveChapter(b, id, doc)))
  ipcMain.handle('shell:showFile', (_e, path: string) => {
    if (existsSync(path)) shell.showItemInFolder(path)
    else shell.openPath(join(path, '..'))
  })
  ipcMain.handle('shell:openInWord', (_e, path: string) => shell.openPath(path))
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
