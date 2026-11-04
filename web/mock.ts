// ponytail: in-memory sample data + fake AI so the UI is clickable before the server exists.
// Swap these functions for fetch calls to /api/* (plan.md §4) once server/ lands; shapes follow plan.md §2.
import { reactive } from 'vue'

export type Status = 'collecting' | 'drafting' | 'draft_ready' | 'pending_approval' | 'approved' | 'discarded'
export type Kind = 'web' | 'session' | 'quick'
export type Step = 'ai' | 'attachments' | 'interrupted' | 'mirror'

export interface Decision { decision: string; alternatives_considered: string[]; rationale: string }
export interface Section {
  subsystem: string
  work_done: string
  problems: string[]
  decisions: Decision[]
  test_results: string | null
  images: { attachment_id: number; caption: string }[]
}
export interface NotebookEntry {
  title: string
  date: string
  start_time: string
  end_time: string
  attendees: string[]
  goals: string[]
  sections: Section[]
  next_steps: string[]
}
export interface SourceMessage { author: string; at: string; content: string; attachment_ids: number[] }
export interface Attachment { id: number; filename: string; size?: number; url?: string; from?: string }
export interface Revision { v: number; by: string; at: string; what: string; entry: NotebookEntry }
export interface Entry {
  id: number
  kind: Kind
  status: Status
  title: string
  date: string
  channel?: string
  created_by: string
  created_at: string
  source_messages: SourceMessage[]
  source_text?: string
  attachments: Attachment[]
  entry: NotebookEntry | null
  ai_untouched: string[] // 'title' | 'time' | 'attendees' | 'goals' | 'next_steps' | 'section:<i>'
  drafted_at?: string
  submitted_by?: string
  submitted_at?: string
  approved_by?: string
  approved_at?: string
  discarded_by?: string
  discarded_at?: string
  returned?: { by: string; at: string; reason: string }
  revising?: string // instruction while the AI is revising
  failed_step?: Step
  error?: string
  failed_at?: string
  version: number
  revisions: Revision[]
}
export interface Member { discord_id: string; discord_name: string; real_name: string; is_admin: boolean; registered_at: string }

export const NI = '[needs input]'
export const SUBSYSTEMS = ['Intake', 'Drivetrain', 'Outtake', 'Software', 'Strategy', 'Outreach']

export const members = reactive<Member[]>([
  { discord_id: 'eli', discord_name: 'eli.x', real_name: 'Eli Xiao', is_admin: true, registered_at: '2026-09-02' },
  { discord_id: 'alice', discord_name: 'alicechen', real_name: 'Alice Chen', is_admin: false, registered_at: '2026-09-02' },
  { discord_id: 'bob', discord_name: 'bobli_ftc', real_name: 'Bob Li', is_admin: false, registered_at: '2026-09-03' },
  { discord_id: 'carol', discord_name: 'carolw', real_name: 'Carol Wu', is_admin: true, registered_at: '2026-09-03' },
  { discord_id: 'dan', discord_name: 'dpark', real_name: 'Daniel Park', is_admin: false, registered_at: '2026-09-10' },
  { discord_id: 'grace', discord_name: 'grace.liu', real_name: 'Grace Liu', is_admin: false, registered_at: '2026-09-18' },
  { discord_id: 'sam', discord_name: 'samo', real_name: 'Sam Ortiz', is_admin: false, registered_at: '2026-10-07' },
])
export const me = members[0]

const now = () => new Date().toLocaleString('sv').slice(0, 16) // sv = 'YYYY-MM-DD HH:mm', local time
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))
export const countNI = (x: unknown) => JSON.stringify(x ?? '').split(NI).length - 1
export const isRegistered = (name: string) => members.some((m) => m.real_name === name)

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
const ALL_AI = ['title', 'time', 'attendees', 'goals', 'next_steps', 'section:0', 'section:1']

