// Words per chapter, read from the files (so they are right even for chapters changed in Word).
// Used by the cork board and the table (feature 60).

import { useEffect, useState } from 'react'
import type { Book } from '@shared/types'
import { api, onDiskChange } from './api'

export function useWordCounts(book: Book): Record<string, number> {
  const [words, setWords] = useState<Record<string, number>>({})
  const fileKey = book.chapters.map((c) => c.id + c.file).join('|')
  useEffect(() => {
    let alive = true
    const load = () =>
      api.wordCounts(book.path).then((r) => {
        if (alive && r.ok && r.value) setWords(r.value)
      })
    void load()
    const offs = book.chapters.map((c) => onDiskChange(book.path, c.id, load))
    return () => {
      alive = false
      offs.forEach((off) => off())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.path, fileKey])
  return words
}
