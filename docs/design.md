# Glaucus 设计文档

实现细节见 [plan.md](plan.md)。

FTC 队伍的工程笔记系统：队员在 Discord 里随手记录或在网页上直接录入，LLM 整理成结构化英文笔记，在网页上编辑，经另一名队员在网页上批准后归档。

## 1. 范围

- **做**：工程笔记 / Portfolio 素材的收集、整理、审核、归档。
- **不做**：规则 / SDK 文档问答。
- **用户**：先服务自己一支队（单租户），数据表留 `team_id` 以便将来开放。多租户相关功能（`/setup` 向导、权限隔离、后台）等真开放时再做。
- **分工**：**网页是主界面**（草稿编辑、改稿、提交、批准、浏览、搜索、管理）；**Discord 只是信息源之一**（session、@bot 采集），采集完回一个网页链接。核心逻辑（整理、存储、导出）不依赖 Discord 类型。等真有第二个信息源再抽 adapter 接口，现在不写。
- **隐私：全部私有**。笔记里有学生真名和照片（多数是未成年人）。网页所有页面和图片 URL 都要登录才能访问，不做公开分享链接；GitHub 镜像仓库和备份桶都设为私有。比赛需要 portfolio 时手动导出。

## 2. 技术栈

| 用途 | 选型 |
|---|---|
| 语言 | TypeScript（Node 26 LTS，内置类型剥离直接跑 `.ts`，后端无构建步骤） |
| Web 后端 | Hono（`@hono/node-server`） |
| 前端 | Vue 3（`<script setup>`）+ Vite + vue-router，构建成静态文件由 Hono 托管 |
| UI | Tailwind + shadcn-vue |
| 校验 | zod：`NotebookEntry` 只写一份 schema，LLM 输出、API、前端表单共用 |
| Discord | discord.js |
| LLM | Vercel AI SDK + `@ai-sdk/deepseek`（默认 deepseek-flash，模型 / `base_url` 可配，可换 OpenAI / Anthropic） |
| 存储 | SQLite（`node:sqlite`），agent 查历史用 FTS5 |
| 图片 | sharp |
| 登录 | Discord OAuth2（`fetch` 直调）+ Hono 签名 cookie |
| GitHub 镜像（可选） | 系统 `git`（`child_process`）+ VPS 上的本地 clone，直推私有仓库 main |
| 测试 | `node --test` |
| 部署 | Docker Compose（app + Caddy），跑在自有 VPS |

**进程结构**：单个 Node 进程，里面跑 Hono HTTP 服务、discord.js bot、后台循环（session 闲置检测）。LLM 生成草稿用进程内异步任务，前端轮询状态。

**仓库结构**：`server/`（Hono + bot + agent）、`web/`（Vue）、`shared/`（zod schema）。

明确不引入：Next.js / Nuxt 等全栈框架、Pinia、表单库、ORM、Redis / 任务队列、dotenv（用 `--env-file`）、测试框架、认证库、向量库、Octokit、isomorphic-git、webhook 服务。

## 3. 收集

### 3.1 网页录入

- 网页上新建 entry：粘贴文字 + 上传图片 → 生成草稿（`kind=web`）。不进 Discord 也能记。
- 日期默认今天，可改；起止时间留空，由 LLM 从文字里提取，提取不到就留空。

### 3.2 Discord Session

