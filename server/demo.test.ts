// Demo mode: no Discord, test accounts, sample data, canned AI. Run: npm test
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { NotebookEntry } from '../shared/entry.ts'

Object.assign(process.env, {
  CONFIG: 'config.example.toml', DATA_DIR: mkdtempSync(`${tmpdir()}/vibedoc-`), COOKIE_SECRET: 'test', DEV_LOGIN: '1', LLM_API_KEY: '',
})
const { app } = await import('./main.ts')
const { config } = await import('./config.ts')
const { cannedDraft, startDemo } = await import('./demo.ts')
await startDemo()

/** Logs in exactly the way the login page does: follow the link it renders for that account. */
async function asAccount(id: string) {
  const accounts = (await (await app.request('/auth/dev-users')).json()) as { id: string; admin: number }[]
  const a = accounts.find((x) => x.id === id)!
  const r = await app.request(`/auth/dev?id=${a.id}&admin=${a.admin}`)
  assert.equal(r.headers.get('location'), '/', 'seeded accounts skip /register')
  const cookie = r.headers.get('set-cookie')!.split(';')[0]
  return async (path: string, init: RequestInit & { json?: unknown } = {}) => {
    const res = await app.request(path, {
      ...init,
      headers: { cookie, ...(init.json !== undefined && { 'content-type': 'application/json' }) },
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    })
    return { status: res.status, res, body: (res.headers.get('content-type')?.includes('json') ? await res.json() : null) as any }
  }
}

test('login page gets accounts, and Discord is out of the loop', async () => {
  const accounts = (await (await app.request('/auth/dev-users')).json()) as { id: string; name: string; admin: number }[]
  assert.deepEqual(accounts.slice(0, 2).map((a) => [a.name, a.admin]), [['Carol Wu', 1], ['Eli Xiao', 1]], 'admins first')
  assert.equal(accounts.length, 7)
  assert.equal((await app.request('/auth/login')).headers.get('location'), '/login')
})

test('the api is still closed without a login', async () => {
  assert.equal((await app.request('/api/entries')).status, 401)
})

test('DEV_LOGIN off: no test accounts, Discord login is back', async () => {
  config.devLogin = false
  try {
    assert.equal((await app.request('/auth/dev-users')).status, 404)
    assert.equal((await app.request('/auth/dev?id=eli&admin=1')).status, 404)
    assert.match((await app.request('/auth/login')).headers.get('location')!, /^https:\/\/discord\.com\/oauth2\/authorize/)
  } finally {
    config.devLogin = true
  }
})

test('sample data is valid, covers each state, and seeds only once', async () => {
  const eli = await asAccount('eli')
  const { body: list } = await eli('/api/entries')
  await startDemo()
  assert.equal((await eli('/api/entries')).body.length, list.length, 'second start does not duplicate')
  assert.doesNotMatch(JSON.stringify(list), /[　-〿㐀-鿿＀-￯]/, 'sample data is English-only')
  assert.deepEqual(
    [...new Set(list.map((e: { status: string }) => e.status))].sort(),
    ['approved', 'collecting', 'discarded', 'draft_ready', 'drafting', 'pending_approval'],
  )
  for (const e of list) {
    if (e.entry) NotebookEntry.parse(e.entry)
    const own = e.attachments.map((a: { id: number }) => a.id)
    const used = [
      ...(e.entry?.sections ?? []).flatMap((s: { images: { attachment_id: number }[] }) => s.images.map((im) => im.attachment_id)),
      ...e.source_messages.flatMap((m: { attachment_ids: number[] }) => m.attachment_ids),
    ]
    for (const id of used) assert.ok(own.includes(id), `entry ${e.id}: attachment ${id} is not its own`)
  }
  const withImage = list.find((e: { attachments: unknown[] }) => e.attachments.length)
  assert.equal((await eli(withImage.attachments[0].url)).res.headers.get('content-type'), 'image/jpeg')
  const archived = list.find((e: { status: string }) => e.status === 'approved')
  assert.match(await (await eli(`/api/entries/${archived.id}/export.md`)).res.text(), new RegExp(`^# ${archived.title}$`, 'm'))
})

test('canned AI: fresh draft keeps the notes and invents nothing; revise changes only what was asked', () => {
  const fresh = cannedDraft('Date: 2026-11-04\n\nNotes:\ndrivetrain chain snapped\nreplaced it\n\nAttachments:\n#7 a.jpg (image attached below)\n#8 b.pdf (not shown)')
  NotebookEntry.parse(fresh)
  assert.equal(fresh.title, 'drivetrain chain snapped')
  assert.equal(fresh.sections[0].subsystem, 'Drivetrain')
  assert.equal(fresh.sections[0].work_done, 'drivetrain chain snapped\nreplaced it')
  assert.deepEqual(fresh.sections[0].images, [{ attachment_id: 7, caption: 'a.jpg' }])
  assert.deepEqual(fresh.next_steps, ['[needs input]'])

  const revised = cannedDraft(`Notes:\nx\n\nAttachments:\n(none)\n\nCurrent draft:\n${JSON.stringify(fresh)}\n\nChange it as follows, keep everything else: add a retest`)
  assert.deepEqual(revised, { ...fresh, next_steps: ['[needs input]', 'add a retest'] })
})

test('demo flow: new entry → canned draft → submit → another member approves', async () => {
  const alice = await asAccount('alice')
  const carol = await asAccount('carol')
  const form = new FormData()
  form.set('text', '今天换了 intake 的轮子')
  form.set('date', '2026-11-04')
  let { body: e } = await alice('/api/entries', { method: 'POST', body: form })
  assert.equal(e.status, 'drafting')
  for (let i = 0; i < 40 && e.status === 'drafting' && !e.failed_step; i++) {
    await new Promise((r) => setTimeout(r, 100))
    e = (await alice(`/api/entries/${e.id}`)).body
  }
  assert.equal(e.status, 'draft_ready', e.error)
  assert.equal(e.entry.sections[0].work_done, '今天换了 intake 的轮子')
  ;({ body: e } = await alice(`/api/entries/${e.id}/submit`, { method: 'POST' }))
  ;({ body: e } = await carol(`/api/entries/${e.id}/approve`, { method: 'POST' }))
  assert.equal(e.status, 'approved')
})
