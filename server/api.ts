// /api/* (plan.md §4). Every handler reads and writes synchronously between awaits, and node:sqlite is
// synchronous, so a read-check-write sequence cannot interleave with another request in this one process.
import { readFileSync } from 'node:fs'
import { strToU8, zipSync } from 'fflate'
import { Hono, type Context } from 'hono'
import { NotebookEntry } from '../shared/entry.ts'
import { requireAdmin, type Env } from './auth.ts'
import { config, now, today } from './config.ts'
import { db, getRow, memberName, transition, writeFts, type Row } from './db.ts'
import { attachmentsOf, saveUpload } from './files.ts'
import { runAgent } from './jobs.ts'
import { log } from './log.ts'
import { renderMarkdown, slugify } from './render.ts'

const json = <T>(s: unknown, fallback: T): T => (typeof s === 'string' ? JSON.parse(s) : fallback)

/** DB row → the Entry shape the web app renders (names instead of discord ids). */
function toApi(row: Row) {
  const revs = db.prepare('select * from entry_revisions where entry_id = ? order by id desc').all(row.id) as Row[]
  return {
    id: row.id, kind: row.kind, status: row.status, title: row.title, date: row.date, channel: row.channel_id,
    created_by: memberName(row.created_by as string), created_at: row.created_at,
    source_text: row.source_text, source_messages: json(row.source_messages, []),
    attachments: attachmentsOf(row.id).map((a) => ({
      id: a.id, filename: a.filename, url: a.small_path ? `/files/${a.id}` : null, orig_url: `/files/${a.id}?orig=1`, sent_to_llm: !!a.sent_to_llm,
    })),
    entry: json(row.entry, null), ai_untouched: json(row.ai_untouched, []), drafted_at: row.drafted_at, revising: row.revising,
    submitted_by: memberName(row.submitted_by as string), submitted_at: row.submitted_at,
    approved_by: memberName(row.approved_by as string), approved_at: row.approved_at,
    discarded_by: memberName(row.discarded_by as string), discarded_at: row.discarded_at,
    returned: row.returned_by ? { by: memberName(row.returned_by as string), at: row.returned_at, reason: row.return_reason } : null,
    failed_step: row.failed_step, error: row.error, failed_at: row.failed_at, version: row.version,
    revisions: revs.map((r, i) => ({ v: revs.length - i, by: memberName(r.editor_id as string), at: r.edited_at, what: r.what, entry: json(r.entry, null) })),
  }
}

const id = (c: Context) => Number(c.req.param('id'))
const reply = (c: Context, entryId: number) => c.json(toApi(getRow(entryId)!))
const conflict = (c: Context) => c.json({ error: 'entry changed state; reload' }, 409)

function uniqueSlug(date: string, title: string) {
  const base = slugify(title)
  let slug = base
  for (let n = 2; db.prepare('select 1 from entries where date = ? and slug = ?').get(date, slug); n++) slug = `${base}-${n}`
  return slug
}

function addRevision(entryId: number, by: string, what: 'submit' | 'admin_edit', note: unknown) {
  db.prepare('insert into entry_revisions (entry_id, editor_id, edited_at, what, entry) values (?, ?, ?, ?, ?)')
    .run(entryId, by, now(), what, JSON.stringify(note))
}

