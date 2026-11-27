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
  { id: 'rain', name: 'גשם', hint: 'טיפות על החלון, ומדי פעם רעם רחוק' },
  { id: 'cafe', name: 'בית קפה', hint: 'שיחות רחוקות, כוסות וצלחות, מכונת אספרסו' },
  { id: 'typewriter', name: 'מכונת כתיבה', hint: 'הקשות, פעמון וגלגלת' },
  { id: 'fire', name: 'אח בוערת', hint: 'רחש עמוק ופצפוצים' },
  { id: 'waves', name: 'גלים', hint: 'גלים שנשברים על החוף וקצף שנסוג' },
  { id: 'wind', name: 'רוח', hint: 'משבים שמייללים ונרגעים' },
  { id: 'brown', name: 'רעש חום', hint: 'רחש עמוק ואחיד לגמרי, בלי שום שינוי, שמסתיר רעשים' }
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
function noise(c: BaseAudioContext, kind: 'white' | 'pink' | 'brown'): AudioBuffer {
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

function loop(c: BaseAudioContext, kind: 'white' | 'pink' | 'brown'): AudioBufferSourceNode {
  const s = c.createBufferSource()
  s.buffer = noise(c, kind)
  s.loop = true
  // each sound starts at a different place in the loop, so two never sound the same
  s.start(0, Math.random() * 5)
  return s
}

function filter(c: BaseAudioContext, type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
  const f = c.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  f.Q.value = q
  return f
}

/** A slow wobble of a value around its base: an oscillator into the parameter */
function lfo(c: BaseAudioContext, param: AudioParam, rate: number, depth: number): OscillatorNode {
  const o = c.createOscillator()
  o.frequency.value = rate
  const g = c.createGain()
  g.gain.value = depth
  o.connect(g).connect(param)
  o.start()
  return o
}

/** A very short sound at time `at`: a burst of noise through a band, or a tone that dies away */
function burst(c: BaseAudioContext, out: AudioNode, at: number, o: { freq: number; q?: number; len: number; vol: number; type?: BiquadFilterType }) {
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
function tone(c: BaseAudioContext, out: AudioNode, at: number, freq: number, len: number, vol: number, type: OscillatorType = 'sine') {
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

/** A noise source that plays from `at` for `dur` seconds (looping the buffer) */
function shot(c: BaseAudioContext, kind: 'white' | 'pink' | 'brown', at: number, dur: number): AudioBufferSourceNode {
  const s = c.createBufferSource()
  s.buffer = noise(c, kind)
  s.loop = true
  s.start(at, Math.random() * 5)
  s.stop(at + dur)
  return s
}

function panner(c: BaseAudioContext, v: number, out: AudioNode): StereoPannerNode {
  const p = c.createStereoPanner()
  p.pan.value = Math.max(-1, Math.min(1, v))
  p.connect(out)
  return p
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a)

/** A short reverberation (a room or a hall): decaying noise, a little different in each ear */
function roomImpulse(c: BaseAudioContext, secs: number): AudioBuffer {
  const len = Math.floor(c.sampleRate * secs)
  const b = c.createBuffer(2, len, c.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3)
  }
  return b
}

/** Thunder far away: a deep roll that grows, rolls a few times and fades (sometimes with a crack first) */
function thunder(c: BaseAudioContext, out: AudioNode, at: number) {
  const dur = rnd(6, 11)
  const near = Math.random() < 0.3
  const s = shot(c, 'brown', at, dur + 0.2)
  const lp = filter(c, 'lowpass', near ? 1400 : 380, 0.5)
  lp.frequency.setValueAtTime(near ? 1400 : 380, at)
  lp.frequency.exponentialRampToValueAtTime(near ? 260 : 160, at + 1.2)
  lp.frequency.exponentialRampToValueAtTime(70, at + dur)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(near ? 0.9 : 0.35, at + (near ? 0.06 : 0.9))
  let t = at + (near ? 0.4 : 1.4)
  for (let i = 0, n = 3 + Math.floor(Math.random() * 4); i < n && t < at + dur - 1; i++) {
    g.gain.exponentialRampToValueAtTime(rnd(0.08, 0.2), t)
    t += rnd(0.5, 1.4)
    g.gain.exponentialRampToValueAtTime(rnd(0.25, 0.6) * (1 - i / (n + 1)), t)
    t += rnd(0.3, 0.9)
  }
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  s.connect(lp).connect(g).connect(panner(c, rnd(-0.5, 0.5), out))
}

/** A small struck bell (the typewriter's end-of-line bell): a few out-of-tune partials that beat, and the strike */
function bell(c: BaseAudioContext, out: AudioNode, at: number, f: number, vol: number) {
  for (const [ratio, amp, decay] of [
    [1, 1, 1.5],
    [1.004, 0.7, 1.4],
    [2.42, 0.5, 0.75],
    [2.43, 0.3, 0.7],
    [3.98, 0.28, 0.42],
    [5.73, 0.16, 0.26],
    [8.1, 0.08, 0.15]
  ])
    tone(c, out, at, f * ratio, decay, vol * amp)
  burst(c, out, at, { freq: 6500, q: 0.8, len: 0.006, vol: vol * 2.5, type: 'highpass' })
}

// Vowel shapes of speech (first and second formant, Hz): talking far away is mostly these
const VOWELS: [number, number][] = [
  [730, 1090],
  [530, 1840],
  [290, 2250],
  [570, 840],
  [320, 900],
  [660, 1700],
  [450, 1300]
]

/** One person talking at another table: syllables of a voice, in sentences, with pauses for the others */
function talker(c: BaseAudioContext, out: AudioNode): () => void {
  const o = c.createOscillator()
  o.type = 'sawtooth'
  const base = (Math.random() < 0.5 ? 115 : 205) * rnd(0.85, 1.15)
  o.frequency.value = base
  const f1 = filter(c, 'bandpass', 600, 5)
  const f2 = filter(c, 'bandpass', 1500, 7)
  const g = c.createGain()
  g.gain.value = 0
  const g2 = c.createGain()
  g2.gain.value = 0.6
  const p = panner(c, rnd(-0.9, 0.9), out)
  const dist = c.createGain()
  dist.gain.value = rnd(0.25, 0.8)
  o.connect(f1).connect(g)
  o.connect(f2).connect(g2).connect(g)
  g.connect(dist).connect(p)
  o.start()
  let left = 0
  const talk = scheduler(c, (at) => {
    if (left <= 0) {
      left = 3 + Math.floor(Math.random() * 14)
      g.gain.setTargetAtTime(0, at, 0.04)
      // someone else is talking now, or a short breath
      return Math.random() < 0.35 ? rnd(2, 7) : rnd(0.25, 1.2)
    }
    left--
    const len = rnd(0.08, 0.24)
    const [a, b] = VOWELS[Math.floor(Math.random() * VOWELS.length)]
    f1.frequency.setTargetAtTime(a, at, 0.025)
    f2.frequency.setTargetAtTime(b, at, 0.025)
    // the voice goes up and down along the sentence, and down at its end
    o.frequency.setTargetAtTime(base * (left === 0 ? rnd(0.75, 0.9) : rnd(0.9, 1.25)), at, 0.06)
    g.gain.setTargetAtTime(rnd(0.5, 1), at, 0.018)
    g.gain.setTargetAtTime(rnd(0.05, 0.2), at + len * 0.75, 0.025)
    // a consonant now and then (s, t, k)
    if (Math.random() < 0.35) burst(c, p, at, { freq: rnd(3000, 6500), q: 1.2, len: rnd(0.02, 0.06), vol: 0.05 * dist.gain.value, type: 'highpass' })
    return len + rnd(0.01, 0.06)
  })
  return () => (talk(), o.stop())
}

const BUILDERS: Record<string, Builder> = {
  rain: (c, out) => {
    // the rain beyond the glass: soft and muffled
    const far = loop(c, 'pink')
    const fg = c.createGain()
    fg.gain.value = 0.1
    far.connect(filter(c, 'highpass', 250)).connect(filter(c, 'lowpass', 1800)).connect(fg).connect(out)
    // drops hitting the window: a tap with a short glassy ring, each in its own place on the pane
    let dense = 1
    const drops = scheduler(c, (at) => {
      const p = panner(c, rnd(-0.85, 0.85), out)
      const big = Math.random() < 0.14
      const f = big ? rnd(800, 1600) : rnd(1700, 4800)
      burst(c, p, at, { freq: f, q: rnd(4, 9), len: big ? rnd(0.04, 0.07) : rnd(0.015, 0.035), vol: big ? rnd(0.9, 1.4) : rnd(0.35, 0.8) })
      if (Math.random() < 0.5) tone(c, p, at + 0.002, f * rnd(1.4, 1.9), 0.035, big ? 0.05 : 0.025)
      // a drop running down the glass: a soft trickle that slides down
      if (Math.random() < 0.015) {
        const d = rnd(0.6, 1.4)
        const s = shot(c, 'white', at, d + 0.1)
        const bp = filter(c, 'bandpass', 2600, 6)
        bp.frequency.setValueAtTime(rnd(2400, 3200), at)
        bp.frequency.exponentialRampToValueAtTime(rnd(900, 1400), at + d)
        const tg = c.createGain()
        tg.gain.setValueAtTime(0.0001, at)
        tg.gain.exponentialRampToValueAtTime(0.06, at + 0.1)
        tg.gain.exponentialRampToValueAtTime(0.0001, at + d)
        s.connect(bp).connect(tg).connect(p)
      }
      // the shower comes in waves: sometimes more drops, sometimes fewer
      if (Math.random() < 0.012) dense = rnd(0.45, 1.6)
      return rnd(0.03, 0.22) / dense
    })
    // now and then thunder, far away
    let first = true
    const rumble = scheduler(c, (at) => {
      if (first) {
        first = false
        return rnd(20, 50)
      }
      thunder(c, out, at)
      return rnd(50, 140)
    })
    return () => (drops(), rumble(), far.stop())
  },
  waves: (c, out) => {
    // the sea between the waves: a calm, far wash
    const bed = loop(c, 'pink')
    const bg = c.createGain()
    bg.gain.value = 0.05
    bed.connect(filter(c, 'lowpass', 1000)).connect(bg).connect(out)
    // each wave: it swells, breaks with a bright rush, and the foam fizzes back down the sand
    const waves = scheduler(c, (at) => {
      const size = rnd(0.5, 1)
      const rise = rnd(1.4, 2.8)
      const wash = rnd(3, 6)
      const peak = at + rise
      const p = panner(c, rnd(-0.35, 0.35), out)
      // the swell: a low roar that grows
      const sw = shot(c, 'brown', at, rise + wash)
      const slp = filter(c, 'lowpass', 200, 0.5)
      slp.frequency.setValueAtTime(180, at)
      slp.frequency.exponentialRampToValueAtTime(900, peak)
      slp.frequency.exponentialRampToValueAtTime(220, peak + wash)
      const sg = c.createGain()
      sg.gain.setValueAtTime(0.0001, at)
      sg.gain.exponentialRampToValueAtTime(0.45 * size, peak)
      sg.gain.exponentialRampToValueAtTime(0.0001, peak + wash)
      sw.connect(slp).connect(sg).connect(p)
      // the break: a broad white rush
      const br = shot(c, 'pink', peak - 0.4, wash + 0.4)
      const bhp = filter(c, 'highpass', 350)
      const blp = filter(c, 'lowpass', 1500, 0.5)
      blp.frequency.setValueAtTime(1500, peak - 0.4)
      blp.frequency.exponentialRampToValueAtTime(8000, peak + 0.15)
      blp.frequency.exponentialRampToValueAtTime(2200, peak + wash)
      const bgn = c.createGain()
      bgn.gain.setValueAtTime(0.0001, peak - 0.4)
      bgn.gain.exponentialRampToValueAtTime(0.55 * size, peak + 0.15)
      bgn.gain.exponentialRampToValueAtTime(0.12 * size, peak + wash * 0.4)
      bgn.gain.exponentialRampToValueAtTime(0.0001, peak + wash)
      br.connect(bhp).connect(blp).connect(bgn).connect(p)
      // the foam pulling back: many tiny bubbles popping, fewer and fewer
      for (let i = 0, n = Math.floor(70 * size); i < n; i++) {
        const t = peak + 0.3 + Math.pow(Math.random(), 1.6) * wash
        burst(c, p, t, { freq: rnd(3000, 9000), q: 4, len: rnd(0.005, 0.015), vol: rnd(0.02, 0.07) * size * (1 - (t - peak) / (wash + 0.5)) })
      }
      return rise + wash * rnd(0.6, 0.9) + rnd(0, 2.5)
    })
    return () => (waves(), bed.stop())
  },
  wind: (c, out) => {
    // the rush of air (without the deep rumble: that is the brown noise)
    const body = loop(c, 'pink')
    const bp = filter(c, 'bandpass', 700, 0.6)
    const bodyG = c.createGain()
    bodyG.gain.value = 0.3
    body.connect(filter(c, 'highpass', 220)).connect(bp).connect(bodyG).connect(out)
    // two howls: narrow resonances that rise with each gust and fall after it
    const howl = (freq: number, q: number, side: number) => {
      const s = loop(c, 'white')
      const f = filter(c, 'bandpass', freq, q)
      const g = c.createGain()
      g.gain.value = 0.05
      s.connect(f).connect(g).connect(panner(c, side, out))
      return { s, f, g }
    }
    const h1 = howl(520, 16, -0.45)
    const h2 = howl(830, 22, 0.45)
    // gusts come at uneven times and strengths (never a regular rhythm)
    const gusts = scheduler(c, (at) => {
      const s = Math.random() < 0.2 ? rnd(0.75, 1) : rnd(0.12, 0.65)
      const tc = rnd(0.6, 1.8)
      bodyG.gain.setTargetAtTime(0.12 + 0.55 * s, at, tc)
      bp.frequency.setTargetAtTime(380 + 1000 * s, at, tc)
      h1.f.frequency.setTargetAtTime(380 + 520 * s + rnd(-40, 40), at, tc * 0.8)
      h1.g.gain.setTargetAtTime(0.03 + 0.9 * s * s, at, tc)
      h2.f.frequency.setTargetAtTime(640 + 760 * s + rnd(-60, 60), at + 0.3, tc)
      h2.g.gain.setTargetAtTime(0.02 + 0.6 * s * s, at + 0.3, tc)
      // a strong gust rattles things: dry leaves, a loose shutter
      if (s > 0.7) for (let i = 0; i < 12; i++) burst(c, out, at + rnd(0.3, 2), { freq: rnd(2500, 6000), q: 2, len: rnd(0.008, 0.02), vol: rnd(0.02, 0.06), type: 'highpass' })
      return rnd(1.2, 4.5)
    })
    return () => (gusts(), body.stop(), h1.s.stop(), h2.s.stop())
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
    // everything in the room blurs a little (a short hall reverb), and the far end is muffled
    const bus = c.createGain()
    bus.gain.value = 0.5
    const lp = filter(c, 'lowpass', 2400, 0.5)
    const dry = c.createGain()
    dry.gain.value = 0.55
    const verb = c.createConvolver()
    verb.buffer = roomImpulse(c, 1.4)
    const wet = c.createGain()
    wet.gain.value = 0.5
    bus.connect(lp)
    lp.connect(dry).connect(out)
    lp.connect(verb).connect(wet).connect(out)
    // people talking at the other tables
    const talkers = Array.from({ length: 8 }, () => talker(c, bus))
    // the room itself: a low hum (fridge, street outside)
    const room = loop(c, 'brown')
    const rg = c.createGain()
    rg.gain.value = 0.12
    room.connect(filter(c, 'lowpass', 220)).connect(rg).connect(out)
    // cups and saucers, a spoon stirring
    const clinks = scheduler(c, (at) => {
      const p = panner(c, rnd(-0.8, 0.8), bus)
      const kind = Math.random()
      if (kind < 0.45) {
        // a cup put down on a saucer: a soft knock and a short ring
        burst(c, p, at, { freq: rnd(350, 600), q: 2, len: 0.04, vol: 0.25 })
        const f = rnd(2600, 4200)
        tone(c, p, at + 0.005, f, rnd(0.12, 0.25), 0.05)
        tone(c, p, at + 0.005, f * 2.31, 0.08, 0.02)
      } else if (kind < 0.75) {
        // a spoon stirring in a cup
        const f = rnd(3200, 4800)
        for (let i = 0, n = 3 + Math.floor(Math.random() * 4); i < n; i++) tone(c, p, at + i * rnd(0.16, 0.24), f * rnd(0.97, 1.03), 0.07, 0.025)
      } else {
        // two glasses touching
        const f = rnd(1800, 2600)
        tone(c, p, at, f, 0.5, 0.035)
        tone(c, p, at, f * 2.7, 0.2, 0.012)
      }
      return rnd(1.5, 6)
    })
    // the espresso machine: now and then the steam wand hisses
    let first = true
    const steam = scheduler(c, (at) => {
      if (first) {
        first = false
        return rnd(12, 35)
      }
      const d = rnd(2, 4.5)
      const s = shot(c, 'white', at, d + 0.6)
      const hp = filter(c, 'highpass', 2500)
      const g = c.createGain()
      g.gain.setValueAtTime(0.0001, at)
      g.gain.exponentialRampToValueAtTime(0.05, at + 0.3)
      g.gain.setValueAtTime(0.05, at + d)
      g.gain.exponentialRampToValueAtTime(0.0001, at + d + 0.5)
      s.connect(hp).connect(g).connect(panner(c, rnd(-0.6, 0.6), bus))
      return rnd(35, 90)
    })
    return () => (clinks(), steam(), room.stop(), talkers.forEach((x) => x()))
  },
  typewriter: (c, out) => {
    let keys = 0
    let word = 0
    let lineAt = 45 + Math.floor(Math.random() * 25)
    const bellF = rnd(1650, 1850)
    const typing = scheduler(c, (at) => {
      keys++
      word++
      // a key: a sharp click and the thump of the type bar
      burst(c, out, at, { freq: 2600 + Math.random() * 1200, q: 1.4, len: 0.018, vol: 0.35 + Math.random() * 0.2 })
      tone(c, out, at + 0.004, 140 + Math.random() * 40, 0.04, 0.12, 'triangle')
      if (keys >= lineAt) {
        // near the end of the line: the bell...
        keys = 0
        lineAt = 45 + Math.floor(Math.random() * 25)
        bell(c, out, at + 0.15, bellF, 0.07)
        // ...then the lever is pushed and the carriage runs back with its ratchet, and stops with a thunk
        const r = at + 0.75
        burst(c, out, r, { freq: 1500, q: 2, len: 0.03, vol: 0.3 })
        let t = r + 0.08
        for (let i = 0; i < 16; i++) {
          burst(c, out, t, { freq: rnd(2400, 3200), q: 3, len: 0.012, vol: 0.09 })
          t += 0.032 - i * 0.0013
        }
        const slide = shot(c, 'pink', r + 0.05, t - r)
        const sg = c.createGain()
        sg.gain.value = 0.05
        slide.connect(filter(c, 'bandpass', 800, 1.5)).connect(sg).connect(out)
        burst(c, out, t + 0.01, { freq: 250, q: 1, len: 0.09, vol: 0.45 })
        tone(c, out, t + 0.01, 85, 0.12, 0.15, 'triangle')
        return t - at + 0.6 + Math.random() * 1.2
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
    // deliberately the same all the time: no waves, no gusts, nothing that draws attention
    const s = loop(c, 'brown')
    const g = c.createGain()
    g.gain.value = 0.7
    s.connect(filter(c, 'lowpass', 500)).connect(g).connect(out)
    return () => s.stop()
  }
}

/** Loudness trim of each sound, so they all start at about the same volume (measured, see test/sounds) */
const TRIM: Record<string, number> = { rain: 2.5, cafe: 1.2, typewriter: 2, fire: 0.6, waves: 2, wind: 1.5, brown: 0.5 }

/** Renders a few seconds of a sound ahead of time (used to check and balance the sounds) */
export async function renderSound(id: string, seconds: number, sampleRate = 22050): Promise<AudioBuffer> {
  const c = new OfflineAudioContext(2, Math.floor(seconds * sampleRate), sampleRate)
  const g = c.createGain()
  g.gain.value = TRIM[id] ?? 1
  g.connect(c.destination)
  BUILDERS[id](c, g)
  return c.startRendering()
}

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