- `/session start [subsystem]`：在当前文字频道下创建一个 thread，开启 session。任何队员都能开，任何频道都能开。
- **每个频道同一时间最多一个 session**；当前频道已有时拒绝，并回复现有 thread 链接。不同频道可以并行（如机械组、编程组各在自己的频道开）。由数据库约束保证，见 §9。
- `/session end`（在 thread 里或它的父频道里执行）结束该频道的 session；或 thread **闲置 4 小时**（可配）自动结束。闲置判断只看 thread 最后一条消息时间。
- **结束时一次性拉取** thread 全部历史 + 下载附件（此时 URL 新签发，不会过期）。不做实时监听，因此消息编辑 / 删除自然生效。
- 原始消息快照存入 entry（`source_messages`），供后续改稿时 agent 参照。
- 结束时先锁定 thread（需要 bot 有 Manage Threads），避免之后发的消息被漏掉却没有提示；生成草稿后在 thread 和父频道都回复网页链接，再归档 thread，让它离开侧边栏。thread 里没有任何消息时直接丢弃，不调用 LLM。开错的 session 这样处理：没发消息就 `/session end`，发过消息就结束后在网页上丢弃，所以不设 `/session kill`。
- `/continue`（在父频道或 thread 里执行，普通成员在被锁定的 thread 里可能用不了，所以父频道是主入口）：解锁并恢复该频道最近一个 session，或所在 thread 的 session，回到 `collecting`。只有 `draft_ready` 的草稿能恢复；该频道已有进行中的 session 时拒绝。再次结束时新消息合并进现有草稿，没有新消息就不调用 LLM，草稿不变。恢复期间网页上看不到也改不了这份草稿。

### 3.3 @bot 快速记录

- 在任意频道 @bot：代码取之前最近的 **50 条**消息（硬上限），由模型返回相关消息的编号，代码按编号保存，并立即下载其中的附件。@bot 那条和它回复的消息一定保留；模型挑选失败时只用这两条。
- 归属（规则写死）：
  1. 在 session thread 里 @bot → 不用另外处理（结束时会整体拉取），只回一句"已记录"。
  2. 所在频道有进行中的 session → 只从 session 开始之后的消息里挑选（@bot 那条和它回复的消息除外），追加到该 session 的 `source_messages`。更早的消息可能已属于别的笔记。
  3. 否则 → 当天的**快速记录**（`kind=quick`）：当天已有一条还没提交的 quick（`collecting` / `drafting` / `draft_ready`）就并进去，由 agent 把新素材合并进草稿；没有或已提交就新建一条。回复网页链接。
- "当天"按 `config.toml` 里的队伍时区算。

### 3.4 附件

- 收集时立即保存原文件到 VPS 本地（Discord 附件下载 / 网页上传）。
- 图片：sharp 缩到长边 1600px JPEG（约 300KB），用于发给 LLM、网页展示和镜像到 git。
- 非图片（视频、PDF、CAD 等）：只存原文件，网页上显示为下载链接，不发给 LLM，不进 git 镜像。

## 4. LLM

### 4.1 Agent

- AI SDK 生成结构化输出，用 zod 校验 `NotebookEntry`，失败自动让模型重试。具体输出模式（tool / json / prompt 内 schema）以 M0b 实测为准，见 §11。
- 改稿：同一套能力，输入 = 当前草稿 + 原始消息 + 用户在网页上输入的自然语言修改意见。合并新素材（§3.3）也走这条路，修改意见固定为"把新消息并入草稿"。
- 测试用 AI SDK 的 mock model（`ai/test`），不调真 API。

### 4.2 工具（暂定，可扩充）

| tool | 作用 |
|---|---|
| `search_entries(query)` | FTS5 查历史笔记，做跨活动关联（只查 `approved`） |
| `get_entry(id)` | 读某条历史笔记全文 |

agent 碰不到 Discord：@bot 的上下文由代码取好再交给模型挑选（§3.3）。真名和附件也不需要工具：代码把作者真名、附件编号和图片直接放进提示，Discord 消息里的 `<@id>` 提及在拉取时换成真名。模型在输出里按编号引用图片，不属于这条笔记的编号由代码丢弃。

**agent 不得拥有**：提交、批准、退回、git 操作、发 Discord 消息。这些是确定性流程，由代码执行。agent 只产出和修改笔记内容——这是"学生对内容负责"在代码层面的保证。

### 4.3 图片

