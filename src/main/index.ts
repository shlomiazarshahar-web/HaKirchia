import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import type { AltDraft, Book, Bookmark, DrawerItem, FocusSettings, OpResult, OutlineNode, PMNode, PrivateNote, RecentBook, SoundSettings, Theme } from '../shared/types'
import type { StopPoint } from '../shared/stoppoint'
import type { PaneLayout } from '../shared/panes'
import * as project from './project'
import { getSettings, rememberBook, updateSettings } from './settings'
import * as fonts from './fonts'
import * as spell from './spell'
import { noteContextWord } from './spell'
import * as exporter from './export'
import type { PublishSettings } from '../shared/publish'
import { promises as fsp } from 'fs'
import type { TypographySettings } from '../shared/hebrew'
import { allowedInTranslatePane, type ChapterSource, type SplitItem } from '../shared/translation'
import type { GlossaryEntry, InspirationGroup, InspirationImage, Material, MaterialKind, TimelineEvent } from '../shared/background'
import { IMAGE_EXTS } from './background'
import * as ai from './ai'
import * as wordtools from './wordtools'
import * as workshop from './workshop'
import * as updater from './updater'
import * as recovery from './recovery'
import * as backup from './backup'
import { docxBlocks } from '../shared/docx'
import { sourceKind } from '../shared/sourcefile'
import { sourceToPdf } from './sourcefile'
import { normalizeBackup, type BackupSettings } from '../shared/backup'
import type { RecoveryEntry } from '../shared/recovery'
import type { AiSettings, ExercisePrompt, Review, ReviewRequest, ChatTurn, Finding } from '../shared/review'
import { normalizeAccent } from '../shared/accent'
import * as writingLog from './writinglog'
import { allowedInMusicPlayer } from '../shared/sounds'

let win: BrowserWindow | null = null
let allowClose = false
let closeTimer: ReturnType<typeof setTimeout> | null = null
/** The writer asked to restart into the downloaded version: once everything is saved, install it */
let installAfterClose = false

/** Lets the window close for good: into the new version's installer, or just closed */
function finishClose(): void {
  allowClose = true
  if (installAfterClose) updater.installNow()
  else win?.close()
}

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
      preload: PRELOAD(),
      sandbox: false,
      contextIsolation: true,
      spellcheck: true,
      // Google Translate opens in a <webview> pane (feature 13); see will-attach-webview below
      webviewTag: true
    }
  })
  // The only web pages allowed inside the app are Google Translate and YouTube (the music player, feature 56), without any access to the computer
  win.webContents.on('will-attach-webview', (e, prefs, params) => {
    delete prefs.preload
    prefs.nodeIntegration = false
    prefs.contextIsolation = true
    prefs.sandbox = true
    if (!allowedInTranslatePane(params.src) && !allowedInMusicPlayer(params.src)) e.preventDefault()
  })
  win.webContents.on('did-attach-webview', (_e, wc) => {
    wc.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })
    wc.on('will-navigate', (ev, url) => {
      if (!allowedInTranslatePane(url) && !allowedInMusicPlayer(url)) {
        ev.preventDefault()
        shell.openExternal(url)
      }
    })
  })
  // The page crashed (or ran out of memory): load it again. Typing that was not saved yet waits in
  // the recovery folder, and the app offers it back as it starts (feature 41).
  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit' || !win || win.isDestroyed()) return
    void loadAppPage(win)
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
    closeTimer = setTimeout(finishClose, 4000)
  })
  void loadAppPage(win)
}

const PRELOAD = () => join(__dirname, '../preload/index.js')

