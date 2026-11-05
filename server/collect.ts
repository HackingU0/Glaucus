// Discord messages → entries (design.md §3.2–3.4). No discord.js types here, so it all runs in tests; bot.ts does the talking.
// Reads and writes happen synchronously between awaits (see api.ts), so one process cannot interleave them.
import { pickMessages } from './agent.ts'
import { now, today } from './config.ts'
import { db, getRow, realName, transition, type Row, type SourceMessage } from './db.ts'
import { saveUpload } from './files.ts'
import { MERGE, runAgent } from './jobs.ts'
import { log } from './log.ts'

export interface Msg {
  id: string
  authorId: string
  authorName: string
  at: string
  content: string
  attachments: { url: string; filename: string; mime: string }[]
}

const NOT_FAILED = { failed_step: null, error: null, failed_at: null }

export const sourcesOf = (id: number) => JSON.parse(getRow(id)!.source_messages as string) as SourceMessage[]

/** So created_by shows a name, not an id, for someone who has never logged in. Logging in overwrites it. */
export function ensureMember(discordId: string, username: string) {
  db.prepare('insert into members (discord_id, discord_name) values (?, ?) on conflict do nothing').run(discordId, username)
}

/** <@id> → a name. The bot's own mention disappears. */
export function resolveMentions(content: string, botId: string, name: (id: string) => string | undefined) {
  return content.replace(/<@!?(\d+)>/g, (_, id) => (id === botId ? '' : `@${name(id) ?? 'unknown'}`)).trim()
}

async function fetchBytes(url: string) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`attachment download failed: HTTP ${r.status}`)
  return new Uint8Array(await r.arrayBuffer())
}

/**
 * Appends what is not there yet, oldest first. Each message is written whole, so a failed download throws with the
 * earlier ones saved, and running it again carries on from there.
 */
export async function addMessages(entryId: number, msgs: Msg[], download = fetchBytes) {
  const has = (id: string) => sourcesOf(entryId).some((m) => m.id === id)
  for (const m of msgs) {
    if (has(m.id)) continue
    const files = await Promise.all(m.attachments.map((a) => download(a.url)))
    if (has(m.id)) continue // another mention got here during the download
    const attachment_ids: number[] = []
    for (const [i, a] of m.attachments.entries()) attachment_ids.push(await saveUpload(entryId, a.filename, a.mime, files[i]))
    const list = [...sourcesOf(entryId), { id: m.id, author_id: m.authorId, author: m.authorName, at: m.at, content: m.content, attachment_ids }]
      .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1)) // Discord ids are in time order
    db.prepare('update entries set source_messages = ?, version = version + 1 where id = ?').run(JSON.stringify(list), entryId)
  }
}

export const activeSession = (channelId: string) =>
  db.prepare(`select * from entries where kind = 'session' and status = 'collecting' and channel_id = ?`).get(channelId) as Row | undefined
export const sessionByThread = (threadId: string) =>
  db.prepare(`select * from entries where kind = 'session' and status = 'collecting' and thread_id = ?`).get(threadId) as Row | undefined
export const sessionOfThread = (threadId: string) =>
  db.prepare(`select * from entries where kind = 'session' and thread_id = ?`).get(threadId) as Row | undefined
export const lastSession = (channelId: string) =>
  db.prepare(`select * from entries where kind = 'session' and channel_id = ? and thread_id is not null order by id desc limit 1`).get(channelId) as Row | undefined
export const collectingSessions = () =>
  db.prepare(`select * from entries where kind = 'session' and status = 'collecting' and thread_id is not null`).all() as Row[]

