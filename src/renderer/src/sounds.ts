// Background sounds while writing (feature 56). All of them are recordings shipped with the app
// (round 15: the fire too, and a river instead of brown noise). No internet.
// Several can play together, each with its own volume. The YouTube player (a link, e.g. a Lofi stream) lives in
// components/Sounds.tsx; this file is the built-in sounds and the shared settings.

import { useSyncExternalStore } from 'react'
import type { SoundSettings } from '@shared/types'
import { api } from './api'
import rainUrl from './assets/sounds/rain-on-window.mp3?url'
import thunderUrl from './assets/sounds/thunder.mp3?url'
import cafeUrl from './assets/sounds/cafe.mp3?url'
import typewriterUrl from './assets/sounds/typewriter.mp3?url'
import wavesUrl from './assets/sounds/waves.mp3?url'
import windUrl from './assets/sounds/wind.mp3?url'
import howlUrl from './assets/sounds/howling-wind.mp3?url'
import fireUrl from './assets/sounds/fire.mp3?url'
import riverUrl from './assets/sounds/river.mp3?url'

export interface SoundDef {
  id: string
  name: string
  hint: string
}

export const SOUNDS: SoundDef[] = [
  { id: 'rain', name: 'גשם', hint: 'טיפות על החלון, ומדי פעם רעם רחוק' },
  { id: 'cafe', name: 'בית קפה', hint: 'המולה של בית קפה אמיתי' },
  { id: 'typewriter', name: 'מכונת כתיבה', hint: 'הקשות, פעמון וגלגלת' },
  { id: 'fire', name: 'אח בוערת', hint: 'עצים בוערים ומפצפצים' },
  { id: 'waves', name: 'גלים', hint: 'גלים על החוף' },
  { id: 'wind', name: 'רוח', hint: 'רוח במשבים, עם יללה' },
  { id: 'river', name: 'נהר', hint: 'מים זורמים בנחל, רחש אחיד שמסתיר רעשים' }
]

export const DEFAULT_SOUNDS: SoundSettings = { on: {}, master: 0.7, youtube: '', recentYoutube: [] }

// ---------------------------------------------------------------------------
// The shared state: settings (saved) plus what is playing right now (not saved: nothing starts by
// itself when the app opens)
// ---------------------------------------------------------------------------

export interface SoundState {
  settings: SoundSettings
  playing: Record<string, boolean>
  /** The YouTube player is on */
  youtubeOn: boolean
}

let state: SoundState = { settings: DEFAULT_SOUNDS, playing: {}, youtubeOn: false }
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
let saveTimer: ReturnType<typeof setTimeout> | null = null

export function useSounds(): SoundState {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state
  )
}

/** Round 15: brown noise became the river; a volume set for it carries over */
function renamedSounds(on: Record<string, number>): Record<string, number> {
  if (!('brown' in on)) return on
  const { brown, ...rest } = on
  return 'river' in rest ? rest : { ...rest, river: brown }
}

export function initSounds(s: SoundSettings | undefined): void {
  const v = s && typeof s === 'object' ? s : DEFAULT_SOUNDS
  state = {
    ...state,
    settings: {
      on: renamedSounds(v.on && typeof v.on === 'object' ? v.on : {}),
      master: typeof v.master === 'number' ? Math.min(1, Math.max(0, v.master)) : DEFAULT_SOUNDS.master,
      youtube: typeof v.youtube === 'string' ? v.youtube : '',
      recentYoutube: Array.isArray(v.recentYoutube) ? v.recentYoutube.filter((x) => typeof x === 'string').slice(0, 6) : []
    }
  }
  emit()
}

function patchSettings(p: Partial<SoundSettings>) {
  state = { ...state, settings: { ...state.settings, ...p } }
  emit()
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void api.setSounds(state.settings), 600)
}

export const volumeOf = (id: string): number => state.settings.on[id] ?? 0.5
export const anyPlaying = (s: SoundState): boolean => s.youtubeOn || Object.values(s.playing).some(Boolean)

