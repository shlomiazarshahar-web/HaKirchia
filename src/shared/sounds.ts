// Feature 56, the YouTube player: which links it accepts, and which pages may open in it.
// Pure logic, used by the window and checked again in the main process.

/** The video (or playlist) of a YouTube link, as an address for the embedded player; null if it is not one */
export function youtubeEmbed(link: string): string | null {
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
  const list = u.searchParams.get('list')
  if (!/^[\w-]{6,}$/.test(id)) {
    if (list && /^[\w-]+$/.test(list)) return `https://www.youtube.com/embed/videoseries?list=${list}&autoplay=1`
    return null
  }
  return `https://www.youtube.com/embed/${id}?autoplay=1${list && /^[\w-]+$/.test(list) ? `&list=${list}` : `&loop=1&playlist=${id}`}`
}

/** Pages the music player may show (YouTube and its consent page); everything else opens in the browser */
export function allowedInMusicPlayer(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    return /^(www\.|m\.)?youtube(-nocookie)?\.com$/.test(u.hostname) || u.hostname === 'consent.youtube.com' || /^(accounts|consent)\.google\.com$/.test(u.hostname)
  } catch {
    return false
  }
}
