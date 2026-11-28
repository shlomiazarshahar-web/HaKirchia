// Writing review with Claude (feature 19), the window's side: review settings (a small store, like
// prefs), whether there is a key, and running a request while showing its progress.
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Settings } from '@shared/types'
import { newId, normalizeAi, type AiSettings } from '@shared/review'
import { api } from './api'

let ai: AiSettings = normalizeAi(undefined)
let key: { has: boolean; hint: string } = { has: false, hint: '' }
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const sub = (l: () => void) => (listeners.add(l), () => void listeners.delete(l))

export function initAi(s: Settings): void {
  ai = normalizeAi(s.ai)
  // round 17: the depth moved once to the new default; remember that it did
  if (s.ai && !s.ai.r17) void api.setAiSettings({ effort: ai.effort, r17: true })
  emit()
  void api.aiKeyState().then((k) => ((key = k), emit()))
}

export function useAi(): AiSettings {
  return useSyncExternalStore(sub, () => ai)
}
export function useAiKey(): { has: boolean; hint: string } {
  return useSyncExternalStore(sub, () => key)
}
export function setAi(patch: Partial<AiSettings>): void {
  ai = { ...ai, ...patch }
  emit()
  void api.setAiSettings(patch)
}
export async function saveKey(k: string): Promise<string | null> {
  const r = await api.setAiKey(k)
  if (!r.ok || !r.value) return r.error ?? 'לא הצלחתי לשמור את המפתח'
  key = r.value
  emit()
  return null
}

/** A request to Claude in progress: its id (to cancel it) and the answer so far */
export function useAiJob(): { jobId: string | null; partial: string; start: () => string; done: () => void; cancel: () => void } {
  const [jobId, setJobId] = useState<string | null>(null)
  const [partial, setPartial] = useState('')
  useEffect(() => {
    if (!jobId) return
    return api.onAiProgress((id, text) => id === jobId && setPartial(text))
  }, [jobId])
  return {
    jobId,
    partial,
    start: () => {
      const id = newId()
      setPartial('')
      setJobId(id)
      return id
    },
    done: () => setJobId(null),
    cancel: () => {
      if (jobId) void api.cancelAi(jobId)
    }
  }
}
