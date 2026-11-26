// Round 10, the main-process side of synonyms (43) and automatic niqqud (55).
// Synonyms come from Claude, with the writer's own key. Niqqud comes from Dicta's Nakdan (free,
// needs the internet); when Dicta cannot be reached, Claude can add the niqqud instead.
import { net } from 'electron'
import Anthropic from '@anthropic-ai/sdk'
import { aiSettings, client, errorText } from './ai'
import { phrasePrompt } from '../shared/trmemory'
import { claudeNiqqudPrompt, nakdanChunks, readNakdan, readSynonyms, SYNONYM_SCHEMA, synonymPrompt, tokensFromVocalized, type NakdanToken, type SynonymSense } from '../shared/wordtools'

const synCache = new Map<string, SynonymSense[]>()

export async function synonyms(word: string, sentence: string): Promise<SynonymSense[]> {
  const key = `${word}|${sentence}`
  const hit = synCache.get(key)
  if (hit) return hit
  const c = await client()
  try {
    const msg = await c.messages.create({
      model: aiSettings().model,
      max_tokens: 4000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SYNONYM_SCHEMA as unknown as Record<string, unknown> } },
      messages: [{ role: 'user', content: synonymPrompt(word, sentence) }]
    } as Anthropic.MessageCreateParamsNonStreaming)
    const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
    const out = readSynonyms(text, word)
    if (synCache.size > 500) synCache.clear()
    synCache.set(key, out)
    return out
  } catch (e) {
    throw new Error(errorText(e))
  }
}

// Dicta's addresses change from time to time; the first that answers is used from then on.
// 2-0 first: it is the one the working open-source client (dicta-nakdan on npm) talks to.
const NAKDAN_URLS = ['https://nakdan-2-0.loadbalancer.dicta.org.il/api', 'https://nakdan-u1-0.loadbalancer.dicta.org.il/api', 'https://nakdan-5-3.loadbalancer.dicta.org.il/api', 'https://nakdan-5-1.loadbalancer.dicta.org.il/api']
let good: { url: string; how: Fetcher } | null = null

type Fetcher = 'electron' | 'node'

class HttpError extends Error {
  constructor(public status: number, detail: string) {
    super(`HTTP ${status}${detail ? `: ${detail}` : ''}`)
  }
}

/** Exactly what the working client sends: JSON in, JSON out, only the fields Dicta needs */
async function askDicta(url: string, how: Fetcher, data: string): Promise<NakdanToken[]> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 30000)
  try {
    const init = {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ task: 'nakdan', genre: 'modern', data, addmorph: false, keepqq: false })
    }
    // Electron's own network stack, and Node's as a second try (they differ in how they reach the server)
    const res = how === 'electron' ? await net.fetch(url, init) : await fetch(url, init)
    if (!res.ok) {
      let detail = ''
      try {
        detail = (await res.text()).replace(/\s+/g, ' ').slice(0, 120)
      } catch {
        /* no body */
      }
      throw new HttpError(res.status, detail)
    }
    return readNakdan(await res.json())
  } finally {
    clearTimeout(timer)
  }
}

function shortHost(url: string): string {
  return url.replace(/^https:\/\/nakdan-/, '').replace(/\.loadbalancer.*$/, '')
}

async function dictaChunk(chunk: string): Promise<NakdanToken[]> {
  const tries: { url: string; how: Fetcher }[] = []
  if (good) tries.push(good)
  for (const how of ['electron', 'node'] as Fetcher[]) for (const url of NAKDAN_URLS) if (!(good && good.url === url && good.how === how)) tries.push({ url, how })
  const errors: string[] = []
  for (const t of tries) {
    // a busy server (5xx) gets one more chance after a short pause
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const out = await askDicta(t.url, t.how, chunk)
        good = t
        return out
      } catch (e) {
        const m = e instanceof Error ? (e.name === 'AbortError' ? 'לא ענה תוך 30 שניות' : e.message) : String(e)
        if (e instanceof HttpError && e.status >= 500 && attempt === 0) {
          await new Promise((r) => setTimeout(r, 1500))
          continue
        }
        errors.push(`${shortHost(t.url)}/${t.how}: ${m}`)
        break
      }
    }
  }
  if (errors.every((m) => /ENOTFOUND|ERR_INTERNET|ERR_NAME|ERR_NETWORK|EAI_AGAIN/i.test(m))) throw new Error('אין חיבור לאינטרנט, והניקוד האוטומטי צריך אותו.')
  throw new Error(`הנקדן של דיקטה לא ענה. פרטים: ${errors.join(' · ')}`)
}

async function dicta(text: string): Promise<NakdanToken[]> {
  const out: NakdanToken[] = []
  // smaller pieces than before: long requests are what a busy server turns away first
  for (const chunk of nakdanChunks(text, 2000)) out.push(...(await dictaChunk(chunk)))
  return out
}

async function claudeNiqqud(text: string): Promise<NakdanToken[]> {
  const c = await client()
  try {
    const msg = await c.messages.create({
      model: aiSettings().model,
      max_tokens: Math.min(32000, 2000 + text.length * 4),
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: claudeNiqqudPrompt(text) }]
    } as Anthropic.MessageCreateParamsNonStreaming)
    const out = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim()
    return tokensFromVocalized(text, out)
  } catch (e) {
    throw new Error(errorText(e))
  }
}

export function nakdan(text: string, by: 'dicta' | 'claude'): Promise<NakdanToken[]> {
  return by === 'claude' ? claudeNiqqud(text) : dicta(text)
}

/** Which words of an earlier translation render a repeated phrase (translation memory, feature 46) */
export async function tmPhrase(source: string, phrase: string, target: string): Promise<string> {
  const c = await client()
  try {
    const msg = await c.messages.create({
      model: aiSettings().model,
      max_tokens: 400,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: phrasePrompt(source, phrase, target) }]
    } as Anthropic.MessageCreateParamsNonStreaming)
    const out = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim().replace(/^["״“”']+|["״“”']+$/g, '')
    return out === '-' ? '' : out
  } catch (e) {
    throw new Error(errorText(e))
  }
}
