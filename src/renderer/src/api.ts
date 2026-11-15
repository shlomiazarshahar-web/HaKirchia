import type { Api } from '../../preload'
import type { PMNode } from '@shared/types'
import type { StopPoint } from '@shared/stoppoint'

declare global {
  interface Window {
    api: Api
  }
}
export const api = window.api

// Pending chapter saves. Anything that switches chapters, renames files or closes the app
// waits for these first, so no typing is ever lost.
const flushers = new Set<() => Promise<void>>()
export function registerFlusher(fn: () => Promise<void>): () => void {
  flushers.add(fn)
  return () => flushers.delete(fn)
}
export async function flushAll(): Promise<void> {
  await Promise.all([...flushers].map((f) => f()))
}

// Chapters changed on disk outside the app. Each open editor listens for its own chapter.
const diskListeners = new Map<string, Set<() => void>>()
api.onChapterDiskChanged((bookPath, chapterId) => {
  for (const fn of diskListeners.get(`${bookPath}|${chapterId}`) ?? []) fn()
})
export function onDiskChange(bookPath: string, chapterId: string, fn: () => void): () => void {
  const key = `${bookPath}|${chapterId}`
  if (!diskListeners.has(key)) diskListeners.set(key, new Set())
  diskListeners.get(key)!.add(fn)
  return () => diskListeners.get(key)?.delete(fn)
}

// The same chapter open in more than one place at once (split screen, or a chapter next to the
// master). Typing in one editor is passed to the others right away, so they never show old text
// and never save it over the new one. Only the editor that was typed in saves the file.
type LiveFn = (doc: PMNode, from: symbol) => void
const liveListeners = new Map<string, Set<LiveFn>>()
export function onLiveEdit(bookPath: string, chapterId: string, fn: LiveFn): () => void {
  const key = `${bookPath}|${chapterId}`
  if (!liveListeners.has(key)) liveListeners.set(key, new Set())
  liveListeners.get(key)!.add(fn)
  return () => liveListeners.get(key)?.delete(fn)
}
/** True when another editor shows this chapter too (so the text is worth passing on). */
export function hasLiveTwin(bookPath: string, chapterId: string): boolean {
  return (liveListeners.get(`${bookPath}|${chapterId}`)?.size ?? 0) > 1
}
export function publishLiveEdit(bookPath: string, chapterId: string, doc: PMNode, from: symbol): void {
  for (const fn of liveListeners.get(`${bookPath}|${chapterId}`) ?? []) fn(doc, from)
}

// Live word counts: every editor reports its chapter's words as they change, so the status bar can
// show the whole book's total (the other chapters come from the files on disk).
type WordsFn = (bookPath: string, chapterId: string, words: number) => void
const wordListeners = new Set<WordsFn>()
export function reportWords(bookPath: string, chapterId: string, words: number): void {
  for (const fn of wordListeners) fn(bookPath, chapterId, words)
}
export function onWordsReport(fn: WordsFn): () => void {
  wordListeners.add(fn)
  return () => wordListeners.delete(fn)
}

// Stopping point: when a book opens where the writer stopped, the editor of that chapter puts the
// cursor back there as soon as it has loaded.
let pendingStop: { bookPath: string; sp: StopPoint } | null = null
export function setPendingStop(bookPath: string, sp: StopPoint | null): void {
  pendingStop = sp ? { bookPath, sp } : null
}
export function takePendingStop(bookPath: string, chapterId: string): StopPoint | null {
  if (!pendingStop || pendingStop.bookPath !== bookPath || pendingStop.sp.chapterId !== chapterId) return null
  const sp = pendingStop.sp
  pendingStop = null
  return sp
}
