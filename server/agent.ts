// design.md §4. Schema goes in the prompt and the reply is parsed with zod + retried: M0 found deepseek
// thinking mode rejects forced tool_choice and json_schema response_format, so no native structured output.
// ponytail: M0b (AI SDK against the real API) is still open; if it finds native output works, only this file changes.
import { createDeepSeek } from '@ai-sdk/deepseek'
import { generateText, stepCountIs, tool, type LanguageModel, type ModelMessage, type UserContent } from 'ai'
import { z } from 'zod'
import { NI, NotebookEntry } from '../shared/entry.ts'
import { config } from './config.ts'
import { db } from './db.ts'

let model: LanguageModel = createDeepSeek({ apiKey: config.llmKey, baseURL: config.llm.base_url })(config.llm.model)
export const setModel = (m: LanguageModel) => { model = m } // tests

const SYSTEM = `You turn an FTC robotics team's raw notes (chat messages or pasted text, any language, plus photos) into one English engineering notebook entry.

Rules:
- Only state facts that appear in the notes or images. Never invent numbers, part names, measurements or results.
- If a fact the entry needs is missing, write exactly "${NI}" in its place. Leave start_time / end_time as "" if no time is mentioned.
- Write in English, concise and factual, past tense.
- section.subsystem must be one of: ${config.subsystems.join(', ')}.
- Put a photo in a section by its attachment id (images: [{attachment_id, caption}]); only use ids listed as attached images.
- attendees are real names of people who took part (authors of the notes count).
- You may call search_entries / get_entry to link to earlier archived entries.

Reply with ONLY a JSON object matching this JSON Schema, no prose, no code fence:
${JSON.stringify(z.toJSONSchema(NotebookEntry))}`

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
    const r = await generateText({ model, instructions: SYSTEM, messages, tools, stopWhen: stepCountIs(8) })
    const json = r.text.slice(r.text.indexOf('{'), r.text.lastIndexOf('}') + 1)
    let parsed: ReturnType<typeof NotebookEntry.safeParse>
    try {
      parsed = NotebookEntry.safeParse(JSON.parse(json))
    } catch (err) {
      lastError = `not valid JSON: ${(err as Error).message}`
      messages.push(...r.response.messages, { role: 'user', content: `Your reply was ${lastError}. Reply with only the JSON object.` })
      continue
    }
    if (parsed.success) return tidy(parsed.data, input)
    lastError = z.prettifyError(parsed.error)
    messages.push(...r.response.messages, { role: 'user', content: `Your JSON does not match the schema:\n${lastError}\nReply with the corrected JSON object only.` })
  }
  throw new Error(`LLM output invalid after 3 attempts: ${lastError.slice(0, 500)}`)
}

/** Code, not the model, has the last word on ids, date and attendees (plan.md §3 agent.ts). */
function tidy(e: NotebookEntry, input: AgentInput): NotebookEntry {
  const ids = new Set(input.attachments.filter((a) => a.image).map((a) => a.id))
  for (const s of e.sections) s.images = s.images.filter((im) => ids.has(im.attachment_id))
  return { ...e, date: input.date, attendees: e.attendees.length ? e.attendees : [input.author] }
}
