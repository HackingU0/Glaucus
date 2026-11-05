// The branching behind Discord collection, without Discord (plan.md §7). Run: npm test
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { MockLanguageModelV4 } from 'ai/test'

Object.assign(process.env, { CONFIG: 'config.example.toml', DATA_DIR: mkdtempSync(`${tmpdir()}/glaucus-`), COOKIE_SECRET: 'test' })
const c = await import('./collect.ts')
const { setModel } = await import('./agent.ts')
const { db, getRow, transition } = await import('./db.ts')
const { markInterrupted, runAgent } = await import('./jobs.ts')

const NOTE = { title: 'T', date: 'x', start_time: '', end_time: '', attendees: ['A'], goals: [], next_steps: [], sections: [] }
const reply = (text: string) => ({
  content: [{ type: 'text' as const, text }], warnings: [],
  finishReason: { unified: 'stop' as const, raw: undefined },
  usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
})
const answer = (text: string) => setModel(new MockLanguageModelV4({ doGenerate: async () => reply(text) }))

const msg = (id: string, content = `m${id}`, attachments: { url: string; filename: string; mime: string }[] = []) =>
  ({ id, authorId: 'u1', authorName: 'Alice', at: '2026-11-04 10:00', content, attachments })
const session = (channelId: string) => c.openSession({ channelId, channelName: `#${channelId}`, userId: 'u1', subsystem: null }).id!

test('resolveMentions: real names in, the bot out', () => {
  const name = (id: string) => ({ '1': 'Alice Chen' })[id]
  assert.equal(c.resolveMentions('<@9> ask <@1> and <@!2>', '9', name), 'ask @Alice Chen and @unknown')
})

test('one session per channel, channels run side by side', () => {
  const first = c.openSession({ channelId: 'a', channelName: '#a', userId: 'u1', subsystem: 'Intake' })
  assert.ok(first.id)
  assert.equal(getRow(first.id!)!.source_text, 'Subsystem: Intake')
  assert.equal(c.openSession({ channelId: 'a', channelName: '#a', userId: 'u2', subsystem: null }).existing!.id, first.id)
  assert.ok(c.openSession({ channelId: 'b', channelName: '#b', userId: 'u2', subsystem: null }).id)
  assert.throws(() => db.prepare(`insert into entries (kind, status, channel_id, date, created_by, created_at) values ('session', 'collecting', 'a', 'd', 'u', 'n')`).run(), 'the index is the backstop')
})

test('addMessages skips what it has, keeps time order, and resumes after a failed download', async () => {
  const id = session('resume')
  await c.addMessages(id, [msg('20')])
  await c.addMessages(id, [msg('10'), msg('20', 'edited later: ignored')])
  assert.deepEqual(c.sourcesOf(id).map((m) => [m.id, m.content]), [['10', 'm10'], ['20', 'm20']])

  const file = { url: 'u', filename: 'a.pdf', mime: 'application/pdf' }
  const broken = async () => { throw new Error('boom') }
  await assert.rejects(c.addMessages(id, [msg('30'), msg('40', 'x', [file]), msg('50')], broken), /boom/)
  assert.deepEqual(c.sourcesOf(id).map((m) => m.id), ['10', '20', '30'], 'stops at the failure with no half-saved message')
  assert.equal(db.prepare('select count(*) n from attachments where entry_id = ?').get(id)!.n, 0)

  await c.addMessages(id, [msg('30'), msg('40', 'x', [file]), msg('50')], async () => new Uint8Array([1]))
  const list = c.sourcesOf(id)
  assert.deepEqual(list.map((m) => m.id), ['10', '20', '30', '40', '50'])
  assert.equal(list[3].attachment_ids.length, 1)
})

test('sealSession: an empty session is discarded, one with messages goes on', async () => {
  const empty = session('empty')
  assert.ok(transition(empty, ['collecting'], 'drafting'))
  assert.equal(c.sealSession(empty), false)
  assert.equal(getRow(empty)!.status, 'discarded')
  assert.ok(c.openSession({ channelId: 'empty', channelName: '#empty', userId: 'u1', subsystem: null }).id, 'the channel is free again')

  const full = session('full')
  await c.addMessages(full, [msg('1')])
  transition(full, ['collecting'], 'drafting')
  c.failCollect(full, new Error('nope'))
  assert.equal(getRow(full)!.failed_step, 'attachments')
  assert.equal(c.sealSession(full), true)
  const row = getRow(full)!
  assert.deepEqual([row.status, row.failed_step, !!row.ended_at], ['drafting', null, true])
})

test('a restart tells an unfinished collection from an unfinished draft', async () => {
  const collecting = session('restart1')
  transition(collecting, ['collecting'], 'drafting')
  const drafting = session('restart2')
  await c.addMessages(drafting, [msg('1')])
  transition(drafting, ['collecting'], 'drafting')
  c.sealSession(drafting)
  markInterrupted()
  assert.equal(getRow(collecting)!.failed_step, 'attachments')
  assert.equal(getRow(drafting)!.failed_step, 'interrupted')
})

