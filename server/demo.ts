// Demo mode (DEV_LOGIN=1): a sample team and entries on an empty database, plus a canned AI when there is no LLM key.
// Loaded only from main.ts behind DEV_LOGIN, so production never imports it. Reset: stop the server, delete data/.
import { MockLanguageModelV4 } from 'ai/test'
import sharp from 'sharp'
import { NI, type NotebookEntry, type Section } from '../shared/entry.ts'
import { setModel } from './agent.ts'
import { config } from './config.ts'
import { db, writeFts } from './db.ts'
import { saveUpload } from './files.ts'
import { renderMarkdown, slugify } from './render.ts'

const MEMBERS: [id: string, name: string, admin: 0 | 1][] = [
  ['eli', 'Eli Xiao', 1], ['carol', 'Carol Wu', 1], ['alice', 'Alice Chen', 0], ['bob', 'Bob Li', 0],
  ['dan', 'Daniel Park', 0], ['grace', 'Grace Liu', 0], ['sam', 'Sam Ortiz', 0],
]
const nameOf = (id: string) => MEMBERS.find((m) => m[0] === id)![1]

const INTAKE: NotebookEntry = {
  title: 'Intake wheel selection and odometry drift',
  date: '2026-11-02', start_time: '15:00', end_time: NI,
  attendees: ['Alice Chen', 'Bob Li', 'Carol Wu', 'kevz_07'],
  goals: ['Improve intake reliability', 'Investigate odometry drift'],
  sections: [
    {
      subsystem: 'Intake',
      work_done: 'Tested replacement intake wheels after the original REV wheels slipped and failed to pull game elements in.',
      problems: ['REV wheels too slippery; elements not intaken consistently', 'Elements are ejected too hard at 0.8 power'],
      decisions: [{
        decision: 'Use goBILDA compliant wheels for the intake',
        alternatives_considered: ['REV wheels (original)', 'goBILDA gripper wheels'],
        rationale: 'Compliant wheels gave the most consistent intake: 9/10 successful attempts.',
      }],
      test_results: `Compliant wheel: 9/10 successful intakes. Gripper wheel: ${NI}.`,
      images: [{ attachment_id: 1, caption: 'Compliant wheel intake test' }],
    },
    {
      subsystem: 'Drivetrain',
      work_done: 'Observed odometry drift during testing. Root cause not yet identified.',
      problems: [`Odometry position drifts by ${NI}`],
      decisions: [], test_results: null,
      images: [{ attachment_id: 2, caption: 'Odometry log showing drift' }],
    },
  ],
  next_steps: ['Lower intake power from 0.8 to 0.6 and retest', 'Find the cause of odometry drift'],
}
const INTAKE_SOURCE = [
  { author: 'Alice Chen', at: '2026-11-02 15:02', content: 'Tuning the intake today. The original REV wheels are too slippery, game elements keep failing to pull in', attachment_ids: [] },
  { author: 'Bob Li', at: '2026-11-02 15:20', content: 'Tried the goBILDA gripper wheel and compliant wheel. Compliant pulls in most consistently, 9 out of 10 attempts worked', attachment_ids: [1] },
  { author: 'Alice Chen', at: '2026-11-02 15:41', content: 'OK, going with compliant then. Next time try dropping the speed from 0.8 to 0.6, it is launching them a bit right now', attachment_ids: [] },
  { author: 'Carol Wu', at: '2026-11-02 16:05', content: 'Odometry on the drivetrain is drifting. No idea why yet', attachment_ids: [2] },
]
const AUTO: NotebookEntry = {
  title: 'Autonomous path tuning',
  date: '2026-10-30', start_time: '16:00', end_time: '18:00',
  attendees: ['Carol Wu', 'Grace Liu'],
  goals: ['Reduce overshoot on the left-side autonomous route'],
  sections: [
    {
      subsystem: 'Software',
      work_done: 'Tuned the path follower gains for the left-side autonomous route; reduced overshoot at the second turn.',
      problems: ['Robot overshot the second turn by about 8 cm'],
      decisions: [{ decision: 'Lower kP from 0.12 to 0.08', alternatives_considered: ['Add a feedforward term'], rationale: 'Smallest change that removed the overshoot in testing.' }],
      test_results: '10 runs after tuning: overshoot under 2 cm in all runs.',
      images: [],
    },
    {
      subsystem: 'Strategy',
      work_done: 'Agreed the left-side route is the default when our alliance partner has no autonomous.',
      problems: [], decisions: [], test_results: null, images: [],
    },
  ],
  next_steps: ['Tune the right-side route the same way'],
}
const GEAR_V1: NotebookEntry = {
  title: 'Drivetrain gear ratio trade study',
  date: '2026-10-28', start_time: '15:30', end_time: '17:10',
  attendees: ['Bob Li', 'Daniel Park', 'Eli Xiao'],
  goals: ['Choose a drivetrain gearbox ratio for the season'],
  sections: [{
    subsystem: 'Drivetrain',
    work_done: 'Compared 13.7:1 and 19.2:1 motor gearboxes for the drivetrain, trading top speed for pushing force.',
    problems: ['13.7:1 stalls when pushed by another robot'],
    decisions: [{
      decision: 'Use 19.2:1 gearboxes',
      alternatives_considered: ['13.7:1 gearboxes'],
      rationale: 'Pushing force matters more than top speed on a crowded field; 19.2:1 still crosses the field in about 2 s.',
    }],
    test_results: '13.7:1: 1.4 s across the field, stalled in 3/5 pushing tests. 19.2:1: 2.0 s, stalled in 0/5.',
    images: [{ attachment_id: 1, caption: 'Push test setup' }],
  }],
  next_steps: ['Order two more 19.2:1 gearboxes'],
}
const GEAR_V2: NotebookEntry = {
  ...GEAR_V1,
  sections: [{ ...GEAR_V1.sections[0], images: [{ attachment_id: 1, caption: 'Push test setup against the practice bot' }] }],
}
const simple = (title: string, date: string, subsystem: string, work: string, people: string[]): NotebookEntry => ({
  title, date, start_time: '15:00', end_time: '17:00', attendees: people, goals: [],
  sections: [{ subsystem, work_done: work, problems: [], decisions: [], test_results: null, images: [] }],
  next_steps: [],
})

