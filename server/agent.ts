// design.md §4, §11. Output.object over a hand-written schema prompt: with thinking on, deepseek-flash often echoes a
// schema pasted into our prompt back as its answer (M0b); the SDK's own injection did not. Invalid replies are retried.
import { createDeepSeek } from '@ai-sdk/deepseek'
import { generateText, NoObjectGeneratedError, Output, stepCountIs, tool, type LanguageModel, type ModelMessage, type UserContent } from 'ai'
import { z } from 'zod'
import { NI, NotebookEntry } from '../shared/entry.ts'
import { config } from './config.ts'
import { db } from './db.ts'

let override: LanguageModel | undefined
export const setModel = (m: LanguageModel) => { override = m } // tests, demo
const getModel = () => override ?? createDeepSeek({ apiKey: config.llmKey, baseURL: config.llm.base_url })(config.llm.model) // /setup can change these

const SYSTEM = `You turn an FTC robotics team's raw notes (chat messages or pasted text, any language, plus photos) into one English engineering notebook entry.

Rules:
- Only state facts that appear in the notes or images. Never invent numbers, part names, measurements or results.
- If a fact the entry needs is missing, write exactly "${NI}" in its place. Leave start_time / end_time as "" if no time is mentioned.
- Write in English, concise and factual, past tense.
- section.subsystem must be one of: ${config.subsystems.join(', ')}.
- Put a photo in a section by its attachment id (images: [{attachment_id, caption}]); only use ids listed as attached images.
- attendees are real names of people who took part (authors of the notes count).
- You may call search_entries / get_entry to link to earlier archived entries.

Reply with only the notebook entry as a JSON object, no prose, no code fence.`

const ftsQuery = (q: string) => q.split(/\s+/).filter(Boolean).map((w) => `"${w.replace(/"/g, '""')}"`).join(' OR ')

const tools = {
  search_entries: tool({
    description: 'Full-text search over archived notebook entries. Returns id, date, title.',
    inputSchema: z.object({ query: z.string() }),
    execute: ({ query }) =>
      db.prepare(`select e.id, e.date, e.title from entries_fts f join entries e on e.id = f.entry_id
                  where entries_fts match ? and e.status = 'approved' order by rank limit 10`).all(ftsQuery(query)),
  }),
  get_entry: tool({
    description: 'Read one archived notebook entry in full.',
    inputSchema: z.object({ id: z.number().int() }),
    execute: ({ id }) => {
      const r = db.prepare(`select entry from entries where id = ? and status = 'approved'`).get(id) as { entry: string } | undefined
      return r ? JSON.parse(r.entry) : 'not found'
    },
  }),
}

export interface AgentInput {
  date: string
  author: string
  sources: string                                   // the raw notes, already flattened to text
  attachments: { id: number; filename: string; image?: Uint8Array }[]
  current?: NotebookEntry                           // revise: the draft to change
  instruction?: string                              // revise: what to change
}

export async function compose(input: AgentInput): Promise<NotebookEntry> {
  const content: UserContent = [{
    type: 'text',
    text: [
      `Date: ${input.date}`,
      `Entered by: ${input.author}`,
      `Notes:\n${input.sources || '(none)'}`,
      `Attachments:\n${input.attachments.map((a) => `#${a.id} ${a.filename}${a.image ? ' (image attached below)' : ' (not shown)'}`).join('\n') || '(none)'}`,
      ...(input.current ? [`Current draft:\n${JSON.stringify(input.current)}`, `Change it as follows, keep everything else: ${input.instruction}`] : []),
    ].join('\n\n'),
  }]
  for (const a of input.attachments) if (a.image) content.push({ type: 'text', text: `Attachment #${a.id}:` }, { type: 'file', data: a.image, mediaType: 'image/jpeg' })

  const messages: ModelMessage[] = [{ role: 'user', content }]
  let lastError = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await generateText({ model: getModel(), instructions: SYSTEM, messages, tools, stopWhen: stepCountIs(8), output: Output.object({ schema: NotebookEntry }) })
      return tidy(r.output, input)
    } catch (err) {
      if (!NoObjectGeneratedError.isInstance(err)) throw err // network, auth, rate limit: retrying here will not help
      lastError = (err.cause as Error | undefined)?.message ?? err.message
      messages.push({ role: 'assistant', content: err.text || '(empty)' }, { role: 'user', content: `Your reply was invalid:\n${lastError}\nReply with the corrected JSON object only.` })
    }
  }
  throw new Error(`LLM output invalid after 3 attempts: ${lastError.slice(0, 500)}`)
}

const PICK = `Someone @mentioned the engineering notebook bot in an FTC robotics team's chat. Below are recent messages, numbered oldest to newest; the last one is the mention.
Choose the messages that belong in the note the mention asks to record. If the mention has no text, choose what it most likely refers to. Leave out unrelated chat.
Reply with only a JSON object: {"numbers": [...]}.`

/** Numbers of the messages worth keeping. Never throws: bot.ts always keeps the mention itself, so a failure here costs context, not the note. */
export async function pickMessages(msgs: { author: string; content: string; files: string[] }[]): Promise<number[]> {
  const list = msgs.map((m, i) => `${i}. ${m.author}: ${m.content || '(no text)'}${m.files.length ? ` [attached: ${m.files.join(', ')}]` : ''}`).join('\n')
  try {
    const r = await generateText({
      model: getModel(), instructions: PICK, messages: [{ role: 'user', content: list }],
      output: Output.object({ schema: z.object({ numbers: z.array(z.number().int()) }) }),
    })
    return r.output.numbers
  } catch (err) {
    console.error('pickMessages failed:', (err as Error).message)
    return []
  }
}

/** Code, not the model, has the last word on ids, date and attendees (plan.md §3 agent.ts). */
function tidy(e: NotebookEntry, input: AgentInput): NotebookEntry {
  const ids = new Set(input.attachments.filter((a) => a.image).map((a) => a.id))
  for (const s of e.sections) s.images = s.images.filter((im) => ids.has(im.attachment_id))
  return { ...e, date: input.date, attendees: e.attendees.length ? e.attendees : [input.author] }
}