test('quick notes: one open per day, new messages merge, a submitted one starts over', async () => {
  answer(JSON.stringify(NOTE))
  const id = c.openQuick('u1')
  assert.equal(c.openQuick('u2'), id)
  await c.addMessages(id, [msg('1')])
  await c.draftQuick(id)
  assert.equal(getRow(id)!.status, 'draft_ready')

  await c.addMessages(id, [msg('2')])
  const merge = c.draftQuick(id)
  assert.match(getRow(id)!.revising as string, /Merge/)
  assert.equal(getRow(id)!.status, 'drafting')
  await merge
  assert.deepEqual([getRow(id)!.status, getRow(id)!.revising], ['draft_ready', null])

  transition(id, ['draft_ready'], 'pending_approval')
  assert.notEqual(c.openQuick('u1'), id)
})

test('a merge queued behind a running job still ends in a draft, and a submitted note is left alone', async () => {
  answer(JSON.stringify(NOTE))
  const id = session('queue')
  await c.addMessages(id, [msg('1')])
  transition(id, ['collecting'], 'drafting')
  const first = runAgent(id)
  const second = runAgent(id, 'merge')
  await first
  await second
  assert.equal(getRow(id)!.status, 'draft_ready')

  transition(id, ['draft_ready'], 'pending_approval')
  const version = getRow(id)!.version
  await runAgent(id, 'merge')
  assert.deepEqual([getRow(id)!.status, getRow(id)!.version], ['pending_approval', version])
})

test('selectMessages: the mention always stays, the model adds context, and failing costs only context', async () => {
  const list = [msg('1', 'unrelated'), msg('2', 'chain snapped'), msg('3', '')]
  answer('{"numbers": [1, 99]}')
  assert.deepEqual((await c.selectMessages(list, ['3'])).map((m) => m.id), ['2'], 'a bare mention itself has nothing to save')
  answer('{"numbers": [1]}')
  assert.deepEqual((await c.selectMessages([msg('2'), msg('4', 'note this')], ['4'])).map((m) => m.id), ['4'])
  answer('not json')
  const mention = msg('5', 'note this')
  assert.deepEqual((await c.selectMessages([msg('2'), mention], ['5'])).map((m) => m.id), ['5'])
})

test('unregisteredAuthors lists each author without a real name once', () => {
  db.prepare(`insert into members (discord_id, real_name) values ('reg', 'Reg Istered')`).run()
  c.ensureMember('new', 'newbie')
  const of = (authorId: string) => ({ ...msg('1'), authorId })
  assert.deepEqual(c.unregisteredAuthors([of('reg'), of('new'), of('new'), of('never')]), ['new', 'never'])
})

test('an unregistered author who started the session reaches the model under one name', async () => {
  c.ensureMember('u9', 'eliqi')
  const id = c.openSession({ channelId: 'one-name', channelName: '#one-name', userId: 'u9', subsystem: null }).id!
  await c.addMessages(id, [{ ...msg('900'), authorId: 'u9', authorName: 'HackingU0' }])
  assert.equal(c.sourcesOf(id)[0].author_id, 'u9')
  transition(id, ['collecting'], 'drafting')
  let prompt = ''
  setModel(new MockLanguageModelV4({ doGenerate: async (o) => { prompt = JSON.stringify(o.prompt); return reply(JSON.stringify(NOTE)) } }))
  await runAgent(id)
  assert.match(prompt, /Entered by: HackingU0/)
  assert.doesNotMatch(prompt, /eliqi/)
})

test('/continue: a reopened session merges new messages, skips the AI without any, and respects submit and the channel limit', async () => {
  const id = session('cont')
  await c.addMessages(id, [msg('1000')])
  const end = () => { transition(id, ['collecting'], 'drafting'); c.sealSession(id) }
  end()
  answer(JSON.stringify(NOTE))
  await c.draftSession(id, 0)
  assert.equal(getRow(id)!.status, 'draft_ready')
  db.prepare('update entries set thread_id = ? where id = ?').run('t-cont', id)
  assert.equal(c.lastSession('cont')!.id, id)
  assert.equal(c.sessionOfThread('t-cont')!.id, id)

  const other = session('cont')
  assert.equal(c.reopenSession(getRow(id)!).running!.id, other, 'one session per channel')
  transition(other, ['collecting'], 'discarded')

  assert.ok(c.reopenSession(getRow(id)!).reopened)
  assert.equal(getRow(id)!.status, 'collecting')
  assert.equal(getRow(id)!.ended_at, null)

  end() // nothing new: same draft, no AI
  let calls = 0
  let prompt = ''
  setModel(new MockLanguageModelV4({ doGenerate: async (o) => { calls++; prompt = JSON.stringify(o.prompt); return reply(JSON.stringify({ ...NOTE, title: 'Merged' })) } }))
  await c.draftSession(id, c.sourcesOf(id).length)
  assert.equal(calls, 0)
  assert.equal(getRow(id)!.status, 'draft_ready')
  assert.ok(getRow(id)!.ended_at)

  c.reopenSession(getRow(id)!)
  const before = c.sourcesOf(id).length
  await c.addMessages(id, [msg('1001', 'new finding')])
  end()
  await c.draftSession(id, before)
  assert.equal(calls, 1)
  assert.match(prompt, /Merge the new messages/)
  assert.match(prompt, /new finding/)
  assert.equal(getRow(id)!.title, 'Merged')

  transition(id, ['draft_ready'], 'pending_approval')
  assert.ok(!c.reopenSession(getRow(id)!).reopened)
  assert.equal(getRow(id)!.status, 'pending_approval')
})

