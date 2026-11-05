# Glaucus Design Document

See [plan.md](plan.md) for implementation details.

An engineering notebook system for FTC teams: team members jot down notes in Discord or enter them directly on the web, an LLM organizes them into structured English notes, they are edited on the web, approved by another team member on the web, and then archived.

## 1. Scope

- **Do**: Collection, organization, review, and archiving of engineering notebook / portfolio material.
- **Don't do**: Rules / SDK documentation Q&A.
- **Users**: Initially serve a single team (single-tenant); the data tables reserve `team_id` for future opening up. Multi-tenant features (`/setup` wizard, permission isolation, admin backend) will be built when we actually open up.
- **Division of labor**: **The web is the primary interface** (draft editing, revisions, submission, approval, browsing, search, management); **Discord is just one information source** (sessions, @bot capture), and after capture it replies with a web link. Core logic (organization, storage, export) does not depend on Discord types. When there really is a second information source, we'll extract an adapter interface; for now we don't write one.
- **Privacy: entirely private**. Notes contain students' real names and photos (mostly minors). All web pages and image URLs require login to access; no public share links; the GitHub mirror repository and backup bucket are both set to private. When a competition needs a portfolio, export manually.

## 2. Tech Stack

| Purpose | Choice |
|---|---|
| Language | TypeScript (Node 26 LTS, built-in type stripping runs `.ts` directly, no build step for the backend) |
| Web backend | Hono (`@hono/node-server`) |
| Frontend | Vue 3 (`<script setup>`) + Vite + vue-router, built into static files served by Hono |
| UI | Tailwind + shadcn-vue |
| Validation | zod: write the `NotebookEntry` schema only once, shared by LLM output, API, and frontend forms |
| Discord | discord.js |
| LLM | Vercel AI SDK + `@ai-sdk/deepseek` (default deepseek-flash, model / `base_url` configurable, can switch to OpenAI / Anthropic) |
| Storage | SQLite (`node:sqlite`), FTS5 for agent history queries |
| Images | sharp |
| Login | Discord OAuth2 (direct `fetch` calls) + Hono signed cookie |
| GitHub mirror (optional) | System `git` (`child_process`) + local clone on the VPS, push directly to private repo main |
| Testing | `node --test` |
| Deployment | Docker Compose (app + Caddy), running on our own VPS |

**Process structure**: A single Node process running the Hono HTTP server, the discord.js bot, and a background loop (session idle detection). LLM draft generation uses in-process async tasks; the frontend polls for status.

**Repository structure**: `server/` (Hono + bot + agent), `web/` (Vue), `shared/` (zod schemas).

Explicitly not introducing: full-stack frameworks like Next.js / Nuxt, Pinia, form libraries, ORMs, Redis / task queues, dotenv (use `--env-file`), test frameworks, auth libraries, vector databases, Octokit, isomorphic-git, webhook services.

## 3. Collection

### 3.1 Web Entry

- Create a new entry on the web: paste text + upload images → generate draft (`kind=web`). Can record without going into Discord.
- Date defaults to today, editable; start/end times left blank, extracted by the LLM from the text, left blank if not extractable.

### 3.2 Discord Session

