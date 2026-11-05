// ponytail: in-process queue; a restart drops running jobs and the startup scan marks them 'interrupted'.
// A real queue only matters with more than one process.
import { readFile } from 'node:fs/promises'
import { config, now } from './config.ts'
import { compose } from './agent.ts'
import { db, getRow, memberName, namedSources, transition, writeFts, type Row } from './db.ts'
import { attachmentsOf } from './files.ts'
import { log } from './log.ts'

const chains = new Map<number, Promise<unknown>>()

/** Runs jobs for the same entry one after another; different entries run in parallel. */
function enqueue(id: number, fn: () => Promise<void>) {
  const next = (chains.get(id) ?? Promise.resolve()).then(fn)
  chains.set(id, next)
  next.finally(() => chains.get(id) === next && chains.delete(id))
  return next
}

export const AI_FIELDS = ['title', 'time', 'attendees', 'goals', 'next_steps']
export const MERGE = 'Merge the new messages from the notes into this draft.'

function sourcesText(row: Row) {
  return [
    row.source_text ?? '',
    ...namedSources(row).map((m) => `[${m.at}] ${m.author}: ${m.content}${m.attachment_ids.length ? ` (attachments ${m.attachment_ids.map((i) => '#' + i).join(' ')})` : ''}`),
  ].filter(Boolean).join('\n')
}

/**
 * Caller has already moved the entry to 'drafting'. Fresh draft when no instruction, else revise the current one.
 * Success → draft_ready; failure → failed_step 'ai' (status back to draft_ready if there is a draft to show).
 */
export function runAgent(id: number, instruction?: string) {
  return enqueue(id, async () => {
    const row = getRow(id)!
    // Queued behind another job: that one may have finished, and someone may have submitted the draft since.
    if (row.status === 'draft_ready') transition(id, ['draft_ready'], 'drafting', instruction ? { revising: instruction } : {})
    else if (row.status !== 'drafting') return
    try {
      const atts = attachmentsOf(id)
      const sent = atts.filter((a) => a.small_path).slice(0, config.image_limit)
      const attachments = await Promise.all(atts.map(async (a) => ({
        id: a.id, filename: a.filename, image: sent.includes(a) ? await readFile(a.small_path!) : undefined,
      })))
      const current = instruction && row.entry ? JSON.parse(row.entry as string) : undefined
      // Before someone registers, their username and their name in the chat differ; give the model one, or it lists them twice.
      const author = namedSources(row).find((m) => m.author_id === row.created_by)?.author ?? memberName(row.created_by as string)!
      const note = await compose({ date: row.date as string, author, sources: sourcesText(row), attachments, current, instruction })

      const aiUntouched = current ? row.ai_untouched : JSON.stringify([...AI_FIELDS, ...note.sections.map((_, i) => 'section:' + i)])
      db.prepare(`update entries set entry = ?, title = ?, ai_untouched = ?, status = 'draft_ready', drafted_at = ?, revising = null,
                  failed_step = null, error = null, failed_at = null, version = version + 1 where id = ?`)
        .run(JSON.stringify(note), note.title, aiUntouched, now(), id)
      for (const a of sent) db.prepare('update attachments set sent_to_llm = 1 where id = ?').run(a.id)
      writeFts(id, note)
    } catch (err) {
      // APICallError can carry an empty message (e.g. a bare 401), so fall back to name + status.
      const e = err as Error & { statusCode?: number; responseBody?: string }
      const msg = e.message || [e.name, e.statusCode, e.responseBody].filter(Boolean).join(' ') || String(err)
      db.prepare(`update entries set status = case when entry is null then 'drafting' else 'draft_ready' end, revising = null,
                  failed_step = 'ai', error = ?, failed_at = ?, version = version + 1 where id = ?`).run(msg, now(), id)
      void log(`❌ entry ${id} · ai · ${msg}`)
    }
  })
}

/** Jobs that were running when the process died are not coming back. A session with no ended_at had not finished collecting. */
export function markInterrupted() {
  db.prepare(`update entries set status = case when entry is null then 'drafting' else 'draft_ready' end, revising = null,
              failed_step = case when kind = 'session' and ended_at is null then 'attachments' else 'interrupted' end,
              error = 'Server restarted while this was running', failed_at = ?
              where status = 'drafting' and failed_step is null`).run(now())
}
