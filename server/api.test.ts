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
