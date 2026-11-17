import { contextBridge, ipcRenderer, webFrame } from 'electron'
import type { PaneLayout } from '../shared/panes'
import type { Book, ChapterStatus, CustomFont, FocusSettings, LoadedChapter, OpResult, OutlineNode, PMNode, RecentBook, Settings, SpellStatus, Theme } from '../shared/types'
import type { TypographySettings } from '../shared/hebrew'
import type { StopPoint } from '../shared/stoppoint'

const api = {
  platform: process.platform,
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  setTheme: (t: Theme): Promise<boolean> => ipcRenderer.invoke('settings:theme', t),
  setLastChapter: (bookPath: string, id: string): Promise<void> => ipcRenderer.invoke('settings:lastChapter', bookPath, id),
  setSplitLayout: (bookPath: string, layout: PaneLayout): Promise<void> => ipcRenderer.invoke('settings:splitLayout', bookPath, layout),
  /** Makes the whole interface bigger or smaller, and remembers it */
  setZoom: (zoom: number): Promise<void> => {
    webFrame.setZoomFactor(zoom)
    return ipcRenderer.invoke('settings:zoom', zoom)
  },
  setTypography: (t: TypographySettings): Promise<void> => ipcRenderer.invoke('settings:typography', t),
  setFocusSettings: (f: FocusSettings): Promise<void> => ipcRenderer.invoke('settings:focus', f),
  setAskStopNote: (on: boolean): Promise<void> => ipcRenderer.invoke('settings:askStopNote', on),
  /** Full screen on/off (focused writing mode) */
  setFullScreen: (on: boolean): Promise<void> => ipcRenderer.invoke('window:fullscreen', on),
  /** Remembers where the writer stopped in this book, or forgets it (null) */
  setStopPoint: (bookPath: string, sp: StopPoint | null): Promise<OpResult<void>> => ipcRenderer.invoke('book:stopPoint', bookPath, sp),
  /** Font families installed in Windows */
  systemFonts: (): Promise<string[]> => ipcRenderer.invoke('fonts:system'),
  addSystemFont: (family: string): Promise<CustomFont[]> => ipcRenderer.invoke('fonts:addSystem', family),
  /** Asks for a font file (ttf/otf/woff) and adds it. value is null when cancelled. */
  addFontFile: (): Promise<OpResult<{ fonts: CustomFont[]; family: string } | null>> => ipcRenderer.invoke('fonts:addFile'),
  readFontFile: (file: string): Promise<Uint8Array | null> => ipcRenderer.invoke('fonts:read', file),
  removeFont: (family: string): Promise<CustomFont[]> => ipcRenderer.invoke('fonts:remove', family),
  spellStatus: (): Promise<SpellStatus> => ipcRenderer.invoke('spell:status'),
  setSpellcheck: (on: boolean): Promise<SpellStatus> => ipcRenderer.invoke('spell:enable', on),
  addDictionaryWord: (word: string): Promise<SpellStatus> => ipcRenderer.invoke('spell:add', word),
  removeDictionaryWord: (word: string): Promise<SpellStatus> => ipcRenderer.invoke('spell:remove', word),
  listLibrary: (): Promise<RecentBook[]> => ipcRenderer.invoke('library:list'),
  forgetBook: (path: string): Promise<void> => ipcRenderer.invoke('library:forget', path),
  chooseFolder: (purpose: 'parent' | 'open'): Promise<string | null> => ipcRenderer.invoke('dialog:chooseFolder', purpose),
  defaultFolder: (): Promise<string> => ipcRenderer.invoke('app:defaultFolder'),
  createBook: (parentDir: string, title: string): Promise<OpResult<Book>> => ipcRenderer.invoke('book:create', parentDir, title),
  openBook: (folder: string): Promise<OpResult<Book>> => ipcRenderer.invoke('book:open', folder),
  addChapter: (bookPath: string, title: string, partId?: string): Promise<OpResult<{ book: Book; chapterId: string }>> =>
    ipcRenderer.invoke('chapter:add', bookPath, title, partId),
  renameChapter: (bookPath: string, id: string, title: string): Promise<OpResult<Book>> => ipcRenderer.invoke('chapter:rename', bookPath, id, title),
  /** Saves the binder tree (order, parts). Renames files when the chapter order changed. */
  saveOutline: (bookPath: string, outline: OutlineNode[]): Promise<OpResult<Book>> => ipcRenderer.invoke('book:outline', bookPath, outline),
  deleteChapter: (bookPath: string, id: string): Promise<OpResult<Book>> => ipcRenderer.invoke('chapter:delete', bookPath, id),
  updateChapterMeta: (bookPath: string, id: string, meta: { status?: ChapterStatus; synopsis?: string }): Promise<OpResult<Book>> =>
    ipcRenderer.invoke('chapter:meta', bookPath, id, meta),
  /** Words per chapter id, read from the files on disk (for the cork board). */
  wordCounts: (bookPath: string): Promise<OpResult<Record<string, number>>> => ipcRenderer.invoke('book:wordCounts', bookPath),
  loadChapter: (bookPath: string, id: string): Promise<OpResult<LoadedChapter>> => ipcRenderer.invoke('chapter:load', bookPath, id),
  saveChapter: (bookPath: string, id: string, doc: PMNode): Promise<OpResult<void>> => ipcRenderer.invoke('chapter:save', bookPath, id, doc),
  showFile: (path: string): Promise<void> => ipcRenderer.invoke('shell:showFile', path),
  openInWord: (path: string): Promise<string> => ipcRenderer.invoke('shell:openInWord', path),
  /** A chapter file was changed outside the app (e.g. saved in Word). Returns an unsubscribe function. */
  onChapterDiskChanged: (fn: (bookPath: string, chapterId: string) => void) => {
    const h = (_e: unknown, bookPath: string, chapterId: string) => fn(bookPath, chapterId)
    ipcRenderer.on('chapter:disk-changed', h)
    return () => {
      ipcRenderer.removeListener('chapter:disk-changed', h)
    }
  },
  /**
   * The window is about to close. fn saves what is pending and returns true to close, or false when
   * the writer changed their mind. fn calls wait() before asking anything, so there is no time limit.
   */
  onBeforeClose: (fn: (wait: () => void) => Promise<boolean>) => {
    ipcRenderer.on('app:flush-before-close', async () => {
      let close = true
      try {
        close = await fn(() => ipcRenderer.send('app:close-wait'))
      } finally {
        ipcRenderer.send(close ? 'app:flushed' : 'app:close-cancelled')
      }
    })
  }
}

export type Api = typeof api
contextBridge.exposeInMainWorld('api', api)
