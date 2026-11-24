// Round 10, the main-process side of synonyms (43) and automatic niqqud (55).
// Synonyms come from Claude, with the writer's own key. Niqqud comes from Dicta's Nakdan (free,
// needs the internet); when Dicta cannot be reached, Claude can add the niqqud instead.
import { net } from 'electron'
import Anthropic from '@anthropic-ai/sdk'
import { aiSettings, client, errorText } from './ai'
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
const NAKDAN_URLS = ['https://nakdan-u1-0.loadbalancer.dicta.org.il/api', 'https://nakdan-5-3.loadbalancer.dicta.org.il/api', 'https://nakdan-5-1.loadbalancer.dicta.org.il/api', 'https://nakdan-2-0.loadbalancer.dicta.org.il/api']
let goodUrl: string | null = null

async function askDicta(url: string, data: string): Promise<NakdanToken[]> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 30000)
  try {
    const res = await net.fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ task: 'nakdan', data, genre: 'modern', addmorph: true, keepqq: false, nodageshdefmem: false, patachma: false, keepmetagim: true, keepnikud: true, matchpartial: true, useTokenization: true })
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return readNakdan(await res.json())
  } finally {
    clearTimeout(timer)
  }
}

async function dicta(text: string): Promise<NakdanToken[]> {
  const out: NakdanToken[] = []
  for (const chunk of nakdanChunks(text)) {
    const urls = goodUrl ? [goodUrl, ...NAKDAN_URLS.filter((u) => u !== goodUrl)] : NAKDAN_URLS
    let done: NakdanToken[] | null = null
    let last: unknown = null
    for (const u of urls) {
      try {
        done = await askDicta(u, chunk)
        goodUrl = u
        break
      } catch (e) {
        last = e
      }
    }
    if (!done) {
      const m = last instanceof Error ? last.message : String(last)
      throw new Error(/ENOTFOUND|ERR_INTERNET|ERR_NAME|ERR_NETWORK|EAI_AGAIN/i.test(m) ? 'אין חיבור לאינטרנט, והניקוד האוטומטי צריך אותו.' : `הנקדן של דיקטה לא ענה (${m}).`)
    }
    out.push(...done)
  }
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