- 发给模型的是压缩版，**每个 entry 上限 20 张**（可配）。超出部分只挂附件，草稿中提示。
- deepseek-flash 带 vision；若接口不接受图片，换 provider（改配置即可）。

### 4.4 事实约束

System prompt + schema 共同约束：**只写消息 / 图片里出现过的事实**。数据、型号、测量值不得编造；缺失则留空或标 `[needs input]`。

## 5. 笔记 Schema

定义在 `shared/` 的 zod schema 里，前后端共用：

```
NotebookEntry
  title: str                    # LLM 生成，可手改；slug 由它派生
  date, start_time, end_time
  attendees: [真名]             # 默认取消息作者，网页上可增减（到场没发言的人）
  goals: [str]
  sections: [
    subsystem: str              # 新草稿取值限于 config.toml 的子系统列表；旧 entry 保留原值
    work_done: str
    problems: [str]
    decisions: [{decision, alternatives_considered, rationale}]
    test_results: str | null
    images: [{attachment_id, caption}]
  ]
  next_steps: [str]
```

开发中逐步丰富。时长、outreach 人次等从起止时间和参与人推算，暂不单设字段。

**输出语言：英文**（输入什么语言都行）。

**slug**：`title` 转小写 ASCII、连字符连接；同一天重名加 `-2`、`-3`。批准时定下，之后不变（镜像文件名稳定）。

## 6. 审核与归档

### 6.1 流程

1. 收集完成 → agent 生成草稿 → 网页草稿页：左边原始消息 / 附件，右边按 `NotebookEntry` 字段的结构化表单。
2. **任何已登录队员**都可以：
   - 直接编辑字段、增删 section / decision、调整图片顺序和 caption；
   - 在输入框里用自然语言让 agent 改稿（如"第二段说错了，最后选的是 goBILDA 轮子"）；
   - 重新生成（会覆盖手改内容，点之前弹确认）；
   - 丢弃（→ `discarded`，不物理删除）；
   - 提交（→ `pending_approval`，记录 `submitted_by`）。
3. **批准**：除提交者以外的任何队员都可以在网页上点 Approve（→ `approved`），或填写理由退回（→ `draft_ready`，理由显示在草稿页顶部）。bot-admin 也不能批准自己提交的。
4. `pending_approval` 期间有人编辑 → 回到 `draft_ready`，需要重新提交。保证批准的就是批准者看到的版本。
5. 批准时：定 slug → 渲染 Markdown 存入 `rendered_md` → 若配置了镜像，推送到 GitHub（§7）。
6. **归档后只读**，只有 bot-admin 能改。每次修改前把旧版本存入 `entry_revisions`（谁、何时、旧 JSON），改完重新渲染、重新推送镜像。状态保持 `approved`。

### 6.2 状态机

```
collecting → drafting → draft_ready ⇄ pending_approval → approved
                ↑           │              （退回 / 被编辑）     （仅 bot-admin 可改，留修订记录）
                └───────────┘
              （AI 改稿 / 重新生成）
draft_ready → discarded
drafting → discarded（空 session，或失败后没有任务在跑）
```

网页录入的 entry 从 `drafting` 开始。失败不是一种状态，记在 `failed_step` / `error` 字段里（§10.2）。

### 6.3 并发编辑

- 保存时带上读取时的 `version`，和库里不一致就拒绝，提示"别人改过了，请刷新"。
- `drafting`（AI 生成 / 改稿进行中）期间表单只读。

### 6.4 数据源

**SQLite 是唯一数据源**。GitHub 仓库只是已批准笔记的镜像，每次推送覆盖。**禁止人工直接向镜像仓库提交**，所有修改经由网页。

### 6.5 渲染

