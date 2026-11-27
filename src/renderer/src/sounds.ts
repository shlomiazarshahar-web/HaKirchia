// Background sounds while writing (feature 56). Every sound is made on the spot by the computer's
// sound engine (Web Audio): no recordings, no internet, nothing to download. Several can play
// together, each with its own volume. The YouTube player (a link, e.g. a Lofi stream) lives in
// components/Sounds.tsx; this file is the built-in sounds and the shared settings.

import { useSyncExternalStore } from 'react'
import type { SoundSettings } from '@shared/types'
import { api } from './api'

export interface SoundDef {
  id: string
  name: string
  hint: string
}

export const SOUNDS: SoundDef[] = [
  { id: 'rain', name: 'גשם', hint: 'גשם יציב עם טיפות' },
  { id: 'cafe', name: 'בית קפה', hint: 'המולה רחוקה וכוסות' },
  { id: 'typewriter', name: 'מכונת כתיבה', hint: 'הקשות, פעמון וגלגלת' },
  { id: 'fire', name: 'אח בוערת', hint: 'רחש עמוק ופצפוצים' },
  { id: 'waves', name: 'גלים', hint: 'ים שנושם לאט' },
  { id: 'wind', name: 'רוח', hint: 'רוח שעולה ויורדת' },
  { id: 'brown', name: 'רעש חום', hint: 'רחש עמוק ואחיד שמסתיר רעשים' }
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

export function initSounds(s: SoundSettings | undefined): void {
  const v = s && typeof s === 'object' ? s : DEFAULT_SOUNDS
  state = {
    ...state,
    settings: {
      on: v.on && typeof v.on === 'object' ? v.on : {},
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

/** A few seconds of noise that loops: white (hiss), pink (softer) or brown (deep) */
function noise(c: AudioContext, kind: 'white' | 'pink' | 'brown'): AudioBuffer {
  if (buffers[kind]) return buffers[kind]
  const len = c.sampleRate * 6
  const b = c.createBuffer(2, len, c.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch)
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1
      if (kind === 'white') d[i] = w * 0.5
      else if (kind === 'pink') {
        // Paul Kellet's pink noise filter
        b0 = 0.99886 * b0 + w * 0.0555179
        b1 = 0.99332 * b1 + w * 0.0750759
        b2 = 0.969 * b2 + w * 0.153852
        b3 = 0.8665 * b3 + w * 0.3104856
        b4 = 0.55 * b4 + w * 0.5329522
        b5 = -0.7616 * b5 - w * 0.016898
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11
        b6 = w * 0.115926
      } else {
        last = (last + 0.02 * w) / 1.02
        d[i] = last * 3.5
      }
    }
    // the loop's ends are faded into each other, so it never clicks
    const fade = Math.floor(c.sampleRate * 0.05)
    for (let i = 0; i < fade; i++) {
      const t = i / fade
      d[i] = d[i] * t + d[len - fade + i] * (1 - t)
    }
  }
  buffers[kind] = b
  return b
}

function loop(c: AudioContext, kind: 'white' | 'pink' | 'brown'): AudioBufferSourceNode {
  const s = c.createBufferSource()
  s.buffer = noise(c, kind)
  s.loop = true
  // each sound starts at a different place in the loop, so two never sound the same
  s.start(0, Math.random() * 5)
  return s
}

function filter(c: AudioContext, type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
  const f = c.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  f.Q.value = q
  return f
}

/** A slow wobble of a value around its base: an oscillator into the parameter */
function lfo(c: AudioContext, param: AudioParam, rate: number, depth: number): OscillatorNode {
  const o = c.createOscillator()
  o.frequency.value = rate
  const g = c.createGain()
  g.gain.value = depth
  o.connect(g).connect(param)
  o.start()
  return o
}

/** A very short sound at time `at`: a burst of noise through a band, or a tone that dies away */
function burst(c: AudioContext, out: AudioNode, at: number, o: { freq: number; q?: number; len: number; vol: number; type?: BiquadFilterType }) {
  const s = c.createBufferSource()
  s.buffer = noise(c, 'white')
  const f = filter(c, o.type ?? 'bandpass', o.freq, o.q ?? 1)
  const g = c.createGain()
  g.gain.setValueAtTime(0, at)
  g.gain.linearRampToValueAtTime(o.vol, at + 0.002)
  g.gain.exponentialRampToValueAtTime(0.0001, at + o.len)
  s.connect(f).connect(g).connect(out)
  s.start(at, Math.random() * 5, o.len + 0.05)
}
function tone(c: AudioContext, out: AudioNode, at: number, freq: number, len: number, vol: number, type: OscillatorType = 'sine') {
  const o = c.createOscillator()
  o.type = type
  o.frequency.value = freq
  const g = c.createGain()
  g.gain.setValueAtTime(0, at)
  g.gain.linearRampToValueAtTime(vol, at + 0.004)
  g.gain.exponentialRampToValueAtTime(0.0001, at + len)
  o.connect(g).connect(out)
  o.start(at)
  o.stop(at + len + 0.05)
}

/**
 * Calls `plan(time)` again and again; each call places the next event(s) at `time` and says how long
 * until the following one. Events are placed a little ahead, so timers that run late never skip.
 */
function scheduler(c: AudioContext, plan: (at: number) => number): () => void {
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

type Builder = (c: AudioContext, out: GainNode) => () => void

const BUILDERS: Record<string, Builder> = {
  rain: (c, out) => {
    const hiss = loop(c, 'pink')
    const hp = filter(c, 'highpass', 500)
    const lp = filter(c, 'lowpass', 7000)
    const g = c.createGain()
    g.gain.value = 0.55
    hiss.connect(hp).connect(lp).connect(g).connect(out)
    const deep = loop(c, 'brown')
    const dg = c.createGain()
    dg.gain.value = 0.25
    deep.connect(filter(c, 'lowpass', 300)).connect(dg).connect(out)
    const drops = scheduler(c, (at) => {
      burst(c, out, at, { freq: 2500 + Math.random() * 4500, q: 2, len: 0.015 + Math.random() * 0.03, vol: 0.05 + Math.random() * 0.12 })
      return 0.01 + Math.random() * 0.06
    })
    return () => (drops(), hiss.stop(), deep.stop())
  },
  waves: (c, out) => {
    const s = loop(c, 'brown')
    const lp = filter(c, 'lowpass', 700)
    const g = c.createGain()
    g.gain.value = 0.5
    s.connect(lp).connect(g).connect(out)
    // the sea breathes: a wave every ~9 seconds, brighter as it breaks
    const a = lfo(c, g.gain, 0.11, 0.42)
    const b = lfo(c, lp.frequency, 0.11, 450)
    const foam = loop(c, 'pink')
    const fg = c.createGain()
    fg.gain.value = 0.08
    foam.connect(filter(c, 'highpass', 1800)).connect(fg).connect(out)
    const f = lfo(c, fg.gain, 0.11, 0.07)
    return () => (s.stop(), foam.stop(), a.stop(), b.stop(), f.stop())
  },
  wind: (c, out) => {
    const s = loop(c, 'pink')
    const bp = filter(c, 'bandpass', 500, 1.2)
    const g = c.createGain()
    g.gain.value = 0.7
    s.connect(bp).connect(g).connect(out)
    const a = lfo(c, bp.frequency, 0.07, 280)
    const b = lfo(c, g.gain, 0.045, 0.45)
    const whistle = loop(c, 'white')
    const wbp = filter(c, 'bandpass', 1400, 9)
    const wg = c.createGain()
    wg.gain.value = 0.12
    whistle.connect(wbp).connect(wg).connect(out)
    const d = lfo(c, wbp.frequency, 0.09, 500)
    const e = lfo(c, wg.gain, 0.06, 0.1)
    return () => (s.stop(), whistle.stop(), a.stop(), b.stop(), d.stop(), e.stop())
  },
  fire: (c, out) => {
    const s = loop(c, 'brown')
    const g = c.createGain()
    g.gain.value = 0.6
    s.connect(filter(c, 'lowpass', 450)).connect(g).connect(out)
    const flicker = lfo(c, g.gain, 0.3, 0.15)
    const crackle = scheduler(c, (at) => {
      const n = Math.random() < 0.25 ? 2 + Math.floor(Math.random() * 4) : 1
      for (let i = 0; i < n; i++) burst(c, out, at + i * (0.008 + Math.random() * 0.02), { freq: 1800 + Math.random() * 3500, q: 0.8, len: 0.004 + Math.random() * 0.012, vol: 0.1 + Math.random() * 0.35, type: 'highpass' })
      // now and then a log shifts: a deeper pop
      if (Math.random() < 0.04) burst(c, out, at, { freq: 400 + Math.random() * 300, q: 1.5, len: 0.06, vol: 0.4 })
      return 0.03 + Math.random() * 0.35
    })
    return () => (crackle(), flicker.stop(), s.stop())
  },
  cafe: (c, out) => {
    // many voices far away: noise shaped like speech (the band of voices, wobbling at syllable speed)
    const stops: (() => void)[] = []
    for (const [freq, rate] of [
      [420, 3.1],
      [650, 4.3],
      [900, 5.2],
      [520, 2.4]
    ]) {
      const s = loop(c, 'pink')
      const bp = filter(c, 'bandpass', freq, 1.6)
      const g = c.createGain()
      g.gain.value = 0.32
      s.connect(bp).connect(g).connect(out)
      const a = lfo(c, g.gain, rate, 0.18)
      const b = lfo(c, bp.frequency, rate / 3.7, freq * 0.18)
      stops.push(() => (s.stop(), a.stop(), b.stop()))
    }
    const room = loop(c, 'brown')
    const rg = c.createGain()
    rg.gain.value = 0.2
    room.connect(filter(c, 'lowpass', 250)).connect(rg).connect(out)
    const clinks = scheduler(c, (at) => {
      const f = 2200 + Math.random() * 2400
      tone(c, out, at, f, 0.5, 0.025)
      tone(c, out, at, f * 2.76, 0.25, 0.012)
      if (Math.random() < 0.4) tone(c, out, at + 0.09, f * 1.07, 0.4, 0.018)
      return 2.5 + Math.random() * 7
    })
    return () => (clinks(), room.stop(), stops.forEach((x) => x()))
  },
  typewriter: (c, out) => {
    let keys = 0
    let word = 0
    let lineAt = 45 + Math.floor(Math.random() * 25)
    const typing = scheduler(c, (at) => {
      keys++
      word++
      // a key: a sharp click and the thump of the type bar
      burst(c, out, at, { freq: 2600 + Math.random() * 1200, q: 1.4, len: 0.018, vol: 0.35 + Math.random() * 0.2 })
      tone(c, out, at + 0.004, 140 + Math.random() * 40, 0.04, 0.12, 'triangle')
      if (keys >= lineAt) {
        // the end of the line: the bell, then the carriage goes back
        keys = 0
        lineAt = 45 + Math.floor(Math.random() * 25)
        tone(c, out, at + 0.15, 2093, 1.2, 0.06)
        tone(c, out, at + 0.15, 4186, 0.6, 0.015)
        for (let i = 0; i < 14; i++) burst(c, out, at + 0.6 + i * 0.022, { freq: 900 + i * 60, q: 1, len: 0.03, vol: 0.06 })
        burst(c, out, at + 0.95, { freq: 300, q: 1, len: 0.08, vol: 0.4 })
        return 1.6 + Math.random() * 1.5
      }
      if (word > 3 + Math.random() * 6) {
        word = 0
        // the space bar, a thought, or a pause
        return Math.random() < 0.12 ? 1 + Math.random() * 2.5 : 0.22 + Math.random() * 0.25
      }
      return 0.09 + Math.random() * 0.12
    })
    return typing
  },
  brown: (c, out) => {
    const s = loop(c, 'brown')
    const g = c.createGain()
    g.gain.value = 0.7
    s.connect(filter(c, 'lowpass', 900)).connect(g).connect(out)
    return () => s.stop()
  }
}

function start(id: string) {
  if (voices.has(id) || !BUILDERS[id]) return
  const { ctx: c, out } = audio()
  const gain = c.createGain()
  gain.gain.value = 0
  gain.gain.setTargetAtTime(volumeOf(id), c.currentTime, 0.3)
  gain.connect(out)
  const end = BUILDERS[id](c, gain)
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

