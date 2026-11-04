// The one NotebookEntry schema (design.md §5): LLM output, API and web form all use it.
import { z } from 'zod'

export const NI = '[needs input]'

export const Decision = z.object({
  decision: z.string(),
  alternatives_considered: z.array(z.string()),
  rationale: z.string(),
})
export const Section = z.object({
  subsystem: z.string(),
  work_done: z.string(),
  problems: z.array(z.string()),
  decisions: z.array(Decision),
  test_results: z.string().nullable(),
  images: z.array(z.object({ attachment_id: z.number().int(), caption: z.string() })),
})
export const NotebookEntry = z.object({
  title: z.string(),
  date: z.string(),
  start_time: z.string(), // 'HH:mm', '' or NI
  end_time: z.string(),
  attendees: z.array(z.string()),
  goals: z.array(z.string()),
  sections: z.array(Section),
  next_steps: z.array(z.string()),
})

export type Decision = z.infer<typeof Decision>
export type Section = z.infer<typeof Section>
export type NotebookEntry = z.infer<typeof NotebookEntry>

export type Status = 'collecting' | 'drafting' | 'draft_ready' | 'pending_approval' | 'approved' | 'discarded'
export type Kind = 'web' | 'session' | 'quick'
export type Step = 'ai' | 'attachments' | 'interrupted' | 'mirror'
