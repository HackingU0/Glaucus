# vibedoc.bot 设计文档

FTC 队伍的工程笔记 bot：队员在 Discord 里随手记录，LLM 整理成结构化英文笔记，经 GitHub PR 人工审核后归档。

## 1. 范围

- **做**：工程笔记 / Portfolio 素材的收集、整理、审核、归档。
- **不做**：规则 / SDK 文档问答。
- **用户**：先服务自己一支队（单租户），数据表留 `team_id` 以便将来开放。多租户相关功能（`/setup` 向导、权限隔离、后台）等真开放时再做。
- **多平台**：核心逻辑（整理、存储、导出）不依赖 Discord 类型，Discord 只是薄入口层。等真有第二个平台再抽 adapter 接口，现在不写。

## 2. 技术栈

| 用途 | 选型 |
|---|---|
| 语言 | Python |
| Discord | discord.py |
| LLM | pydantic-ai（默认 deepseek-flash，`base_url` / 模型可配，可换 OpenAI / Anthropic） |
| 存储 | SQLite（stdlib `sqlite3`），检索用 FTS5 |
| 图片 | Pillow |
| Git | 系统 `git`（subprocess）+ VPS 上的本地 clone |
| GitHub API | `httpx` 直调 REST |
| 部署 | Docker，跑在自有 VPS |

明确不引入：PyGithub、GitPython、Jinja、向量库、webhook 服务。

## 3. 收集

### 3.1 Session（主路径）

- `/session start [subsystem]`：创建一个 thread，开启 session。任何队员都能开。
- **同一时间只允许一个 session**；已有时拒绝，并回复现有 thread 链接。
- `/session end` 结束；或 thread **闲置 4 小时**（可配）自动结束。闲置判断只看 thread 最后一条消息时间。
- **结束时一次性拉取** thread 全部历史 + 下载附件（此时 URL 新签发，不会过期）。不做实时监听，因此消息编辑 / 删除自然生效。
- 原始消息快照存入 entry（`source_messages`），供后续改稿时 agent 参照。

### 3.2 @bot 快速记录

- 在任意频道 @bot：agent 用 `fetch_messages` 自行往前翻上下文，**硬上限 50 条**，挑出相关消息。
- 归属（规则写死）：有进行中的 session → 并入该 session；否则生成当天的**快速记录**（`kind=quick`），走同样的审核流程。

### 3.3 附件

- 收集时立即下载原图存 VPS 本地。
- 压缩版：Pillow 缩到长边 1600px JPEG（约 300KB），用于发给 LLM 和提交到 git。

## 4. LLM

### 4.1 Agent

- pydantic-ai `Agent(output_type=NotebookEntry)`，输出经 pydantic 校验，失败自动让模型重试。
- 改稿：同一套能力，输入 = 当前草稿 + 原始消息 + 用户的自然语言修改意见。
- 测试用 pydantic-ai 的 `TestModel`，不调真 API。

### 4.2 工具（暂定，可扩充）

| tool | 作用 |
|---|---|
| `search_entries(query, subsystem?, date_range?)` | FTS5 查历史笔记，做跨活动关联 |
| `get_entry(id)` | 读某条历史笔记全文 |
| `get_member(discord_id)` | Discord ID → 真名 |
| `fetch_messages(channel, limit, before?)` | 往前翻上下文（硬上限 50） |
| `list_attachments(entry_id)` / `attach_image(...)` | 管理图片与说明 |

**agent 不得拥有**：git 操作、开 / 合并 PR、发 Discord 消息、发布。这些是确定性流程，由 bot 代码执行。agent 只产出和修改笔记内容——这是"学生对内容负责"在代码层面的保证。

### 4.3 图片

- 发给模型的是压缩版，**每个 session 上限 20 张**（可配）。超出部分只挂附件，草稿中提示。
- deepseek-flash 带 vision；若其 OpenAI 兼容接口不接受图片，换 provider（改配置即可）。

### 4.4 事实约束

System prompt + schema 共同约束：**只写消息 / 图片里出现过的事实**。数据、型号、测量值不得编造；缺失则留空或标 `[needs input]`。

## 5. 笔记 Schema

```
NotebookEntry
  date, start_time, end_time
  attendees: [真名]
  goals: [str]
  sections: [
    subsystem: str              # 取值来自 config.toml 的子系统列表
    work_done: str
    problems: [str]
    decisions: [{decision, alternatives_considered, rationale}]
    test_results: str | None
    images: [{attachment_id, caption}]
  ]
  next_steps: [str]
```

开发中逐步丰富。时长、outreach 人次等从 session 起止时间和参与人推算，暂不单设字段。

