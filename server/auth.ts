// Discord OAuth2 (scope identify) → guild membership + admin role via the bot token → signed cookie with the
// discord_id. Admin flag is refreshed at each login, so a role change applies at the next login (≤ 7 days).
import { randomBytes } from 'node:crypto'
import { Hono, type MiddlewareHandler } from 'hono'
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie'
import { config, now } from './config.ts'
import { db } from './db.ts'

export interface Member { discord_id: string; discord_name: string; real_name: string; is_admin: number; registered_at: string | null }
export type Env = { Variables: { user: Member } }

const DISCORD = 'https://discord.com/api/v10'
const redirectUri = () => `${config.site_url}/auth/callback`
const cookieOpts = { httpOnly: true, sameSite: 'Lax', secure: config.site_url.startsWith('https'), path: '/' } as const

function upsertMember(id: string, name: string, admin: boolean) {
  db.prepare(`insert into members (discord_id, discord_name, is_admin) values (?, ?, ?)
              on conflict (discord_id) do update set discord_name = excluded.discord_name, is_admin = excluded.is_admin`)
    .run(id, name, admin ? 1 : 0)
}

export const auth = new Hono()
  .get('/login', async (c) => {
    if (config.devLogin) return c.redirect('/login') // demo: the login page lists test accounts, Discord is never involved
    const state = randomBytes(16).toString('hex')
    await setSignedCookie(c, 'oauth_state', state, config.cookieSecret, { ...cookieOpts, maxAge: 600 })
    const q = new URLSearchParams({ client_id: config.discord.client_id, response_type: 'code', scope: 'identify', redirect_uri: redirectUri(), state })
    return c.redirect(`https://discord.com/oauth2/authorize?${q}`)
  })
  .get('/callback', async (c) => {
    const state = await getSignedCookie(c, config.cookieSecret, 'oauth_state')
    deleteCookie(c, 'oauth_state', { path: '/' })
    if (!state || state !== c.req.query('state') || !c.req.query('code')) return c.redirect('/login')

    const tok = await fetch(`${DISCORD}/oauth2/token`, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: config.discord.client_id, client_secret: config.clientSecret,
        grant_type: 'authorization_code', code: c.req.query('code')!, redirect_uri: redirectUri(),
      }),
    }).then((r) => r.json() as Promise<{ access_token?: string }>)
    if (!tok.access_token) return c.redirect('/login')
    const user = await fetch(`${DISCORD}/users/@me`, { headers: { Authorization: `Bearer ${tok.access_token}` } })
      .then((r) => r.json() as Promise<{ id: string; username: string }>)

    const m = await fetch(`${DISCORD}/guilds/${config.discord.guild_id}/members/${user.id}`, { headers: { Authorization: `Bot ${config.botToken}` } })
    if (m.status === 404) return c.redirect(`/login?error=not_member&user=${encodeURIComponent(user.username)}`)
    if (!m.ok) throw new Error(`Discord guild member lookup failed: ${m.status}`)
    const { roles } = (await m.json()) as { roles: string[] }

    upsertMember(user.id, user.username, roles.includes(config.discord.admin_role_id))
    return login(c, user.id)
  })
  .post('/logout', (c) => {
    deleteCookie(c, 'uid', { path: '/' })
    return c.body(null, 204)
  })
  // Local dev / tests without a Discord app: /auth/dev?id=alice&name=Alice%20Chen&admin=1. Off unless DEV_LOGIN=1.
  .get('/dev', (c) => {
    if (!config.devLogin) return c.notFound()
    const id = c.req.query('id') ?? 'dev'
    upsertMember(id, id, c.req.query('admin') === '1')
    if (c.req.query('name')) db.prepare('update members set real_name = ?, registered_at = ? where discord_id = ?').run(c.req.query('name')!, now(), id)
    return login(c, id)
  })
  // The accounts the login page offers in demo mode.
  .get('/dev-users', (c) => {
    if (!config.devLogin) return c.notFound()
    return c.json(db.prepare(`select discord_id as id, real_name as name, is_admin as admin from members where real_name != '' order by is_admin desc, registered_at, real_name`).all())
  })

async function login(c: Parameters<MiddlewareHandler>[0], id: string) {
  await setSignedCookie(c, 'uid', id, config.cookieSecret, { ...cookieOpts, maxAge: 7 * 86400 })
  const m = db.prepare('select real_name from members where discord_id = ?').get(id) as { real_name: string }
  return c.redirect(m.real_name ? '/' : '/register')
}

export const requireUser: MiddlewareHandler<Env> = async (c, next) => {
  const id = await getSignedCookie(c, config.cookieSecret, 'uid')
  const user = id ? (db.prepare('select * from members where discord_id = ?').get(id) as Member | undefined) : undefined
  if (!user) return c.json({ error: 'login required' }, 401)
  c.set('user', user)
  await next()
}

export const requireAdmin: MiddlewareHandler<Env> = async (c, next) => {
  if (!c.get('user').is_admin) return c.json({ error: 'bot-admin only' }, 403)
  await next()
}