interface Seed {
  columns: Record<string, string> // entries columns; people are member ids
  files?: string[]
  messages?: typeof INTAKE_SOURCE
  note?: NotebookEntry            // attachment_id here and in messages = 1-based index into files, remapped on insert
  aiUntouched?: string[]
  revisions?: [editor: string, at: string, what: 'submit' | 'admin_edit', note: NotebookEntry][]
}
const web = (date: string, by: string, at: string, source_text: string) => ({ kind: 'web', date, created_by: by, created_at: at, source_text })
const session = (date: string, by: string, at: string, channel_id: string) => ({ kind: 'session', date, created_by: by, created_at: at, channel_id })

// Oldest first, so ids grow with date. One entry per state the UI can show; 'drafting' happens live on a new entry.
const SEEDS: Seed[] = [
  {
    columns: { ...session('2026-10-21', 'alice', '2026-10-21 15:00', '#build'), status: 'approved', drafted_at: '2026-10-21 17:30', submitted_by: 'alice', submitted_at: '2026-10-21 19:00', approved_by: 'carol', approved_at: '2026-10-22 08:15' },
    messages: [{ author: 'Alice Chen', at: '2026-10-21 15:10', content: 'First version of the intake is built: REV wheels on a polycarbonate plate', attachment_ids: [] }],
    note: simple('Intake prototype v1 build', '2026-10-21', 'Intake', 'Built the first intake prototype with REV wheels on a polycarbonate plate.', ['Alice Chen', 'Bob Li']),
    revisions: [['alice', '2026-10-22 08:15', 'submit', simple('Intake prototype v1 build', '2026-10-21', 'Intake', 'Built the first intake prototype with REV wheels on a polycarbonate plate.', ['Alice Chen', 'Bob Li'])]],
  },
  {
    columns: { ...web('2026-10-24', 'grace', '2026-10-24 20:30', 'Library STEM night. Kids drove the robot on a small field, about 40 people came.'), status: 'approved', drafted_at: '2026-10-24 20:31', submitted_by: 'grace', submitted_at: '2026-10-24 21:00', approved_by: 'bob', approved_at: '2026-10-25 08:40' },
    note: simple('Library STEM night demo', '2026-10-24', 'Outreach', 'Demoed the robot at the public library STEM night; kids drove the robot in a small field.', ['Grace Liu', 'Sam Ortiz']),
    revisions: [['grace', '2026-10-25 08:40', 'submit', simple('Library STEM night demo', '2026-10-24', 'Outreach', 'Demoed the robot at the public library STEM night; kids drove the robot in a small field.', ['Grace Liu', 'Sam Ortiz'])]],
  },
  {
    columns: { ...session('2026-10-26', 'alice', '2026-10-26 15:00', '#build'), status: 'discarded', drafted_at: '2026-10-26 16:20', discarded_by: 'alice', discarded_at: '2026-10-27 10:02' },
    files: ['intake_test.jpg'],
    messages: INTAKE_SOURCE.slice(0, 2),
    note: { ...INTAKE, title: 'Test session (duplicate)', date: '2026-10-26', sections: [INTAKE.sections[0]] },
  },
  {
    columns: { ...session('2026-10-28', 'bob', '2026-10-28 15:30', '#build'), status: 'approved', drafted_at: '2026-10-28 17:20', submitted_by: 'bob', submitted_at: '2026-10-28 21:05', approved_by: 'eli', approved_at: '2026-10-29 09:12' },
    files: ['push_test.jpg'],
    messages: [
      { author: 'Bob Li', at: '2026-10-28 15:40', content: '13.7 stalls as soon as it gets pushed, 19.2 took 5 pushes with no problem', attachment_ids: [1] as never[] },
      { author: 'Daniel Park', at: '2026-10-28 16:20', content: '19.2 crosses the field in about 2 s, 13.7 takes 1.4 s', attachment_ids: [] },
    ],
    note: GEAR_V2,
    revisions: [['bob', '2026-10-29 09:12', 'submit', GEAR_V1], ['carol', '2026-11-04 10:30', 'admin_edit', GEAR_V2]],
  },
  {
    columns: { ...web('2026-10-30', 'carol', '2026-10-30 18:10', 'Auto left route overshoots the second turn. Dropped kP from 0.12 to 0.08, ran it 10 times and every run stayed within 2 cm.'), status: 'pending_approval', drafted_at: '2026-10-30 18:12', submitted_by: 'carol', submitted_at: '2026-10-30 19:02' },
    note: AUTO,
  },
  {
    columns: { ...session('2026-11-02', 'alice', '2026-11-02 15:02', '#build'), status: 'draft_ready', drafted_at: '2026-11-02 16:20' },
    files: ['intake_test.jpg', 'odo_log.png'],
    messages: INTAKE_SOURCE,
    note: INTAKE,
    aiUntouched: ['title', 'time', 'attendees', 'goals', 'next_steps', 'section:0', 'section:1'],
  },
  {
    columns: { kind: 'quick', status: 'drafting', title: 'Quick note 2026-11-03', date: '2026-11-03', created_by: 'bob', created_at: '2026-11-03 21:14', failed_step: 'ai', error: 'Request timed out after 60 s (3/3 attempts)', failed_at: '2026-11-03 21:16',
      source_text: 'Tested the intake 5 more times with the compliant wheels, 5/5 pulled in. Changed speed to 0.6, no more launching.\nOdometry still drifts. Carol thinks the dead wheel spring is too loose, opening it up tomorrow.' },
  },
  {
    columns: { ...session('2026-11-04', 'grace', '2026-11-04 15:10', '#software'), status: 'collecting', title: 'Session #software' },
    messages: Array.from({ length: 12 }, (_, i) => ({ author: i % 2 ? 'Carol Wu' : 'Grace Liu', at: `2026-11-04 15:${10 + i * 3}`, content: 'autonomous path follower tuning, pid gains', attachment_ids: [] })),
  },
]