**输出语言：英文**（输入什么语言都行）。

## 6. 审核与发布

### 6.1 流程

1. session 结束 → agent 生成草稿 → 发到 thread。草稿用代码模板渲染的 Markdown；超过 Discord 消息长度时以 `.md` 附件发送 + 简短摘要。
2. 草稿消息带按钮：[🔄 重新生成] [📤 提交]。**任何已注册队员**都可以：
   - 回复自然语言让 agent 改稿（如"第二段说错了，最后选的是 goBILDA 轮子"）；
   - 点重新生成；
   - 点提交。
3. 提交 → bot 用固定模板渲染 Markdown → 建分支 `entry/<date>-<slug>` → commit → push → 开 PR。
4. **人工在 GitHub 上 review 并合并到 main**——这是唯一的审核门。
5. PR 上的修改意见回到 Discord thread 里用自然语言提，bot 向同一分支追加 commit，PR 自动更新。不监听 GitHub PR comment。
6. PR 关闭未合并 → `rejected`；在 thread 里 @bot 可重新开 PR。

### 6.2 状态机

```
collecting → drafting → draft_ready → pr_open → merged
                                          └──→ rejected ──(@bot)──→ pr_open
```

PR 状态靠**轮询**：每 10 分钟查一次所有 `pr_open` 的 entry。VPS 不开端口。

### 6.3 数据源

**SQLite 是唯一数据源**。笔记仓库 main 分支是已合并笔记的镜像。**禁止人工直接向笔记仓库提交**，所有修改经由 agent。

### 6.4 Markdown 渲染

LLM 只输出 `NotebookEntry`；Markdown 由一个 Python 函数（f-string 模板）渲染，保证格式一致、PR diff 干净。将来加 PDF 导出 = 多一个模板。文件头注明"由 bot 生成，请勿手改"。

## 7. GitHub

- **单独的笔记仓库**（与机器人代码仓库分开）。
- 目录：`entries/<date>-<slug>.md` + `assets/<date>/<file>.jpg`（压缩版）。不用 Git LFS。
- **身份**：专用机器账号（因为 GitHub 不允许作者 approve 自己的 PR），fine-grained PAT 仅授权该仓库，权限 `contents:write` + `pull_requests:write`。
- **main 分支保护**：必须经 PR、需 1 个 approval、禁止 force push。bot 本身也无法直推 main。

## 8. 身份、角色、配置

- **队员注册**：`/register <真名>`，自行注册，Discord ID 自动取。`bot-admin` 可修改他人注册名。
- **未注册者**出现在 session 中：用 Discord 显示名临时代替，草稿中标 `[unregistered]`，并提醒一次去注册。
- **角色**：只有 `bot-admin`。
  - `/retry <entry_id>`：从失败步骤继续。
  - `/session kill`：强制结束当前 session。
  - 修改他人注册名。
- **配置**：
  - `config.toml`：笔记频道、日志频道、`bot-admin` 角色、笔记仓库、输出语言、子系统列表、超时、图片上限、上下文上限、LLM `base_url` / 模型、轮询间隔。改后重启生效。
  - `.env`：Discord token、LLM API key、GitHub PAT。

## 9. 数据模型（SQLite）

```
members      (team_id, discord_id PK, real_name, registered_at)
entries      (id PK, team_id, kind[session|quick], status, thread_id, channel_id,
              date, started_at, ended_at,
              source_messages JSON, entry JSON, rendered_md,
              branch, pr_number, failed_step, error, updated_at)
attachments  (id PK, entry_id FK, filename, orig_path, compressed_path, caption, sent_to_llm)
entries_fts  FTS5 虚表，索引 entry 的文本内容
```

## 10. 运维

### 10.1 日志频道

记录**错误 + 关键状态变化**，每条一行，附 `entry_id` 和步骤：

- 状态：session 开始 / 结束、PR 开出、PR 合并 / 被拒。
- 错误：LLM 调用失败、schema 校验失败、附件下载失败、push / 开 PR 失败。

### 10.2 失败处理

- 失败时记录 `failed_step` + `error`，往日志频道发消息。
- 由 `bot-admin` 执行 `/retry <entry_id>` 从失败步骤继续。不做自动后台重试队列。

### 10.3 备份

每日 cron：`sqlite3 .backup` + 原图目录，经 `rclone` 推到 B2 / R2。

## 11. 待验证风险

- deepseek-flash 经 pydantic-ai（OpenAI 兼容接口）的：结构化输出、function calling 稳定性、图片输入。M0 实测；不行就换 provider，架构不变。
