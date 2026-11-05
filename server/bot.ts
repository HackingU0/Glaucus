// discord.js side of collection (design.md §3.2, §3.3): commands, mentions, the idle check. The decisions are in collect.ts.
import {
  ChannelType, Client, cleanContent, Events, GatewayIntentBits, InteractionContextType, MessageFlags, SlashCommandBuilder, SnowflakeUtil,
  ThreadAutoArchiveDuration, type ChatInputCommandInteraction, type Guild, type Message, type ThreadChannel,
} from 'discord.js'
import {
  activeSession, addMessages, collectingSessions, draftQuick, draftSession, ensureMember, failCollect, lastSession, openQuick, openSession, reopenSession, resolveMentions,
  sealSession, selectMessages, sessionByThread, sessionOfThread, sourcesOf, unregisteredAuthors, type Msg,
} from './collect.ts'
import { chat } from './agent.ts'
import { config, isAllowed, stamp, today } from './config.ts'
import { db, getRow, memberName, realName, transition, type Row } from './db.ts'
import { runAgent } from './jobs.ts'
import { log } from './log.ts'

const CONTEXT_LIMIT = 50 // design.md §3.3: hard cap on what a mention looks back at
const CHAT_CONTEXT = 16 // what chat sees of those: every reply costs tokens for all of it
const IDLE_CHECK_MS = 5 * 60 * 1000

// No GuildMembers intent: login looks up one member over REST (auth.ts), and that needs no intent.
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] })

const link = (id: number) => `${config.site_url}/entries/${id}`
const describeError = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** Bot chatter must never ping anyone, and a failed send must never take a flow down with it. */
async function say(channel: { send: ThreadChannel['send'] }, content: string, users: string[] = []) {
  await channel.send({ content, allowedMentions: { users } }).catch((err) => console.error('discord send failed:', describeError(err)))
}

const keep = (m: Message) => !m.author.bot && !m.system

/** Only allowed members reach a note. Fetched history carries no member, so each author is looked up once; no intent needed for that. */
async function fromAllowed(msgs: Message[]) {
  const allowed = new Map<string, boolean>()
  for (const id of new Set(msgs.map((m) => m.author.id))) {
    const member = await msgs[0].guild!.members.fetch(id).catch((err) => {
      if (err.code === 10007 || err.code === 10013) return null // left the server: not a member. Anything else: fail, so a retry can get it
      throw err
    })
    allowed.set(id, !!member && isAllowed([...member.roles.cache.keys()]))
  }
  return msgs.filter((m) => allowed.get(m.author.id))
}

function deniedText(guild: Guild | null) {
  const names = config.discord.allowed_role_ids.map((id) => guild?.roles.cache.get(id)?.name).filter(Boolean)
  return `You need one of these roles to use Glaucus: ${names.join(', ') || 'none are set up'}.`
}
const rolesOf = (member: ChatInputCommandInteraction['member']) =>
  !member ? [] : Array.isArray(member.roles) ? member.roles : [...member.roles.cache.keys()]

function toMsg(m: Message): Msg {
  const named = resolveMentions(m.content, client.user!.id, (id) => realName(id) || m.mentions.members?.get(id)?.displayName || m.mentions.users.get(id)?.displayName)
  return {
    id: m.id,
    authorId: m.author.id,
    authorName: realName(m.author.id) || m.member?.displayName || m.author.displayName,
    at: stamp(m.createdTimestamp),
    content: cleanContent(named, m.channel), // the remaining channel and role mentions
    attachments: m.attachments.map((a) => ({ url: a.url, filename: a.name, mime: a.contentType ?? 'application/octet-stream' })),
  }
}

async function allMessages(thread: ThreadChannel) {
  const out: Message[] = []
  for (let before: string | undefined; ;) {
    const page = await thread.messages.fetch({ limit: 100, before })
    out.push(...page.values())
    if (page.size < 100) return out
    before = page.lastKey()
  }
}

/** The thread leaves the sidebar here, so the result goes to the channel too, where people will see it. */
async function closeThread(thread: ThreadChannel, text: string, channelExtra = '', users: string[] = []) {
  await say(thread, text)
  await thread.setArchived(true).catch((err) => log(`⚠️ could not archive #${thread.name} · ${describeError(err)}`))
  if (thread.parent?.isSendable()) await say(thread.parent, text + channelExtra, users)
}