- LLM 只输出 `NotebookEntry`。
- 网页预览：Vue 直接从 entry JSON 渲染。
- Markdown：一个 TS 函数（模板字符串）渲染，保证格式一致、git diff 干净。文件头注明"由 bot 生成，请勿手改"。网页上可下载单条 `.md`，或把选中的 entry 打包成 zip（含压缩图）。将来加 PDF 导出 = 多一个模板。

## 7. GitHub 镜像（可选）

`config.toml` 里没配仓库就整个跳过。

- **单独的私有仓库**（与代码仓库分开）。
- 目录：`entries/<date>-<slug>.md` + `assets/<date>/<file>.jpg`（压缩版）。不用 Git LFS。
- **身份**：fine-grained PAT，仅授权该仓库，权限 `contents:write`。bot 直推 main，不开 PR、不建分支。
- 每次批准 / bot-admin 修改 = 一个 commit，message 带 entry 标题、批准人或修改人。
- main 禁止 force push（分支保护里设一下即可）。
- 推送失败记 `failed_step=mirror`，可重试，不影响 entry 在网页上已是 `approved`。

## 8. 身份、角色、配置

- **首次设置**：服务器没有配置也能启动，第一次打开任何页面都会跳到 `/setup`。新服务器谁先打开谁就能接管，所以必须输入一次性令牌；令牌只打印在服务器日志里，每次重启都会换。页面填写并测试站点地址、时区、LLM（真实调用一次）和 Discord（bot token、client secret、Message Content intent、OAuth 重定向地址、bot 权限），选择服务器、允许的角色、`bot-admin` 角色和日志频道，并可搜索成员测试其能否进入。点完成时服务器再完整测试一遍，通过后保存并启动 bot，不用重启。完成后 `/setup` 关闭；要重新设置就删除 `data/settings.json` 并重启。
- **使用权限**：只有拥有任一允许角色（可多个，如 Coach 和 Team 5898）或 `bot-admin` 角色的成员才能使用 Glaucus，没有配置角色时除 `bot-admin` 外都不允许。其他人登录网页、用 slash command 或 @bot 都会报错，他们在 thread 里发的消息不进入笔记。
- **登录**：网页用 Discord OAuth2（scope `identify`）登录，直接拿到 `discord_id`。登录后由 bot 检查此人是否在队伍的 Discord 服务器里、是否有允许的角色，否则拒绝。首次登录填写真名。
- **未注册者**（没在网页登录过）出现在 Discord session 中：用 Discord 显示名临时代替，草稿中标 `[unregistered]`，并在 thread 和父频道里提醒一次去网页登录。
- **角色**：
  - 队员（任何已登录者）：编辑草稿、提交、批准 / 退回他人提交的 entry。
  - `bot-admin`（Discord 角色，登录时由 bot 查询）：网页上可以从失败步骤重试、修改他人注册名、修改已归档的 entry。
- **配置**（后者覆盖前者）：
  - `config.toml`（可选）：子系统列表、闲置超时、图片上限，以及下面设置页收集的非密钥项。改后重启生效。
  - `data/settings.json`（`/setup` 写入，权限 600）：Discord 服务器、允许的角色、`bot-admin` 角色、日志频道、站点 URL、队伍时区、LLM `base_url` / 模型，以及密钥。cookie 签名密钥首次启动时自动生成并存在这里。备份会包含这个文件，所以备份桶必须私有。
  - 环境变量（可选）：Discord bot token、OAuth client secret、cookie 签名密钥、LLM API key。设置后设置页不能修改对应项。

## 9. 数据模型（SQLite）

```
members         (team_id, discord_id PK, real_name, registered_at)
entries         (id PK, team_id, kind[web|session|quick],
                 status[collecting|drafting|draft_ready|pending_approval|approved|discarded],
                 thread_id?, channel_id?, date, started_at, ended_at,
                 source_messages JSON, entry JSON, title, slug?, rendered_md?,
                 submitted_by?, approved_by?, approved_at?, return_reason?,
                 failed_step?, error?, version, updated_at)   -- version 用于乐观锁
attachments     (id PK, entry_id FK, filename, mime, orig_path, compressed_path?, caption, sent_to_llm)
entry_revisions (id PK, entry_id FK, editor_id, edited_at, entry JSON)   -- 仅记录归档后的修改
entries_fts     FTS5 虚表，索引 entry 的文本内容
```

