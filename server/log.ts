import { config } from './config.ts'

/** One line to the Discord log channel (design.md §10.1); console when no channel / token is configured. */
export async function log(line: string) {
  console.log('[log]', line)
  if (!config.discord.log_channel_id || !config.botToken) return
  try {
    const r = await fetch(`https://discord.com/api/v10/channels/${config.discord.log_channel_id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${config.botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: line.slice(0, 2000), allowed_mentions: { parse: [] } }),
    })
    if (!r.ok) console.error('log channel send failed', r.status)
  } catch (err) {
    console.error('log channel send failed', err)
  }
}