const INTAKE_SOURCE: SourceMessage[] = [
  { author: 'Alice Chen', at: '2026-11-02 15:02', content: '今天调 intake，原来 REV 的轮子太滑，球老是吸不进来', attachment_ids: [] },
  { author: 'Bob Li', at: '2026-11-02 15:20', content: '试了 goBILDA 的 gripper wheel 和 compliant wheel，compliant 吸得最稳，10 次成功 9 次', attachment_ids: [1] },
  { author: 'Alice Chen', at: '2026-11-02 15:41', content: '那就定 compliant 了，下次把转速从 0.8 降到 0.6 试试，现在有点打飞', attachment_ids: [] },
  { author: 'Carol Wu', at: '2026-11-02 16:05', content: '底盘那边 odometry 偏了，还没查出原因', attachment_ids: [2] },
]
const INTAKE_FILES: Attachment[] = [
  { id: 1, filename: 'intake_test.jpg', from: 'Bob Li · 15:20' },
  { id: 2, filename: 'odo_log.png', from: 'Carol Wu · 16:05' },
]

const GEAR_V2: NotebookEntry = {
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
    images: [{ attachment_id: 31, caption: 'Push test setup' }],
  }],
  next_steps: ['Order two more 19.2:1 gearboxes'],
}
const GEAR = clone(GEAR_V2)
GEAR.sections[0].images[0].caption = 'Push test setup against the practice bot'

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

const simple = (title: string, date: string, subsystem: string, work: string, people: string[]): NotebookEntry => ({
  title, date, start_time: '15:00', end_time: '17:00', attendees: people, goals: [],
  sections: [{ subsystem, work_done: work, problems: [], decisions: [], test_results: null, images: [] }],
  next_steps: [],
})

const base = { source_messages: [], attachments: [], entry: null, ai_untouched: [], version: 1, revisions: [] }

