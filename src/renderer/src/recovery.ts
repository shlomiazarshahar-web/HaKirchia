// Crash recovery (feature 41), the window's side: each editor keeps its unsaved typing in the
// recovery folder (through the main process) and clears it once the text is in its Word file.

import { api } from './api'
import { recoveryKey, RECOVERY_EVERY_MS, type RecoveryKind } from '@shared/recovery'
import type { PMNode } from '@shared/types'

/** This run of the window. Text kept by an earlier run (before a crash) is what gets offered back. */
export const SESSION = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/-/g, '').slice(0, 12)

export interface Journal {
  /** Typing happened: keep it within a moment, at most once every RECOVERY_EVERY_MS */
  touch: () => void
  /** Keep it now (a save just failed) */
  now: () => void
  /** The text is safely in its file */
  clear: () => void
  dispose: () => void
}

/**
 * The recovery journal of one document. `get` returns the text to keep, or null when there is
 * nothing unsaved (then nothing is written).
 */
export function journal(kind: RecoveryKind, where: () => { bookPath: string; id: string }, get: () => PMNode | null): Journal {
  let timer: ReturnType<typeof setTimeout> | null = null
  let written = false
  const write = () => {
    timer = null
    const doc = get()
    if (!doc) return
    const { bookPath, id } = where()
    written = true
    void api.writeRecovery(SESSION, { kind, bookPath, id, doc, at: Date.now() })
  }
  return {
    touch: () => {
      if (!timer) timer = setTimeout(write, RECOVERY_EVERY_MS)
    },
    now: () => {
      if (timer) clearTimeout(timer)
      write()
    },
    clear: () => {
      if (timer) clearTimeout(timer)
      timer = null
      if (!written) return
      written = false
      const { bookPath, id } = where()
      void api.clearRecovery(SESSION, recoveryKey(kind, bookPath, id))
    },
    dispose: () => {
      if (timer) clearTimeout(timer)
      timer = null
    }
  }
}
