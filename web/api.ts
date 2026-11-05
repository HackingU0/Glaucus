// The server (plan.md §4) behind reactive state the pages render. Actions replace the entry in place with the
// server's copy, so pages just read `entries` / `getEntry()`; drafting entries are polled until the AI is done.
import { reactive } from 'vue'
import { toast } from 'vue-sonner'
import { NI, type NotebookEntry, type Kind, type Status, type Step } from '../shared/entry'

export { NI }
export type { Decision, Kind, NotebookEntry, Section, Status, Step } from '../shared/entry'

export interface SourceMessage { author: string; at: string; content: string; attachment_ids: number[] }
export interface Attachment { id: number; filename: string; url?: string; orig_url?: string; from?: string; size?: number }
export interface Revision { v: number; by: string; at: string; what: string; entry: NotebookEntry }
export interface Entry {
  id: number
  kind: Kind
  status: Status
  title: string
  date: string
  channel?: string
  created_by: string
  created_at: string
  source_messages: SourceMessage[]
  source_text?: string
  attachments: Attachment[]
  entry: NotebookEntry | null
  ai_untouched: string[] // 'title' | 'time' | 'attendees' | 'goals' | 'next_steps' | 'section:<i>'
  drafted_at?: string
  submitted_by?: string
  submitted_at?: string
  approved_by?: string
  approved_at?: string
  discarded_by?: string
  discarded_at?: string
  returned?: { by: string; at: string; reason: string }
  revising?: string // instruction while the AI is revising
  failed_step?: Step
  error?: string
  failed_at?: string
  version: number
  revisions: Revision[]
}
export interface UsageRow { member_id: string; name: string; discord_name: string | null; today: number; week: number; month: number; total: number; month_calls: number; last_at: string }
export interface Member { discord_id: string; discord_name: string; real_name: string; is_admin: boolean; registered_at: string }

export const me = reactive<Member>({ discord_id: '', discord_name: '', real_name: '', is_admin: false, registered_at: '' })
export const members = reactive<Member[]>([])
export const entries = reactive<Entry[]>([])
export const SUBSYSTEMS = reactive<string[]>([])
export const setupState = reactive<{ needed?: boolean }>({})

export const countNI = (x: unknown) => JSON.stringify(x ?? '').split(NI).length - 1
export const isRegistered = (name: string) => members.some((m) => m.real_name === name)
export const getEntry = (id: number) => entries.find((e) => e.id === id)

// ---- transport ------------------------------------------------------------------------
async function req(path: string, init: RequestInit & { json?: unknown } = {}) {
  const r = await fetch(path, {
    ...init,
    headers: init.json !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  })
  if (r.status === 401) location.href = '/login'
  if (!r.ok && r.status !== 409) {
    const msg = (await r.json().catch(() => null))?.error ?? `${r.status} ${r.statusText}`
    toast.error(msg)
    throw new Error(msg)
  }
  return r
}

function put(fresh: Entry) {
  const e = getEntry(fresh.id)
  if (e) Object.assign(e, fresh)
  else entries.unshift(fresh)
  return getEntry(fresh.id)!
}
export const fetchEntry = async (id: number) => put(await (await req(`/api/entries/${id}`)).json())

/** POST an action; on 409 (someone else moved it first) just show the entry's real state. */
async function act(e: Entry, action: string, json?: unknown) {
  const r = await req(`/api/entries/${e.id}/${action}`, { method: 'POST', json })
  if (r.status === 409) return void fetchEntry(e.id)
  put(await r.json())
}

// ---- session / lists ------------------------------------------------------------------
/** false when not logged in. */
export async function loadMe() {
  const r = await fetch('/api/me')
  if (!r.ok) return false
  const m = await r.json()
  Object.assign(me, m)
  SUBSYSTEMS.splice(0, SUBSYSTEMS.length, ...m.subsystems)
  return true
}
export async function refresh() {
  const [list, people] = await Promise.all([req('/api/entries').then((r) => r.json()), req('/api/members').then((r) => r.json())])
  entries.splice(0, entries.length, ...list)
  members.splice(0, members.length, ...people)
}
export async function register(realName: string) {
  await req('/api/me', { method: 'POST', json: { real_name: realName } })
  me.real_name = realName
}
export async function logout() {
  await fetch('/auth/logout', { method: 'POST' })
  location.href = '/login'
}
export const fetchUsage = async (): Promise<UsageRow[]> => (await req('/api/usage')).json()
export async function renameMember(discordId: string, realName: string) {
  await req(`/api/members/${discordId}`, { method: 'PUT', json: { real_name: realName } })
  const m = members.find((x) => x.discord_id === discordId)
  if (m) m.real_name = realName
}

setInterval(() => {
  for (const e of entries) if (e.status === 'drafting' && !e.failed_step) fetchEntry(e.id).catch(() => {})
}, 2000)

// ---- entry actions --------------------------------------------------------------------
export async function createEntry(text: string, date: string, files: File[]) {
  const form = new FormData()
  form.set('text', text)
  form.set('date', date)
  for (const f of files) form.append('files', f)
  return put(await (await req('/api/entries', { method: 'POST', body: form })).json()).id
}

/** Returns false on a version conflict (someone else saved first). */
export async function save(e: Entry, note: NotebookEntry, version: number, aiUntouched: string[]) {
  const r = await req(`/api/entries/${e.id}`, { method: 'PUT', json: { entry: note, version, ai_untouched: aiUntouched } })
  if (r.status === 409) return false
  put(await r.json())
  return true
}
export const regenerate = (e: Entry) => act(e, 'regenerate')
export const revise = (e: Entry, instruction: string) => act(e, 'revise', { instruction })
export const retry = (e: Entry) => act(e, 'retry')
export const submit = (e: Entry) => act(e, 'submit')
export const approve = (e: Entry) => act(e, 'approve')
export const returnEntry = (e: Entry, reason: string) => act(e, 'return', { reason })
export const reopen = (e: Entry) => act(e, 'reopen')
export const discard = (e: Entry) => act(e, 'discard')