export function setVolume(id: string, v: number): void {
  patchSettings({ on: { ...state.settings.on, [id]: v } })
  voices.get(id)?.gain.gain.setTargetAtTime(v, ctx!.currentTime, 0.08)
}

export function setMaster(v: number): void {
  patchSettings({ master: v })
  if (master && ctx) master.gain.setTargetAtTime(v, ctx.currentTime, 0.08)
}

export function toggleSound(id: string): void {
  const on = !state.playing[id]
  state = { ...state, playing: { ...state.playing, [id]: on } }
  emit()
  if (on) start(id)
  else stop(id)
}

export function stopAll(): void {
  for (const id of [...voices.keys()]) stop(id)
  state = { ...state, playing: {}, youtubeOn: false }
  emit()
}

export function setYoutube(url: string, on: boolean): void {
  const recent = url ? [url, ...state.settings.recentYoutube.filter((x) => x !== url)].slice(0, 6) : state.settings.recentYoutube
  state = { ...state, youtubeOn: on }
  patchSettings({ youtube: url, recentYoutube: recent })
}
export function setYoutubeOn(on: boolean): void {
  state = { ...state, youtubeOn: on }
  emit()
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

let ctx: AudioContext | null = null
let master: GainNode | null = null
const buffers: Record<string, AudioBuffer> = {}
interface Voice {
  gain: GainNode
  stop: () => void
}
const voices = new Map<string, Voice>()

function audio(): { ctx: AudioContext; out: GainNode } {
  if (!ctx) {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value = state.settings.master
    master.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return { ctx, out: master! }
}

/**
 * Calls `plan(time)` again and again; each call places the next event(s) at `time` and says how long
 * until the following one. Events are placed a little ahead, so timers that run late never skip.
 */
function scheduler(c: BaseAudioContext, plan: (at: number) => number): () => void {
  // rendering ahead of time (an OfflineAudioContext, used to check the sounds): place everything now
  if ('startRendering' in c) {
    const end = (c as OfflineAudioContext).length / c.sampleRate
    for (let t = 0.1; t < end; ) t += Math.max(0.01, plan(t))
    return () => undefined
  }
  let next = c.currentTime + 0.1
  let alive = true
  const tick = () => {
    if (!alive) return
    while (next < c.currentTime + 0.25) next += Math.max(0.01, plan(next))
    timer = setTimeout(tick, 60)
  }
  let timer = setTimeout(tick, 0)
  return () => {
    alive = false
    clearTimeout(timer)
  }
}

type Builder = (c: BaseAudioContext, out: GainNode) => () => void

const rnd = (a: number, b: number) => a + Math.random() * (b - a)

// ---------------------------------------------------------------------------
// Recordings (round 14, after שלומי's test: the made-up rain, café, typewriter, waves and wind did
// not sound real). Real recordings, from the free "sounds-for-focus" collection (MIT, the sounds of
// Moodist), shipped inside the app: still no internet needed.
// ---------------------------------------------------------------------------

const RECORDINGS: Record<string, string> = {
  rain: rainUrl,
  thunder: thunderUrl,
  cafe: cafeUrl,
  typewriter: typewriterUrl,
  waves: wavesUrl,
  wind: windUrl,
  howl: howlUrl,
  fire: fireUrl,
  river: riverUrl
}
const decoded = new Map<string, Promise<AudioBuffer>>()
function recording(c: BaseAudioContext, name: string): Promise<AudioBuffer> {
  let p = decoded.get(name)
  if (!p) {
    p = fetch(RECORDINGS[name])
      .then((r) => r.arrayBuffer())
      .then((b) => c.decodeAudioData(b))
    p.catch(() => decoded.delete(name))
    decoded.set(name, p)
  }
  return p
}

/** Plays a recording over and over without a seam: each round starts a few seconds before the last one ends, and they cross-fade */
function playLoop(c: BaseAudioContext, out: AudioNode, name: string, vol = 1): () => void {
  let stopped = false
  let stopSched = () => undefined as void
  void recording(c, name).then((buf) => {
    if (stopped) return
    const xf = Math.min(3, buf.duration / 4)
    let first = true
    stopSched = scheduler(c, (at) => {
      // the first round starts somewhere in the middle, so it is never the same opening
      const off = first ? Math.random() * (buf.duration - 2 * xf) : 0
      const len = buf.duration - off
      const s = c.createBufferSource()
      s.buffer = buf
      const g = c.createGain()
      g.gain.setValueAtTime(0, at)
      g.gain.linearRampToValueAtTime(vol, at + (first ? 1 : xf))
      g.gain.setValueAtTime(vol, at + len - xf)
      g.gain.linearRampToValueAtTime(0, at + len)
      s.connect(g).connect(out)
      s.start(at, off)
      s.stop(at + len + 0.05)
      first = false
      return len - xf
    })
  })
  return () => {
    stopped = true
    stopSched()
  }
}

/** Now and then a roll of thunder (a part of the thunder recording), the first one soon after the rain starts */
function thunderNowAndThen(c: BaseAudioContext, out: AudioNode, vol: number): () => void {
  let stopped = false
  let stopSched = () => undefined as void
  void recording(c, 'thunder').then((buf) => {
    if (stopped) return
    let first = true
    stopSched = scheduler(c, (at) => {
      if (first) {
        first = false
        return rnd(10, 25)
      }
      // the recording is quiet for its first half minute; the thunder is after that
      const from = Math.min(buf.duration - 20, rnd(32, 45))
      const len = Math.min(buf.duration - from, rnd(18, 28))
      const s = c.createBufferSource()
      s.buffer = buf
      const g = c.createGain()
      const v = vol * rnd(0.6, 1)
      g.gain.setValueAtTime(0, at)
      g.gain.linearRampToValueAtTime(v, at + 1.5)
      g.gain.setValueAtTime(v, at + len - 4)
      g.gain.linearRampToValueAtTime(0, at + len)
      s.connect(g).connect(out)
      s.start(at, from)
      s.stop(at + len + 0.05)
      return len + rnd(45, 120)
    })
  })
  return () => {
    stopped = true
    stopSched()
  }
}

const BUILDERS: Record<string, Builder> = {
  rain: (c, out) => {
    const rain = playLoop(c, out, 'rain')
    const rumble = thunderNowAndThen(c, out, 1.6)
    return () => (rain(), rumble())
  },
  cafe: (c, out) => playLoop(c, out, 'cafe'),
  typewriter: (c, out) => playLoop(c, out, 'typewriter'),
  waves: (c, out) => playLoop(c, out, 'waves'),
  wind: (c, out) => {
    const wind = playLoop(c, out, 'wind')
    const howl = playLoop(c, out, 'howl', 0.4)
    return () => (wind(), howl())
  },
  fire: (c, out) => playLoop(c, out, 'fire'),
  river: (c, out) => playLoop(c, out, 'river')
}

/** Loudness trim of each sound, so they all start at about the same volume (measured with ffmpeg volumedetect) */
const TRIM: Record<string, number> = { rain: 0.45, cafe: 0.75, typewriter: 1.4, fire: 1.4, waves: 2.4, wind: 1.2, river: 1.85 }

function start(id: string) {
  if (voices.has(id) || !BUILDERS[id]) return
  const { ctx: c, out } = audio()
  const gain = c.createGain()
  gain.gain.value = 0
  gain.gain.setTargetAtTime(volumeOf(id), c.currentTime, 0.3)
  gain.connect(out)
  const trim = c.createGain()
  trim.gain.value = TRIM[id] ?? 1
  trim.connect(gain)
  const end = BUILDERS[id](c, trim)
  voices.set(id, {
    gain,
    stop: () => {
      gain.gain.setTargetAtTime(0, c.currentTime, 0.15)
      setTimeout(() => (end(), gain.disconnect()), 800)
    }
  })
}

function stop(id: string) {
  const v = voices.get(id)
  if (!v) return
  voices.delete(id)
  v.stop()
}