/** Pulls the thread, then drafts. Also the retry for failed_step 'attachments', so it picks up where it stopped. Never rejects. */
export async function collect(id: number, by?: string) {
  const row = getRow(id)!
  const before = sourcesOf(id).length
  let thread: ThreadChannel | undefined
  let msgs: Msg[]
  try {
    const channel = await client.channels.fetch(row.thread_id as string)
    if (!channel?.isThread()) throw new Error('the session thread no longer exists')
    thread = channel
    // Locked before reading, so nothing posted from here on is silently left out. Without the permission the session still ends.
    await thread.edit({ archived: false, locked: true }).catch((err) => log(`⚠️ could not lock #${channel.name}, give the bot Manage Threads · ${describeError(err)}`))
    msgs = (await fromAllowed((await allMessages(thread)).filter(keep))).map(toMsg).filter((m) => m.content || m.attachments.length).reverse()
    await addMessages(id, msgs)
  } catch (err) {
    failCollect(id, err)
    if (thread) await say(thread, `⚠️ I could not save everything from this session. A bot-admin can retry it here: ${link(id)}`)
    return
  }
  if (!sealSession(id)) {
    void log(`🗑️ entry ${id} · empty session discarded`)
    await closeThread(thread, 'Nothing was posted in this session, so there is nothing to draft.')
    return
  }
  await draftSession(id, before, by)
  const text = getRow(id)!.failed_step
    ? `⚠️ The draft failed, and a bot-admin can retry it here: ${link(id)}`
    : row.entry && sourcesOf(id).length === before
      ? `Nothing new was posted, so the draft is unchanged: ${link(id)}`
      : `📝 Draft ready: ${link(id)}`
  const missing = unregisteredAuthors(msgs)
  const reminder = missing.length ? `\n${missing.map((u) => `<@${u}>`).join(' ')} please log in once at ${config.site_url} so the notebook uses your real name. For now it shows your Discord name.` : ''
  await closeThread(thread, text, `\nRun \`/continue\` here to add more.${reminder}`, missing)
}

function endSession(row: Row, by: string) {
  if (!transition(row.id, ['collecting'], 'drafting')) return false // someone else ended it first
  void log(`🏁 entry ${row.id} · session ended by ${by}`)
  return true
}

async function onStart(i: ChatInputCommandInteraction) {
  const channel = i.channel
  if (channel?.type !== ChannelType.GuildText) {
    return i.reply({ content: 'Start a session from a text channel.', flags: MessageFlags.Ephemeral })
  }
  ensureMember(i.user.id, i.user.username)
  const subsystem = i.options.getString('subsystem')
  const opened = openSession({ channelId: channel.id, channelName: `#${channel.name}`, userId: i.user.id, subsystem })
  if (opened.existing) {
    const where = opened.existing.thread_id ? `<#${opened.existing.thread_id}>` : 'this channel'
    return i.reply({ content: `A session is already running: ${where}. End it with \`/session end\`.`, flags: MessageFlags.Ephemeral })
  }
  const id = opened.id!
  await i.deferReply()
  try {
    const started = await i.editReply('🧵 Starting a session…')
    const thread = await started.startThread({ // on the reply, so #channel doesn't get a separate "started a thread" line
      name: [today(), subsystem, 'session'].filter(Boolean).join(' '),
      autoArchiveDuration: ThreadAutoArchiveDuration.OneDay, // longer than the idle limit, so it can't archive mid-session
    })
    db.prepare('update entries set thread_id = ? where id = ?').run(thread.id, id)
    await say(thread, `<@${i.user.id}> started this session. Everything posted here goes into a notebook draft. Run \`/session end\` when you are done; it also ends after ${config.session_idle_hours} hours without a message.`, [i.user.id])
    void log(`🧵 entry ${id} · session started in #${channel.name} by ${memberName(i.user.id)}`)
    await i.editReply(`🧵 Session started: <#${thread.id}>`)
  } catch (err) {
    db.prepare('delete from entries where id = ?').run(id)
    void log(`❌ session start failed in #${channel.name} · ${describeError(err)}`)
    await i.editReply('Could not create the thread. Check that I can create threads in this channel.')
  }
}

async function onEnd(i: ChatInputCommandInteraction) {
  const channel = i.channel
  const row = activeSession(channel?.isThread() ? (channel.parentId ?? '') : i.channelId)
  if (!row?.thread_id) return i.reply({ content: 'No session is running in this channel.', flags: MessageFlags.Ephemeral })
  if (!endSession(row, i.user.username)) return i.reply({ content: 'This session has already ended.', flags: MessageFlags.Ephemeral })
  ensureMember(i.user.id, i.user.username)
  // Reply first: collect locks the thread this may be running in.
  await i.reply(`🏁 Session ended by <@${i.user.id}>. Writing the draft; the link will appear in <#${row.channel_id}>.`).finally(() => void collect(row.id, i.user.id))
}

