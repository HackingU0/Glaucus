// End-to-end over app.request(): web entry → AI draft (mock model) → edit → submit → approve → admin edit → export.
// No real LLM, no Discord: dev login + MockLanguageModelV4. Run: npm test
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { unzipSync } from 'fflate'
import sharp from 'sharp'
import { MockLanguageModelV4 } from 'ai/test'

Object.assign(process.env, {
  CONFIG: 'config.example.toml', DATA_DIR: mkdtempSync(`${tmpdir()}/glaucus-`), COOKIE_SECRET: 'test', DEV_LOGIN: '1',
})
const { app } = await import('./main.ts')
const { setModel } = await import('./agent.ts')
const { slugify } = await import('./render.ts')

const NOTE = {
  title: 'Intake wheel test', date: 'ignored', start_time: '15:00', end_time: '',
  attendees: ['Alice Chen'], goals: ['Pick intake wheels'], next_steps: ['Retest at 0.6 power'],
  sections: [{
    subsystem: 'Intake', work_done: 'Tested compliant wheels.', problems: [], test_results: '9/10 intakes',
    decisions: [{ decision: 'Use compliant wheels', alternatives_considered: ['REV wheels'], rationale: 'Most consistent.' }],
    images: [{ attachment_id: 1, caption: 'Test rig' }, { attachment_id: 999, caption: 'not ours' }],
  }],
}
const reply = (text: string) => ({
  content: [{ type: 'text' as const, text }], warnings: [],
  finishReason: { unified: 'stop' as const, raw: undefined },
  usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
})
// Not JSON, then JSON that fails the schema → the agent must retry each time and accept the third.
const model = new MockLanguageModelV4({ doGenerate: [reply('sure! here it is'), reply('{"title": 1}'), reply(JSON.stringify(NOTE))] })
setModel(model)

async function login(id: string, name: string, admin = false) {
  const r = await app.request(`/auth/dev?id=${id}&name=${encodeURIComponent(name)}&admin=${admin ? 1 : 0}`)
  return r.headers.get('set-cookie')!.split(';')[0]
}
const as = (cookie: string) => async (path: string, init: RequestInit & { json?: unknown } = {}) => {
  const r = await app.request(path, {
    ...init,
    headers: { cookie, ...(init.json !== undefined && { 'content-type': 'application/json' }) },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  })
  const body: any = r.headers.get('content-type')?.includes('json') ? await r.json() : null
  return { status: r.status, r, body }
}

test('slugify', () => {
  assert.equal(slugify('Intake: v2 (goBILDA)!'), 'intake-v2-gobilda')
  assert.equal(slugify('全是中文'), 'entry')
  assert.ok(slugify('a'.repeat(100)).length <= 60)
})

test('login is required for api and files', async () => {
  assert.equal((await app.request('/api/entries')).status, 401)
  assert.equal((await app.request('/files/1')).status, 401)
})