const placeholder = (label: string) =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#E7E7E1"/><text x="400" y="258" font-family="sans-serif" font-size="30" fill="#77776F" text-anchor="middle">${label}</text></svg>`)).png().toBuffer()

async function seed() {
  if ((db.prepare('select count(*) c from entries').get() as { c: number }).c) return
  for (const [id, name, admin] of MEMBERS) {
    db.prepare('insert or ignore into members (discord_id, discord_name, real_name, is_admin, registered_at) values (?, ?, ?, ?, ?)').run(id, id, name, admin, '2026-09-02')
  }
  for (const s of SEEDS) {
    const keys = Object.keys(s.columns)
    const id = Number(db.prepare(`insert into entries (${keys}) values (${keys.map(() => '?')})`).run(...Object.values(s.columns)).lastInsertRowid)

    const ids: number[] = []
    for (const f of s.files ?? []) ids.push(await saveUpload(id, f, 'image/png', await placeholder(f)))
    const remap = (n: NotebookEntry): NotebookEntry => ({
      ...n,
      sections: n.sections.map((sec: Section) => ({ ...sec, images: sec.images.map((im) => ({ ...im, attachment_id: ids[im.attachment_id - 1] })) })),
    })
    const messages = (s.messages ?? []).map((m) => ({ ...m, attachment_ids: (m.attachment_ids as number[]).map((n) => ids[n - 1]) }))
    db.prepare('update entries set source_messages = ? where id = ?').run(JSON.stringify(messages), id)

    if (s.note) {
      const note = remap(s.note)
      db.prepare('update entries set entry = ?, title = ?, ai_untouched = ? where id = ?').run(JSON.stringify(note), note.title, JSON.stringify(s.aiUntouched ?? []), id)
      if (s.columns.status === 'approved') {
        db.prepare('update entries set slug = ?, rendered_md = ? where id = ?').run(
          slugify(note.title),
          renderMarkdown(note, { submitted_by: nameOf(s.columns.submitted_by), approved_by: nameOf(s.columns.approved_by), approved_at: s.columns.approved_at }),
          id,
        )
      }
      writeFts(id, note)
    }
    for (const [editor, at, what, note] of s.revisions ?? []) {
      db.prepare('insert into entry_revisions (entry_id, editor_id, edited_at, what, entry) values (?, ?, ?, ?, ?)').run(id, editor, at, what, JSON.stringify(remap(note)))
    }
  }
}

