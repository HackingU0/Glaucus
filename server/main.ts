import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { api } from './api.ts'
import { auth, requireUser, type Env } from './auth.ts'
import { config } from './config.ts'
import { files } from './files.ts'
import { markInterrupted } from './jobs.ts'
import { log } from './log.ts'

export const app = new Hono<Env>()
  .route('/auth', auth)
  .use('/api/*', requireUser)
  .use('/files/*', requireUser)
  .route('/api', api)
  .route('/files', files)
  // The SPA shell carries no data; everything behind it is behind requireUser.
  .use('/*', serveStatic({ root: 'web/dist' }))
  .get('*', serveStatic({ path: 'web/dist/index.html' }))
  .onError((err, c) => {
    console.error(err)
    void log(`❌ ${c.req.method} ${c.req.path} · ${err.message}`)
    return c.json({ error: 'internal error' }, 500)
  })

if (import.meta.main) {
  markInterrupted()
  if (config.devLogin) await (await import('./demo.ts')).startDemo()
  // Not in demo mode: its sample sessions point at channels that don't exist. A dead bot must not take the web app down.
  else if (config.botToken && config.discord.guild_id) {
    void import('./bot.ts').then((b) => b.startBot()).catch((err) => log(`❌ Discord bot failed to start · ${err.message}`))
  }
  const port = Number(process.env.PORT ?? 8787)
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Glaucus on :${port}${config.devLogin ? ' (DEV_LOGIN on: /auth/dev is open — never in production)' : ''}`)
    void log('🟢 Glaucus started')
  })
}
