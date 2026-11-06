// First run (design.md §9.1): the server starts without settings and /setup collects and tests them. Whoever reaches a new
// server first must not be able to claim it, so every call but /status needs a one-time token that only goes to the server's logs.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { generateText, Output } from 'ai'
import { Hono } from 'hono'
import { z } from 'zod'
import { config, needsSetup, saveSettings } from './config.ts'
import { createModel } from './llm.ts'
import { log } from './log.ts'

const DISCORD = 'https://discord.com/api/v10'
const token = randomBytes(24).toString('hex')
const digest = (s: string) => createHash('sha256').update(s).digest()

export function announceSetup() {
  console.log(`\nGlaucus needs setting up. Open /setup on this server and enter this token:\n\n  ${token}\n`)
}

/** A dead bot must not take the web app down. */
let startBot = () => import('./bot.ts').then((b) => b.startBot())
export const setBotStarter = (fn: typeof startBot) => { startBot = fn } // tests
export function startDiscord() {
  void startBot().catch((err) => log(`❌ Discord bot failed to start · ${err.message}`))
}

// Discord permission bits the bot uses. Administrator (bit 3) covers them all.
const NEEDED = { 'View Channels': 10n, 'Send Messages': 11n, 'Read Message History': 16n, 'Manage Threads': 34n, 'Create Public Threads': 35n, 'Send Messages in Threads': 38n }
const INVITE_PERMISSIONS = Object.values(NEEDED).reduce((all, bit) => all | (1n << bit), 0n)
const MESSAGE_CONTENT_FLAGS = (1 << 18) | (1 << 19) // the intent, approved or limited (under 100 servers)

type Role = { id: string; name: string; managed?: boolean; permissions: string }
const Field = z.string().trim().default('')

async function checkLlm(llm: { base_url: string; model: string }, key: string) {
  try {
    await generateText({
      model: createModel(llm, key), // structured output, like every real call: plain text passing proves little
      prompt: 'Reply with {"ok": true}.', output: Output.object({ schema: z.object({ ok: z.boolean() }) }),
      abortSignal: AbortSignal.timeout(60_000), maxRetries: 0,
    })
    return { ok: true }
  } catch (err) {
    const e = err as Error & { statusCode?: number }
    return { ok: false, error: e.message || [e.name, e.statusCode].filter(Boolean).join(' ') }
  }
}

async function checkDiscord(o: { botToken: string; clientSecret: string; guildId: string; siteUrl: string }) {
  const bot = (path: string) => fetch(`${DISCORD}${path}`, { headers: { Authorization: `Bot ${o.botToken}` } })
  const appRes = await bot('/applications/@me')
  if (!appRes.ok) return { ok: false as const, error: appRes.status === 401 ? 'The bot token is not valid.' : `Discord answered ${appRes.status}.` }
  const app = (await appRes.json()) as { id: string; name: string; flags?: number; redirect_uris?: string[] }

  const secret = await fetch(`${DISCORD}/oauth2/token`, {
    method: 'POST',
    body: new URLSearchParams({ client_id: app.id, client_secret: o.clientSecret, grant_type: 'client_credentials', scope: 'identify' }),
  })
  const redirectUri = `${o.siteUrl.replace(/\/+$/, '')}/auth/callback`
  const guilds = (await (await bot('/users/@me/guilds')).json()) as { id: string; name: string }[]
  const guildId = o.guildId || (guilds.length === 1 ? guilds[0].id : '')

  let guild = null
  if (guilds.some((g) => g.id === guildId)) {
    const [me, roles, channels] = await Promise.all([bot('/users/@me').then((r) => r.json()), bot(`/guilds/${guildId}/roles`).then((r) => r.json()), bot(`/guilds/${guildId}/channels`).then((r) => r.json())]) as
      [{ id: string }, Role[], { id: string; name: string; type: number }[]]
    const member = (await (await bot(`/guilds/${guildId}/members/${me.id}`)).json()) as { roles: string[] }
    const held = roles.filter((r) => r.id === guildId || member.roles.includes(r.id)).reduce((all, r) => all | BigInt(r.permissions), 0n)
    const has = (bit: bigint) => Boolean((held >> 3n) & 1n) || Boolean((held >> bit) & 1n)
    guild = {
      id: guildId,
      roles: roles.filter((r) => r.id !== guildId && !r.managed).map(({ id, name }) => ({ id, name })), // not @everyone, not other bots' roles
      channels: channels.filter((c) => c.type === 0).map(({ id, name }) => ({ id, name })),
      missing_permissions: Object.entries(NEEDED).filter(([, bit]) => !has(bit)).map(([name]) => name),
    }
  }
  return {
    ok: true as const, app_id: app.id, app_name: app.name,
    secret_ok: secret.ok,
    message_content: Boolean((app.flags ?? 0) & MESSAGE_CONTENT_FLAGS),
    redirect_uri: redirectUri, redirect_ok: (app.redirect_uris ?? []).includes(redirectUri),
    invite_url: `https://discord.com/oauth2/authorize?client_id=${app.id}&scope=bot+applications.commands&permissions=${INVITE_PERMISSIONS}`,
    guilds: guilds.map(({ id, name }) => ({ id, name })), guild,
  }
}

