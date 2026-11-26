// Writing review with Claude (feature 19), the main-process side: the writer's own API key (kept
// encrypted by Windows), and the calls to Claude. The window never sees the key.
import { app, safeStorage, type WebContents } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import Anthropic from '@anthropic-ai/sdk'
import type { BetaMessageParam, BetaTextBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { getSettings } from './settings'
import { costOf, findingThreadMessages, normalizeAi, parseReply, REPLY_SCHEMA, promptIdeasMessage, REVIEW_SCHEMA, reviewAsText, reviewMessage, systemPrompt, type AiSettings, type ChatTurn, type Finding, type Review, type ReviewRequest, type Usage } from '../shared/review'

const keyFile = () => join(app.getPath('userData'), 'claude-key.bin')
let keyCache: string | null | undefined

async function readKey(): Promise<string | null> {
  if (keyCache !== undefined) return keyCache
  try {
    const buf = await fs.readFile(keyFile())
    keyCache = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8')
  } catch {
    keyCache = null
  }
  return keyCache
}

export interface KeyState {
  has: boolean
  /** The key's last characters, to recognise it */
  hint: string
}

export async function keyState(): Promise<KeyState> {
  const k = await readKey()
  return { has: !!k, hint: k ? `…${k.slice(-4)}` : '' }
}

/** Saves the key (encrypted with the Windows account), or forgets it (empty) */
export async function setKey(key: string): Promise<KeyState> {
  const k = key.trim()
  if (!k) {
    await fs.rm(keyFile(), { force: true })
    keyCache = null
  } else {
    const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(k) : Buffer.from(k, 'utf8')
    await fs.writeFile(keyFile(), data)
    keyCache = k
  }
  return keyState()
}

export function aiSettings(): AiSettings {
  return normalizeAi(getSettings().ai)
}

export async function client(): Promise<Anthropic> {
  const key = await readKey()
  if (!key) throw new Error('עדיין לא הוגדר מפתח API. אפשר להגדיר אותו ב"הגדרות ביקורת".')
  return new Anthropic({ apiKey: key, maxRetries: 2 })
}

/** Errors in words the writer understands */
export function errorText(e: unknown): string {
  if (e instanceof Anthropic.APIUserAbortError) return 'בוטל'
  if (e instanceof Anthropic.AuthenticationError) return 'המפתח לא התקבל. כדאי לבדוק שהעתקת אותו במלואו (מתחיל ב־sk-ant-).'
  if (e instanceof Anthropic.PermissionDeniedError) return 'למפתח הזה אין הרשאה למודל שנבחר.'
  if (e instanceof Anthropic.RateLimitError) return 'יותר מדי בקשות בזמן קצר, או שהגעת למגבלת השימוש בחשבון. כדאי לנסות שוב בעוד דקה.'
  if (e instanceof Anthropic.APIConnectionError) return 'אין חיבור ל־Claude. כדאי לבדוק את החיבור לאינטרנט.'
  if (e instanceof Anthropic.BadRequestError) {
    const m = e.message.toLowerCase()
    if (m.includes('credit') || m.includes('billing')) return 'אין מספיק קרדיט בחשבון ה־API. אפשר להוסיף ב־console.anthropic.com תחת Billing.'
    if (m.includes('too long') || m.includes('context')) return 'הטקסט ארוך מדי לבקשה אחת. אפשר לבקר פרק אחד בכל פעם.'
    return `Claude לא קיבל את הבקשה: ${e.message}`
  }
  if (e instanceof Anthropic.InternalServerError) return 'Claude עמוס כרגע. כדאי לנסות שוב בעוד כמה דקות.'
  if (e instanceof Anthropic.APIError) return `שגיאה מ־Claude: ${e.message}`
  return e instanceof Error ? e.message : String(e)
}

/** Is the key good? Asks Claude about the chosen model (no cost). */
export async function testKey(): Promise<string> {
  const c = await client()
  const m = await c.models.retrieve(aiSettings().model)
  return m.display_name ?? m.id
}

const jobs = new Map<string, AbortController>()

export function cancel(jobId: string): void {
  jobs.get(jobId)?.abort()
}

type Body = Parameters<Anthropic['beta']['messages']['stream']>[0]

/**
 * Sends one request and streams it. Refusals go to another model on the server ("fallbacks");
 * if the account or model does not accept that, the same request is sent again without it.
 */
async function streamOnce(body: Body, jobId: string, onText: (snapshot: string) => void): Promise<{ text: string; usage: Usage; model: string }> {
  const c = await client()
  const ctrl = new AbortController()
  jobs.set(jobId, ctrl)
  const run = async (withFallback: boolean) => {
    const req: Body = withFallback ? { ...body, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : body
    const stream = c.beta.messages.stream(req, { signal: ctrl.signal })
    let last = 0
    stream.on('text', (_d, snap) => {
      // at most a few updates a second to the window
      const now = Date.now()
      if (now - last > 120) {
        last = now
        onText(snap)
      }
    })
    return stream.finalMessage()
  }
  try {
    let msg
    try {
      msg = await run(true)
    } catch (e) {
      if (e instanceof Anthropic.BadRequestError && /fallback/i.test(e.message)) msg = await run(false)
      else throw e
    }
    if (msg.stop_reason === 'refusal') throw new Error('Claude סירב להתייחס לטקסט הזה. אפשר לנסות קטע קצר יותר או ניסוח אחר של השאלה.')
    const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
    if (msg.stop_reason === 'max_tokens' && !text) throw new Error('התשובה נקטעה. אפשר לנסות שוב עם טקסט קצר יותר.')
    const u = msg.usage
    const cacheRead = u.cache_read_input_tokens ?? 0
    const cacheWrite = u.cache_creation_input_tokens ?? 0
    const usage: Usage = { input: u.input_tokens + cacheRead + cacheWrite, output: u.output_tokens, cost: costOf(msg.model, u.input_tokens, u.output_tokens, cacheRead, cacheWrite) }
    return { text, usage, model: msg.model }
  } catch (e) {
    throw new Error(errorText(e))
  } finally {
    jobs.delete(jobId)
  }
}

function contextBlocks(req: ReviewRequest, ask: string): BetaTextBlockParam[] {
  const { context } = reviewMessage(req)
  // The long text first and marked for caching: follow-up questions reuse it at a tenth of the price
  return [
    { type: 'text', text: context, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: ask }
  ]
}

export async function review(wc: WebContents, jobId: string, req: ReviewRequest): Promise<{ json: string; usage: Usage; model: string }> {
  const s = aiSettings()
  const { ask } = reviewMessage(req)
  const body: Body = {
    model: s.model,
    max_tokens: 64000,
    system: systemPrompt(s.instructions),
    thinking: { type: 'adaptive' },
    output_config: { effort: s.effort, format: { type: 'json_schema', schema: REVIEW_SCHEMA as unknown as Record<string, unknown> } },
    messages: [{ role: 'user', content: contextBlocks(req, ask) }]
  }
  const r = await streamOnce(body, jobId, (snap) => !wc.isDestroyed() && wc.send('ai:progress', jobId, snap))
  return { json: r.text, usage: r.usage, model: r.model }
}

/** A follow-up question about a review: the same text (cached), the review, the talk so far, and the question */
export async function followUp(wc: WebContents, jobId: string, req: ReviewRequest, rv: Pick<Review, 'summary' | 'findings'>, chat: ChatTurn[], question: string): Promise<{ text: string; usage: Usage }> {
  const s = aiSettings()
  const { ask } = reviewMessage(req)
  const messages: BetaMessageParam[] = [
    { role: 'user', content: contextBlocks(req, ask) },
    { role: 'assistant', content: reviewAsText(rv) || '(אין הערות)' }
  ]
  for (const t of chat) messages.push({ role: t.role, content: t.text })
  messages.push({ role: 'user', content: `${question}\n\n(ענה בטקסט רגיל, בקצרה ולעניין.)` })
  const body: Body = {
    model: s.model,
    max_tokens: 32000,
    system: systemPrompt(s.instructions),
    thinking: { type: 'adaptive' },
    output_config: { effort: s.effort === 'xhigh' ? 'high' : s.effort },
    messages
  }
  const r = await streamOnce(body, jobId, (snap) => !wc.isDestroyed() && wc.send('ai:progress', jobId, snap))
  return { text: r.text.trim(), usage: r.usage }
}

/** The writer's reply on one comment: the same text (cached), the review, the talk about this comment, and the reply */
export async function findingReply(wc: WebContents, jobId: string, req: ReviewRequest, rv: Pick<Review, 'summary' | 'findings'>, finding: Finding, message: string): Promise<{ reply: string; decision: string; usage: Usage }> {
  const s = aiSettings()
  const { ask } = reviewMessage(req)
  const messages: BetaMessageParam[] = [
    { role: 'user', content: contextBlocks(req, ask) },
    { role: 'assistant', content: reviewAsText(rv) || '(אין הערות)' }
  ]
  for (const t of findingThreadMessages(finding, finding.thread ?? [], message)) messages.push({ role: t.role, content: t.text })
  const body: Body = {
    model: s.model,
    max_tokens: 32000,
    system: systemPrompt(s.instructions),
    thinking: { type: 'adaptive' },
    output_config: { effort: s.effort === 'xhigh' ? 'high' : s.effort, format: { type: 'json_schema', schema: REPLY_SCHEMA as unknown as Record<string, unknown> } },
    messages
  }
  const r = await streamOnce(body, jobId, (snap) => !wc.isDestroyed() && wc.send('ai:progress', jobId, snap))
  return { ...parseReply(r.text), usage: r.usage }
}

/** New writing prompts for the workshop */
export async function promptIdeas(jobId: string, theme: string, count: number, avoid: string[]): Promise<{ prompts: string[]; usage: Usage }> {
  const s = aiSettings()
  const body: Body = {
    model: s.model,
    max_tokens: 8000,
    system: systemPrompt(s.instructions),
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: promptIdeasMessage(theme, count, avoid) }]
  }
  const r = await streamOnce(body, jobId, () => undefined)
  const prompts = r.text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim())
    .filter((l) => l.length > 3)
  return { prompts, usage: r.usage }
}
