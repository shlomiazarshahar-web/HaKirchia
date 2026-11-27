// Feature 56, the YouTube player: which links it accepts, and which pages may open in it.
// Pure logic, used by the window and checked again in the main process.
//
// The small player is a tiny page of the app's own that holds YouTube's player in a frame. YouTube
// now refuses to play (error 152-4 / 153) unless that page has a real web address it can name as
// "the site that embeds me": an app-only address (file://, a custom scheme) is not enough.
// So the page is served from a real web origin, in one of two ways (main/music.ts):
//   way 1: a tiny local web server on this computer (http://127.0.0.1:<port>/player)
//   way 2: an https address answered inside the player's own session (PLAYER_HTTPS_BASE)
// The panel tries way 1, then way 2, and remembers the way that played.

/** Prefix of the player page's console reports (ready / playing / error:<code>) */
export const PLAYER_SCHEME = 'hakirchia-yt'
/** Way 2's address: the app answers it itself, inside the music session (nothing is downloaded from it) */
export const PLAYER_HTTPS_HOST = 'shlomiazarshahar-web.github.io'
export const PLAYER_HTTPS_PATH = '/hakirchia-player/'
export const PLAYER_HTTPS_BASE = `https://${PLAYER_HTTPS_HOST}${PLAYER_HTTPS_PATH}`
/** How many ways there are to show the small player */
export const PLAYER_WAYS = 2

const ID = /^[\w-]{6,}$/
const LIST = /^[\w-]+$/

/** The video and/or playlist of a YouTube link; null if it is not a YouTube link */
export function youtubeParts(link: string): { id?: string; list?: string } | null {
  let u: URL
  try {
    u = new URL(link.trim().startsWith('http') ? link.trim() : `https://${link.trim()}`)
  } catch {
    return null
  }
  const host = u.hostname.replace(/^www\.|^m\.|^music\./, '')
  let id = ''
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0]
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v') ?? ''
    else {
      const m = u.pathname.match(/^\/(?:embed|live|shorts|v)\/([\w-]{6,})/)
      if (m) id = m[1]
    }
  } else return null
  const list = u.searchParams.get('list') ?? ''
  const out: { id?: string; list?: string } = {}
  if (ID.test(id) && id !== 'videoseries') out.id = id
  if (LIST.test(list)) out.list = list
  return out.id || out.list ? out : null
}

/** The video (or playlist) of a YouTube link, as an address for YouTube's embedded player; null if it is not one */
export function youtubeEmbed(link: string): string | null {
  const p = youtubeParts(link)
  if (!p) return null
  if (!p.id) return `https://www.youtube.com/embed/videoseries?list=${p.list}&autoplay=1`
  return `https://www.youtube.com/embed/${p.id}?autoplay=1${p.list ? `&list=${p.list}` : `&loop=1&playlist=${p.id}`}`
}

/** The app's own small player page for a link (YouTube's player inside a frame), at a page address (way 1 or 2) */
export function youtubePlayer(link: string, base: string): string | null {
  const p = youtubeParts(link)
  if (!p) return null
  const q = new URLSearchParams()
  if (p.id) q.set('v', p.id)
  if (p.list) q.set('list', p.list)
  return `${base}?${q}`
}

/** YouTube's normal page for the link (the fallback when the small player is refused) */
export function youtubeWatch(link: string): string | null {
  const p = youtubeParts(link)
  if (!p) return null
  if (!p.id) return `https://www.youtube.com/playlist?list=${p.list}`
  return `https://www.youtube.com/watch?v=${p.id}${p.list ? `&list=${p.list}` : ''}`
}

/** The player page's HTML: YouTube's IFrame player filling the page; errors are reported on the console */
export function playerHtml(params: URLSearchParams): string | null {
  const id = params.get('v') ?? ''
  const list = params.get('list') ?? ''
  const okId = ID.test(id)
  const okList = LIST.test(list)
  if (!okId && !okList) return null
  const vars: Record<string, string | number> = { autoplay: 1, playsinline: 1, rel: 0 }
  if (okList) Object.assign(vars, { listType: 'playlist', list })
  else Object.assign(vars, { loop: 1, playlist: id })
  const cfg = JSON.stringify({ videoId: okId ? id : undefined, playerVars: vars })
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="referrer" content="strict-origin-when-cross-origin">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#p{width:100%;height:100%;border:0}</style>
</head><body><div id="p"></div>
<script>
var cfg = ${cfg};
function report(what) { console.log('${PLAYER_SCHEME}:' + what); }
function onYouTubeIframeAPIReady() {
  cfg.width = '100%'; cfg.height = '100%';
  // the site that embeds the player: this page's own (real) web address
  cfg.playerVars.origin = location.origin;
  cfg.playerVars.widget_referrer = location.href;
  cfg.events = {
    onReady: function (e) { report('ready'); try { e.target.playVideo(); } catch (x) {} },
    onStateChange: function (e) { if (e.data === 1) report('playing'); },
    onError: function (e) { report('error:' + e.data); }
  };
  new YT.Player('p', cfg);
}
</script>
<script src="https://www.youtube.com/iframe_api" onerror="report('error:offline')"></script>
</body></html>`
}

/** Pages the music player may show (the app's player page, YouTube and its consent page); everything else opens in the browser */
export function allowedInMusicPlayer(url: string): boolean {
  try {
    const u = new URL(url)
    // way 1: the local player server (main/music.ts listens on this computer only)
    if (u.protocol === 'http:') return u.hostname === '127.0.0.1' && /^\/player\/?$/.test(u.pathname)
    if (u.protocol !== 'https:') return false
    // way 2
    if (u.hostname === PLAYER_HTTPS_HOST) return u.pathname === PLAYER_HTTPS_PATH
    return /^(www\.|m\.)?youtube(-nocookie)?\.com$/.test(u.hostname) || u.hostname === 'consent.youtube.com' || /^(accounts|consent)\.google\.com$/.test(u.hostname)
  } catch {
    return false
  }
}