export const entries = reactive<Entry[]>([
  {
    ...base, id: 1, kind: 'session', status: 'collecting', title: 'Session #software', date: '2026-11-04', channel: '#software',
    created_by: 'Grace Liu', created_at: '2026-11-04 15:10',
    source_messages: Array.from({ length: 12 }, (_, i) => ({ author: i % 2 ? 'Carol Wu' : 'Grace Liu', at: '2026-11-04 15:' + String(10 + i * 3), content: 'autonomous path follower tuning, pid gains', attachment_ids: [] })),
  },
  {
    ...base, id: 2, kind: 'web', status: 'drafting', title: 'Outtake slide tensioning', date: '2026-11-04',
    created_by: 'Eli Xiao', created_at: '2026-11-04 14:02',
    source_text: 'outtake 的滑轨线又松了，换了新的 spool，张紧后升降顺了很多。',
    attachments: [{ id: 21, filename: 'slide_before.jpg' }, { id: 22, filename: 'slide_after.jpg' }, { id: 23, filename: 'spool.jpg' }],
  },
  {
    ...base, id: 3, kind: 'quick', status: 'drafting', title: 'Quick note 2026-11-03', date: '2026-11-03',
    created_by: 'Bob Li', created_at: '2026-11-03 21:14',
    source_text: 'intake 换成 compliant 轮以后又测了 5 次，5 次都吸进来了。转速改成 0.6，没有再打飞。\nodometry 还是偏，Carol 觉得是 dead wheel 的弹簧太松，明天拆开看。',
    failed_step: 'ai', error: 'Request timed out after 60 s (3/3 attempts)', failed_at: '2026-11-03 21:16',
  },
  {
    ...base, id: 4, kind: 'session', status: 'draft_ready', title: INTAKE.title, date: '2026-11-02', channel: '#build',
    created_by: 'Alice Chen', created_at: '2026-11-02 15:02', drafted_at: '2026-11-02 16:20',
    source_messages: INTAKE_SOURCE, attachments: INTAKE_FILES, entry: clone(INTAKE), ai_untouched: ALL_AI,
  },
  {
    ...base, id: 5, kind: 'web', status: 'pending_approval', title: AUTO.title, date: '2026-10-30',
    created_by: 'Carol Wu', created_at: '2026-10-30 18:10', drafted_at: '2026-10-30 18:12',
    submitted_by: 'Carol Wu', submitted_at: '2026-10-30 19:02',
    source_text: 'auto 左边路线第二个弯冲过头了，kP 从 0.12 降到 0.08，跑了 10 次都在 2cm 以内。',
    entry: AUTO,
  },
  {
    ...base, id: 6, kind: 'session', status: 'approved', title: GEAR.title, date: '2026-10-28', channel: '#build',
    created_by: 'Bob Li', created_at: '2026-10-28 15:30', drafted_at: '2026-10-28 17:20',
    submitted_by: 'Bob Li', submitted_at: '2026-10-28 21:05', approved_by: 'Eli Xiao', approved_at: '2026-10-29 09:12',
    source_messages: [
      { author: 'Bob Li', at: '2026-10-28 15:40', content: '13.7 的一推就停转，19.2 推了 5 次都没事', attachment_ids: [31] },
      { author: 'Daniel Park', at: '2026-10-28 16:20', content: '19.2 过场大概 2 秒，13.7 是 1.4 秒', attachment_ids: [] },
    ],
    attachments: [{ id: 31, filename: 'push_test.jpg', from: 'Bob Li · 15:40' }],
    entry: GEAR, version: 3,
    revisions: [
      { v: 3, by: 'Carol Wu', at: '2026-11-04 10:30', what: 'admin_edit', entry: GEAR },
      { v: 2, by: 'Bob Li', at: '2026-10-28 21:05', what: 'resubmit', entry: GEAR_V2 },
      { v: 1, by: 'Bob Li', at: '2026-10-28 18:40', what: 'submit_ai', entry: { ...GEAR_V2, end_time: NI } },
    ],
  },
  {
    ...base, id: 7, kind: 'session', status: 'discarded', title: 'Test session (duplicate)', date: '2026-10-26', channel: '#build',
    created_by: 'Alice Chen', created_at: '2026-10-26 15:00', drafted_at: '2026-10-26 16:20',
    discarded_by: 'Alice Chen', discarded_at: '2026-10-27 10:02',
    source_messages: INTAKE_SOURCE.slice(0, 2), attachments: INTAKE_FILES.slice(0, 1),
    entry: { ...clone(INTAKE), title: 'Test session (duplicate)', date: '2026-10-26' },
  },
  {
    ...base, id: 8, kind: 'web', status: 'approved', title: 'Library STEM night demo', date: '2026-10-24',
    created_by: 'Grace Liu', created_at: '2026-10-24 20:30', drafted_at: '2026-10-24 20:31',
    submitted_by: 'Grace Liu', submitted_at: '2026-10-24 21:00', approved_by: 'Bob Li', approved_at: '2026-10-25 08:40',
    source_text: '图书馆 STEM night，小朋友在小场地里开机器人，来了大概 40 个人。',
    entry: simple('Library STEM night demo', '2026-10-24', 'Outreach', 'Demoed the robot at the public library STEM night; kids drove the robot in a small field.', ['Grace Liu', 'Sam Ortiz']),
  },
  {
    ...base, id: 9, kind: 'session', status: 'approved', title: 'Intake prototype v1 build', date: '2026-10-21', channel: '#build',
    created_by: 'Alice Chen', created_at: '2026-10-21 15:00', drafted_at: '2026-10-21 17:30',
    submitted_by: 'Alice Chen', submitted_at: '2026-10-21 19:00', approved_by: 'Carol Wu', approved_at: '2026-10-22 08:15',
    source_messages: [{ author: 'Alice Chen', at: '2026-10-21 15:10', content: '第一版 intake 装好了，REV 轮子 + 聚碳酸酯板', attachment_ids: [] }],
    entry: simple('Intake prototype v1 build', '2026-10-21', 'Intake', 'Built the first intake prototype with REV wheels on a polycarbonate plate.', ['Alice Chen', 'Bob Li']),
  },
  {
    ...base, id: 10, kind: 'session', status: 'drafting', title: 'Session #build · 10-25', date: '2026-10-25', channel: '#build',
    created_by: 'Alice Chen', created_at: '2026-10-25 15:00',
    source_messages: [{ author: 'Alice Chen', at: '2026-10-25 15:05', content: '拍了几张新底盘的照片', attachment_ids: [41] }],
    attachments: [{ id: 41, filename: 'IMG_2031.HEIC', from: 'Alice Chen · 15:05' }],
    failed_step: 'attachments', error: 'Discord CDN returned 403 for IMG_2031.HEIC', failed_at: '2026-10-25 18:02',
  },
])

