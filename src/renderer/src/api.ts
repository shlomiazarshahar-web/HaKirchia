import type { Api } from '../../preload'

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
