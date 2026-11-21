// What the background-materials screens (pages, glossary, timeline, inspiration board) need from
// the app, without passing it through every pane.
import { createContext, useContext } from 'react'
import type { Book } from '@shared/types'
import type { MaterialKind } from '@shared/background'
import type { JumpTarget } from '../nav'

export interface BgActions {
  book: Book
  /** The book changed on disk (returned by an operation) */
  onBook: (b: Book) => void
  show: (text: string, error?: boolean) => void
  /** Goes to a place in a chapter, in a pane next to this one */
  goTo: (chapterId: string, target?: JumpTarget) => void
  openMaterial: (id: string) => void
  openGlossary: () => void
  newMaterial: (kind: MaterialKind) => void
  /** Asks before deleting a page */
  deleteMaterial: (id: string) => void
  /** Opens find and replace with these words */
  findReplace: (query: string, replace: string) => void
  /** The page just created: its name field takes the focus */
  freshMaterial: string | null
  /** The glossary entry just added from the right-click menu: its empty field takes the focus */
  freshTerm: string | null
}

export const BgContext = createContext<BgActions | null>(null)
export function useBg(): BgActions {
  const v = useContext(BgContext)
  if (!v) throw new Error('BgContext missing')
  return v
}
