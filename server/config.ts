// Settings come from, lowest priority first: config.toml (optional), data/settings.json (written by /setup), env vars (secrets only).
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { parse } from 'smol-toml'
import { z } from 'zod'

const Settings = z.object({
  site_url: z.string().default(''),
  timezone: z.string().default('UTC'),
  subsystems: z.array(z.string()).default(['Intake', 'Drivetrain', 'Outtake', 'Software', 'Strategy', 'Outreach']),
  image_limit: z.number().int().default(20),
  session_idle_hours: z.number().default(4),
  discord: z.object({
    client_id: z.string().default(''),
    guild_id: z.string().default(''),
    admin_role_id: z.string().default(''),
    allowed_role_ids: z.array(z.string()).default([]),
    log_channel_id: z.string().default(''),
  }).prefault({}),
  llm: z.object({ base_url: z.string().default('https://api.deepseek.com'), model: z.string().default('deepseek-flash') }).prefault({}),
})
type Settings = z.infer<typeof Settings>
export interface Secrets { bot_token?: string; client_secret?: string; llm_key?: string; cookie_secret?: string }
type Stored = Partial<Settings> & { secrets?: Secrets }

const dataDir = process.env.DATA_DIR ?? 'data'
const storedFile = `${dataDir}/settings.json`
const tomlFile = process.env.CONFIG ?? 'config.toml'
const toml = (existsSync(tomlFile) ? parse(readFileSync(tomlFile, 'utf8')) : {}) as Partial<Settings>
let stored: Stored = existsSync(storedFile) ? JSON.parse(readFileSync(storedFile, 'utf8')) : {}

function store(next: Stored) {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(`${storedFile}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 }) // it holds secrets
  renameSync(`${storedFile}.tmp`, storedFile)
  stored = next
}

function resolve() {
  const { secrets = {}, ...saved } = stored
  const parsed = Settings.safeParse({
    ...toml, ...saved, discord: { ...toml.discord, ...saved.discord }, llm: { ...toml.llm, ...saved.llm },
  })
  if (!parsed.success) throw new Error(`settings: ${z.prettifyError(parsed.error)}`)
  return {
    ...parsed.data,
    botToken: process.env.DISCORD_BOT_TOKEN || secrets.bot_token || '',
    clientSecret: process.env.DISCORD_CLIENT_SECRET || secrets.client_secret || '',
    llmKey: process.env.LLM_API_KEY || secrets.llm_key || '',
    cookieSecret: process.env.COOKIE_SECRET || secrets.cookie_secret || '',
  }
}

export const config = { ...resolve(), dataDir, devLogin: process.env.DEV_LOGIN === '1' }
if (!config.cookieSecret) { // generated once: a new one on every start would log everyone out
  config.cookieSecret = randomBytes(32).toString('hex')
  store({ ...stored, secrets: { ...stored.secrets, cookie_secret: config.cookieSecret } })
}

/** What /setup collects. A secret left out keeps its current value. Applies at once, no restart needed. */
export function saveSettings(next: Pick<Settings, 'site_url' | 'timezone' | 'discord' | 'llm'>, secrets: Secrets) {
  store({ ...stored, ...next, secrets: { ...stored.secrets, ...secrets } })
  Object.assign(config, resolve())
}

export const needsSetup = () => !config.devLogin && !(config.site_url && config.llmKey && config.botToken && config.clientSecret
  && config.discord.client_id && config.discord.guild_id && config.discord.admin_role_id && config.discord.allowed_role_ids.length)

/** Who may use Glaucus at all. No configured role means nobody but bot-admins: the check fails closed. */
export const isAllowed = (roles: string[]) =>
  roles.includes(config.discord.admin_role_id) || roles.some((r) => config.discord.allowed_role_ids.includes(r))

/** 'YYYY-MM-DD HH:mm' in the team's timezone. Every stored timestamp uses this. */
export const stamp = (ms: number) => new Date(ms).toLocaleString('sv', { timeZone: config.timezone }).slice(0, 16)
export const now = () => stamp(Date.now())
export const today = () => now().slice(0, 10)
