import { mkdirSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { NotebookEntry, Status } from '../shared/entry.ts'
import { config } from './config.ts'

mkdirSync(config.dataDir, { recursive: true })
export const db = new DatabaseSync(process.env.DB ?? `${config.dataDir}/glaucus.db`)
db.exec('pragma journal_mode = wal; pragma foreign_keys = on;')

// plan.md §2, plus the bookkeeping columns the UI shows (who / when for each step).
db.exec(`
create table if not exists members (
  discord_id    text primary key,
  team_id       text not null default 'default',
  discord_name  text not null default '',
  real_name     text not null default '',      -- '' until /register
  is_admin      integer not null default 0,    -- refreshed from the Discord role at each login
  registered_at text
);

create table if not exists entries (
  id              integer primary key,
  team_id         text not null default 'default',
  kind            text not null check (kind in ('web','session','quick')),
  status          text not null check (status in
                    ('collecting','drafting','draft_ready','pending_approval','approved','discarded')),
  channel_id      text,
  thread_id       text,
  date            text not null,
  started_at      text,
  ended_at        text,
  created_by      text not null,
  created_at      text not null,
  source_text     text,
  source_messages text not null default '[]',
  entry           text,
  ai_untouched    text not null default '[]',
  title           text not null default '',
  slug            text,
  rendered_md     text,
  drafted_at      text,
  revising        text,
  submitted_by    text,
  submitted_at    text,
  approved_by     text,
  approved_at     text,
  returned_by     text,
  returned_at     text,
  return_reason   text,
  discarded_by    text,
  discarded_at    text,
  failed_step     text,
  error           text,
  failed_at       text,
  version         integer not null default 1,
  updated_at      text
);
create unique index if not exists one_session_per_channel
  on entries(channel_id) where kind = 'session' and status = 'collecting';
create unique index if not exists one_open_quick_per_day
  on entries(date) where kind = 'quick' and status in ('collecting','drafting','draft_ready');
create unique index if not exists slug_per_day on entries(date, slug) where slug is not null;

create table if not exists attachments (
  id          integer primary key,
  entry_id    integer not null references entries(id),
  filename    text not null,
  mime        text not null,
  orig_path   text not null default '',
  small_path  text,
  caption     text not null default '',
  sent_to_llm integer not null default 0
);

-- One row per approved version: written at approval and at each admin edit afterwards.
create table if not exists entry_revisions (
  id        integer primary key,
  entry_id  integer not null references entries(id),
  editor_id text not null,
  edited_at text not null,
  what      text not null,                     -- 'submit' | 'admin_edit'
  entry     text not null
);

create virtual table if not exists entries_fts using fts5(title, body, entry_id unindexed);
`)

export type Row = Record<string, string | number | null> & { id: number; status: Status; version: number }

export const getRow = (id: number) => db.prepare('select * from entries where id = ?').get(id) as Row | undefined

export function tx<T>(fn: () => T): T {
  db.exec('begin')
  try {
    const out = fn()
    db.exec('commit')
    return out
  } catch (err) {
    db.exec('rollback')
    throw err
  }
}

/** Atomic status change; false if the entry is not in one of `from` (someone got there first / illegal move). */
export function transition(id: number, from: Status[], to: Status, extra: Record<string, SQLInputValue> = {}) {
  const keys = Object.keys(extra)
  const set = ['status = ?', 'version = version + 1', ...keys.map((k) => `${k} = ?`)].join(', ')
  const r = db
    .prepare(`update entries set ${set} where id = ? and status in (${from.map(() => '?').join(',')})`)
    .run(to, ...keys.map((k) => extra[k]), id, ...from)
  return r.changes > 0
}

const strings = (x: unknown): string[] =>
  typeof x === 'string' ? [x] : x && typeof x === 'object' ? Object.values(x).flatMap(strings) : []

export function writeFts(id: number, note: NotebookEntry | null) {
  db.prepare('delete from entries_fts where entry_id = ?').run(id)
  if (note) db.prepare('insert into entries_fts (title, body, entry_id) values (?, ?, ?)').run(note.title, strings(note).join('\n'), id)
}

export function memberName(id: string | null | undefined) {
  if (!id) return null
  const m = db.prepare('select real_name, discord_name from members where discord_id = ?').get(id) as { real_name: string; discord_name: string } | undefined
  return m?.real_name || m?.discord_name || id
}
