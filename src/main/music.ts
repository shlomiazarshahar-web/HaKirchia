// Feature 56 (fixed in round 14): the YouTube player's own session ("persist:music").
// - Serves the app's small player page (shared/sounds.ts playerHtml) on PLAYER_SCHEME, so YouTube's
//   player sits in a frame inside a page, as YouTube requires (it refused to be the page itself:
//   error 152-4).
// - Tells YouTube which site embeds it (the Referer header), which its player now insists on.
// - Presents itself as plain Chrome, so YouTube does not treat the app as an unknown browser.

import { protocol, session } from 'electron'
import { PLAYER_SCHEME, playerHtml } from '../shared/sounds'

export const MUSIC_PARTITION = 'persist:music'

/** Must run before the app is ready */
export function registerPlayerScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: PLAYER_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }])
}

export function setupMusicSession(): void {
  const ses = session.fromPartition(MUSIC_PARTITION)
  ses.protocol.handle(PLAYER_SCHEME, (req) => {
    const u = new URL(req.url)
    const html = u.hostname === 'player' ? playerHtml(u.searchParams) : null
    if (!html) return new Response('not found', { status: 404 })
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
  })
  ses.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube.com/*', 'https://www.youtube-nocookie.com/*'] }, (d, cb) => {
    const h = d.requestHeaders
    if (!Object.keys(h).some((k) => k.toLowerCase() === 'referer')) h.Referer = 'https://www.youtube.com/'
    cb({ requestHeaders: h })
  })
  ses.setUserAgent(
    ses
      .getUserAgent()
      .replace(/\s(HaKirchia|hakirchia|Electron)\/\S+/g, '')
      .trim()
  )
}
