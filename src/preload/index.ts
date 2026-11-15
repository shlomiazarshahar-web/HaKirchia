import { contextBridge, ipcRenderer } from 'electron'
import type { Book, ChapterStatus, LoadedChapter, OpResult, OutlineNode, PMNode, RecentBook, Settings, Theme } from '../shared/types'

const api = {
  platform: process.platform,
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  setTheme: (t: Theme): Promise<boolean> => ipcRenderer.invoke('settings:theme', t),
  setLastChapter: (bookPath: string, id: string): Promise<void> => ipcRenderer.invoke('settings:lastChapter', bookPath, id),
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
  onFlushBeforeClose: (fn: () => Promise<void>) => {
    ipcRenderer.on('app:flush-before-close', async () => {
      try {
        await fn()
      } finally {
        ipcRenderer.send('app:flushed')
      }
    })
  }
}

export type Api = typeof api
contextBridge.exposeInMainWorld('api', api)