export const getEntry = (id: number) => entries.find((e) => e.id === id)

let nextId = 100
const fakeAI = (e: Entry, make: () => NotebookEntry, fresh: boolean) => {
  e.status = 'drafting'
  e.failed_step = e.error = undefined
  setTimeout(() => {
    e.entry = make()
    e.title = e.entry.title
    if (fresh) e.ai_untouched = ['title', 'time', 'attendees', 'goals', 'next_steps', ...e.entry.sections.map((_, i) => 'section:' + i)]
    e.status = 'draft_ready'
    e.drafted_at = now()
    e.revising = undefined
    e.version++
  }, 3000)
}

export function createEntry(text: string, date: string, files: File[]) {
  const e: Entry = {
    ...clone(base), id: nextId++, kind: 'web', status: 'drafting', title: text.split('\n')[0].slice(0, 60) || 'Untitled', date,
    created_by: me.real_name, created_at: now(), source_text: text,
    attachments: files.map((f) => ({ id: nextId++, filename: f.name, size: f.size, url: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined })),
  }
  entries.unshift(e)
  const imgs = e.attachments.filter((a) => a.url)
  fakeAI(e, () => ({
    ...clone(INTAKE), title: e.title, date, attendees: [me.real_name],
    sections: [{ ...clone(INTAKE.sections[0]), images: imgs.slice(0, 2).map((a) => ({ attachment_id: a.id, caption: NI })) }],
  }), true)
  return e.id
}

export const regenerate = (e: Entry) => fakeAI(e, () => clone(INTAKE), true)
export const revise = (e: Entry, instruction: string) => {
  e.revising = instruction
  const current = clone(e.entry!)
  fakeAI(e, () => current, false)
}
export const retry = (e: Entry) => fakeAI(e, () => clone(INTAKE), true)

/** Returns false on a version conflict (someone else saved first). */
export function save(e: Entry, note: NotebookEntry, version: number, aiUntouched: string[]) {
  if (version !== e.version) return false
  if (e.status === 'approved') e.revisions.unshift({ v: e.version + 1, by: me.real_name, at: now(), what: 'admin_edit', entry: clone(note) })
  if (e.status === 'pending_approval') { e.status = 'draft_ready'; e.submitted_by = e.submitted_at = undefined }
  e.entry = clone(note)
  e.title = note.title
  e.ai_untouched = aiUntouched
  e.version++
  return true
}
export function submit(e: Entry) {
  Object.assign(e, { status: 'pending_approval', submitted_by: me.real_name, submitted_at: now(), returned: undefined })
}
export function approve(e: Entry) {
  Object.assign(e, { status: 'approved', approved_by: me.real_name, approved_at: now() })
  e.revisions.unshift({ v: e.revisions.length + 1, by: e.submitted_by!, at: e.submitted_at!, what: 'submit', entry: clone(e.entry!) })
}
export function returnEntry(e: Entry, reason: string) {
  Object.assign(e, { status: 'draft_ready', returned: { by: me.real_name, at: now(), reason }, submitted_by: undefined, submitted_at: undefined })
}
export function reopen(e: Entry) {
  Object.assign(e, { status: 'draft_ready', submitted_by: undefined, submitted_at: undefined })
}
export function discard(e: Entry) {
  Object.assign(e, { status: 'discarded', discarded_by: me.real_name, discarded_at: now() })
}
