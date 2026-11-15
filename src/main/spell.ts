// Spell checking (Hebrew + English, Hunspell dictionaries built into Electron) with a personal
// dictionary for names and invented words, and the right-click menu with suggestions.
import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { promises as fs, readFileSync } from 'fs'
import { join } from 'path'
import type { SpellStatus } from '../shared/types'
import { getSettings, updateSettings } from './settings'

const LANGS = ['he', 'he-IL', 'en-US']
const dictFile = () => join(app.getPath('userData'), 'מילון אישי.txt')
const failed = new Set<string>()
let words: string[] = []

function loadWords(): string[] {
  try {
    return readFileSync(dictFile(), 'utf8')
      .split(/\r?\n/)
      .map((w) => w.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}
let writing = Promise.resolve()
function saveWords(): void {
  const text = words.join('\r\n') + '\r\n'
  writing = writing.then(() => fs.writeFile(dictFile(), text, 'utf8')).catch(() => undefined)
}

export function setupSpellcheck(win: BrowserWindow): void {
  const ses = win.webContents.session
  const available = ses.availableSpellCheckerLanguages
  const langs = available.length ? LANGS.filter((l) => available.includes(l)) : ['he', 'en-US']
  const pick = [...new Set(langs.map((l) => (l === 'he-IL' && langs.includes('he') ? 'he' : l)))]
  try {
    ses.setSpellCheckerLanguages(pick)
  } catch {
    /* a language that this version does not know */
  }
  ses.setSpellCheckerEnabled(getSettings().spellcheck !== false)
  ses.on('spellcheck-dictionary-download-failure', (_e, lang) => failed.add(lang))
  ses.on('spellcheck-dictionary-download-success', (_e, lang) => failed.delete(lang))

  // The personal dictionary lives in a plain text file (one word per line) so it is easy to back up
  words = loadWords()
  for (const w of words) ses.addWordToSpellCheckerDictionary(w)

  win.webContents.on('context-menu', (_e, p) => {
    const items: MenuItemConstructorOptions[] = []
    if (p.misspelledWord) {
      const sugg = p.dictionarySuggestions.slice(0, 7)
      if (sugg.length) for (const s of sugg) items.push({ label: s, click: () => win.webContents.replaceMisspelling(s) })
      else items.push({ label: 'אין הצעות', enabled: false })
      items.push(
        { type: 'separator' },
        { label: `הוספת "${p.misspelledWord}" למילון האישי`, click: () => addWord(win, p.misspelledWord) },
        { type: 'separator' }
      )
    }
    const f = p.editFlags
    if (p.isEditable) {
      items.push(
        { label: 'גזירה', role: 'cut', enabled: f.canCut },
        { label: 'העתקה', role: 'copy', enabled: f.canCopy },
        { label: 'הדבקה', role: 'paste', enabled: f.canPaste },
        { type: 'separator' },
        { label: 'בחירת הכול', role: 'selectAll' }
      )
    } else if (p.selectionText) items.push({ label: 'העתקה', role: 'copy' })
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win })
  })
}

/** From the right-click menu: add the word, and refresh the red line under it. */
export function addWord(win: BrowserWindow, word: string): void {
  addWordQuiet(win, word)
  win.webContents.replaceMisspelling(word.trim())
}

export function removeWord(win: BrowserWindow, word: string): void {
  words = words.filter((w) => w !== word)
  win.webContents.session.removeWordFromSpellCheckerDictionary(word)
  saveWords()
}

export function addWordQuiet(win: BrowserWindow, word: string): void {
  const w = word.trim()
  if (!w || words.includes(w)) return
  words = [...words, w].sort((a, b) => a.localeCompare(b, 'he'))
  win.webContents.session.addWordToSpellCheckerDictionary(w)
  saveWords()
}

export function setSpellEnabled(win: BrowserWindow, on: boolean): void {
  updateSettings({ spellcheck: on })
  win.webContents.session.setSpellCheckerEnabled(on)
}

export function spellStatus(win: BrowserWindow): SpellStatus {
  const ses = win.webContents.session
  const languages = ses.getSpellCheckerLanguages()
  return {
    enabled: ses.isSpellCheckerEnabled(),
    languages,
    hebrewMissing: !languages.some((l) => l.startsWith('he')) || [...failed].some((l) => l.startsWith('he')),
    words
  }
}
