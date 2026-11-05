// First run and role checks (design.md §8), with Discord and the LLM stubbed. Run: npm test
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { test } from 'node:test'

const dataDir = mkdtempSync(`${tmpdir()}/glaucus-`)
Object.assign(process.env, { CONFIG: `${dataDir}/no-such-file.toml`, DATA_DIR: dataDir })
for (const name of ['COOKIE_SECRET', 'DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_SECRET', 'LLM_API_KEY', 'DEV_LOGIN']) delete process.env[name]
const { app } = await import('./main.ts')
const { announceSetup, setBotStarter } = await import('./setup.ts')
const { config, isAllowed, needsSetup } = await import('./config.ts')

const GUILD = '100'
const COACH = '201'
const TEAM = '202'
const ADMIN = '203'
const OTHER = '204'
const SITE = 'https://notes.example.org'

let botStarts = 0
setBotStarter(async () => { botStarts++ })
let token = ''
const realLog = console.log
console.log = (line: unknown) => { token = /\n {2}(\w+)\n/.exec(String(line))?.[1] ?? token }
announceSetup()
console.log = realLog

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const roleOf = { coach: [COACH], team: [TEAM, OTHER], boss: [ADMIN], outsider: [OTHER] } as Record<string, string[]>
let oauthUser = 'coach'
let llmWorks = true
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input)
  const path = url.replace('https://discord.com/api/v10', '')
  if (url.startsWith('https://llm.test/')) {
    if (!llmWorks) return json({ error: { message: 'bad key' } }, 401)
    return json({ id: 'x', created: 1, model: 'm', choices: [{ index: 0, message: { role: 'assistant', content: '{"ok": true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } })
  }
  if (path === '/applications/@me') {
    return (init?.headers as Record<string, string>).Authorization === 'Bot good-bot' ? json({ id: '999', name: 'Glaucus', flags: 1 << 19, redirect_uris: [`${SITE}/auth/callback`] }) : json({}, 401)
  }
  if (path === '/oauth2/token') {
    const form = init!.body as URLSearchParams
    if (form.get('grant_type') === 'client_credentials') return json({}, form.get('client_secret') === 'good-secret' ? 200 : 401)
    return json({ access_token: 'user-token' })
  }
  if (path === '/users/@me') return json((init?.headers as Record<string, string>).Authorization.startsWith('Bearer') ? { id: oauthUser, username: oauthUser } : { id: '999' })
  if (path === '/users/@me/guilds') return json([{ id: GUILD, name: 'Team' }])
  if (path === `/guilds/${GUILD}/roles`) {
    return json([
      { id: GUILD, name: '@everyone', permissions: '0' }, { id: COACH, name: 'Coach', permissions: '0' }, { id: TEAM, name: 'Team 5898', permissions: '0' },
      { id: ADMIN, name: 'Admin', permissions: '0' }, { id: OTHER, name: 'Other', permissions: '0' }, { id: '205', name: 'Bot role', managed: true, permissions: String((1n << 10n) | (1n << 11n) | (1n << 16n)) },
    ])
  }
  if (path === `/guilds/${GUILD}/channels`) return json([{ id: '301', name: 'general', type: 0 }, { id: '302', name: 'voice', type: 2 }])
  if (path === `/guilds/${GUILD}/members/999`) return json({ roles: ['205'] })
  if (path.startsWith(`/guilds/${GUILD}/members/search`)) {
    return json(Object.keys(roleOf).filter((n) => n.startsWith(new URL(url).searchParams.get('query')!)).map((n) => ({ roles: roleOf[n], user: { id: n, username: n } })))
  }
  const member = path.match(/^\/guilds\/100\/members\/(\w+)$/)?.[1]
  if (member) return roleOf[member] ? json({ roles: roleOf[member] }) : json({}, 404)
  throw new Error(`unexpected fetch: ${url}`)
}) as typeof fetch

const call = (path: string, body?: unknown, t = token) => app.request(`/api/setup${path}`, {
  method: body ? 'POST' : 'GET',
  headers: { 'x-setup-token': t, 'content-type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
})
const form = (over: { discord?: object; llm?: object } = {}) => ({
  site_url: `${SITE}/`, timezone: 'America/New_York',
  llm: { base_url: 'https://llm.test/v1', model: 'm', key: 'good-key', ...over.llm },
  discord: { bot_token: 'good-bot', client_secret: 'good-secret', guild_id: GUILD, admin_role_id: ADMIN, allowed_role_ids: [COACH, TEAM], log_channel_id: '', ...over.discord },
})

test('a new server starts empty, asks for setup and only trusts the token from its logs', async () => {
  assert.ok(needsSetup())
  assert.ok(config.cookieSecret, 'generated')
  assert.equal(statSync(`${dataDir}/settings.json`).mode & 0o777, 0o600)
  assert.deepEqual(await (await call('/status', undefined, '')).json(), { needed: true })
  assert.equal((await app.request('/auth/login')).headers.get('location'), '/setup')
  assert.ok(token, 'printed to the logs')
  for (const wrong of ['', 'nope']) {
    assert.equal((await call('/state', undefined, wrong)).status, 401)
    assert.equal((await call('', form(), wrong)).status, 401)
    assert.equal((await call('/test/discord', form(), wrong)).status, 401)
  }
  assert.equal((await call('/state')).status, 200)
})

test('tests report what works, and only list roles people can hold', async () => {
  assert.deepEqual(await (await call('/test/llm', form())).json(), { ok: true })
  llmWorks = false
  assert.equal(((await (await call('/test/llm', form())).json()) as { ok: boolean }).ok, false)
  llmWorks = true

  const bad = (await (await call('/test/discord', form({ discord: { bot_token: 'bad' } }))).json()) as { ok: boolean }
  assert.equal(bad.ok, false)
  const d = (await (await call('/test/discord', form({ discord: { client_secret: 'bad', guild_id: '' } }))).json()) as any
  assert.equal(d.ok, true)
  assert.equal(d.secret_ok, false)
  assert.equal(d.message_content, true)
  assert.equal(d.redirect_ok, true, 'a trailing slash on the site URL still matches')
  assert.equal(d.guild.id, GUILD, 'the only server is chosen')
  assert.deepEqual(d.guild.roles.map((r: { name: string }) => r.name), ['Coach', 'Team 5898', 'Admin', 'Other'])
  assert.deepEqual(d.guild.channels.map((c: { name: string }) => c.name), ['general'])
  assert.deepEqual(d.guild.missing_permissions, ['Manage Threads', 'Create Public Threads', 'Send Messages in Threads'])
})

test('testing a member shows who would get in with the chosen roles', async () => {
  const check = async (query: string) => ((await (await call('/test/member', { ...form(), query })).json()) as any[])[0]
  assert.equal((await check('coach')).allowed, true)
  assert.equal((await check('team')).allowed, true, 'any one of several roles is enough')
  assert.deepEqual((await check('team')).roles, ['Team 5898', 'Other'])
  assert.equal((await check('outsider')).allowed, false)
  const boss = await check('boss')
  assert.ok(boss.allowed && boss.admin, 'bot-admins always get in')
})

test('finishing tests everything again and saves nothing until it all works', async () => {
  const errorsFor = async (f: unknown) => {
    const r = await call('', f)
    assert.equal(r.status, 422)
    return ((await r.json()) as { errors: string[] }).errors.join(' ')
  }
  assert.match(await errorsFor(form({ discord: { allowed_role_ids: [] } })), /at least one allowed role/)
  assert.match(await errorsFor(form({ discord: { admin_role_id: '' } })), /bot-admin role/)
  assert.match(await errorsFor(form({ discord: { allowed_role_ids: ['777'] } })), /not in this server/)
  assert.match(await errorsFor(form({ discord: { client_secret: 'bad' } })), /client secret/)
  assert.match(await errorsFor({ ...form(), site_url: 'https://elsewhere.example.org' }), /redirect/)
  llmWorks = false
  assert.match(await errorsFor(form()), /AI:/)
  llmWorks = true
  assert.ok(needsSetup())
  assert.equal(botStarts, 0)

  assert.equal((await call('', form())).status, 204)
  assert.ok(!needsSetup())
  assert.equal(botStarts, 1, 'no restart needed')
  assert.equal(config.site_url, SITE)
  assert.equal(config.discord.client_id, '999')
  assert.equal(config.botToken, 'good-bot')

  const saved = readFileSync(`${dataDir}/settings.json`, 'utf8')
  assert.equal(statSync(`${dataDir}/settings.json`).mode & 0o777, 0o600)
  assert.ok(saved.includes('good-bot') && saved.includes('good-key') && saved.includes('good-secret') && saved.includes(config.cookieSecret))
})

test('after setup the page is closed, even with the token', async () => {
  assert.deepEqual(await (await call('/status', undefined, '')).json(), { needed: false })
  assert.equal((await call('/state')).status, 410)
  assert.equal((await call('', form())).status, 410)
  assert.equal(botStarts, 1)
})

/** The whole Discord login, up to where it redirects. */
async function discordLogin(user: string) {
  oauthUser = user
  const start = await app.request('/auth/login')
  const authorize = new URL(start.headers.get('location')!)
  assert.equal(authorize.hostname, 'discord.com')
  assert.equal(authorize.searchParams.get('client_id'), '999')
  const r = await app.request(`/auth/callback?code=c&state=${authorize.searchParams.get('state')}`, { headers: { cookie: start.headers.get('set-cookie')!.split(';')[0] } })
  return { location: r.headers.get('location')!, cookies: r.headers.getSetCookie().join('\n') }
}

test('login: any allowed role or bot-admin gets in, anyone else is refused', async () => {
  for (const user of ['coach', 'team', 'boss']) {
    const r = await discordLogin(user)
    assert.equal(r.location, '/register', user)
    assert.match(r.cookies, /uid=/, user)
  }
  const refused = await discordLogin('outsider')
  assert.equal(refused.location, '/login?error=no_role&user=outsider')
  assert.doesNotMatch(refused.cookies, /uid=/)
  assert.equal((await discordLogin('stranger')).location, '/login?error=not_member&user=stranger')
})

test('isAllowed fails closed', () => {
  assert.ok(isAllowed([COACH]) && isAllowed([OTHER, TEAM]) && isAllowed([ADMIN]))
  assert.ok(!isAllowed([OTHER]) && !isAllowed([]))
  const { allowed_role_ids, admin_role_id } = config.discord
  config.discord.allowed_role_ids = []
  config.discord.admin_role_id = ''
  assert.ok(!isAllowed([COACH]) && !isAllowed([]))
  Object.assign(config.discord, { allowed_role_ids, admin_role_id })
})