/** At most one per channel (design.md §3.2): gives back the running one instead. The unique index is the backstop. */
export function openSession(o: { channelId: string; channelName: string; userId: string; subsystem: string | null }) {
  const existing = activeSession(o.channelId)
  if (existing) return { existing }
  const at = now()
  const id = Number(db.prepare(`insert into entries (kind, status, channel_id, channel_name, date, started_at, created_by, created_at, source_text, title)
                                values ('session', 'collecting', ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(o.channelId, o.channelName, at.slice(0, 10), at, o.userId, at, o.subsystem ? `Subsystem: ${o.subsystem}` : null, `Session ${o.channelName}`).lastInsertRowid)
  return { id }
}

/** All messages are in: an empty session is discarded without an LLM call. True when there is something to draft. */
export function sealSession(id: number) {
  const at = now()
  if (sourcesOf(id).length) {
    transition(id, ['drafting'], 'drafting', { ended_at: at, ...NOT_FAILED })
    return true
  }
  transition(id, ['drafting'], 'discarded', { ended_at: at, discarded_by: getRow(id)!.created_by, discarded_at: at, ...NOT_FAILED })
  return false
}

/** After sealSession. Once a draft exists, new messages merge into it so hand edits survive, and no new messages means no AI run. */
export async function draftSession(id: number, before: number) {
  if (!getRow(id)!.entry) return runAgent(id)
  if (sourcesOf(id).length === before) return void transition(id, ['drafting'], 'draft_ready')
  transition(id, ['drafting'], 'drafting', { revising: MERGE })
  return runAgent(id, MERGE)
}

/** /continue: only a draft still being worked on goes back to collecting, and one session per channel still holds. */
export function reopenSession(row: Row): { running?: Row; reopened?: boolean } {
  const running = activeSession(row.channel_id as string)
  if (running) return { running }
  return { reopened: transition(row.id, ['draft_ready'], 'collecting', { ended_at: null, ...NOT_FAILED }) }
}

export function failCollect(id: number, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  transition(id, ['drafting'], 'drafting', { failed_step: 'attachments', error: msg, failed_at: now() })
  void log(`❌ entry ${id} · attachments · ${msg}`)
}

/** Today's unsubmitted quick note, or a new one (design.md §3.3). */
export function openQuick(userId: string) {
  const date = today()
  const open = db.prepare(`select id from entries where kind = 'quick' and date = ? and status in ('collecting', 'drafting', 'draft_ready')`).get(date) as { id: number } | undefined
  if (open) return open.id
  return Number(db.prepare(`insert into entries (kind, status, date, created_by, created_at, title) values ('quick', 'collecting', ?, ?, ?, ?)`)
    .run(date, userId, now(), `Quick note ${date}`).lastInsertRowid)
}

/** New messages are in a quick note: first draft, or a revise that folds them in. Queues behind a job already running. */
export function draftQuick(id: number) {
  const row = getRow(id)!
  if (row.status === 'collecting' || (row.status === 'drafting' && !row.entry && row.failed_step)) {
    transition(id, [row.status], 'drafting', NOT_FAILED)
    return runAgent(id)
  }
  if (row.status === 'draft_ready') transition(id, ['draft_ready'], 'drafting', { revising: MERGE, ...NOT_FAILED })
  return runAgent(id, MERGE)
}

/**
 * The mention and what it replies to always stay; the model only adds context. Oldest first, mention last.
 * `since` is a running session's first message: older chat can't be offered to it, because it may belong to another note.
 */
export async function selectMessages(all: Msg[], mustKeep: string[], since?: string | null) {
  const candidates = since ? all.filter((m) => BigInt(m.id) > BigInt(since) || mustKeep.includes(m.id)) : all
  const usable = (m: Msg) => m.content || m.attachments.length
  if (candidates.length <= mustKeep.length) return candidates.filter(usable)
  const numbers = new Set(await pickMessages(candidates.map((m) => ({ author: m.authorName, content: m.content, files: m.attachments.map((a) => a.filename) }))))
  return candidates.filter((m, i) => (numbers.has(i) || mustKeep.includes(m.id)) && usable(m))
}

/** Authors who should log in once, so their real name shows up. */
export function unregisteredAuthors(msgs: Msg[]) {
  return [...new Set(msgs.map((m) => m.authorId))].filter((id) => !realName(id))
}
