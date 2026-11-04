// M0b spike: AI SDK + @ai-sdk/deepseek against the real API: structured output / function calling / image input,
// thinking on and off, then the production path server/agent.ts compose(). Fake data only.
// Run: node --env-file=.env spikes/m0b_llm.ts   (LLM_API_KEY required; uses the [llm] section of config.toml)
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { generateText, Output, stepCountIs, tool, type ModelMessage } from 'ai'
import sharp from 'sharp'
import { parse } from 'smol-toml'
import { z } from 'zod'
import { NotebookEntry } from '../shared/entry.ts'

const { llm } = parse(readFileSync(process.env.CONFIG ?? 'config.toml', 'utf8')) as { llm: { base_url?: string; model: string } }
assert.ok(process.env.LLM_API_KEY, 'LLM_API_KEY is not set')
const model = createDeepSeek({ apiKey: process.env.LLM_API_KEY, baseURL: llm.base_url })(llm.model)
const TIMEOUT = 180_000

const MESSAGES = `[<@111>] 今天调 intake，原来 REV 的轮子太滑，球老是吸不进来
[<@222>] 试了 goBILDA 的 gripper wheel 和 compliant wheel，compliant 吸得最稳，10 次成功 9 次
[<@111>] 那就定 compliant 了，下次把转速从 0.8 降到 0.6 试试，现在有点打飞`

const BASE = `Turn FTC team chat into an English engineering notebook entry. Date: 2026-11-02. Only state facts present in the messages. If a required fact is missing write exactly "[needs input]". subsystem must be one of: Intake, Drivetrain, Outtake, Software, Strategy, Outreach. Leave images empty.`
const WITH_TOOL = `${BASE} Resolve every <@id> mention with get_member and list those real names in attendees.`
const PROMPTED = `${WITH_TOOL}\nReply with ONLY a JSON object matching this JSON Schema, no prose, no code fence:\n${JSON.stringify(z.toJSONSchema(NotebookEntry))}`

const options = (thinking: boolean) => ({ deepseek: { thinking: { type: thinking ? 'enabled' : 'disabled' } } } as const)
const memberTool = (calls: string[]) => ({
  get_member: tool({
    description: 'Resolve a Discord user id (digits only) to the member real name.',
    inputSchema: z.object({ discord_id: z.string() }),
    execute: ({ discord_id }) => {
      calls.push(discord_id)
      return ({ 111: 'Alice Chen', 222: 'Bob Li' } as Record<string, string>)[discord_id.replace(/\D/g, '')] ?? 'unknown'
    },
  }),
})

function assertFacts(note: NotebookEntry) {
  const decisions = note.sections.flatMap((s) => s.decisions)
  assert.ok(decisions.some((d) => /compliant/i.test(d.decision)), 'no compliant-wheel decision extracted')
}
function assertResolved(note: NotebookEntry, calls: string[]) {
  assert.ok(calls.length > 0, 'model did not call get_member')
  for (const name of ['Alice Chen', 'Bob Li']) assert.ok(note.attendees.includes(name), `${name} missing from attendees: ${note.attendees}`)
}

