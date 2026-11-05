# Goals and Milestones

See [design.md](design.md) for design details.

## Goals

### What to build

1. **Low-friction capture**: Team members can jot notes casually in Discord (session thread / @bot), or enter them directly on the web (paste text + upload images).
2. **Automatic organization**: The LLM organizes raw material into a structured English `NotebookEntry`. It writes only facts that appeared in the material; data, model numbers, and measurements are not fabricated, and missing items are marked `[needs input]`.
3. **Web review and editing**: The draft page has raw material on the left and a structured form on the right; you can manually edit fields, adjust image order and captions, use natural language to have the AI revise the draft, and regenerate.
4. **Archive after human review**: After submission, another team member approves it on the web; after archiving, only bot-admin can modify it, with revision records kept. Optionally mirror to a private GitHub repository.
5. **Searchable**: Browse and full-text search historical notes on the web; when the agent writes new notes, it can query history and make cross-event connections.
6. **Students are responsible for the content**: The agent only produces and modifies note content, plus chat reply text; submission, approval, git, and sending messages are all executed by deterministic code.
7. **Entirely private**: All pages and images require login; the mirror repository and backup bucket are private.
8. **Easy to maintain**: Failures are visible and can be retried from the failed step; daily backups; deployment on a single VPS with one `docker compose up`.

### What not to build

- Rules / SDK documentation Q&A.
- Multi-tenancy (the data tables reserve `team_id`; build it when we actually open up).
- Real-time listening to Discord messages (pull everything at once when the session ends).
- Automatic background retry queue (failures are manually retried by `bot-admin`).
- GitHub PR review flow (replaced by web Approve).
- Public sharing / public display.

## Milestones

Principle: first close the loop **entry → draft → edit → approve** on the web, then connect Discord as an information source. Each milestone has verifiable acceptance criteria.

### M0 — LLM empirical testing (spike, Python) ✅

Verify the riskiest assumptions first, without writing them into production code.

- [x] A script: pydantic-ai + deepseek-flash, input a few fake messages → output `NotebookEntry`
- [x] Verify function calling: register a fake tool and confirm the model calls it
- [x] Verify image input: pass a compressed image and confirm the model can describe it
- [x] Record conclusions; retest failing items with OpenAI / Anthropic

**Acceptance**: All three pass (or a replacement provider has been determined).

### M0b — LLM empirical testing (spike, TS) ✅

Switch the tech stack to TS and retest the same three items with the AI SDK.

- [x] A script: AI SDK + `@ai-sdk/deepseek`, fake messages → zod-validated `NotebookEntry`
- [x] Determine a usable structured output mode (in thinking mode, tool / json modes may not be supported; fallback is schema-in-prompt + zod parsing + retry)
- [x] Verify function calling coexists with structured output
- [x] Verify image input
- [x] Write conclusions back to design.md §11

**Acceptance**: All three pass, and the output mode is determined.

### M1 — Skeleton

- [x] Repository structure `server/` / `web/` / `shared/`, `package.json`, `tsconfig`, `config.toml` + `.env` loading
- [x] SQLite schema initialization (members / entries / attachments / entry_revisions / entries_fts, including the unique index for one session per channel)
- [x] Hono server + Vue (Vite) build artifact hosting, Tailwind + shadcn-vue wired up; all routes and attachment URLs require login by default
- [x] discord.js bot online, with Message Content intent enabled
- [ ] Discord OAuth login + server member check + real name on first login; signed cookie (real account login has passed; non-team-member rejection awaits confirmation with a second account)
- [x] Log channel send function

**Acceptance**: Log in with Discord in the browser and fill in real name; non-team-member login is rejected; unauthenticated access to attachment URLs is rejected; the log channel receives "bot started".

### M2 — Web entry and drafts ✅

- [x] `NotebookEntry` zod schema (`shared/`, including `title`)
- [x] New entry page: paste text + upload attachments (images compressed by sharp to 1600px, non-images store original file only), date defaults to today
- [x] Agent + tools (`search_entries`, `get_entry`)
- [x] Fact-constraint system prompt
- [x] Asynchronous draft generation, frontend polls status
- [x] Draft page: raw material on the left, structured form on the right; save (`updated_at` optimistic locking, read-only during `drafting`)
- [x] AI revision input box, regenerate (with confirmation dialog), discard
- [x] Entry list + full-text search (frontend substring matching; switch to FTS5 when there are enough notes that the list is noticeably slow)
- [x] A mock model test: fake messages → draft → validation passes, no real API call