const Form = z.object({
  site_url: Field, timezone: Field,
  llm: z.object({ base_url: Field, model: Field, key: Field }).prefault({}),
  discord: z.object({
    bot_token: Field, client_secret: Field, guild_id: Field, admin_role_id: Field,
    allowed_role_ids: z.array(z.string()).default([]), log_channel_id: Field,
  }).prefault({}),
})
const secrets = (f: z.infer<typeof Form>) => ({ botToken: f.discord.bot_token || config.botToken, clientSecret: f.discord.client_secret || config.clientSecret, llmKey: f.llm.key || config.llmKey })

export const setup = new Hono()
  .get('/status', (c) => c.json({ needed: needsSetup() }))
  .use(async (c, next) => {
    if (!needsSetup()) return c.json({ error: 'setup is already finished' }, 410)
    if (!timingSafeEqual(digest(c.req.header('x-setup-token') ?? ''), digest(token))) return c.json({ error: 'wrong setup token' }, 401)
    await next()
  })

  /** Never the secrets themselves: only whether each is set, and whether an env var holds it and the form can't change it. */
  .get('/state', (c) => c.json({
    site_url: config.site_url, timezone: config.timezone, llm: config.llm, discord: config.discord,
    secrets: {
      llm_key: { set: !!config.llmKey, env: !!process.env.LLM_API_KEY },
      bot_token: { set: !!config.botToken, env: !!process.env.DISCORD_BOT_TOKEN },
      client_secret: { set: !!config.clientSecret, env: !!process.env.DISCORD_CLIENT_SECRET },
    },
  }))
  .post('/test/llm', async (c) => {
    const f = Form.parse(await c.req.json())
    return c.json(await checkLlm(f.llm, secrets(f).llmKey))
  })
  .post('/test/discord', async (c) => {
    const f = Form.parse(await c.req.json())
    return c.json(await checkDiscord({ ...secrets(f), guildId: f.discord.guild_id, siteUrl: f.site_url }))
  })

  /** Who would get in with these roles. Searching needs no privileged intent. */
  .post('/test/member', async (c) => {
    const body = await c.req.json()
    const f = Form.parse(body)
    const query = String(body.query ?? '').trim()
    const headers = { Authorization: `Bot ${secrets(f).botToken}` }
    const res = await fetch(`${DISCORD}/guilds/${f.discord.guild_id}/members/search?${new URLSearchParams({ query, limit: '5' })}`, { headers })
    if (!res.ok) return c.json({ error: `Discord answered ${res.status}.` }, 502)
    const roles = (await (await fetch(`${DISCORD}/guilds/${f.discord.guild_id}/roles`, { headers })).json()) as Role[]
    const members = (await res.json()) as { nick?: string | null; roles: string[]; user: { id: string; username: string; global_name?: string | null; bot?: boolean } }[]
    const usable = new Set([f.discord.admin_role_id, ...f.discord.allowed_role_ids].filter(Boolean))
    return c.json(members.filter((m) => !m.user.bot).map((m) => ({
      id: m.user.id, username: m.user.username, name: m.nick || m.user.global_name || m.user.username,
      allowed: m.roles.some((r) => usable.has(r)),
      admin: m.roles.includes(f.discord.admin_role_id),
      roles: roles.filter((r) => m.roles.includes(r.id)).map((r) => r.name),
    })))
  })

  /** Everything is tested once more here, so a form that skipped a test can't save something that doesn't work. */
  .post('/', async (c) => {
    const f = Form.parse(await c.req.json())
    const s = secrets(f)
    const errors: string[] = []
    if (!/^https?:\/\/[^/]+/.test(f.site_url)) errors.push('The site URL must start with http:// or https://.')
    try { new Intl.DateTimeFormat('en', { timeZone: f.timezone }) } catch { errors.push('The time zone is not valid.') }
    if (!f.discord.allowed_role_ids.length) errors.push('Choose at least one allowed role.')
    if (!f.discord.admin_role_id) errors.push('Choose a bot-admin role.')

    const d = await checkDiscord({ ...s, guildId: f.discord.guild_id, siteUrl: f.site_url })
    if (!d.ok) errors.push(d.error)
    else {
      if (!d.secret_ok) errors.push('The client secret is not valid.')
      if (!d.message_content) errors.push('Turn on the Message Content intent for the bot.')
      if (!d.redirect_ok) errors.push(`Add ${d.redirect_uri} as a redirect in the Discord developer portal.`)
      if (!d.guild) errors.push('The bot is not in the chosen server.')
      else if (![f.discord.admin_role_id, ...f.discord.allowed_role_ids].every((id) => d.guild!.roles.some((r) => r.id === id))) errors.push('A chosen role is not in this server.')
    }
    const llm = await checkLlm(f.llm, s.llmKey)
    if (!llm.ok) errors.push(`AI: ${llm.error}`)
    if (errors.length || !d.ok) return c.json({ errors }, 422)

    saveSettings({
      site_url: f.site_url.replace(/\/+$/, ''), timezone: f.timezone,
      llm: { base_url: f.llm.base_url, model: f.llm.model },
      discord: { client_id: d.app_id, guild_id: f.discord.guild_id, admin_role_id: f.discord.admin_role_id, allowed_role_ids: f.discord.allowed_role_ids, log_channel_id: f.discord.log_channel_id },
    }, {
      ...(f.discord.bot_token && { bot_token: f.discord.bot_token }),
      ...(f.discord.client_secret && { client_secret: f.discord.client_secret }),
      ...(f.llm.key && { llm_key: f.llm.key }),
    })
    void log('🟢 Glaucus setup finished')
    startDiscord()
    return c.body(null, 204)
  })

