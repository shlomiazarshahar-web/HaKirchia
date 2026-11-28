// Round 17: a review and the replies after it share one cached prefix. Runs the real main-process
// calls against a small fake Claude server and compares what is sent.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'http'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dir = mkdtempSync(join(tmpdir(), 'r17-'))
writeFileSync(join(dir, 'claude-key.bin'), 'sk-ant-test')
vi.mock('electron', () => ({ app: { getPath: () => dir }, safeStorage: { isEncryptionAvailable: () => false } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ ai: { effort: 'medium', r17: true } }) }))

const bodies: Record<string, unknown>[] = []
let server: Server

function sse(text: string): string {
  const ev = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify({ type, ...(data as object) })}\n\n`
  return (
    ev('message_start', { message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 1000, cache_creation_input_tokens: 100, cache_creation: { ephemeral_1h_input_tokens: 100, ephemeral_5m_input_tokens: 0 } } } }) +
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) +
    ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } }) +
    ev('content_block_stop', { index: 0 }) +
    ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }) +
    ev('message_stop', {})
  )
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const body = JSON.parse(raw)
      bodies.push(body)
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const json = bodies.length === 1 ? { summary: 'ס', findings: [], lessons: '', next: '', reply: '', decision: '' } : { summary: '', findings: [], lessons: '', next: '', reply: 'תשובה', decision: 'משאיר' }
      res.end(sse(JSON.stringify(json)))
    })
  })
  await new Promise<void>((r) => server.listen(0, r))
  const port = (server.address() as { port: number }).port
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`
})
afterAll(() => server.close())

describe('round 17: review and replies share the cache', () => {
  it('sends the same prefix, shape and depth, and the reply reads it', async () => {
    const ai = await import('../src/main/ai')
    const wc = { isDestroyed: () => true, send: () => undefined } as never
    const req = { scope: 'chapter' as const, texts: [{ id: 'c1', title: 'פרק', paras: ['שורה ראשונה', 'שורה שנייה'] }], kinds: [{ name: 'הגהה', prompt: 'טעויות' }], bookTitle: 'ספר', model: 'claude-opus-5-5' as const, effort: 'medium' as const }
    const r = await ai.review(wc, 'j1', req)
    expect(JSON.parse(r.json).summary).toBe('ס')
    const rv = { summary: 'ס', findings: [{ id: 'f', kind: 'הגהה', quote: 'שורה', comment: 'הערה', status: 'open' as const }], model: r.model, effort: 'medium' as const }
    const { model: _m, effort: _e, ...followReq } = req
    const reply = await ai.findingReply(wc, 'j2', followReq, rv, rv.findings[0], 'זה מכוון')
    expect(reply).toMatchObject({ reply: 'תשובה', decision: 'משאיר' })
    await ai.followUp(wc, 'j3', followReq, rv, [], 'שאלה')

    const [b1, b2, b3] = bodies as { system: string; model: string; output_config: unknown; messages: { content: unknown }[] }[]
    for (const b of [b2, b3]) {
      expect(b.system).toBe(b1.system)
      expect(b.model).toBe(b1.model)
      expect(b.output_config).toEqual(b1.output_config)
      // the review's whole message (text + ask, marked for an hour) is the start of every follow-up
      expect(b.messages[0]).toEqual(b1.messages[0])
    }
    const first = b1.messages[0].content as { cache_control?: { ttl?: string } }[]
    expect(first[first.length - 1].cache_control?.ttl).toBe('1h')
    // a 1-hour write costs twice the input price, a read 5% (Opus 5.5): 100*8 + 1000*0.2 + 10*4 + 5*20 per million
    expect(reply.usage.cost).toBeCloseTo((100 * 8 + 1000 * 0.2 + 10 * 4 + 5 * 20) / 1e6, 8)
  })
})
