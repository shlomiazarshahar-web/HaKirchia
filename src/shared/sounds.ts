// Feature 56, the YouTube player: which links it accepts, and which pages may open in it.
// Pure logic, used by the window and checked again in the main process.
//
// Round 14: YouTube refuses its embedded player when it is the page itself rather than a frame
// inside a page (error 152-4). So the small player is now a tiny page of the app's own
// (PLAYER_SCHEME, served by the main process) that holds YouTube's player in a frame. If that still
// fails, the panel falls back to YouTube's normal watch page.

/** The scheme of the app's own player page (main/music.ts serves it) */
export const PLAYER_SCHEME = 'hakirchia-yt'

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

/** The app's own small player page for a link (YouTube's player inside a frame) */
export function youtubePlayer(link: string): string | null {
  const p = youtubeParts(link)
  if (!p) return null
  const q = new URLSearchParams()
  if (p.id) q.set('v', p.id)
  if (p.list) q.set('list', p.list)
  return `${PLAYER_SCHEME}://player/?${q}`
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
  cfg.events = {
    onReady: function (e) { report('ready'); try { e.target.playVideo(); } catch (x) {} },
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
    if (u.protocol === `${PLAYER_SCHEME}:`) return u.hostname === 'player'
    if (u.protocol !== 'https:') return false
    return /^(www\.|m\.)?youtube(-nocookie)?\.com$/.test(u.hostname) || u.hostname === 'consent.youtube.com' || /^(accounts|consent)\.google\.com$/.test(u.hostname)
  } catch {
    return false
  }
}
