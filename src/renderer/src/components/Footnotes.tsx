// Footnotes under a chapter (feature 15): one field per note number in the text, in order.
import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { FOOTNOTE_ADDED } from '../editor'

interface Item {
  pos: number
  text: string
}

function collect(editor: Editor): Item[] {
  const out: Item[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'footnote') out.push({ pos, text: String(node.attrs.text ?? '') })
    return true
  })
  return out
}

export function FootnoteList({ editor }: { editor: Editor }) {
  const [items, setItems] = useState<Item[]>(() => collect(editor))
  const fields = useRef<(HTMLTextAreaElement | null)[]>([])
  const editable = editor.isEditable

  useEffect(() => {
    const upd = () => {
      if (editor.isDestroyed) return
      const next = collect(editor)
      setItems((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next))
    }
    upd()
    editor.on('update', upd)
    editor.on('transaction', upd)
    // a new note: its field gets the keyboard
    const added = (e: Event) => {
      const d = (e as CustomEvent).detail as { editor: Editor; pos: number }
      if (d.editor !== editor) return
      upd()
      requestAnimationFrame(() => {
        const i = collect(editor).findIndex((x) => x.pos === d.pos)
        const f = fields.current[i]
        if (f) {
          f.focus()
          f.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        }
      })
    }
    window.addEventListener(FOOTNOTE_ADDED, added)
    // a click on a number in the text goes to its note
    const click = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (!t.matches?.('sup.fn-ref')) return
      const all = [...editor.view.dom.querySelectorAll('sup.fn-ref')]
      const f = fields.current[all.indexOf(t)]
      if (f) {
        e.preventDefault()
        f.focus()
        f.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    }
    editor.view.dom.addEventListener('click', click)
    return () => {
      editor.off('update', upd)
      editor.off('transaction', upd)
      window.removeEventListener(FOOTNOTE_ADDED, added)
      if (!editor.isDestroyed) editor.view.dom.removeEventListener('click', click)
    }
  }, [editor])

  if (!items.length) return null

  const backToText = (i: number) => {
    const it = collect(editor)[i]
    if (it) editor.chain().focus().setTextSelection(it.pos + 1).scrollIntoView().run()
  }

  return (
    <section className="footnotes" aria-label="הערות שוליים">
      <div className="fn-h">הערות שוליים</div>
      <ol>
        {items.map((it, i) => (
          <li key={i}>
            <button className="fn-num" title="חזרה למקום ההערה בטקסט" onClick={() => backToText(i)}>
              {i + 1}
            </button>
            <textarea
              ref={(el) => {
                fields.current[i] = el
                if (el) {
                  el.style.height = 'auto'
                  el.style.height = el.scrollHeight + 'px'
                }
              }}
              value={it.text}
              readOnly={!editable}
              dir="auto"
              rows={1}
              placeholder="הטקסט של הערת השוליים"
              aria-label={`הערת שוליים ${i + 1}`}
              onChange={(e) => {
                const cur = collect(editor)[i]
                if (cur) editor.commands.setFootnoteText(cur.pos, e.target.value)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
                  e.preventDefault()
                  backToText(i)
                }
              }}
            />
            {editable && (
              <button
                className="ib icon fn-del"
                title="מחיקת ההערה (גם המספר בטקסט)"
                aria-label={`מחיקת הערת שוליים ${i + 1}`}
                onClick={() => {
                  const cur = collect(editor)[i]
                  if (cur) editor.chain().focus().deleteRange({ from: cur.pos, to: cur.pos + 1 }).run()
                }}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
