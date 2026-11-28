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
// The word under the mouse at the last right-click, sent by the window (Windows does not select it)
let ctxWord = { word: '', at: 0 }
export function noteContextWord(word: string): void {
  ctxWord = { word: word.trim(), at: Date.now() }
}

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
    // Synonyms (feature 43): for one word, selected or under the mouse
    if (p.isEditable) {
      const selWord = p.selectionText.trim()
      const word = selWord && !/\s/.test(selWord) ? selWord : !selWord && Date.now() - ctxWord.at < 1500 ? ctxWord.word : ''
      if (word && word.length <= 30) {
        items.push({ label: `מילים נרדפות ל"${word}"…`, accelerator: 'Shift+F7', click: () => win.webContents.send('context:synonyms') }, { type: 'separator' })
      }
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
    // Background materials (round 7): a page or a glossary entry from the selected words
    const sel = p.selectionText.trim().replace(/\s+/g, ' ')
    if (sel && sel.length <= 80 && !p.selectionText.includes('\n')) {
      const short = sel.length > 28 ? sel.slice(0, 27) + '…' : sel
      const send = (kind: string) => () => win.webContents.send('context:background', kind, sel)
      if (items.length) items.push({ type: 'separator' })
      items.push(
        {
          label: `דף רקע חדש: "${short}"`,
          submenu: [
            { label: 'דמות', click: send('character') },
            { label: 'מקום', click: send('place') },
            { label: 'דף מחקר', click: send('research') }
          ]
        },
        p.isEditable
          ? { label: `הוספה למילון המונחים`, click: send('term') }
          : { label: `הוספה למילון המונחים (כמונח במקור)`, click: send('original') }
      )
    }
    // Feature 65: a hint planted here, or the payoff of one (any length of marked words, in a chapter)
    if (p.isEditable && p.selectionText.trim()) {
      const quote = p.selectionText.replace(/\s+/g, ' ').trim().slice(0, 400)
      const send = (kind: string) => () => win.webContents.send('context:background', kind, quote)
      if (items.length) items.push({ type: 'separator' })
      items.push({ label: 'שתילת רמז כאן', click: send('setup') }, { label: 'התשלום של רמז…', click: send('payoff') })
    }
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