export const api = new Hono<Env>()
  // Names go into notes, so nothing but /api/me works before /register.
  .use(async (c, next) => {
    if (!c.get('user').real_name && c.req.path !== '/api/me') return c.json({ error: 'register first' }, 403)
    await next()
  })

  .get('/me', (c) => {
    const u = c.get('user')
    return c.json({ discord_id: u.discord_id, discord_name: u.discord_name, real_name: u.real_name, is_admin: !!u.is_admin, subsystems: config.subsystems })
  })
  .post('/me', async (c) => {
    const name = String((await c.req.json()).real_name ?? '').trim()
    if (!name) return c.json({ error: 'real_name required' }, 400)
    db.prepare('update members set real_name = ?, registered_at = coalesce(registered_at, ?) where discord_id = ?').run(name, now(), c.get('user').discord_id)
    return c.body(null, 204)
  })

  .get('/members', (c) => c.json(
    (db.prepare(`select discord_id, discord_name, real_name, is_admin, registered_at from members where real_name != '' order by registered_at`).all() as Row[])
      .map((m) => ({ ...m, is_admin: !!m.is_admin })),
  ))
  .put('/members/:discord_id', requireAdmin, async (c) => {
    const name = String((await c.req.json()).real_name ?? '').trim()
    if (!name) return c.json({ error: 'real_name required' }, 400)
    db.prepare('update members set real_name = ? where discord_id = ?').run(name, c.req.param('discord_id'))
    return c.body(null, 204)
  })

  // ponytail: returns every entry in full; the web app filters / searches client-side. Paginate when it gets slow.
  .get('/entries', (c) => c.json((db.prepare('select * from entries order by date desc, id desc').all() as Row[]).map(toApi)))

  .post('/entries', async (c) => {
    const body = await c.req.parseBody({ all: true })
    const text = String(body.text ?? '').trim()
    const uploads = ([] as unknown[]).concat(body['files[]'] ?? body.files ?? []).filter((f): f is File => f instanceof File)
    if (!text && !uploads.length) return c.json({ error: 'text or files required' }, 400)
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date)) ? String(body.date) : today()

    const entryId = Number(db.prepare(`insert into entries (kind, status, date, created_by, created_at, source_text, title)
                                       values ('web', 'drafting', ?, ?, ?, ?, ?)`)
      .run(date, c.get('user').discord_id, now(), text, text.split('\n')[0].slice(0, 60) || 'Untitled').lastInsertRowid)
    for (const f of uploads) await saveUpload(entryId, f.name, f.type, new Uint8Array(await f.arrayBuffer()))
    void runAgent(entryId)
    return reply(c, entryId)
  })

  .get('/entries/:id', (c) => (getRow(id(c)) ? reply(c, id(c)) : c.notFound()))

  .put('/entries/:id', async (c) => {
    const row = getRow(id(c))
    if (!row) return c.notFound()
    const body = await c.req.json()
    const note = NotebookEntry.safeParse(body.entry)
    if (!note.success) return c.json({ error: note.error.message }, 400)
    if (body.version !== row.version || !['draft_ready', 'pending_approval', 'approved'].includes(row.status)) return conflict(c)
    const user = c.get('user')
    if (row.status === 'approved' && !user.is_admin) return c.json({ error: 'archived entries are bot-admin only' }, 403)

    const extra: Record<string, string | null> = {
      entry: JSON.stringify(note.data), title: note.data.title, ai_untouched: JSON.stringify(body.ai_untouched ?? []), updated_at: now(),
    }
    // Editing a pending entry withdraws it: what gets approved is what the approver saw (design.md §6.1).
    if (row.status === 'pending_approval') Object.assign(extra, { submitted_by: null, submitted_at: null })
    if (row.status === 'approved') {
      extra.rendered_md = renderMarkdown(note.data, { submitted_by: memberName(row.submitted_by as string), approved_by: memberName(row.approved_by as string), approved_at: row.approved_at as string })
      addRevision(row.id, user.discord_id, 'admin_edit', note.data)
      void log(`✏️ entry ${row.id} · archived entry edited by ${user.real_name}`)
    }
    transition(row.id, [row.status], row.status === 'pending_approval' ? 'draft_ready' : row.status, extra)
    writeFts(row.id, note.data)
    return reply(c, row.id)
  })

  .post('/entries/:id/revise', async (c) => {
    const instruction = String((await c.req.json()).instruction ?? '').trim()
    if (!instruction) return c.json({ error: 'instruction required' }, 400)
    if (!getRow(id(c))?.entry || !transition(id(c), ['draft_ready'], 'drafting', { revising: instruction })) return conflict(c)
    void runAgent(id(c), instruction)
    return reply(c, id(c))
  })
  .post('/entries/:id/regenerate', (c) => {
    if (!transition(id(c), ['draft_ready'], 'drafting')) return conflict(c)
    void runAgent(id(c))
    return reply(c, id(c))
  })
  .post('/entries/:id/retry', requireAdmin, (c) => {
    const row = getRow(id(c))
    if (!row?.failed_step) return conflict(c)
    if (row.failed_step === 'mirror' || row.failed_step === 'attachments') return c.json({ error: `retrying '${row.failed_step}' is not implemented yet` }, 501)
    if (!transition(row.id, ['drafting', 'draft_ready'], 'drafting', { failed_step: null, error: null, failed_at: null })) return conflict(c)
    void runAgent(row.id)
    return reply(c, row.id)
  })
  .post('/entries/:id/discard', (c) => {
    // A failed draft has no job running, so it can go too. A running one can't: the job would write its draft back.
    const from = getRow(id(c))?.failed_step ? (['draft_ready', 'drafting'] as const) : (['draft_ready'] as const)
    const ok = transition(id(c), [...from], 'discarded', {
      discarded_by: c.get('user').discord_id, discarded_at: now(), failed_step: null, error: null, failed_at: null,
    })
    if (!ok) return conflict(c)
    return reply(c, id(c))
  })
  .post('/entries/:id/submit', (c) => {
    if (!getRow(id(c))?.entry) return conflict(c)
    const ok = transition(id(c), ['draft_ready'], 'pending_approval', {
      submitted_by: c.get('user').discord_id, submitted_at: now(), returned_by: null, returned_at: null, return_reason: null,
    })
    if (!ok) return conflict(c)
    void log(`📨 entry ${id(c)} · submitted by ${c.get('user').real_name}`)
    return reply(c, id(c))
  })
  .post('/entries/:id/reopen', (c) => {
    if (!transition(id(c), ['pending_approval'], 'draft_ready', { submitted_by: null, submitted_at: null })) return conflict(c)
    return reply(c, id(c))
  })
  .post('/entries/:id/approve', (c) => {
    const row = getRow(id(c))
    const user = c.get('user')
    if (!row || row.status !== 'pending_approval') return conflict(c)
    if (row.submitted_by === user.discord_id) return c.json({ error: 'cannot approve your own submission' }, 403)
    const note = NotebookEntry.parse(JSON.parse(row.entry as string))
    const at = now()
    transition(row.id, ['pending_approval'], 'approved', {
      approved_by: user.discord_id, approved_at: at, slug: uniqueSlug(row.date as string, note.title),
      rendered_md: renderMarkdown(note, { submitted_by: memberName(row.submitted_by as string), approved_by: user.real_name, approved_at: at }),
    })
    addRevision(row.id, row.submitted_by as string, 'submit', note)
    void log(`✅ entry ${row.id} · "${note.title}" approved by ${user.real_name}`)
    return reply(c, row.id)
  })
  .post('/entries/:id/return', async (c) => {
    const reason = String((await c.req.json()).reason ?? '').trim()
    const row = getRow(id(c))
    const user = c.get('user')
    if (!reason) return c.json({ error: 'reason required' }, 400)
    if (row?.submitted_by === user.discord_id) return c.json({ error: 'cannot return your own submission' }, 403)
    const ok = transition(id(c), ['pending_approval'], 'draft_ready', {
      returned_by: user.discord_id, returned_at: now(), return_reason: reason, submitted_by: null, submitted_at: null,
    })
    if (!ok) return conflict(c)
    void log(`↩️ entry ${id(c)} · returned by ${user.real_name}: ${reason}`)
    return reply(c, id(c))
  })

  .get('/entries/:id/export.md', (c) => {
    const row = getRow(id(c))
    if (!row?.entry) return c.notFound()
    const md = (row.rendered_md as string | null) ?? renderMarkdown(JSON.parse(row.entry as string))
    c.header('Content-Type', 'text/markdown; charset=utf-8')
    c.header('Content-Disposition', `attachment; filename="${row.date}-${row.slug ?? slugify(row.title as string)}.md"`)
    return c.body(md)
  })
  .get('/export.zip', (c) => {
    const files: Record<string, Uint8Array> = {}
    for (const entryId of (c.req.query('ids') ?? '').split(',').map(Number)) {
      const row = getRow(entryId)
      if (row?.status !== 'approved') continue
      files[`entries/${row.date}-${row.slug}.md`] = strToU8(row.rendered_md as string)
      const used = new Set((JSON.parse(row.entry as string) as NotebookEntry).sections.flatMap((s) => s.images.map((im) => im.attachment_id)))
      for (const a of attachmentsOf(row.id)) if (used.has(a.id) && a.small_path) files[`assets/${row.date}/${a.id}.jpg`] = readFileSync(a.small_path)
    }
    if (!Object.keys(files).length) return c.json({ error: 'no archived entries selected' }, 400)
    c.header('Content-Type', 'application/zip')
    c.header('Content-Disposition', `attachment; filename="glaucus-${today()}.zip"`)
    return c.body(zipSync(files, { level: 0 }))
  })
