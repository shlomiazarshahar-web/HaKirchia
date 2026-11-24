import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron'
import type { PaneLayout } from '../shared/panes'
import type { AltDraft, Book, Bookmark, ChapterStatus, DrawerItem, PrivateNote, Version, CustomFont, FocusSettings, LoadedChapter, OpResult, OutlineNode, PMNode, RecentBook, Settings, SpellStatus, Theme } from '../shared/types'
import type { TypographySettings } from '../shared/hebrew'
import type { StopPoint } from '../shared/stoppoint'
import type { ChapterSource, SplitItem } from '../shared/translation'
import type { PublishSettings } from '../shared/publish'
import type { AiSettings, ChatTurn, Exercise, ExercisePrompt, Finding, Review, ReviewRequest, Usage, Workshop } from '../shared/review'
import type { UpdateState } from '../shared/update'
import type { RecoveryEntry, RecoveryItem } from '../shared/recovery'
import type { BackupChapter, BackupInfo, BackupSettings } from '../shared/backup'
import type { GlossaryEntry, InspirationGroup, InspirationImage, Material, MaterialKind, TimelineEvent } from '../shared/background'

type BookAnd<T> = OpResult<{ book: Book; value: T }>

const api = {
  platform: process.platform,
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  setTheme: (t: Theme): Promise<boolean> => ipcRenderer.invoke('settings:theme', t),
  setLastChapter: (bookPath: string, id: string): Promise<void> => ipcRenderer.invoke('settings:lastChapter', bookPath, id),
  setSplitLayout: (bookPath: string, layout: PaneLayout): Promise<void> => ipcRenderer.invoke('settings:splitLayout', bookPath, layout),
  setTranslateLayout: (bookPath: string, layout: PaneLayout): Promise<void> => ipcRenderer.invoke('settings:translateLayout', bookPath, layout),
  /** PDF files in the book's "מקור" folder (feature 12) */
  listSourcePdfs: (bookPath: string): Promise<string[]> => ipcRenderer.invoke('source:list', bookPath),
  /** Asks for a PDF and copies it into the book's "מקור" folder. value is its name there, or null when cancelled. */
  addSourcePdf: (bookPath: string): Promise<OpResult<string | null>> => ipcRenderer.invoke('source:add', bookPath),
  readSourcePdf: (bookPath: string, name: string): Promise<OpResult<Uint8Array>> => ipcRenderer.invoke('source:read', bookPath, name),
  /** Links a chapter to its original and its range in it, or unlinks it (null) */
  setSource: (bookPath: string, chapterId: string, src: ChapterSource | null): Promise<OpResult<Book>> => ipcRenderer.invoke('source:set', bookPath, chapterId, src),
  /** One chapter file per chapter of the original, each linked to its range, with its scene breaks ready */
  splitBySource: (bookPath: string, pdf: string, items: SplitItem[], reuseId?: string): Promise<OpResult<Book>> => ipcRenderer.invoke('source:split', bookPath, pdf, items, reuseId),
  // Background materials round (features 11, 20, 21, 34, 37)
  createMaterial: (bookPath: string, kind: MaterialKind, name?: string): Promise<BookAnd<Material>> => ipcRenderer.invoke('material:create', bookPath, kind, name),
  /** value: a notice when the Word file could not be renamed */
  updateMaterial: (bookPath: string, id: string, patch: Partial<Material>): Promise<BookAnd<string | undefined>> => ipcRenderer.invoke('material:update', bookPath, id, patch),
  deleteMaterial: (bookPath: string, id: string): Promise<BookAnd<void>> => ipcRenderer.invoke('material:delete', bookPath, id),
  loadMaterial: (bookPath: string, id: string): Promise<OpResult<LoadedChapter>> => ipcRenderer.invoke('material:load', bookPath, id),
  saveMaterial: (bookPath: string, id: string, doc: PMNode): Promise<OpResult<void>> => ipcRenderer.invoke('material:save', bookPath, id, doc),
  /** Without paths, asks which files. value is null when cancelled. */
  attachFiles: (bookPath: string, id: string, paths?: string[]): Promise<OpResult<{ book: Book; value: void } | null>> => ipcRenderer.invoke('material:attach', bookPath, id, paths),
  detachFile: (bookPath: string, id: string, name: string): Promise<BookAnd<void>> => ipcRenderer.invoke('material:detach', bookPath, id, name),
  openAttachment: (bookPath: string, name: string): Promise<OpResult<string>> => ipcRenderer.invoke('material:openFile', bookPath, name),
  showMaterialFile: (bookPath: string, id: string): Promise<OpResult<void>> => ipcRenderer.invoke('material:showFile', bookPath, id),
  setGlossary: (bookPath: string, list: GlossaryEntry[]): Promise<BookAnd<void>> => ipcRenderer.invoke('glossary:set', bookPath, list),
  setTimeline: (bookPath: string, list: TimelineEvent[]): Promise<BookAnd<void>> => ipcRenderer.invoke('timeline:set', bookPath, list),
  /** Without paths, asks which images. value is null when cancelled. */
  addImages: (bookPath: string, link: { chapterId?: string; materialId?: string }, paths?: string[]): Promise<OpResult<{ book: Book; value: InspirationImage[] } | null>> =>
    ipcRenderer.invoke('images:add', bookPath, link, paths),
  setImages: (bookPath: string, list: InspirationImage[], groups?: InspirationGroup[]): Promise<BookAnd<void>> => ipcRenderer.invoke('images:set', bookPath, list, groups),
  /** An image pasted from the clipboard (its bytes), placed at `at` on the canvas */
  addImageData: (bookPath: string, bytes: Uint8Array, ext: string, link: { chapterId?: string; materialId?: string }, at?: { x: number; y: number }): Promise<BookAnd<InspirationImage>> =>
    ipcRenderer.invoke('images:addData', bookPath, bytes, ext, link, at),
  readImage: (bookPath: string, file: string): Promise<OpResult<Uint8Array>> => ipcRenderer.invoke('images:read', bookPath, file),
  /** The path on disk of a file dropped on the window (images dragged from Explorer) */
  pathForFile: (f: File): string => webUtils.getPathForFile(f),
  /** Paragraphs per chapter id, read from the files on disk (translation progress, feature 28) */
  paragraphCounts: (bookPath: string): Promise<OpResult<Record<string, number>>> => ipcRenderer.invoke('book:paraCounts', bookPath),
  // Writing review with Claude (feature 19). The API key stays in the main process.
  setAiSettings: (patch: Partial<AiSettings>): Promise<Partial<AiSettings>> => ipcRenderer.invoke('ai:settings', patch),
  aiKeyState: (): Promise<{ has: boolean; hint: string }> => ipcRenderer.invoke('ai:keyState'),
  setAiKey: (key: string): Promise<OpResult<{ has: boolean; hint: string }>> => ipcRenderer.invoke('ai:setKey', key),
  /** value: the model's name, when the key works */
  testAiKey: (): Promise<OpResult<string>> => ipcRenderer.invoke('ai:testKey'),
  review: (jobId: string, req: ReviewRequest): Promise<OpResult<{ json: string; usage: Usage; model: string }>> => ipcRenderer.invoke('ai:review', jobId, req),
  followUp: (jobId: string, req: ReviewRequest, rv: Review, chat: ChatTurn[], q: string): Promise<OpResult<{ text: string; usage: Usage }>> => ipcRenderer.invoke('ai:followUp', jobId, req, rv, chat, q),
  findingReply: (jobId: string, req: ReviewRequest, rv: Review, f: Finding, msg: string): Promise<OpResult<{ reply: string; decision: string; usage: Usage }>> => ipcRenderer.invoke('ai:findingReply', jobId, req, rv, f, msg),
  promptIdeas: (jobId: string, theme: string, count: number, avoid: string[]): Promise<OpResult<{ prompts: string[]; usage: Usage }>> => ipcRenderer.invoke('ai:promptIdeas', jobId, theme, count, avoid),
  cancelAi: (jobId: string): Promise<void> => ipcRenderer.invoke('ai:cancel', jobId),
  /** Claude's answer so far, while it is being written */
  onAiProgress: (fn: (jobId: string, text: string) => void) => {
    const h = (_e: unknown, jobId: string, text: string) => fn(jobId, text)
    ipcRenderer.on('ai:progress', h)
    return () => {
      ipcRenderer.removeListener('ai:progress', h)
    }
  },
  listReviews: (bookPath: string): Promise<OpResult<Review[]>> => ipcRenderer.invoke('reviews:list', bookPath),
  putReview: (bookPath: string, rv: Review, remove?: boolean): Promise<OpResult<Review[]>> => ipcRenderer.invoke('reviews:put', bookPath, rv, remove),
  bookBackground: (bookPath: string): Promise<OpResult<string>> => ipcRenderer.invoke('reviews:background', bookPath),
  // The workshop (feature 22)
  openWorkshop: (): Promise<OpResult<Workshop>> => ipcRenderer.invoke('workshop:open'),
  createExercise: (prompt: string, title?: string, fromPromptId?: string): Promise<OpResult<{ workshop: Workshop; value: Exercise }>> => ipcRenderer.invoke('workshop:create', prompt, title, fromPromptId),
  updateExercise: (id: string, patch: { title?: string; prompt?: string }): Promise<OpResult<{ workshop: Workshop; value: void }>> => ipcRenderer.invoke('workshop:update', id, patch),
  deleteExercise: (id: string): Promise<OpResult<{ workshop: Workshop; value: void }>> => ipcRenderer.invoke('workshop:delete', id),
  loadExercise: (id: string): Promise<OpResult<LoadedChapter>> => ipcRenderer.invoke('workshop:load', id),
  saveExercise: (id: string, doc: PMNode): Promise<OpResult<{ workshop: Workshop; value: void }>> => ipcRenderer.invoke('workshop:save', id, doc),
  putExerciseReview: (id: string, rv: Review, remove?: boolean): Promise<OpResult<{ workshop: Workshop; value: void }>> => ipcRenderer.invoke('workshop:review', id, rv, remove),
  addPrompts: (texts: string[], source: ExercisePrompt['source']): Promise<OpResult<{ workshop: Workshop; value: number }>> => ipcRenderer.invoke('workshop:addPrompts', texts, source),
  removePrompt: (id: string): Promise<OpResult<{ workshop: Workshop; value: void }>> => ipcRenderer.invoke('workshop:removePrompt', id),
  editPrompt: (id: string, text: string): Promise<OpResult<{ workshop: Workshop; value: void }>> => ipcRenderer.invoke('workshop:editPrompt', id, text),
  /** Asks for Word/text files. value is null when cancelled. */
  importExercises: (): Promise<OpResult<{ workshop: Workshop; value: number } | null>> => ipcRenderer.invoke('workshop:import'),
  moveWorkshop: (): Promise<OpResult<Workshop | null>> => ipcRenderer.invoke('workshop:move'),
  showExerciseFile: (id: string): Promise<OpResult<void>> => ipcRenderer.invoke('workshop:showFile', id),
  openExerciseInWord: (id: string): Promise<OpResult<string>> => ipcRenderer.invoke('workshop:openInWord', id),
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
  /** Saves the front and back pages, author and page layout (features 31, 36, 16) */
  setPublish: (bookPath: string, p: PublishSettings): Promise<OpResult<Book>> => ipcRenderer.invoke('book:publish', bookPath, p),
  /** The book with every chapter's text as saved (reading view) */
  exportData: (bookPath: string): Promise<OpResult<{ book: Book; docs: Record<string, PMNode> }>> => ipcRenderer.invoke('book:exportData', bookPath),
  /** Asks where to save, then exports the whole book. value is the saved file, or null when cancelled. */
  exportBook: (bookPath: string, title: string, format: 'pdf' | 'docx' | 'epub'): Promise<OpResult<string | null>> => ipcRenderer.invoke('export:run', bookPath, title, format),
  openPath: (path: string): Promise<string> => ipcRenderer.invoke('shell:openPath', path),
  /** The print window (PDF export): its job, printing it, and handing back the final file */
  printJob: (): Promise<{ html: string; css: string; oddPages: boolean; hasToc: boolean; partPage: boolean; kinds: string[]; ids: string[]; notesAtPage: { colW: number; colH: number; gap: number } | null } | null> => ipcRenderer.invoke('print:job'),
  printRender: (): Promise<Uint8Array> => ipcRenderer.invoke('print:render'),
  printFinish: (bytes: Uint8Array | null, error?: string): Promise<void> => ipcRenderer.invoke('print:finish', bytes, error),
  /** Saves the book's "come back here" bookmarks (the whole list) */
  setBookmarks: (bookPath: string, list: Bookmark[]): Promise<OpResult<void>> => ipcRenderer.invoke('book:bookmarks', bookPath, list),
  /** Saves the book's private notes (the whole list) */
  setNotes: (bookPath: string, list: PrivateNote[]): Promise<OpResult<void>> => ipcRenderer.invoke('book:notes', bookPath, list),
  /** Versions of a chapter, newest first (feature 14) */
  listVersions: (bookPath: string, chapterId: string): Promise<OpResult<Version[]>> => ipcRenderer.invoke('versions:list', bookPath, chapterId),
  /** Keeps a copy of the chapter as saved now. Empty label = automatic (reason says why). */
  takeVersion: (bookPath: string, chapterId: string, label: string, reason?: string): Promise<OpResult<Version>> =>
    ipcRenderer.invoke('versions:take', bookPath, chapterId, label, reason),
  loadVersion: (bookPath: string, chapterId: string, versionId: string): Promise<OpResult<PMNode>> => ipcRenderer.invoke('versions:load', bookPath, chapterId, versionId),
  deleteVersion: (bookPath: string, chapterId: string, versionId: string): Promise<OpResult<void>> => ipcRenderer.invoke('versions:delete', bookPath, chapterId, versionId),
  renameVersion: (bookPath: string, chapterId: string, versionId: string, label: string): Promise<OpResult<void>> =>
    ipcRenderer.invoke('versions:rename', bookPath, chapterId, versionId, label),
  /** The book's drawer of cut and deleted text (feature 27), newest first */
  listDrawer: (bookPath: string): Promise<OpResult<DrawerItem[]>> => ipcRenderer.invoke('drawer:list', bookPath),
  addToDrawer: (bookPath: string, item: DrawerItem): Promise<OpResult<DrawerItem[]>> => ipcRenderer.invoke('drawer:add', bookPath, item),
  removeFromDrawer: (bookPath: string, ids: string[]): Promise<OpResult<DrawerItem[]>> => ipcRenderer.invoke('drawer:remove', bookPath, ids),
  /** Alternative drafts (feature 35) */
  createAlt: (bookPath: string, chapterId: string, name: string, doc: PMNode, scene?: AltDraft['scene']): Promise<OpResult<{ book: Book; altId: string }>> =>
    ipcRenderer.invoke('alt:create', bookPath, chapterId, name, doc, scene),
  loadAlt: (bookPath: string, altId: string): Promise<OpResult<LoadedChapter>> => ipcRenderer.invoke('alt:load', bookPath, altId),
  saveAlt: (bookPath: string, altId: string, doc: PMNode): Promise<OpResult<void>> => ipcRenderer.invoke('alt:save', bookPath, altId, doc),
  renameAlt: (bookPath: string, altId: string, name: string): Promise<OpResult<Book>> => ipcRenderer.invoke('alt:rename', bookPath, altId, name),
  deleteAlt: (bookPath: string, altId: string): Promise<OpResult<Book>> => ipcRenderer.invoke('alt:delete', bookPath, altId),
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
  /** Renames the book and its folder. The book comes back at its new path. */
  renameBook: (bookPath: string, title: string, fromLibrary?: boolean): Promise<OpResult<{ book: Book; notice?: string }>> => ipcRenderer.invoke('book:rename', bookPath, title, fromLibrary),
  archiveBook: (path: string, archived: boolean): Promise<void> => ipcRenderer.invoke('library:archive', path, archived),
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
  /** Right-click on selected words: make a background page ('character' | 'place' | 'research') or a glossary entry ('term' | 'original') */
  onContextBackground: (fn: (kind: string, text: string) => void) => {
    const h = (_e: unknown, kind: string, text: string) => fn(kind, text)
    ipcRenderer.on('context:background', h)
    return () => {
      ipcRenderer.removeListener('context:background', h)
    }
  },
  /** A chapter file was changed outside the app (e.g. saved in Word). Returns an unsubscribe function. */
  onChapterDiskChanged: (fn: (bookPath: string, chapterId: string) => void) => {
    const h = (_e: unknown, bookPath: string, chapterId: string) => fn(bookPath, chapterId)
    ipcRenderer.on('chapter:disk-changed', h)
    return () => {
      ipcRenderer.removeListener('chapter:disk-changed', h)
    }
  },
  // Crash recovery (feature 41). `session` tells this run of the window apart from earlier ones.
  writeRecovery: (session: string, entry: RecoveryEntry): Promise<void> => ipcRenderer.invoke('recovery:write', session, entry),
  clearRecovery: (session: string, key: string): Promise<void> => ipcRenderer.invoke('recovery:clear', session, key),
  listRecovery: (session: string): Promise<OpResult<RecoveryItem[]>> => ipcRenderer.invoke('recovery:list', session),
  restoreRecovery: (key: string): Promise<OpResult<void>> => ipcRenderer.invoke('recovery:restore', key),
  discardRecovery: (key: string): Promise<OpResult<void>> => ipcRenderer.invoke('recovery:discard', key),
  /** value: the new file's path, or null when cancelled */
  saveRecoveryAs: (key: string, name: string): Promise<OpResult<string | null>> => ipcRenderer.invoke('recovery:saveAs', key, name),
  // Daily backups (feature 49)
  /** A copy of a book was just made (or failed). Returns an unsubscribe function. */
  onBackupDone: (fn: (bookPath: string) => void) => {
    const h = (_e: unknown, b: string) => fn(b)
    ipcRenderer.on('backup:done', h)
    return () => {
      ipcRenderer.removeListener('backup:done', h)
    }
  },
  /** The folder all backups go to */
  backupRoot: (): Promise<string> => ipcRenderer.invoke('backup:root'),
  backupInfo: (bookPath: string): Promise<OpResult<BackupInfo>> => ipcRenderer.invoke('backup:info', bookPath),
  /** value: the day copied */
  backupNow: (bookPath: string): Promise<OpResult<string | null>> => ipcRenderer.invoke('backup:now', bookPath),
  backupChapters: (bookPath: string, day: string): Promise<OpResult<BackupChapter[]>> => ipcRenderer.invoke('backup:chapters', bookPath, day),
  restoreFromBackup: (bookPath: string, day: string, chapterId: string): Promise<OpResult<{ book: Book; chapterId: string; notice?: string }>> =>
    ipcRenderer.invoke('backup:restoreChapter', bookPath, day, chapterId),
  setBackupSettings: (patch: Partial<BackupSettings>): Promise<BackupSettings> => ipcRenderer.invoke('backup:settings', patch),
  /** value: the new settings, or null when cancelled */
  chooseBackupFolder: (): Promise<BackupSettings | null> => ipcRenderer.invoke('backup:chooseFolder'),
  /** Opens the book's backups folder (or the folder of all backups) in Explorer */
  openBackups: (bookPath?: string): Promise<string> => ipcRenderer.invoke('backup:open', bookPath),
  // Importing a manuscript from Word (feature 42)
  /** Asks for a Word file and reads its paragraphs. value is null when cancelled. */
  pickManuscript: (): Promise<OpResult<{ fileName: string; blocks: PMNode[]; warnings: string[] } | null>> => ipcRenderer.invoke('import:pick'),
  importToBook: (bookPath: string, items: { title: string; doc: PMNode }[]): Promise<OpResult<Book>> => ipcRenderer.invoke('import:toBook', bookPath, items),
  importNewBook: (parentDir: string, title: string, items: { title: string; doc: PMNode }[]): Promise<OpResult<{ book: Book; notice?: string }>> =>
    ipcRenderer.invoke('import:newBook', parentDir, title, items),
  // Auto-update (version 1.1)
  updateState: (): Promise<UpdateState> => ipcRenderer.invoke('update:state'),
  checkForUpdates: (): Promise<void> => ipcRenderer.invoke('update:check'),
  /** Saves, closes, installs the downloaded version and opens it */
  installUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),
  /** Returns an unsubscribe function */
  onUpdateState: (fn: (s: UpdateState) => void) => {
    const h = (_e: unknown, s: UpdateState) => fn(s)
    ipcRenderer.on('update:state', h)
    return () => {
      ipcRenderer.removeListener('update:state', h)
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
