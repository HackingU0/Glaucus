import { readFileSync } from 'node:fs'
import { parse } from 'smol-toml'
import { z } from 'zod'

const Config = z.object({
  site_url: z.string(),
  timezone: z.string(),
  subsystems: z.array(z.string()),
  image_limit: z.number().int().default(20),
  discord: z.object({
    client_id: z.string().default(''),
    guild_id: z.string().default(''),
    admin_role_id: z.string().default(''),
    log_channel_id: z.string().default(''),
  }),
  llm: z.object({ base_url: z.string().optional(), model: z.string() }),
})

const file = process.env.CONFIG ?? 'config.toml'
const parsed = Config.safeParse(parse(readFileSync(file, 'utf8')))
if (!parsed.success) throw new Error(`${file}: ${z.prettifyError(parsed.error)}`)

export const config = {
  ...parsed.data,
  dataDir: process.env.DATA_DIR ?? 'data',
  botToken: process.env.DISCORD_BOT_TOKEN ?? '',
  clientSecret: process.env.DISCORD_CLIENT_SECRET ?? '',
  cookieSecret: process.env.COOKIE_SECRET ?? '',
  llmKey: process.env.LLM_API_KEY ?? '',
  devLogin: process.env.DEV_LOGIN === '1',
}
if (!config.cookieSecret) throw new Error('COOKIE_SECRET is not set')

/** 'YYYY-MM-DD HH:mm' in the team's timezone. Every stored timestamp uses this. */
export const now = () => new Date().toLocaleString('sv', { timeZone: config.timezone }).slice(0, 16)
export const today = () => now().slice(0, 10)
