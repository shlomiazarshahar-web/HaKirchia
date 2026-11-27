// Feature 56: the YouTube player's own session ("persist:music").
//
// YouTube plays its embedded player only when the page around it has a real web address, which it
// names as "the site that embeds me" (otherwise: error 152-4 / 153). An app address (file://, a
// custom scheme) does not count. So the app's small player page (shared/sounds.ts playerHtml) is
// served from a real web origin, in one of two ways:
//   way 1: a tiny web server on this computer only (http://127.0.0.1:<port>/player)
//   way 2: an https address that the music session answers itself (PLAYER_HTTPS_BASE); every other
//          https request of that session passes through unchanged
// The panel (components/Sounds.tsx) asks for way 1 first, and for way 2 if YouTube still refuses.
// Also: the player is presented as plain Chrome, so YouTube does not treat it as an unknown browser.

import { ipcMain, session } from 'electron'
import { createServer } from 'node:http'
import { PLAYER_HTTPS_BASE, PLAYER_HTTPS_HOST, PLAYER_HTTPS_PATH, playerHtml } from '../shared/sounds'

export const MUSIC_PARTITION = 'persist:music'

const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'strict-origin-when-cross-origin'
}

let localBase: Promise<string> | null = null
let httpsOn = false
/** The origin of the player page in use, as the site that embeds YouTube */
let embedder = ''

/** Way 1: the local player server (started on first use, listens on this computer only) */
function startLocal(): Promise<string> {
  if (localBase) return localBase
  localBase = new Promise<string>((resolve, reject) => {
    const srv = createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1')
      const html = /^\/player\/?$/.test(u.pathname) ? playerHtml(u.searchParams) : null
      if (!html) {
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end('not found')
        return
      }
      res.writeHead(200, PAGE_HEADERS)
      res.end(html)
    })
    srv.once('error', (err) => {
      localBase = null
      reject(err)
    })
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      if (!addr || typeof addr === 'string') return reject(new Error('no port'))
      resolve(`http://127.0.0.1:${addr.port}/player`)
    })
  })
  return localBase
}

/** Way 2: the music session answers PLAYER_HTTPS_BASE itself; everything else goes to the web as usual */
function startHttps(): string {
  if (!httpsOn) {
    const ses = session.fromPartition(MUSIC_PARTITION)
    ses.protocol.handle('https', (req) => {
      const u = new URL(req.url)
      if (u.hostname === PLAYER_HTTPS_HOST) {
        const html = u.pathname === PLAYER_HTTPS_PATH ? playerHtml(u.searchParams) : null
        return html ? new Response(html, { headers: PAGE_HEADERS }) : new Response('not found', { status: 404 })
      }
      return ses.fetch(req, { bypassCustomProtocolHandlers: true })
    })
    httpsOn = true
  }
  return PLAYER_HTTPS_BASE
}

export function setupMusicSession(): void {
  const ses = session.fromPartition(MUSIC_PARTITION)
  // Tells YouTube which site embeds it, if the request left that out
  ses.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube.com/*', 'https://www.youtube-nocookie.com/*'] }, (d, cb) => {
    const h = d.requestHeaders
    if (embedder && /\/(embed\/|iframe_api)/.test(d.url) && !Object.keys(h).some((k) => k.toLowerCase() === 'referer')) h.Referer = `${embedder}/`
    cb({ requestHeaders: h })
  })
  ses.setUserAgent(
    ses
      .getUserAgent()
      .replace(/\s(HaKirchia|hakirchia|Electron)\/\S+/g, '')
      .trim()
  )
  // The panel asks where the small player page is, for way 1 or 2 (null: that way is not available)
  ipcMain.handle('music:player', async (_e, way: number): Promise<string | null> => {
    try {
      const base = way === 2 ? startHttps() : await startLocal()
      embedder = new URL(base).origin
      return base
    } catch {
      return null
    }
  })
}

