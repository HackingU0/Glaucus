import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateText, Output } from 'ai'
import { z } from 'zod'
import { createModel, isDeepSeek } from './llm.ts'

const formatSent = async (base_url: string) => {
  let body: Record<string, any> = {}
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    body = JSON.parse(String(init!.body))
    return new Response(JSON.stringify({ id: 'x', created: 1, model: 'm', choices: [{ index: 0, message: { role: 'assistant', content: '{"ok": true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  try {
    const r = await generateText({ model: createModel({ base_url, model: 'm' }, 'k'), prompt: 'hi', output: Output.object({ schema: z.object({ ok: z.boolean() }) }) })
    assert.deepEqual(r.output, { ok: true })
  } finally { globalThis.fetch = realFetch }
  return body.response_format
}

test('DeepSeek gets json_object, the only format it takes', async () => {
  assert.equal((await formatSent('https://api.deepseek.com')).type, 'json_object')
})

test('other OpenAI-compatible APIs get json_schema: Anthropic refuses json_object', async () => {
  const f = await formatSent('https://api.anthropic.com/v1/')
  assert.equal(f.type, 'json_schema')
  assert.deepEqual(f.json_schema.schema.required, ['ok'])
})

test('isDeepSeek looks at the host only', () => {
  assert.equal(isDeepSeek('https://api.deepseek.com/v1'), true)
  assert.equal(isDeepSeek('https://deepseek.com.evil.test'), false)
  assert.equal(isDeepSeek('https://api.openai.com/v1?x=deepseek.com'), false)
  assert.equal(isDeepSeek('not a url'), false)
})
