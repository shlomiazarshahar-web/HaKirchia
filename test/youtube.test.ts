import { describe, expect, it } from 'vitest'
import { allowedInMusicPlayer, playerHtml, PLAYER_HTTPS_BASE, youtubePlayer, youtubeWatch } from '../src/shared/sounds'

describe('YouTube small player on a real web address (fix for error 152-4)', () => {
  it('builds the player page address for way 1 (local server) and way 2 (https)', () => {
    expect(youtubePlayer('https://www.youtube.com/watch?v=jfKfPfyJRdk', 'http://127.0.0.1:5123/player')).toBe('http://127.0.0.1:5123/player?v=jfKfPfyJRdk')
    expect(youtubePlayer('https://www.youtube.com/playlist?list=PL123abc', PLAYER_HTTPS_BASE)).toBe('https://shlomiazarshahar-web.github.io/hakirchia-player/?list=PL123abc')
    expect(youtubePlayer('https://example.com/x', PLAYER_HTTPS_BASE)).toBeNull()
    expect(youtubeWatch('youtu.be/jfKfPfyJRdk')).toBe('https://www.youtube.com/watch?v=jfKfPfyJRdk')
  })
  it('lets only the player pages and YouTube into the music player', () => {
    expect(allowedInMusicPlayer('http://127.0.0.1:5123/player?v=jfKfPfyJRdk')).toBe(true)
    expect(allowedInMusicPlayer('http://127.0.0.1:5123/other')).toBe(false)
    expect(allowedInMusicPlayer('http://example.com/player')).toBe(false)
    expect(allowedInMusicPlayer(`${PLAYER_HTTPS_BASE}?v=jfKfPfyJRdk`)).toBe(true)
    expect(allowedInMusicPlayer('https://shlomiazarshahar-web.github.io/other/')).toBe(false)
    expect(allowedInMusicPlayer('https://www.youtube.com/watch?v=jfKfPfyJRdk')).toBe(true)
    expect(allowedInMusicPlayer('hakirchia-yt://player/?v=x')).toBe(false)
  })
  it('names its own address as the embedding site and reports playing', () => {
    const html = playerHtml(new URLSearchParams('v=jfKfPfyJRdk'))!
    expect(html).toContain('"videoId":"jfKfPfyJRdk"')
    expect(html).toContain('playerVars.origin = location.origin')
    expect(html).toContain("report('playing')")
    expect(html).toContain('https://www.youtube.com/iframe_api')
    expect(playerHtml(new URLSearchParams('v=<script>'))).toBeNull()
  })
})