- `/session start [subsystem]`: creates a thread under the current text channel and starts a session. Any team member can start one, in any channel.
- **At most one session per channel at a time**; if the current channel already has one, reject and reply with the existing thread link. Different channels can run in parallel (e.g., mechanical group and programming group each start one in their own channel). Guaranteed by a database constraint, see §9.
- `/session end` (executed in the thread or its parent channel) ends that channel's session; or the thread **idles for 4 hours** (configurable) and ends automatically. Idle detection only looks at the thread's last message time.
- **On end, pull the entire thread history at once** + download attachments (URLs are freshly signed at this point, won't expire). No real-time listening, so message edits / deletions naturally take effect.
- Raw message snapshots are stored in the entry (`source_messages`), for the agent to reference during later revisions.
- On end, first lock the thread (requires the bot to have Manage Threads), to avoid messages sent afterward being missed without notice; after generating the draft, reply with the web link in both the thread and the parent channel, then archive the thread so it leaves the sidebar. If the thread has no messages, discard directly without calling the LLM. For sessions started by mistake: if no messages were sent, `/session end`; if messages were sent, end then discard on the web, so there is no `/session kill`.
- `/continue` (executed in the parent channel or thread; regular members may not be able to use it in a locked thread, so the parent channel is the main entry point): unlock and resume the most recent session in that channel, or the session of the thread it's in, back to `collecting`. Only `draft_ready` drafts can be resumed; reject if the channel already has an in-progress session. When ended again, new messages are merged into the existing draft; if there are no new messages, the LLM is not called and the draft is unchanged. During resumption, this draft is not visible or editable on the web.

### 3.3 @bot Quick Capture

- **Chat**: When the channel has no in-progress session, @bot first decides whether to chat or to record (one model call). For chat, it replies as Glaucus: he is a goose and a member of the team (persona in `agent.ts`, used only for chat; note content stays neutral). The model only sees the last 16 messages, cannot see images or notes, does not fabricate team facts; the reply is sent by code and cannot @ anyone. Messages with attachments are always treated as records. If the model call fails, reply with a hint and do not generate a note.
- When recording: code takes the previous **50** messages (hard cap), the model returns the indices of relevant messages, code saves by index and immediately downloads their attachments. The @bot message and the message it replies to are always kept; if model selection fails, only these two are used.
- Attribution (hardcoded rules):
  1. @bot in a session thread → no separate handling (pulled in full on end), just reply "recorded".
  2. Channel has an in-progress session → select only from messages after the session started (except the @bot message and the message it replies to), append to that session's `source_messages`. Earlier messages may already belong to another note.
  3. Otherwise → that day's **quick capture** (`kind=quick`): if there is already an unsubmitted quick for the day (`collecting` / `drafting` / `draft_ready`), merge into it, and the agent merges the new material into the draft; if none or already submitted, create a new one. Reply with the web link.
- "That day" is computed according to the team timezone in `config.toml`.

### 3.4 Attachments

- Save the original file to VPS local storage immediately on collection (Discord attachment download / web upload).
- Images: sharp downscales to long edge 1600px JPEG (about 300KB), used for sending to the LLM, web display, and mirroring to git.
- Non-images (videos, PDFs, CAD, etc.): store original file only, display on the web as download links, not sent to the LLM, not included in the git mirror.

## 4. LLM

### 4.1 Agent

- AI SDK generates structured output, validates `NotebookEntry` with zod, automatically retries the model on failure. The specific output mode (tool / json / schema-in-prompt) is subject to M0b actual testing, see §11.
- Revision: same set of capabilities, input = current draft + raw messages + natural-language revision instructions entered by the user on the web. Merging new material (§3.3) also goes through this path, with the revision instruction fixed as "merge the new messages into the draft".
- Tests use the AI SDK mock model (`ai/test`), not real API calls.

### 4.2 Tools (tentative, expandable)

| tool | Purpose |
|---|---|
| `search_entries(query)` | FTS5 search of historical notes, for cross-event connections (only searches `approved`) |
| `get_entry(id)` | Read the full text of a historical note |

The agent cannot touch Discord: the @bot context is fetched by code and then handed to the model for selection (§3.3). Real names and attachments also don't need tools: code puts author real names, attachment indices, and images directly into the prompt; `<@id>` mentions in Discord messages are replaced with real names at fetch time. The model references images by index in its output; indices not belonging to this note are discarded by code.

**The agent must not have**: submit, approve, return, git operations, send Discord messages. These are deterministic flows executed by code. The agent only produces and modifies note content—this is the code-level guarantee of "students are responsible for the content".

### 4.3 Images

- What's sent to the model is the compressed version, **capped at 20 per entry** (configurable). The excess is only attached, with a hint in the draft.
- deepseek-flash has vision; if the API doesn't accept images, switch provider (just change config).

### 4.4 Fact Constraints

System prompt + schema jointly constrain: **only write facts that appeared in the messages / images**. Data, model numbers, and measurements must not be fabricated; if missing, leave blank or mark `[needs input]`.

## 5. Note Schema

Defined in the zod schema in `shared/`, shared by frontend and backend:

```
NotebookEntry
  title: str                    # LLM-generated, manually editable; slug derived from it
  date, start_time, end_time
  attendees: [real name]        # defaults to message authors, can be added/removed on the web (people who attended but didn't speak)
  goals: [str]
  sections: [
    subsystem: str              # new drafts limited to the subsystem list in config.toml; old entries keep original values
    work_done: str
    problems: [str]
    decisions: [{decision, alternatives_considered, rationale}]
    test_results: str | null
    images: [{attachment_id, caption}]
  ]
  next_steps: [str]
```

Gradually enriched during development. Duration, outreach headcount, etc. are inferred from start/end times and attendees, no separate fields for now.

**Output language: English** (input can be any language).

**slug**: `title` converted to lowercase ASCII, hyphen-joined; same-day duplicates get `-2`, `-3`. Fixed at approval, unchanged afterward (stable mirror filenames).

## 6. Review and Archiving

### 6.1 Flow

1. Collection complete → agent generates draft → web draft page: raw messages / attachments on the left, structured form by `NotebookEntry` field on the right.
2. **Any logged-in team member** can:
   - Directly edit fields, add/remove sections / decisions, adjust image order and captions;
   - Use natural language in the input box to have the agent revise (e.g., "the second paragraph is wrong, we ended up choosing goBILDA wheels");
   - Regenerate (overwrites manual edits, confirm dialog before clicking);
   - Discard (→ `discarded`, no physical deletion);
   - Submit (→ `pending_approval`, records `submitted_by`).
3. **Approval**: Any team member other than the submitter can click Approve on the web (→ `approved`), or fill in a reason to return (→ `draft_ready`, reason displayed at the top of the draft page). bot-admin also cannot approve their own submission.
4. If someone edits during `pending_approval` → back to `draft_ready`, needs resubmission. Ensures what's approved is exactly the version the approver saw.
5. On approval: fix slug → render Markdown into `rendered_md` → if mirror configured, push to GitHub (§7).
6. **Read-only after archiving**, only bot-admin can modify. Before each modification, save the old version to `entry_revisions` (who, when, old JSON), re-render and re-push the mirror after modification. Status stays `approved`.

### 6.2 State Machine

```
collecting → drafting → draft_ready ⇄ pending_approval → approved
                ↑           │              (returned / edited)     (only bot-admin can modify, revision records kept)
                └───────────┘
              (AI revision / regeneration)
draft_ready → discarded
drafting → discarded (empty session, or failed with no running task)
```

Web-entered entries start from `drafting`. Failure is not a state; recorded in the `failed_step` / `error` fields (§10.2).

### 6.3 Concurrent Editing

- On save, include the `version` read at load time; reject if inconsistent with the database, prompt "someone else edited it, please refresh".
- During `drafting` (AI generation / revision in progress), the form is read-only.

### 6.4 Data Source

**SQLite is the single source of truth**. The GitHub repository is only a mirror of approved notes, overwritten on each push. **Manual direct commits to the mirror repository are forbidden**; all modifications go through the web.

### 6.5 Rendering

- LLM only outputs `NotebookEntry`.
- Web preview: Vue renders directly from entry JSON.
- Markdown: a TS function (template string) renders it, ensuring consistent format and clean git diffs. File header states "generated by bot, do not edit manually". On the web, you can download a single `.md`, or package selected entries into a zip (with compressed images). Future PDF export = just another template.

## 7. GitHub Mirror (Optional)

If no repository is configured in `config.toml`, skip entirely.

- **Separate private repository** (separate from the code repository).
- Directory: `entries/<date>-<slug>.md` + `assets/<date>/<file>.jpg` (compressed version). No Git LFS.
- **Identity**: fine-grained PAT, authorized only for that repository, permission `contents:write`. Bot pushes directly to main, no PRs, no branches.
- Each approval / bot-admin modification = one commit, message includes entry title, approver or modifier.
- Force push to main is forbidden (just set it in branch protection).
- Push failure records `failed_step=mirror`, retryable, doesn't affect the entry already being `approved` on the web.

## 8. Identity, Roles, Configuration

- **First-time setup**: The server can start without configuration; the first time any page is opened it redirects to `/setup`. On a new server, whoever opens it first can take it over, so a one-time token must be entered; the token is only printed in the server logs and changes on every restart. The page fills in and tests the site URL, timezone, LLM (one real call), and Discord (bot token, client secret, Message Content intent, OAuth redirect URL, bot permissions), selects the server, allowed roles, `bot-admin` role, and log channel, and can search members to test whether they can enter. On clicking finish, the server runs all tests again; on pass, saves and starts the bot, no restart needed. After completion `/setup` is closed; to reconfigure, delete `data/settings.json` and restart.
- **Usage permissions**: Only members with any allowed role (multiple allowed, e.g., Coach and Team 5898) or the `bot-admin` role can use Glaucus; when no roles are configured, no one except `bot-admin` is allowed. Others will get an error when logging into the web, using slash commands, or @bot, and their messages in threads do not enter notes.
- **Login**: Web login uses Discord OAuth2 (scope `identify`), directly obtaining `discord_id`. After login, the bot checks whether the person is in the team's Discord server and has an allowed role, otherwise rejects. First login requires filling in real name.
- **Unregistered users** (never logged in on the web) appearing in a Discord session: temporarily use Discord display name, mark `[unregistered]` in the draft, and remind once in the thread and parent channel to log in on the web.
- **Roles**:
  - Team member (any logged-in person): edit drafts, submit, approve / return entries submitted by others.
  - `bot-admin` (Discord role, queried by bot at login): on the web can retry from failed steps, modify others' registered names, modify archived entries, view each member's AI token usage.
- **AI usage** (anti-abuse): Input and output tokens of every AI call are recorded, attributed to the person who triggered it: web entry, revision, regeneration, and retry count as the operator; `/session end` counts as the person who ended it; @bot (including chat) counts as the person who @'d; sessions ended by idle timeout count as the person who started them. Invalid-response retries are also counted. Statistics only, no quota.
- **Configuration** (later overrides earlier):
  - `config.toml` (optional): subsystem list, idle timeout, image cap, and the non-secret items collected by the settings page below. Restart required after changes.
  - `data/settings.json` (written by `/setup`, permission 600): Discord server, allowed roles, `bot-admin` role, log channel, site URL, team timezone, LLM `base_url` / model, and secrets. Cookie signing key is auto-generated on first start and stored here. Backups will include this file, so the backup bucket must be private.
  - Environment variables (optional): Discord bot token, OAuth client secret, cookie signing key, LLM API key. If set, the corresponding item cannot be modified on the settings page.

## 9. Data Model (SQLite)

```
members         (team_id, discord_id PK, real_name, registered_at)
entries         (id PK, team_id, kind[web|session|quick],
                 status[collecting|drafting|draft_ready|pending_approval|approved|discarded],
                 thread_id?, channel_id?, date, started_at, ended_at,
                 source_messages JSON, entry JSON, title, slug?, rendered_md?,
                 submitted_by?, approved_by?, approved_at?, return_reason?,
                 failed_step?, error?, version, updated_at)   -- version used for optimistic locking
attachments     (id PK, entry_id FK, filename, mime, orig_path, compressed_path?, caption, sent_to_llm)
entry_revisions (id PK, entry_id FK, editor_id, edited_at, entry JSON)   -- only records modifications after archiving
entries_fts     FTS5 virtual table, indexes entry text content
```

- At most one in-progress session per channel: `CREATE UNIQUE INDEX ... ON entries(channel_id) WHERE kind='session' AND status='collecting'`.
- Login state is stored in a signed cookie, no session table.

## 10. Operations

### 10.1 Log Channel

The Discord log channel records **errors + key state changes**, one line each, with `entry_id` and step:

- States: session start / end, submit, approve, return, bot-admin modification of archived entry.
- Errors: LLM call failure, schema validation failure, attachment download failure, mirror push failure.

### 10.2 Failure Handling

- On failure, record `failed_step` + `error`, send a message to the log channel, and the entry shows the error on the web.
- `bot-admin` clicks retry on the web, continuing from the failed step. No automatic background retry queue.

### 10.3 Deployment

- Docker Compose: app + Caddy. Caddy reverse-proxies and automatically issues HTTPS certificates; VPS only opens 80 / 443.
- Requires a domain (Discord OAuth callback URL must be fixed).

### 10.4 Backup

Daily cron: `sqlite3 .backup` + original file directory, pushed to private B2 / R2 bucket via `rclone`.

## 11. LLM Empirical Findings

### M0 (2026-10-04, Python + pydantic-ai 2.54)

- deepseek-flash (DeepSeek-V4.1-Flash, 1M context, input supports text + image) passed all three: structured output, function calling, image input.
- **Pitfall**: In thinking mode, forced `tool_choice` is not supported, nor is `json_schema` response_format.
  → At the time used pydantic-ai's `PromptedOutput`: schema written into prompt, validation + retry; coexists fine with regular tools.
- Reproduce: `uv run spikes/m0_llm.py` (for reference only after migration to TS).

### M0b (2026-11-04, TS, `ai` 7.0.162 + `@ai-sdk/deepseek` 3.0.79)

- Structured output, function calling coexisting with structured output, image input all pass, thinking on / off both work.
- **Conclusion: use `Output.object({ schema: NotebookEntry })`, no longer hand-write schema prompt.** Thinking stays default (on). On parse or validation failure, throws `NoObjectGeneratedError`, `agent.ts` retries with error message, up to 3 times; network, auth, etc. errors are thrown directly.
- The SDK here is in compatibility mode: sets `response_format: json_object`, injects schema into system message, thus bypassing the `json_schema` limitation found in M0.
- **Pitfall**: When schema is hand-written into the prompt with thinking on, the model often returns the JSON Schema itself as the answer.

Same fake messages and `get_member` tool, 6 runs per cell, counting passes on first try (small sample, trend only):

| Output method | thinking on | thinking off |
|---|---|---|
| Hand-written schema prompt + zod | 2/6 | 6/6 |
| `Output.object` | 6/6 | 6/6 |

- Formal path `compose()` (thinking on, with one image): 10/10 success, 13 HTTP requests total, average 5.6 s; facts (9/10, compliant decision) all preserved, images all referenced correctly.
- Not verified: whether `search_entries` / `get_entry` are called by the model in `compose()` (tool coexistence only verified with `get_member`).
- Observed: When material has timestamps, the model fills the first and last message times as `start_time` / `end_time` (start 10/10, end 9/10), which may not be the actual activity time; human review is the safeguard.
- Reproduce: `node --env-file=.env spikes/m0b_llm.ts`.