const CANNOT_CONTINUE: Partial<Record<Row['status'], string>> = {
  drafting: 'The draft is still being written. Try again in a moment.',
  pending_approval: 'This draft is waiting for approval. Withdraw it on the website first.',
  approved: 'This note is already approved.',
  discarded: 'This session was discarded.',
}

async function onContinue(i: ChatInputCommandInteraction) {
  const row = i.channel?.isThread() ? sessionOfThread(i.channelId) : lastSession(i.channelId)
  if (!row) return i.reply({ content: 'There is no session to continue here.', flags: MessageFlags.Ephemeral })
  const { running, reopened } = reopenSession(row)
  if (running) return i.reply({ content: `A session is already running: <#${running.thread_id}>.`, flags: MessageFlags.Ephemeral })
  if (!reopened) return i.reply({ content: CANNOT_CONTINUE[row.status] ?? 'This session cannot be continued.', flags: MessageFlags.Ephemeral })
  ensureMember(i.user.id, i.user.username)
  await i.deferReply()
  try {
    const thread = await client.channels.fetch(row.thread_id as string)
    if (!thread?.isThread()) throw new Error('the session thread no longer exists')
    await thread.edit({ archived: false, ...(thread.locked && { locked: false }) }) // unlocking needs Manage Threads, unarchiving its own thread does not
    await say(thread, `<@${i.user.id}> reopened this session. Post what is new, then run \`/session end\`; it also ends after ${config.session_idle_hours} hours without a message.`, [i.user.id])
    void log(`🔓 entry ${row.id} · session continued by ${memberName(i.user.id)}`)
    await i.editReply(`🔓 Session reopened: <#${thread.id}>`)
  } catch (err) {
    transition(row.id, ['collecting'], 'draft_ready', { ended_at: row.ended_at })
    void log(`❌ /continue on entry ${row.id} · ${describeError(err)}`)
    await i.editReply('Could not reopen the thread. Check that I have Manage Threads in this channel.')
  }
}

/** True when the mention has been answered; false when it's a note, for the recording path below. */
async function chatWith(m: Message, all: Message[], referenceId?: string) {
  const me = client.user!.id
  const isOwnReply = (x: Message) => x.author.id === me && !!x.reference // not its log lines and command replies
  const seen = [...await fromAllowed(all.filter(keep)), ...all.filter(isOwnReply)].sort((a, b) => a.createdTimestamp - b.createdTimestamp)
  const turns = seen.filter((x, i) => i >= seen.length - CHAT_CONTEXT || x.id === referenceId)
    .map((x) => (x.author.id === me ? { author: 'Glaucus', content: x.content, you: true } : { author: toMsg(x).authorName, content: toMsg(x).content }))
  const answer = await chat(turns, { memberId: m.author.id, server: m.guild!.name })
  if (answer?.action === 'record') return false
  // No pings, whatever the model writes.
  await m.reply({ content: (answer?.reply ?? 'Honk. My head isn\'t working right now, try me again in a moment. To save something, say "log this".').slice(0, 2000), allowedMentions: { parse: [], repliedUser: false } })
  return true
}

async function onMention(m: Message) {
  if (sessionByThread(m.channelId)) {
    await m.reply({ content: 'Noted. This goes in when the session ends.', allowedMentions: { repliedUser: false } })
    return
  }
  ensureMember(m.author.id, m.author.username)
  if (m.channel.isSendable()) await m.channel.sendTyping()
  const recent = await m.channel.messages.fetch({ limit: CONTEXT_LIMIT, before: m.id })
  const reference = m.reference ? await m.fetchReference().catch(() => null) : null
  const all = new Map([...recent, ...(reference ? [[reference.id, reference] as const] : []), [m.id, m] as const])
  // With a session running everything is work. It can't see images, so a message with a file is always a note.
  if (!activeSession(m.channelId) && !m.attachments.size && await chatWith(m, [...all.values()], reference?.id)) return
  const candidates = (await fromAllowed([...all.values()].filter(keep))).sort((a, b) => a.createdTimestamp - b.createdTimestamp).map(toMsg)
  const picked = await selectMessages(candidates, [m.id, ...(reference ? [reference.id] : [])], activeSession(m.channelId)?.thread_id as string | undefined)
  if (!picked.length) {
    await m.reply({ content: 'I found nothing to record. Mention me with some text, or reply to the message you mean.', allowedMentions: { repliedUser: false } })
    return
  }

  const session = activeSession(m.channelId)
  let text: string
  if (session) {
    await addMessages(session.id, picked)
    text = `Added to the session in <#${session.thread_id}>.`
  } else {
    const id = openQuick(m.author.id)
    await addMessages(id, picked)
    void draftQuick(id, m.author.id)
    text = `📝 Saved to today's quick note: ${link(id)}`
  }
  const missing = unregisteredAuthors(picked)
  if (missing.length) text += `\n${missing.map((u) => `<@${u}>`).join(' ')} please log in once at ${config.site_url} so the notebook uses your real name.`
  await m.reply({ content: text, allowedMentions: { users: missing, repliedUser: false } })
}