test('a running session only picks from messages since it started, plus the mention and its reply target', async () => {
  let prompt = ''
  let calls = 0
  setModel(new MockLanguageModelV4({ doGenerate: async (o) => { calls++; prompt = JSON.stringify(o.prompt); return reply('{"numbers": [0, 1, 2, 3]}') } }))
  const ids = (msgs: { id: string }[]) => msgs.map((m) => m.id)
  const all = [msg('100', 'before the session'), msg('150', 'replied to, also before'), msg('300', 'during the session'), msg('400', 'the mention')]

  assert.deepEqual(ids(await c.selectMessages(all, ['400', '150'], '200')), ['150', '300', '400'])
  assert.doesNotMatch(prompt, /before the session/)

  calls = 0
  assert.deepEqual(ids(await c.selectMessages([all[0], all[3]], ['400'], '200')), ['400'])
  assert.equal(calls, 0, 'nothing left to choose from, so no AI call')

  assert.deepEqual(ids(await c.selectMessages(all, ['400'])), ['100', '150', '300', '400'], 'without a session, older context is still offered')
})

test('AI usage: a mention counts for whoever mentioned the bot, an idle end for the session creator, and an explicit end for who ended it', async () => {
  const totals = () => Object.fromEntries((db.prepare('select member_id, sum(input_tokens + output_tokens) n from ai_usage group by member_id').all() as { member_id: string; n: number }[]).map((r) => [r.member_id, r.n]))
  db.exec('delete from ai_usage')
  answer('{"numbers": [0, 1]}') // the mock reports 1 + 1 tokens per call
  await c.selectMessages([{ ...msg('800'), authorId: 'context-author' }, { ...msg('801'), authorId: 'mentioner' }], ['801'])
  assert.deepEqual(totals(), { mentioner: 2 })

  db.exec('delete from ai_usage')
  answer(JSON.stringify(NOTE))
  const idle = session('usage-idle')
  await c.addMessages(idle, [msg('810')])
  transition(idle, ['collecting'], 'drafting')
  c.sealSession(idle)
  await c.draftSession(idle, 0)
  assert.deepEqual(totals(), { u1: 2 }, 'the session creator')

  const ended = session('usage-ended')
  await c.addMessages(ended, [msg('820')])
  transition(ended, ['collecting'], 'drafting')
  c.sealSession(ended)
  await c.draftSession(ended, 0, 'ender')
  assert.deepEqual(totals(), { u1: 2, ender: 2 })
})

test('chat: the goose answers or says it is a note, counts tokens for whoever mentioned him, and never throws', async () => {
  const { chat } = await import('./agent.ts')
  const who = { memberId: 'chatter', server: 'Team 5898' }
  const turns = [{ author: 'Alice', content: 'the intake jammed again' }, { author: 'Glaucus', content: 'Honk. Again?', you: true }, { author: 'Bob', content: 'what do you think?' }]
  db.exec('delete from ai_usage')

  let prompt = ''
  setModel(new MockLanguageModelV4({ doGenerate: async (o) => { prompt = JSON.stringify(o.prompt); return reply('{"action": "chat", "reply": "  We should check the rollers.  "}') } }))
  assert.deepEqual(await chat(turns, who), { action: 'chat', reply: 'We should check the rollers.' })
  assert.match(prompt, /You are Glaucus, a goose/)
  assert.match(prompt, /Discord server: Team 5898/)
  assert.match(prompt, /Alice: the intake jammed again/)
  assert.match(prompt, /You \(Glaucus\): Honk\. Again\?/)
  assert.deepEqual(db.prepare('select member_id, entry_id, input_tokens, output_tokens from ai_usage').all().map((r) => ({ ...r })), [{ member_id: 'chatter', entry_id: null, input_tokens: 1, output_tokens: 1 }])

  answer('{"action": "record", "reply": ""}')
  assert.deepEqual(await chat(turns, who), { action: 'record', reply: '' })
  answer('{"action": "record"}')
  assert.equal((await chat(turns, who))!.action, 'record', 'reply may be left out')

  await chat([{ author: 'Bob', content: '' }], who)
  assert.match(prompt, /You are Glaucus/)

  answer('{"action": "chat", "reply": "   "}')
  assert.equal(await chat(turns, who), null, 'an empty answer is no answer')
  answer('honk honk, not JSON')
  assert.equal(await chat(turns, who), null)
  setModel(new MockLanguageModelV4({ doGenerate: async () => { throw new Error('provider down') } }))
  assert.equal(await chat(turns, who), null)
  assert.ok((db.prepare(`select count(*) n from ai_usage where member_id = 'chatter'`).get() as { n: number }).n >= 5, 'invalid replies count too')
})