/** ponytail: canned reply, no real understanding: it echoes the notes and marks the rest [needs input]. Set LLM_API_KEY for real drafts. */
export function cannedDraft(prompt: string): NotebookEntry {
  const revising = prompt.match(/Current draft:\n(.*)\n\nChange it as follows, keep everything else: (.*)$/s)
  if (revising) {
    const note = JSON.parse(revising[1]) as NotebookEntry
    return { ...note, next_steps: [...note.next_steps, revising[2]] }
  }
  const raw = prompt.match(/Notes:\n(.*?)\n\nAttachments:/s)?.[1] ?? ''
  const notes = raw === '(none)' ? '' : raw
  return {
    title: notes.split('\n')[0].slice(0, 60) || 'Untitled', date: '', start_time: '', end_time: '', attendees: [], goals: [NI],
    sections: [{
      subsystem: config.subsystems.find((s) => notes.toLowerCase().includes(s.toLowerCase())) ?? config.subsystems[0],
      work_done: notes || NI, problems: [], decisions: [], test_results: null,
      images: [...prompt.matchAll(/^#(\d+) (.+) \(image attached below\)$/gm)].map((m) => ({ attachment_id: Number(m[1]), caption: m[2] })),
    }],
    next_steps: [NI],
  }
}

const cannedModel = new MockLanguageModelV4({
  doGenerate: async ({ prompt }) => {
    await new Promise((r) => setTimeout(r, 2000)) // long enough to see the drafting state
    const user = prompt.find((m) => m.role === 'user')!.content[0] as { text: string }
    return {
      content: [{ type: 'text', text: JSON.stringify(cannedDraft(user.text)) }], warnings: [],
      finishReason: { unified: 'stop', raw: undefined },
      usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
    }
  },
})

export async function startDemo() {
  await seed()
  if (!config.llmKey) setModel(cannedModel)
}
