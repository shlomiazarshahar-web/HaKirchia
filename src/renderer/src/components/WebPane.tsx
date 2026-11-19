// Google Translate inside the app (feature 13): the ordinary Google Translate site in a pane, no
// API and no account needed. Text sent from the PDF ("לתרגום") opens there; the translation never
// goes into the chapter by itself, the writer copies what they want.
//
// Only Google Translate may open here (checked in the main process too); any other link opens in
// the normal browser.

import { createElement, useEffect, useRef, useState } from 'react'
import { GOOGLE_TRANSLATE_HOME, googleTranslateUrl } from '@shared/translation'
import { onSendToTranslate } from '../translate'
import { Icon } from './Icons'

interface WebviewEl extends HTMLElement {
  src: string
  goBack: () => void
  canGoBack: () => boolean
  reload: () => void
  getURL: () => string
}

export function WebPane({ online = navigator.onLine }: { online?: boolean }) {
  const [src, setSrc] = useState(GOOGLE_TRANSLATE_HOME)
  const [url, setUrl] = useState(GOOGLE_TRANSLATE_HOME)
  const [error, setError] = useState<string | null>(online ? null : 'אין חיבור לאינטרנט. גוגל תרגום צריך אינטרנט.')
  const ref = useRef<WebviewEl | null>(null)

  useEffect(
    () =>
      onSendToTranslate((text) => {
        setError(null)
        setSrc(googleTranslateUrl(text))
      }),
    []
  )

  useEffect(() => {
    const wv = ref.current
    if (!wv) return
    const nav = (e: Event) => setUrl((e as Event & { url: string }).url)
    const fail = (e: Event) => {
      const ev = e as Event & { errorCode: number; isMainFrame: boolean }
      // -3 = the load was replaced by a newer one, not an error
      if (ev.isMainFrame && ev.errorCode !== -3) setError('גוגל תרגום לא נטען. אולי אין חיבור לאינטרנט.')
    }
    const ok = () => setError(null)
    wv.addEventListener('did-navigate', nav)
    wv.addEventListener('did-navigate-in-page', nav)
    wv.addEventListener('did-fail-load', fail)
    wv.addEventListener('did-finish-load', ok)
    return () => {
      wv.removeEventListener('did-navigate', nav)
      wv.removeEventListener('did-navigate-in-page', nav)
      wv.removeEventListener('did-fail-load', fail)
      wv.removeEventListener('did-finish-load', ok)
    }
  }, [])

  const shown = url.replace(/^https:\/\//, '').replace(/[?#].*$/, '')
  return (
    <div className="webpane">
      <div className="urlbar">
        <Icon name="globe" />
        <span className="u" dir="ltr" title={url}>
          {shown}
        </span>
        <button className="ib icon" title="אחורה" aria-label="אחורה" onClick={() => ref.current?.canGoBack() && ref.current.goBack()}>
          <Icon name="jump" />
        </button>
        <button className="ib icon" title="טעינה מחדש" aria-label="טעינה מחדש" onClick={() => (setError(null), ref.current?.reload())}>
          <Icon name="reload" />
        </button>
        <button className="ib icon" title="חזרה לדף הראשי של גוגל תרגום" aria-label="דף ראשי" onClick={() => setSrc(GOOGLE_TRANSLATE_HOME + '&t=' + Date.now())}>
          <Icon name="translate" />
        </button>
      </div>
      {error && (
        <div className="web-error">
          {error}{' '}
          <button className="btn" onClick={() => (setError(null), ref.current?.reload())}>
            לנסות שוב
          </button>
        </div>
      )}
      {createElement('webview', { ref, src, partition: 'persist:translate', className: 'webview', webpreferences: 'contextIsolation=yes,sandbox=yes' })}
      <div className="gthint">סימון טקסט ב־PDF ולחיצה על <b>לתרגום</b> (או Ctrl+Shift+T) שולחים אותו לכאן. התרגום לא נכנס לפרק מעצמו.</div>
    </div>
  )
}
