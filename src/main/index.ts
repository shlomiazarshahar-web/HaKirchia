import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import type { AltDraft, Book, Bookmark, DrawerItem, FocusSettings, OpResult, OutlineNode, PMNode, PrivateNote, RecentBook, Theme } from '../shared/types'
import type { StopPoint } from '../shared/stoppoint'
import type { PaneLayout } from '../shared/panes'
import * as project from './project'
import { getSettings, rememberBook, updateSettings } from './settings'
import * as fonts from './fonts'
import * as spell from './spell'
import type { TypographySettings } from '../shared/hebrew'

let win: BrowserWindow | null = null
let allowClose = false
let closeTimer: ReturnType<typeof setTimeout> | null = null

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
  spell.setupSpellcheck(win)
  win.once('ready-to-show', () => win?.show())
  // Links open in the normal browser, never inside the app window
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  // Before closing, ask the window to save anything still pending. The window may first ask
  // "what next?" (stopping point); it says so ('app:close-wait'), and then there is no time limit.
  win.on('close', (e) => {
    if (allowClose) return
    e.preventDefault()
    if (closeTimer) return
    win?.webContents.send('app:flush-before-close')
    closeTimer = setTimeout(() => {
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
  ipcMain.handle('settings:zoom', (_e, zoom: number) => {
    updateSettings({ zoom })
  })
  ipcMain.handle('settings:splitLayout', (_e, bookPath: string, layout: PaneLayout) => {
    updateSettings({ splitLayout: { ...getSettings().splitLayout, [bookPath]: layout } })
  })
  ipcMain.handle('settings:typography', (_e, typography: TypographySettings) => {
    updateSettings({ typography })
  })

  // Fonts
  ipcMain.handle('fonts:system', () => fonts.listSystemFonts())
  ipcMain.handle('fonts:addSystem', (_e, family: string) => fonts.addSystemFont(family))
  ipcMain.handle('fonts:addFile', () => wrap(() => fonts.addFontFile(win!)))
  ipcMain.handle('fonts:read', (_e, file: string) => fonts.readFontFile(file))
  ipcMain.handle('fonts:remove', (_e, family: string) => fonts.removeFont(family))

  // Spelling
  ipcMain.handle('spell:status', () => spell.spellStatus(win!))
  ipcMain.handle('spell:enable', (_e, on: boolean) => (spell.setSpellEnabled(win!, on), spell.spellStatus(win!)))
  ipcMain.handle('spell:add', (_e, word: string) => (spell.addWordQuiet(win!, word), spell.spellStatus(win!)))
  ipcMain.handle('spell:remove', (_e, word: string) => (spell.removeWord(win!, word), spell.spellStatus(win!)))

  ipcMain.on('app:close-wait', () => {
    if (closeTimer) clearTimeout(closeTimer)
  })
  ipcMain.on('app:close-cancelled', () => {
    if (closeTimer) clearTimeout(closeTimer)
    closeTimer = null
  })
  ipcMain.handle('window:fullscreen', (_e, on: boolean) => {
    win?.setFullScreen(on)
  })
  ipcMain.handle('settings:focus', (_e, focus: FocusSettings) => {
    updateSettings({ focus })
  })
  ipcMain.handle('settings:askStopNote', (_e, on: boolean) => {
    updateSettings({ askStopNote: on })
  })
  ipcMain.handle('book:bookmarks', (_e, bookPath: string, list: Bookmark[]) => wrap(() => project.setBookmarks(bookPath, list)))
  ipcMain.handle('book:notes', (_e, bookPath: string, list: PrivateNote[]) => wrap(() => project.setNotes(bookPath, list)))
  // Versions (feature 14)
  ipcMain.handle('versions:list', (_e, b: string, id: string) => wrap(() => project.listVersions(b, id)))
  ipcMain.handle('versions:take', (_e, b: string, id: string, label: string, reason?: string) => wrap(() => project.takeVersion(b, id, label, reason)))
  ipcMain.handle('versions:load', (_e, b: string, id: string, v: string) => wrap(() => project.loadVersion(b, id, v)))
  ipcMain.handle('versions:delete', (_e, b: string, id: string, v: string) => wrap(() => project.deleteVersion(b, id, v)))
  ipcMain.handle('versions:rename', (_e, b: string, id: string, v: string, label: string) => wrap(() => project.renameVersion(b, id, v, label)))
  // Drawer (feature 27)
  ipcMain.handle('drawer:list', (_e, b: string) => wrap(() => project.readDrawer(b)))
  ipcMain.handle('drawer:add', (_e, b: string, item: DrawerItem) => wrap(() => project.addToDrawer(b, item)))
  ipcMain.handle('drawer:remove', (_e, b: string, ids: string[]) => wrap(() => project.removeFromDrawer(b, ids)))
  // Alternative drafts (feature 35)
  ipcMain.handle('alt:create', (_e, b: string, chapterId: string, name: string, doc: PMNode, scene?: AltDraft['scene']) =>
    wrap(async () => {
      const r = await project.createAlt(b, chapterId, name, doc, scene)
      return { book: r.book, altId: r.alt.id }
    })
  )
  ipcMain.handle('alt:load', (_e, b: string, id: string) => wrap(() => project.loadAlt(b, id)))
  ipcMain.handle('alt:save', (_e, b: string, id: string, doc: PMNode) => wrap(() => project.saveAlt(b, id, doc)))
  ipcMain.handle('alt:rename', (_e, b: string, id: string, name: string) => wrap(() => project.renameAlt(b, id, name)))
  ipcMain.handle('alt:delete', (_e, b: string, id: string) => wrap(() => project.deleteAlt(b, id)))
  ipcMain.handle('book:stopPoint', (_e, bookPath: string, sp: StopPoint | null) => wrap(() => project.setStopPoint(bookPath, sp)))

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
  ipcMain.handle('book:wordCounts', (_e, b: string) => wrap(() => project.wordCounts(b)))
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