/** Loads the app's page into a window; `hash` picks another screen of the same page (e.g. "print") */
function loadAppPage(w: BrowserWindow, hash = ''): Promise<void> {
  const url = process.env['ELECTRON_RENDERER_URL']
  if (url) return w.loadURL(hash ? `${url}#${hash}` : url)
  return w.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
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
  ipcMain.handle('settings:translateLayout', (_e, bookPath: string, layout: PaneLayout) => {
    updateSettings({ translateLayout: { ...getSettings().translateLayout, [bookPath]: layout } })
  })
  // Translation (features 12, 28)
  ipcMain.handle('source:list', (_e, b: string) => project.listSourcePdfs(b))
  ipcMain.handle('source:add', (_e, b: string) =>
    wrap(async () => {
      const res = await dialog.showOpenDialog(win!, {
        title: 'בחירת קובץ המקור (PDF, ePub או Word)',
        filters: [
          { name: 'ספר מקור (PDF, ePub, Word)', extensions: ['pdf', 'epub', 'docx'] },
          { name: 'PDF', extensions: ['pdf'] },
          { name: 'ePub', extensions: ['epub'] },
          { name: 'Word', extensions: ['docx'] }
        ],
        properties: ['openFile']
      })
      if (res.canceled || !res.filePaths[0]) return null
      const file = res.filePaths[0]
      // ePub and Word are printed to a PDF once (feature 52), so the source pane works the same
      if (sourceKind(file) !== 'pdf') return project.addSourcePdf(b, file, await sourceToPdf(file))
      return project.addSourcePdf(b, file)
    })
  )
  ipcMain.handle('source:read', (_e, b: string, name: string) => wrap(() => project.readSourcePdf(b, name)))
  ipcMain.handle('source:split', (_e, b: string, pdf: string, items: SplitItem[], reuseId?: string) => wrapBook(() => project.createChaptersFromSource(b, pdf, items, reuseId)))
  ipcMain.handle('source:set', (_e, b: string, chapterId: string, src: ChapterSource | null) => wrap(() => project.setSource(b, chapterId, src)))
  // Background materials round (features 11, 20, 21, 34, 37)
  ipcMain.handle('material:create', (_e, b: string, kind: MaterialKind, name?: string) => wrap(() => project.createMaterial(b, kind, name)))
  ipcMain.handle('material:update', (_e, b: string, id: string, patch: Partial<Material>) => wrap(() => project.updateMaterial(b, id, patch)))
  ipcMain.handle('material:delete', (_e, b: string, id: string) => wrap(() => project.deleteMaterial(b, id)))
  ipcMain.handle('material:load', (_e, b: string, id: string) => wrap(() => project.loadMaterial(b, id)))
  ipcMain.handle('material:save', (_e, b: string, id: string, doc: PMNode) => wrap(() => project.saveMaterial(b, id, doc)))
  ipcMain.handle('material:attach', (_e, b: string, id: string, paths?: string[]) =>
    wrap(async () => {
      let files = paths ?? []
      if (!files.length) {
        const res = await dialog.showOpenDialog(win!, { title: 'צירוף קבצים לדף', properties: ['openFile', 'multiSelections'] })
        if (res.canceled || !res.filePaths.length) return null
        files = res.filePaths
      }
      return project.attachFiles(b, id, files)
    })
  )
  ipcMain.handle('material:detach', (_e, b: string, id: string, name: string) => wrap(() => project.detachFile(b, id, name)))
  ipcMain.handle('material:openFile', (_e, b: string, name: string) => wrap(() => shell.openPath(project.attachmentPath(b, name))))
  ipcMain.handle('material:showFile', (_e, b: string, id: string) =>
    wrap(async () => {
      const book = await project.openBook(b)
      const f = project.materialFilePath(book, id)
      if (f && existsSync(f)) shell.showItemInFolder(f)
    })
  )
  ipcMain.handle('glossary:set', (_e, b: string, list: GlossaryEntry[]) => wrap(() => project.setGlossary(b, list)))
  ipcMain.handle('timeline:set', (_e, b: string, list: TimelineEvent[]) => wrap(() => project.setTimeline(b, list)))
  ipcMain.handle('images:add', (_e, b: string, link: { chapterId?: string; materialId?: string }, paths?: string[]) =>
    wrap(async () => {
      let files = paths ?? []
      if (!files.length) {
        const res = await dialog.showOpenDialog(win!, {
          title: 'הוספת תמונות השראה',
          filters: [{ name: 'תמונות', extensions: IMAGE_EXTS }],
          properties: ['openFile', 'multiSelections']
        })
        if (res.canceled || !res.filePaths.length) return null
        files = res.filePaths
      }
      return project.addImages(b, files, link)
    })
  )
  ipcMain.handle('images:set', (_e, b: string, list: InspirationImage[], groups?: InspirationGroup[]) => wrap(() => project.setImages(b, list, groups)))
  ipcMain.handle('images:addData', (_e, b: string, bytes: Uint8Array, ext: string, link: { chapterId?: string; materialId?: string }, at?: { x: number; y: number }) =>
    wrap(() => project.addImageData(b, bytes, ext, link, at))
  )
  ipcMain.handle('images:read', (_e, b: string, file: string) => wrap(() => project.readImage(b, file)))
  ipcMain.handle('book:paraCounts', (_e, b: string) => wrap(() => project.paragraphCounts(b)))
  ipcMain.handle('book:paraTexts', (_e, b: string) => wrap(() => project.paragraphTexts(b)))
  ipcMain.handle('words:tmPhrase', (_e, source: string, phrase: string, target: string) => wrap(() => wordtools.tmPhrase(source, phrase, target)))
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
    installAfterClose = false
  })
  // auto-update (version 1.1)
  ipcMain.handle('update:state', () => updater.updateState())
  ipcMain.handle('update:check', () => updater.checkForUpdates())
  ipcMain.handle('update:tests', () => updater.wantsTestUpdates())
  ipcMain.handle('update:setTests', (_e, on: boolean) => updater.setTestUpdates(on))
  ipcMain.handle('update:install', () => {
    if (updater.updateState().kind !== 'ready') return
    // closes the way it always does (saving first, maybe asking "what next?"), then installs
    installAfterClose = true
    win?.close()
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
  ipcMain.handle('settings:accent', (_e, accent: string) => {
    updateSettings({ accent: normalizeAccent(accent) })
  })
  ipcMain.handle('settings:sounds', (_e, sounds: SoundSettings) => {
    updateSettings({ sounds })
  })
  // Writing review with Claude (feature 19)
  ipcMain.handle('ai:settings', (_e, patch: Partial<AiSettings>) => updateSettings({ ai: { ...getSettings().ai, ...patch } }).ai)
  ipcMain.handle('ai:keyState', () => ai.keyState())
  ipcMain.handle('ai:setKey', (_e, key: string) => wrap(() => ai.setKey(key)))
  ipcMain.handle('ai:testKey', () => wrap(() => ai.testKey()))
  ipcMain.handle('ai:review', (e, jobId: string, req: ReviewRequest) => wrap(() => ai.review(e.sender, jobId, req)))
  ipcMain.handle('ai:followUp', (e, jobId: string, req: ReviewRequest, rv: Review, chat: ChatTurn[], q: string) => wrap(() => ai.followUp(e.sender, jobId, req, rv, chat, q)))
  ipcMain.handle('ai:findingReply', (e, jobId: string, req: ReviewRequest, rv: Review, f: Finding, msg: string) => wrap(() => ai.findingReply(e.sender, jobId, req, rv, f, msg)))
  ipcMain.handle('ai:promptIdeas', (_e, jobId: string, theme: string, count: number, avoid: string[]) => wrap(() => ai.promptIdeas(jobId, theme, count, avoid)))
  ipcMain.handle('ai:cancel', (_e, jobId: string) => ai.cancel(jobId))
  // Hebrew writing tools (round 10): synonyms from Claude, automatic niqqud from Dicta (or Claude)
  ipcMain.handle('words:synonyms', (_e, word: string, sentence: string) => wrap(() => wordtools.synonyms(word, sentence)))
  ipcMain.handle('words:nakdan', (_e, text: string, by: 'dicta' | 'claude') => wrap(() => wordtools.nakdan(text, by)))
  ipcMain.on('context:word', (_e, word: string) => noteContextWord(word))
  ipcMain.handle('reviews:list', (_e, b: string) => wrap(() => workshop.readReviews(b)))
  ipcMain.handle('reviews:put', (_e, b: string, rv: Review, remove?: boolean) => wrap(() => workshop.putReview(b, rv, remove)))
  ipcMain.handle('reviews:background', (_e, b: string) => wrap(() => workshop.bookBackground(b)))
  // The workshop (feature 22)
  ipcMain.handle('workshop:open', () => wrap(() => workshop.openWorkshop()))
  ipcMain.handle('workshop:create', (_e, prompt: string, title?: string, fromPromptId?: string) => wrap(() => workshop.createExercise(prompt, title, undefined, fromPromptId)))
  ipcMain.handle('workshop:update', (_e, id: string, patch: { title?: string; prompt?: string }) => wrap(() => workshop.updateExercise(id, patch)))
  ipcMain.handle('workshop:delete', (_e, id: string) => wrap(() => workshop.deleteExercise(id)))
  ipcMain.handle('workshop:load', (_e, id: string) => wrap(() => workshop.loadExercise(id)))
  ipcMain.handle('workshop:save', (_e, id: string, doc: PMNode) => wrap(() => workshop.saveExercise(id, doc)))
  ipcMain.handle('workshop:review', (_e, id: string, rv: Review, remove?: boolean) => wrap(() => workshop.putExerciseReview(id, rv, remove)))
  ipcMain.handle('workshop:addPrompts', (_e, texts: string[], source: ExercisePrompt['source']) => wrap(() => workshop.addPrompts(texts, source)))
  ipcMain.handle('workshop:removePrompt', (_e, id: string) => wrap(() => workshop.removePrompt(id)))
  ipcMain.handle('workshop:editPrompt', (_e, id: string, text: string) => wrap(() => workshop.editPrompt(id, text)))
  ipcMain.handle('workshop:import', () =>
    wrap(async () => {
      const res = await dialog.showOpenDialog(win!, {
        title: 'ייבוא תרגילים (קובצי Word או טקסט)',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Word / טקסט', extensions: ['docx', 'txt', 'md'] }]
      })
      if (res.canceled || !res.filePaths.length) return null
      return workshop.importExercises(res.filePaths)
    })
  )
  ipcMain.handle('workshop:move', () =>
    wrap(async () => {
      const res = await dialog.showOpenDialog(win!, { title: 'איפה לשמור את הסדנה?', defaultPath: workshop.workshopPath(), properties: ['openDirectory', 'createDirectory'] })
      if (res.canceled || !res.filePaths[0]) return null
      return workshop.moveWorkshop(res.filePaths[0])
    })
  )
  ipcMain.handle('workshop:showFile', (_e, id: string) => wrap(async () => shell.showItemInFolder(await workshop.exerciseFile(id))))
  ipcMain.handle('workshop:openInWord', (_e, id: string) => wrap(async () => shell.openPath(await workshop.exerciseFile(id))))
  // Reading and export (features 31, 36, 16)
  ipcMain.handle('book:publish', (_e, b: string, p: PublishSettings) => wrap(() => project.setPublish(b, p)))
  ipcMain.handle('book:exportData', (_e, b: string) => wrap(() => project.exportData(b)))
  ipcMain.handle('export:run', (_e, b: string, title: string, format: exporter.ExportFormat) =>
    wrap(async () => {
      const dir = join(b, 'ייצוא')
      await fsp.mkdir(dir, { recursive: true })
      const res = await dialog.showSaveDialog(win!, {
        title: format === 'pdf' ? 'שמירת PDF להדפסה' : format === 'docx' ? 'שמירת קובץ Word' : 'שמירת ePub',
        defaultPath: exporter.exportPath(dir, title, format),
        filters: [exporter.EXPORT_FILTERS[format]]
      })
      if (res.canceled || !res.filePath) return null
      const out = res.filePath
      if (format === 'docx') await exporter.exportDocx(b, out)
      else if (format === 'epub') await exporter.exportEpub(b, out)
      else await exporter.exportPdf(b, out, PRELOAD(), loadAppPage)
      return out
    })
  )
  // The manuscript for publishers (feature 45)
  ipcMain.handle('export:manuscript', (_e, b: string, title: string) =>
    wrap(async () => {
      const dir = join(b, 'ייצוא')
      await fsp.mkdir(dir, { recursive: true })
      const res = await dialog.showSaveDialog(win!, {
        title: 'שמירת כתב יד להוצאה',
        defaultPath: join(dir, `${project.safeName(title)} - כתב יד.docx`),
        filters: [exporter.EXPORT_FILTERS.docx]
      })
      if (res.canceled || !res.filePath) return null
      await exporter.exportManuscript(b, res.filePath)
      return res.filePath
    })
  )
  // One chapter as a PDF for a beta reader (feature 54)
  ipcMain.handle('export:beta', (_e, b: string, chapterId: string, title: string) =>
    wrap(async () => {
      const dir = join(b, 'ייצוא')
      await fsp.mkdir(dir, { recursive: true })
      const res = await dialog.showSaveDialog(win!, {
        title: 'שמירת הפרק לקורא בטא',
        defaultPath: join(dir, `${project.safeName(title)} - לקורא בטא.pdf`),
        filters: [exporter.EXPORT_FILTERS.pdf]
      })
      if (res.canceled || !res.filePath) return null
      await exporter.exportBetaPdf(b, chapterId, res.filePath, PRELOAD(), loadAppPage)
      return res.filePath
    })
  )
  // The scene break image (feature 48): chosen, copied into the book, and saved in its layout
  ipcMain.handle('publish:sceneImage', (_e, b: string) =>
    wrap(async () => {
      const res = await dialog.showOpenDialog(win!, {
        title: 'תמונה למעבר סצנה',
        properties: ['openFile'],
        filters: [{ name: 'תמונה', extensions: exporter.SCENE_IMAGE_EXTS }]
      })
      if (res.canceled || !res.filePaths[0]) return null
      return exporter.copySceneImage(b, res.filePaths[0])
    })
  )
  ipcMain.handle('publish:readSceneImage', (_e, b: string, file: string) => wrap(async () => (await exporter.readSceneImage(b, { sceneImage: file }))?.dataUrl ?? null))
  ipcMain.handle('shell:openPath', (_e, path: string) => shell.openPath(path))
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
    if (closeTimer) clearTimeout(closeTimer)
    finishClose()
  })

  ipcMain.handle('library:list', (): RecentBook[] =>
    getSettings().recent.map((r) => ({ ...r, exists: project.isBookFolder(r.path) }))
  )
  ipcMain.handle('library:archive', (_e, path: string, archived: boolean) => {
    updateSettings({ recent: getSettings().recent.map((r) => (r.path === path ? { ...r, archived } : r)) })
  })
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
    backup.watchForBackup(book.path)
    return book
  }

  // Crash recovery (feature 41): typing not yet in its Word file, kept on this computer's disk
  ipcMain.handle('recovery:write', (_e, session: string, entry: RecoveryEntry) => recovery.writeEntry(session, entry).catch(() => undefined))
  ipcMain.handle('recovery:clear', (_e, session: string, key: string) => recovery.clearEntry(session, key).catch(() => undefined))
  ipcMain.handle('recovery:list', (_e, session: string) => wrap(() => recovery.listEntries(session)))
  ipcMain.handle('recovery:restore', (_e, key: string) => wrap(() => recovery.restoreEntry(key)))
  ipcMain.handle('recovery:discard', (_e, key: string) => wrap(() => recovery.discardEntry(key)))
  ipcMain.handle('recovery:saveAs', (_e, key: string, name: string) => wrap(() => recovery.saveEntryAs(win!, key, name)))

  // Daily backups (feature 49)
  backup.onBackupDone((b) => win?.webContents.send('backup:done', b))
  ipcMain.handle('backup:root', () => backup.rootDir())
  ipcMain.handle('backup:info', (_e, b: string) => wrap(() => backup.backupInfo(b)))
  ipcMain.handle('backup:now', (_e, b: string) => wrap(() => backup.backupNow(b, true)))
  ipcMain.handle('backup:chapters', (_e, b: string, day: string) => wrap(() => backup.backupChapters(b, day)))
  ipcMain.handle('backup:restoreChapter', (_e, b: string, day: string, chapterId: string) =>
    wrap(async () => {
      const r = await backup.restoreChapter(b, day, chapterId)
      rememberBook(r.book.path, r.book.title, r.book.chapters.length)
      return r
    })
  )
  ipcMain.handle('backup:settings', (_e, patch: Partial<BackupSettings>) => updateSettings({ backup: normalizeBackup({ ...getSettings().backup, ...patch }) }).backup)
  ipcMain.handle('backup:chooseFolder', async () => {
    const res = await dialog.showOpenDialog(win!, { title: 'איפה לשמור את הגיבויים?', defaultPath: backup.rootDir(), properties: ['openDirectory', 'createDirectory'] })
    if (res.canceled || !res.filePaths[0]) return null
    return updateSettings({ backup: normalizeBackup({ ...getSettings().backup, folder: res.filePaths[0] }) }).backup
  })
  ipcMain.handle('backup:open', async (_e, b?: string) => {
    const info = b ? await backup.backupInfo(b).catch(() => null) : null
    const target = info?.dir ?? backup.rootDir()
    await fsp.mkdir(target, { recursive: true }).catch(() => undefined)
    return shell.openPath(target)
  })

  // Importing a manuscript from Word (feature 42)
  ipcMain.handle('import:pick', () =>
    wrap(async () => {
      const res = await dialog.showOpenDialog(win!, {
        title: 'בחירת כתב היד (קובץ Word)',
        defaultPath: getSettings().defaultFolder ?? app.getPath('documents'),
        filters: [{ name: 'Word', extensions: ['docx'] }],
        properties: ['openFile']
      })
      if (res.canceled || !res.filePaths[0]) return null
      const file = res.filePaths[0]
      const { blocks, warnings } = await docxBlocks(new Uint8Array(await fsp.readFile(file)), { splitPages: true })
      return { fileName: file.split(/[\\/]/).pop() ?? '', blocks, warnings }
    })
  )
  ipcMain.handle('import:toBook', (_e, b: string, items: { title: string; doc: PMNode }[]) => wrapBook(() => project.importChapters(b, items)))
  ipcMain.handle('import:newBook', (_e, parentDir: string, title: string, items: { title: string; doc: PMNode }[]) =>
    wrap(async () => {
      updateSettings({ defaultFolder: parentDir })
      const { book, notice } = await project.createBookFromChapters(parentDir, title, items)
      return { book: opened(book), notice }
    })
  )

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
  ipcMain.handle('book:rename', (_e, bookPath: string, title: string, fromLibrary?: boolean) =>
    wrap(async () => {
      const { book, notice } = await project.renameBook(bookPath, title)
      if (book.path !== bookPath) {
        // everything the app remembers about the book moves to its new folder
        const s = getSettings()
        const move = <T,>(rec: Record<string, T> | undefined) => {
          if (!rec || !(bookPath in rec)) return rec
          const { [bookPath]: v, ...rest } = rec
          return { ...rest, [book.path]: v }
        }
        updateSettings({
          recent: fromLibrary ? s.recent : s.recent.filter((r) => r.path !== bookPath),
          lastChapter: move(s.lastChapter) ?? {},
          splitLayout: move(s.splitLayout),
          translateLayout: move(s.translateLayout)
        })
      }
      if (fromLibrary) {
        // the shelf keeps its order: only the name and the folder change
        updateSettings({ recent: getSettings().recent.map((r) => (r.path === bookPath ? { ...r, path: book.path, title: book.title } : r)) })
      } else opened(book)
      return { book, notice }
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
  ipcMain.handle('book:writingLog', (_e, b: string) => wrap(() => writingLog.getLog(b)))
  ipcMain.handle('book:labels', (_e, b: string, labels) => wrap(() => project.setLabels(b, labels)))
  ipcMain.handle('book:wordCounts', (_e, b: string) => wrap(() => project.wordCounts(b)))
  ipcMain.handle('chapter:load', (_e, b: string, id: string) => wrap(() => project.loadChapter(b, id)))
  ipcMain.handle('chapter:save', (_e, b: string, id: string, doc: PMNode) => wrap(() => project.saveChapter(b, id, doc)))
  ipcMain.handle('shell:showFile', (_e, path: string) => {
    if (existsSync(path)) shell.showItemInFolder(path)
    else shell.openPath(join(path, '..'))
  })
  ipcMain.handle('shell:openInWord', (_e, path: string) => shell.openPath(path))
}

// One window only: opening the app again (from the desktop or the Start menu) brings the open
// window to the front instead of a second copy that would write the same chapter files
if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
})

app.whenReady().then(() => {
  // Same id as the installer's shortcuts (appId in electron-builder.yml), so the taskbar groups
  // the running window with its pinned shortcut and shows our icon
  if (process.platform === 'win32') app.setAppUserModelId('com.hakirchia.app')
  Menu.setApplicationMenu(null)
  registerIpc()
  exporter.registerPrintIpc()
  createWindow()
  updater.setupUpdater(() => win)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// feature 47: the writing days gathered in memory are written before the app closes
app.on('before-quit', () => writingLog.flushSync())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