- 每个频道最多一个进行中的 session：`CREATE UNIQUE INDEX ... ON entries(channel_id) WHERE kind='session' AND status='collecting'`。
- 登录状态存在签名 cookie 里，不建 session 表。

## 10. 运维

### 10.1 日志频道

Discord 日志频道记录**错误 + 关键状态变化**，每条一行，附 `entry_id` 和步骤：

- 状态：session 开始 / 结束、提交、批准、退回、bot-admin 修改已归档 entry。
- 错误：LLM 调用失败、schema 校验失败、附件下载失败、镜像推送失败。

### 10.2 失败处理

- 失败时记录 `failed_step` + `error`，往日志频道发消息，网页上该 entry 显示错误。
- 由 `bot-admin` 在网页上点重试，从失败步骤继续。不做自动后台重试队列。

### 10.3 部署

- Docker Compose：app + Caddy。Caddy 反代并自动签发 HTTPS 证书，VPS 只开 80 / 443。
- 需要一个域名（Discord OAuth 回调地址必须固定）。

### 10.4 备份

每日 cron：`sqlite3 .backup` + 原文件目录，经 `rclone` 推到私有的 B2 / R2 桶。

## 11. LLM 实测结论

### M0（2026-10-04，Python + pydantic-ai 2.54）

- deepseek-flash（DeepSeek-V4.1-Flash，1M context，输入支持 text + image）三项均通过：结构化输出、function calling、图片输入。
- **坑**：thinking 模式下不支持强制 `tool_choice`，也不支持 `json_schema` response_format。
  → 当时用 pydantic-ai 的 `PromptedOutput`：schema 写进 prompt，校验 + 重试；与普通 tools 共存正常。
- 复现：`uv run spikes/m0_llm.py`（迁移到 TS 后仅作参考）。

### M0b（2026-11-04，TS，`ai` 7.0.162 + `@ai-sdk/deepseek` 3.0.79）

- 结构化输出、function calling 与结构化输出共存、图片输入均通过，thinking 开 / 关都可用。
- **结论：用 `Output.object({ schema: NotebookEntry })`，不再手写 schema prompt。** thinking 保持默认（开）。解析或校验失败时抛 `NoObjectGeneratedError`，`agent.ts` 带错误信息重试，最多 3 次；网络、鉴权等错误直接抛出。
- SDK 在这里是兼容模式：设 `response_format: json_object`，把 schema 注入 system message，因此绕开了 M0 发现的 `json_schema` 限制。
- **坑**：把 schema 手写进 prompt 且 thinking 开启时，模型常把 JSON Schema 本身当答案返回。

同样的假消息和 `get_member` 工具，每格 6 次，统计第一次就通过的次数（样本小，只看趋势）：

| 输出方式 | thinking 开 | thinking 关 |
|---|---|---|
| 手写 schema prompt + zod | 2/6 | 6/6 |
| `Output.object` | 6/6 | 6/6 |

- 正式路径 `compose()`（thinking 开，带一张图）：10/10 成功，共 13 次 HTTP 请求，平均 5.6 s；事实（9/10、compliant 决定）全部保留，图片都引用正确。
- 未验证：`compose()` 里 `search_entries` / `get_entry` 是否被模型调用（工具共存只用 `get_member` 验证过）。
- 已观察到：素材带时间戳时，模型会把第一条和最后一条消息的时间填成 `start_time` / `end_time`（start 10/10，end 9/10），不一定是真实活动时间，靠人工审核把关。
- 复现：`node --env-file=.env spikes/m0b_llm.ts`。