const image = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="white"/><circle cx="150" cy="200" r="100" fill="red"/><text x="320" y="225" font-family="sans-serif" font-size="60" fill="black">kP = 0.027</text></svg>`)).jpeg().toBuffer()

/** Mode A: SDK-native structured output, no tools. */
async function nativeOnly(thinking: boolean) {
  const r = await generateText({ model, instructions: BASE, prompt: MESSAGES, output: Output.object({ schema: NotebookEntry }), providerOptions: options(thinking), abortSignal: AbortSignal.timeout(TIMEOUT) })
  assertFacts(r.output)
  return 'schema ok'
}
/** Mode B: SDK-native structured output together with tools. */
async function nativeWithTools(thinking: boolean) {
  const calls: string[] = []
  const r = await generateText({ model, instructions: WITH_TOOL, prompt: MESSAGES, tools: memberTool(calls), stopWhen: stepCountIs(8), output: Output.object({ schema: NotebookEntry }), providerOptions: options(thinking), abortSignal: AbortSignal.timeout(TIMEOUT) })
  assertFacts(r.output)
  assertResolved(r.output, calls)
  return `get_member x${calls.length}`
}
/** Mode C: what server/agent.ts does today: schema in the prompt, zod parse, retry with the error. */
async function promptedWithTools(thinking: boolean) {
  const calls: string[] = []
  const messages: ModelMessage[] = [{ role: 'user', content: MESSAGES }]
  let lastError = ''
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await generateText({ model, instructions: PROMPTED, messages, tools: memberTool(calls), stopWhen: stepCountIs(8), providerOptions: options(thinking), abortSignal: AbortSignal.timeout(TIMEOUT) })
    try {
      const note = NotebookEntry.parse(JSON.parse(r.text.slice(r.text.indexOf('{'), r.text.lastIndexOf('}') + 1)))
      assertFacts(note)
      assertResolved(note, calls)
      return `attempt ${attempt}, get_member x${calls.length}`
    } catch (err) {
      lastError = (err as Error).message
      messages.push(...r.response.messages, { role: 'user', content: `Your reply was invalid:\n${lastError}\nReply with the corrected JSON object only.` })
    }
  }
  throw new Error(`invalid after 3 attempts: ${lastError.slice(0, 300)}`)
}
async function vision(thinking: boolean) {
  const r = await generateText({
    model, providerOptions: options(thinking), abortSignal: AbortSignal.timeout(TIMEOUT),
    messages: [{ role: 'user', content: [
      { type: 'text', text: 'What shape and color is on the left of this image, and what text is on the right?' },
      { type: 'file', data: image, mediaType: 'image/jpeg' },
    ] }],
  })
  assert.match(r.text, /0\.027/, r.text)
  assert.match(r.text, /red/i, r.text)
  return r.text.replace(/\s+/g, ' ').slice(0, 70)
}

const describe = (err: unknown) => {
  const e = err as Error & { statusCode?: number; responseBody?: string; cause?: Error }
  return [e.name, e.statusCode, e.message, e.responseBody?.slice(0, 200), e.cause?.message].filter(Boolean).join(' · ').replace(/\s+/g, ' ').slice(0, 320)
}
const fns = { 'native output': nativeOnly, 'native output + tools': nativeWithTools, 'prompted + zod + tools': promptedWithTools, 'image input': vision }
const jobs = Object.entries(fns).flatMap(([name, fn]) => [true, false].map((thinking) => ({ name, thinking, fn })))
const results = await Promise.all(jobs.map(async ({ name, thinking, fn }) => {
  const start = performance.now()
  try {
    return { name, thinking, ok: true, detail: await fn(thinking), s: (performance.now() - start) / 1000 }
  } catch (err) {
    return { name, thinking, ok: false, detail: describe(err), s: (performance.now() - start) / 1000 }
  }
}))
console.log(`\nmodel: ${llm.model}  base: ${llm.base_url}\n`)
for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.name.padEnd(24)} thinking ${r.thinking ? 'on ' : 'off'} ${r.s.toFixed(1).padStart(6)}s  ${r.detail}`)

// Production path: exact system prompt, retry loop and tidy(), in a throwaway database.
process.env.DATA_DIR = mkdtempSync(`${tmpdir()}/glaucus-m0b-`)
process.env.COOKIE_SECRET ||= 'spike'
const { compose } = await import('../server/agent.ts')
const sources = `[2026-11-02 15:02] Alice Chen: 今天调 intake，原来 REV 的轮子太滑，球老是吸不进来
[2026-11-02 15:20] Bob Li: 试了 goBILDA 的 gripper wheel 和 compliant wheel，compliant 吸得最稳，10 次成功 9 次 (attachments #1)
[2026-11-02 15:41] Alice Chen: 那就定 compliant 了，下次把转速从 0.8 降到 0.6 试试，现在有点打飞`
const input = { date: '2026-11-02', author: 'Alice Chen', sources, attachments: [{ id: 1, filename: 'tuning.jpg', image }, { id: 2, filename: 'spec.pdf' }] }

console.log('\ncompose(): fresh draft')
let start = performance.now()
const draft = await compose(input)
console.log(JSON.stringify(draft, null, 1))
console.log(`${((performance.now() - start) / 1000).toFixed(1)}s`)
assert.equal(draft.date, '2026-11-02')
assertFacts(draft)
assert.ok(draft.sections.flatMap((s) => s.images).every((im) => im.attachment_id === 1), 'only the attached image may be used')
assert.match(JSON.stringify(draft), /9\/10|9 out of 10|nine out of ten|9 of 10/i, 'test result lost')

console.log('\ncompose(): revise')
start = performance.now()
const revised = await compose({ ...input, current: draft, instruction: 'Add "Order spare compliant wheels" to next_steps.' })
console.log(JSON.stringify(revised.next_steps), `${((performance.now() - start) / 1000).toFixed(1)}s`)
assert.ok(revised.next_steps.some((s) => /spare compliant wheels/i.test(s)), 'instruction not applied')
assert.equal(revised.title, draft.title, 'revise should keep everything else')
console.log('\n✅ compose(): draft and revise')