**Acceptance**: Paste text and upload images on the web → an English draft appears; manually edit a field and use AI to revise a sentence, both save correctly.

**Known risk**: AI revision re-outputs the whole document, and the code does not guarantee that unmentioned content stays unchanged. Tested 4 times on 2026-11-04: 3 times manual edits were preserved, 1 time the title and image captions were changed (the text at the time had `VERIFY` markers, looking like placeholder content).

### M3 — Approval and archiving (loop complete) ✅

- [x] Submit → `pending_approval`; others Approve / fill in a reason to return; the submitter cannot approve their own submission
- [x] Edited during `pending_approval` → back to `draft_ready`
- [x] On approval, fix slug and render Markdown (template string)
- [x] Read-only after archiving; bot-admin modifications write `entry_revisions`, revision history viewable on the web
- [x] Download a single `.md`, package selected multiple entries into a zip (with compressed images)
- [x] State changes written to the log channel

**Acceptance**: A enters on the web → draft → submit; A cannot click Approve themselves; B returns it, A revises and resubmits, B approves → status `approved`, `.md` can be downloaded; bot-admin changes a field, and the old version is visible in revision history.

### M4 — Discord integration ✅

- [x] `/session start [subsystem]` creates a thread in the current channel; if the channel already has a session, reject and give the link
- [x] `/session end` (acts on the current channel's session)
- [x] Idle timeout detection (background loop, checks the thread's last message time)
- [x] On end, pull the entire thread history → `source_messages` (`<@id>` mentions replaced with real names by code), download attachments
- [x] Generate draft, reply with the web link in both the thread and parent channel; lock the thread on end, archive after sending the link
- [x] `/continue` reopens the thread, new messages merged into the existing draft
- [x] Listen for @bot mentions; code takes the most recent 50 (hard cap), model selects relevant messages
- [x] Attribution rules: in a thread only reply "recorded"; if the channel has a session, append to it; otherwise merge into that day's unsubmitted quick, or create a new one
- [x] Unregistered users marked `[unregistered]` and reminded to log in on the web

**Acceptance**: Start a session, send text and images, after ending a link appears in the thread, opening it shows a complete draft; with no session, @bot a message with an image, generating a quick-capture draft; in a channel with a session, @bot and the content merges into that session; two channels can each have a session at the same time.

### M5 — Operations and deployment

- [ ] First-time setup page: fill in and test LLM, Discord, select allowed roles (multiple allowed) and the `bot-admin` role, can test whether a member can enter; other people logging in and using the bot both get errors (real account rejection awaits confirmation with a second account)
- [x] On the web, `bot-admin` can view each member's AI token usage (anti-abuse)
- [ ] Record `failed_step` for each step failure + log channel error + web display
- [ ] On the web, `bot-admin` retry button, modify others' registered names
- [ ] Dockerfile + Compose (app + Caddy) + VPS deployment instructions
- [ ] Daily backup cron (`sqlite3 .backup` + original images → rclone → B2 / R2)

**Acceptance**: Artificially cause an LLM call failure (e.g., wrong API key), the log channel reports the error, after fixing it retry on the web succeeds; the backup file appears in private object storage.

## Pending decisions

1. **Discord pain points**: Is the most troublesome part reviewing and revising drafts, or team members not being used to slash commands? If the latter, M4 can be cut further.

## Decided decisions (2026-11-04)

- **Review gate**: Web Approve (approved by a team member other than the submitter), not GitHub PR; GitHub is only an optional private read-only mirror.
- **Visibility**: Entirely private.
- **Parallel sessions**: At most one per channel.
- **Post-archive modification**: Only bot-admin can modify, with revision records kept.

## Later (unscheduled)

- **GitHub mirror**: Private repository + `contents:write` PAT, push directly to main after approval / modification (`child_process` git). Data backup is handled by the M5 daily backup; do this when we actually want to view note history on GitHub.
- **PDF export**: Write one more template.
- **Multi-platform capture**: The web provides an entry API; write a thin AstrBot plugin to connect QQ / WeChat / Telegram, etc., call the API after capture, and reply with the web link. Do this when there is a real need for non-Discord platforms.
- **Multi-tenancy**: `/setup` wizard, permission isolation, admin backend. Do this when we actually open up to other teams.