test('draft → submit → approve → admin edit → export', async () => {
  const alice = as(await login('alice', 'Alice Chen'))
  const bob = as(await login('bob', 'Bob Li'))
  const carol = as(await login('carol', 'Carol Wu', true))

  const form = new FormData()
  form.set('text', '今天调 intake，compliant 轮 10 次成功 9 次')
  form.set('date', '2026-11-02')
  const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#888' } }).png().toBuffer()
  form.append('files', new File([new Uint8Array(png)], 'rig.png', { type: 'image/png' }))
  form.append('files', new File(['%PDF-1.4'], 'spec.pdf', { type: 'application/pdf' }))
  let { status, body: e } = await alice('/api/entries', { method: 'POST', body: form })
  assert.equal(status, 200)
  assert.equal(e.status, 'drafting')
  assert.deepEqual(e.attachments.map((a: { url: string | null }) => !!a.url), [true, false])

  for (let i = 0; i < 50 && e.status === 'drafting'; i++) {
    await new Promise((r) => setTimeout(r, 20))
    e = (await alice(`/api/entries/${e.id}`)).body
  }
  assert.equal(e.status, 'draft_ready', e.error)
  assert.equal(model.doGenerateCalls.length, 3, 'retried after each invalid output')
  assert.equal(e.entry.date, '2026-11-02', 'date comes from the entry, not the model')
  assert.deepEqual(e.entry.sections[0].images.map((im: { attachment_id: number }) => im.attachment_id), [1], 'foreign attachment ids dropped')
  assert.equal(e.created_by, 'Alice Chen')

  assert.equal((await alice(`/files/${e.attachments[0].id}`)).r.headers.get('content-type'), 'image/jpeg')
  assert.equal((await alice(`/files/${e.attachments[1].id}?orig=1`)).r.headers.get('content-disposition')?.startsWith('attachment'), true)

  const edited = { ...e.entry, title: 'Intake compliant wheel test' }
  assert.equal((await bob(`/api/entries/${e.id}`, { method: 'PUT', json: { entry: edited, version: e.version - 1 } })).status, 409)
  ;({ body: e } = await bob(`/api/entries/${e.id}`, { method: 'PUT', json: { entry: edited, version: e.version } }))
  assert.equal(e.title, 'Intake compliant wheel test')

  ;({ body: e } = await alice(`/api/entries/${e.id}/submit`, { method: 'POST' }))
  assert.equal(e.status, 'pending_approval')
  assert.equal((await alice(`/api/entries/${e.id}/approve`, { method: 'POST' })).status, 403, 'submitter cannot approve')

  ;({ body: e } = await alice(`/api/entries/${e.id}`, { method: 'PUT', json: { entry: e.entry, version: e.version } }))
  assert.deepEqual([e.status, e.submitted_by], ['draft_ready', null], 'editing a pending entry withdraws it')
  ;({ body: e } = await alice(`/api/entries/${e.id}/submit`, { method: 'POST' }))

  assert.equal((await bob(`/api/entries/${e.id}/return`, { method: 'POST', json: { reason: ' ' } })).status, 400, 'a return needs a reason')
  ;({ body: e } = await bob(`/api/entries/${e.id}/return`, { method: 'POST', json: { reason: 'add end time' } }))
  assert.deepEqual([e.status, e.returned.by, e.submitted_by], ['draft_ready', 'Bob Li', null])
  ;({ body: e } = await alice(`/api/entries/${e.id}/submit`, { method: 'POST' }))
  ;({ body: e } = await bob(`/api/entries/${e.id}/approve`, { method: 'POST' }))
  assert.deepEqual([e.status, e.approved_by, e.revisions.length], ['approved', 'Bob Li', 1])

  assert.equal((await alice(`/api/entries/${e.id}`, { method: 'PUT', json: { entry: e.entry, version: e.version } })).status, 403)
  ;({ body: e } = await carol(`/api/entries/${e.id}`, { method: 'PUT', json: { entry: { ...e.entry, end_time: '17:00' }, version: e.version } }))
  assert.deepEqual([e.status, e.revisions.length, e.revisions[0].what, e.revisions[1].entry.end_time], ['approved', 2, 'admin_edit', ''])

  const md = await (await alice(`/api/entries/${e.id}/export.md`)).r.text()
  assert.match(md, /^# Intake compliant wheel test$/m)
  assert.match(md, /15:00–17:00/)
  assert.match(md, /\(\.\.\/assets\/2026-11-02\/1\.jpg\)/)
  const zip = await alice(`/api/export.zip?ids=${e.id}`)
  assert.equal(zip.r.headers.get('content-type'), 'application/zip')
  assert.deepEqual(Object.keys(unzipSync(new Uint8Array(await zip.r.arrayBuffer()))).sort(), [
    'assets/2026-11-02/1.jpg', 'entries/2026-11-02-intake-compliant-wheel-test.md',
  ])
})

test('a registered name reaches sources and open notes, not approved ones', async () => {
  const { db } = await import('./db.ts')
  const dana = as(await login('dana', ''))
  const carol = as(await login('carol', 'Carol Wu', true))
  const insert = (status: string) => Number(db.prepare(`insert into entries (kind, status, date, created_by, created_at, title, entry, source_messages)
                                                        values ('session', ?, '2026-11-05', 'dana', '2026-11-05 00:00', 'T', ?, ?)`)
    .run(status, JSON.stringify({ ...NOTE, attendees: ['dana', 'Dana D', 'Bob Li'] }),
      JSON.stringify([{ id: '1', author_id: 'dana', author: 'Dana D', at: '2026-11-05 00:00', content: 'x', attachment_ids: [] }])).lastInsertRowid)
  const open = insert('draft_ready')
  const approved = insert('approved')

  assert.equal((await dana('/api/me', { method: 'POST', json: { real_name: 'Dana Diaz' } })).status, 204)
  let entry = (await dana(`/api/entries/${open}`)).body
  assert.equal(entry.source_messages[0].author, 'Dana Diaz')
  assert.deepEqual(entry.entry.attendees, ['Dana Diaz', 'Bob Li']) // two old names become one person
  assert.deepEqual((await dana(`/api/entries/${approved}`)).body.entry.attendees, ['dana', 'Dana D', 'Bob Li'])

  assert.equal((await carol('/api/members/dana', { method: 'PUT', json: { real_name: 'Dana Q' } })).status, 204)
  entry = (await dana(`/api/entries/${open}`)).body
  assert.equal(entry.source_messages[0].author, 'Dana Q')
  assert.deepEqual(entry.entry.attendees, ['Dana Q', 'Bob Li'])
})

test('AI usage: counted for whoever triggered it, invalid replies too, and only bot-admins can read it', async () => {
  const { db } = await import('./db.ts')
  db.exec('delete from ai_usage')
  const dee = as(await login('dee', 'Dee Ng'))
  const eve = as(await login('eve', 'Eve Ho'))
  const admin = as(await login('carol', 'Carol Wu', true))
  const replyCosting = (text: string, input: number, output: number) => ({ ...reply(text), usage: { inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: output, text: output, reasoning: 0 } } })
  const settled = async (read: typeof dee, id: number) => {
    for (let i = 0; i < 100; i++) {
      const { body } = await read(`/api/entries/${id}`)
      if (body.status !== 'drafting') return body
      await new Promise((r) => setTimeout(r, 5))
    }
    throw new Error('still drafting')
  }

  // Dee's draft: one invalid reply, then a valid one. Both cost tokens.
  setModel(new MockLanguageModelV4({ doGenerate: [replyCosting('not json', 100, 10), replyCosting(JSON.stringify(NOTE), 200, 20)] }))
  const form = new FormData()
  form.set('text', 'usage test')
  const { body: entry } = await dee('/api/entries', { method: 'POST', body: form })
  await settled(dee, entry.id)

  // Eve revises Dee's note: Eve's tokens, not Dee's.
  setModel(new MockLanguageModelV4({ doGenerate: [replyCosting(JSON.stringify(NOTE), 1000, 500)] }))
  assert.equal((await eve(`/api/entries/${entry.id}/revise`, { method: 'POST', json: { instruction: 'tighten it' } })).status, 200)
  await settled(eve, entry.id)

  assert.equal((await dee('/api/usage')).status, 403)
  const { body: rows } = await admin('/api/usage')
  assert.deepEqual(rows.map((r: any) => [r.name, r.month, r.month_calls]), [['Eve Ho', 1500, 1], ['Dee Ng', 330, 2]], 'busiest first')
  const eveRow = rows[0]
  assert.deepEqual([eveRow.today, eveRow.week, eveRow.total], [1500, 1500, 1500])

  // Older use only reaches the wider periods.
  const stored = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400_000).toLocaleString('sv', { timeZone: 'America/Los_Angeles' }).slice(0, 16)
  const old = db.prepare(`insert into ai_usage (member_id, entry_id, input_tokens, output_tokens, at) values ('eve', null, 7, 0, ?)`)
  old.run(stored(3))
  old.run(stored(20))
  old.run(stored(90))
  const [after] = (await admin('/api/usage')).body
  assert.deepEqual([after.today, after.week, after.month, after.total], [1500, 1507, 1514, 1521])
  assert.equal(after.month_calls, 3)

  // Someone who never logged in still shows up, under their id.
  db.prepare(`insert into ai_usage (member_id, entry_id, input_tokens, output_tokens, at) values ('stranger', null, 1, 1, ?)`).run(stored(0))
  assert.ok((await admin('/api/usage')).body.some((r: any) => r.name === 'stranger'))
})