async function checkIdle() {
  const limit = config.session_idle_hours * 60 * 60 * 1000
  for (const row of collectingSessions()) {
    try {
      // Only "the thread is gone" ends a session here; a network error just waits for the next round.
      const thread = await client.channels.fetch(row.thread_id as string).catch((err) => {
        if (err.code === 10003) return null // Unknown Channel
        throw err
      })
      const last = thread?.isThread() ? (thread.lastMessageId ?? thread.id) : null
      if ((last === null || Date.now() - SnowflakeUtil.timestampFrom(last) > limit) && endSession(row, 'the idle timer')) void collect(row.id)
    } catch (err) {
      console.error(`idle check failed for entry ${row.id}:`, describeError(err))
    }
  }
}

export async function startBot() {
  client.on(Events.Error, (err) => console.error('discord client error:', err.message))

  client.on(Events.InteractionCreate, async (i) => {
    if (!i.isChatInputCommand() || !['session', 'continue'].includes(i.commandName) || i.guildId !== config.discord.guild_id) return
    try {
      if (!isAllowed(rolesOf(i.member))) return void await i.reply({ content: deniedText(i.guild), flags: MessageFlags.Ephemeral })
      await (i.commandName === 'continue' ? onContinue(i) : i.options.getSubcommand() === 'start' ? onStart(i) : onEnd(i))
    } catch (err) {
      void log(`❌ ${i} · ${describeError(err)}`)
      const content = 'Something went wrong. It is in the log channel.'
      await (i.deferred || i.replied ? i.editReply(content) : i.reply({ content, flags: MessageFlags.Ephemeral })).catch(() => {})
    }
  })

  client.on(Events.MessageCreate, async (m) => {
    if (m.author.bot || m.guildId !== config.discord.guild_id) return
    if (!m.mentions.has(client.user!, { ignoreEveryone: true, ignoreRoles: true, ignoreRepliedUser: true })) return
    try {
      if (!m.member || !isAllowed([...m.member.roles.cache.keys()])) return void await m.reply({ content: deniedText(m.guild), allowedMentions: { repliedUser: false } })
      await onMention(m)
    } catch (err) {
      void log(`❌ mention in #${'name' in m.channel ? m.channel.name : m.channelId} · ${describeError(err)}`)
      await m.reply({ content: 'I could not save that. Try again in a moment; it is in the log channel.', allowedMentions: { repliedUser: false } }).catch(() => {})
    }
  })

  client.once(Events.ClientReady, async (c) => {
    const session = new SlashCommandBuilder().setName('session').setDescription('Collect work into a notebook draft')
      .setContexts(InteractionContextType.Guild)
      .addSubcommand((s) => s.setName('start').setDescription('Start a session thread in this channel')
        .addStringOption((o) => o.setName('subsystem').setDescription('What this session is about')
          .addChoices(...config.subsystems.slice(0, 25).map((name) => ({ name, value: name })))))
      .addSubcommand((s) => s.setName('end').setDescription("End this channel's session and write the draft"))
    const resume = new SlashCommandBuilder().setName('continue').setDescription("Reopen this channel's last session to add more")
      .setContexts(InteractionContextType.Guild)
    const guild = await c.guilds.fetch(config.discord.guild_id)
    await guild.commands.set([session.toJSON(), resume.toJSON()])
    console.log(`Discord bot online as ${c.user.username}`)
    // A crash between the insert and the thread would otherwise hold the channel forever.
    db.exec(`delete from entries where kind = 'session' and status = 'collecting' and thread_id is null`)
    void checkIdle() // sessions may have gone idle while we were down
    setInterval(() => void checkIdle(), IDLE_CHECK_MS).unref()
  })

  await client.login(config.botToken)
}
