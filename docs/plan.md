# 实现计划

需求见 [design.md](design.md)，里程碑与验收见 [milestones.md](milestones.md)。本文只写"怎么做"：目录、表结构、模块、API、实施顺序、测试。

## 0. 相对 design.md 的技术调整

本机 Node v26.9.0（2026-10 起为 LTS），实测 `node:sqlite` 带 FTS5、支持部分索引（SQLite 3.53），`.ts` 可直接运行。因此：

| 原选型 | 改为 | 省掉 |
|---|---|---|
| better-sqlite3 | `node:sqlite`（`DatabaseSync`） | 一个原生模块，Docker 里少一次编译 |
| tsx / tsc 构建后端 | `node server/main.ts`（内置类型剥离） | 后端构建步骤；`tsc --noEmit` 只做类型检查 |
| dotenv | `node --env-file=.env` | 一个依赖 |
| vitest / jest | `node --test` | 测试框架 |
| `updated_at` 做乐观锁 | 加一个 `version` 整数列 | 同一毫秒内两次保存撞时间戳的问题 |

类型剥离的限制：不能用 `enum`、构造函数参数属性、`namespace`；导入要写 `.ts` 后缀，类型导入用 `import type`。tsconfig 开 `erasableSyntaxOnly` + `verbatimModuleSyntax` + `allowImportingTsExtensions`，违规时编译器直接报错。

**依赖清单**（全部）：`hono` `@hono/node-server` `discord.js` `ai` `@ai-sdk/deepseek` `zod` `sharp` `smol-toml` `fflate`（zip 导出），前端 `vue` `vue-router` `tailwindcss` + shadcn-vue 组件；开发依赖 `typescript` `vite` `@vitejs/plugin-vue` `vue-tsc` `@types/node`。版本在 M0b / M1 安装时以 npm 最新为准（当前 `ai@7`、`@ai-sdk/deepseek@3`、`hono@4`、`discord.js@14`）。

## 1. 目录结构

单个 `package.json`，不用 workspace。

```
package.json            scripts: dev / build / start / check / test
tsconfig.json           server + shared
config.toml             §8 的配置项（提交一份 config.example.toml）
.env                    密钥（已 gitignore）
shared/
  entry.ts              NotebookEntry zod schema + 类型；Status / Kind 字面量联合
server/
  main.ts               入口：读配置 → 开库 → 起 Hono → 登录 bot → 启动后台循环 → 扫描遗留的 drafting
  config.ts             读 config.toml + process.env，zod 校验，导出一个 config 对象
  db.ts                 开库 + 建表（§2 的 DDL）+ 小查询函数；transition() 状态迁移
  auth.ts               Discord OAuth 路由、签名 cookie、requireUser / requireAdmin 中间件
  api.ts                /api/* 路由
  files.ts              附件保存、sharp 压缩、/files/:id 受保护下载
  agent.ts              draft() / revise()；工具定义；system prompt
  jobs.ts               按 entry 串行的进程内任务队列 + 失败记录
  render.ts             NotebookEntry → Markdown；slug
  mirror.ts             可选 GitHub 镜像（git 子进程，全局串行）
  bot.ts                discord.js client、slash commands、@bot 处理、闲置检测循环
  log.ts                发日志频道（bot 未就绪时退回 console）
  *.test.ts             见 §7
web/
  index.html  vite.config.ts  main.ts  router.ts  api.ts（fetch 封装）
  pages/  Login.vue  Register.vue  Entries.vue  NewEntry.vue  Entry.vue  Admin.vue
  components/  EntryForm.vue  SourcePanel.vue  StatusBar.vue  ui/（shadcn-vue 生成）
data/                   运行时数据（已 gitignore）：vibedoc.db、files/orig、files/small、mirror/
```

开发时 `node --watch --env-file=.env server/main.ts` 和 `vite` 并行跑，Vite 把 `/api` `/auth` `/files` 代理到 Hono。生产只跑 Hono，托管 `web/dist`。

## 2. 表结构（DDL）

```sql
create table if not exists members (
  discord_id    text primary key,
  team_id       text not null default 'default',
  real_name     text not null,
  registered_at text not null default (datetime('now'))
);

create table if not exists entries (
  id              integer primary key,
  team_id         text not null default 'default',
  kind            text not null check (kind in ('web','session','quick')),
  status          text not null check (status in
                    ('collecting','drafting','draft_ready','pending_approval','approved','discarded')),
  channel_id      text,
  thread_id       text,
  date            text not null,              -- YYYY-MM-DD，队伍时区
  started_at      text,
  ended_at        text,
  source_messages text not null default '[]', -- JSON: [{author_id, author_name, content, at, attachment_ids}]
  entry           text,                       -- NotebookEntry JSON
  title           text,
  slug            text,
  rendered_md     text,
  submitted_by    text,
  approved_by     text,
  approved_at     text,
  return_reason   text,
  failed_step     text,
  error           text,
  version         integer not null default 1,
  updated_at      text not null default (datetime('now'))
);
-- 每个频道最多一个进行中的 session
create unique index if not exists one_session_per_channel
  on entries(channel_id) where kind = 'session' and status = 'collecting';
-- 每天最多一条未提交的 quick（并发 @bot 时第二个插入失败 → 改走合并）
create unique index if not exists one_open_quick_per_day
  on entries(date) where kind = 'quick' and status in ('collecting','drafting','draft_ready');
create unique index if not exists slug_per_day on entries(date, slug) where slug is not null;

create table if not exists attachments (
  id              integer primary key,
  entry_id        integer not null references entries(id),
  filename        text not null,
  mime            text not null,
  orig_path       text not null,
  small_path      text,                       -- 仅图片
  caption         text not null default '',
  sent_to_llm     integer not null default 0
);

create table if not exists entry_revisions (
  id        integer primary key,
  entry_id  integer not null references entries(id),
  editor_id text not null,
  edited_at text not null default (datetime('now')),
  entry     text not null                     -- 修改前的 NotebookEntry JSON
);

create virtual table if not exists entries_fts using fts5(title, body, entry_id unindexed);
```

- 不做迁移框架。schema 变了就在 `db.ts` 里加 `alter table`，用 `pragma user_version` 记版本。
- FTS 用独立表（不做 external content），每次写 entry 时在同一事务里先删后插 `entries_fts`。`body` 把 NotebookEntry 里所有字符串拼起来。
- 状态迁移只走一个函数，靠 SQL 保证原子：

```ts
// 返回 false 表示当前状态不允许（被别人抢先 / 非法迁移）
function transition(id: number, from: Status[], to: Status, extra: Record<string, unknown> = {}): boolean
// UPDATE entries SET status=?, ...extra, version=version+1 WHERE id=? AND status IN (...)
```

## 3. 后端模块要点

### config.ts
- `smol-toml` 解析 → zod 校验，缺字段启动即失败并打印哪一项。`mirror` 整节可省略。

### auth.ts
- `/auth/login` → 跳 Discord（scope `identify`，`state` 存短期签名 cookie 防 CSRF）。
- `/auth/callback` → 换 token → `GET /users/@me` → bot 查 `guild.members.fetch(id)`，不在服务器就拒绝；同时读角色得到 `isAdmin` → 写签名 cookie `{discord_id, isAdmin, exp}`（Hono `setSignedCookie`，7 天）。
- 没有 `members` 记录的跳 `/register` 填真名。
- `requireUser` 挂在 `/api/*` 和 `/files/*` 上；`requireAdmin` 挂在管理接口上。bot-admin 角色变动最迟 7 天后生效（cookie 过期），够用。

### files.ts
- 保存：原文件写 `data/files/orig/<id>-<filename>`；图片再用 sharp `.rotate().resize(1600, 1600, {fit:'inside'}).jpeg({quality: 80})` 写 `data/files/small/<id>.jpg`。`.rotate()` 先按 EXIF 摆正手机照片。
- `GET /files/:id?orig=1` 经过 `requireUser`，不开静态目录。

### agent.ts
- 两个函数，签名固定，内部实现等 M0b 结论再定：

```ts
draft(input: {sources: SourceMessage[], images: Attachment[], date: string}): Promise<NotebookEntry>
revise(input: {current: NotebookEntry, sources: SourceMessage[], images: Attachment[], instruction: string}): Promise<NotebookEntry>
```

- 出口统一 `NotebookEntry.parse()`；解析失败带 zod 错误重试，最多 2 次，仍失败就抛错。
- 最后由代码（不是模型）做后处理：把 `attendees` 里的 ID 换成真名、未注册者标 `[unregistered]`；把 `images[].attachment_id` 不属于本 entry 的过滤掉。

### jobs.ts
- `enqueue(entryId, step, fn)`：同一 entry 的任务串行（`Map<id, Promise>` 链），不同 entry 并行。
- 包一层：开始设 `drafting`，成功设 `draft_ready` 并清掉 `failed_step`，失败写 `failed_step/error` 并发日志频道，状态回到 `draft_ready`（草稿为空时停在 `drafting`，等重试）。
- 启动时把所有 `drafting` 标成 `failed_step='interrupted'`（进程重启打断的任务），等 bot-admin 重试。
- `// ponytail: 进程内队列，重启丢任务靠启动扫描兜底；多进程部署时才需要真队列`

### render.ts
- `renderMarkdown(entry, attachments, members) → string`：纯函数，模板字符串。
- `slugify(title)`：转小写、非 `[a-z0-9]` 换 `-`、截 60 字符；冲突加 `-2` 由调用方查库决定。

### mirror.ts
- 启动时 `data/mirror` 不存在就 `git clone`（PAT 放在 URL 里，不写进日志）。
- `publish(entry)`：`git pull --ff-only` → 写 md 和图片 → `git add -A` → `git commit` → `git push`。全局一个 Promise 链串行。
- 失败 → `failed_step='mirror'`，不改 `approved` 状态。

### bot.ts
- intents：Guilds、GuildMessages、MessageContent、GuildMembers（查成员和角色）。
- 启动时注册 guild 级 slash commands（`/session start|end|kill`），改完重启立即生效。
- `/session start`：直接 insert（`kind=session, status=collecting`），唯一索引冲突就查出现有的、回链接。再建 thread，把 `thread_id` 写回。
- 结束（end / kill / 闲置）：`transition(collecting → drafting)` 抢锁成功的才继续，所以 end 和闲置循环同时触发也只跑一次 → 分页拉 thread 全部消息（每页 100）→ 下载附件 → 写 `source_messages` → `enqueue(draft)` → 在 thread 里回链接。
- 闲置循环：`setInterval` 每 5 分钟，对每个 `collecting` 的 session 取 thread 的 `lastMessageId` 对应时间，超时就结束。
- `@bot`：按 design §3.3 的三条规则归属。插入 quick 撞了唯一索引 → 改为追加到那一条 + `enqueue(revise '把新消息并入草稿')`。

## 4. HTTP API

全部 JSON，除上传和下载。`:id` 为 entry id。

| 方法 路径 | 权限 | 作用 / 前置状态 |
|---|---|---|
| `GET /auth/login` `/auth/callback` · `POST /auth/logout` | — | 登录 |
| `GET /api/me` · `POST /api/me {real_name}` | 用户 | 当前用户 / 注册真名 |
| `GET /api/entries?q=&status=` | 用户 | 列表；带 `q` 走 FTS |
| `POST /api/entries`（multipart：text, date, files[]） | 用户 | 新建 web entry → drafting |
| `GET /api/entries/:id` | 用户 | entry + attachments + source_messages |
| `PUT /api/entries/:id {entry, version}` | 用户 / 归档后仅 admin | 保存；version 不符回 409；pending_approval 时回到 draft_ready；approved 时先写 revision |
| `POST /api/entries/:id/revise {instruction}` | 用户 | draft_ready → drafting |
| `POST /api/entries/:id/regenerate` | 用户 | draft_ready → drafting |
| `POST /api/entries/:id/discard` | 用户 | draft_ready → discarded |
| `POST /api/entries/:id/submit` | 用户 | draft_ready → pending_approval |
| `POST /api/entries/:id/approve` | 用户（≠ submitted_by） | pending_approval → approved，定 slug、渲染、镜像 |
| `POST /api/entries/:id/return {reason}` | 用户（≠ submitted_by） | pending_approval → draft_ready |
| `POST /api/entries/:id/retry` | admin | 从 failed_step 继续 |
| `GET /api/entries/:id/revisions` | 用户 | 修订历史 |
| `GET /api/entries/:id/export.md` · `GET /api/export.zip?ids=` | 用户 | 导出 |
| `GET /api/members` · `PUT /api/members/:discord_id` | admin | 改注册名 |
| `GET /files/:attachment_id[?orig=1]` | 用户 | 附件 |

## 5. 前端

- 不用 Pinia：`api.ts` 一个 fetch 封装（401 跳登录），当前用户放一个模块级 `ref`。
- `Entry.vue` 一页搞定草稿 / 待批准 / 已归档三种状态，按 `status` 和权限决定哪些按钮可点。`drafting` 时每 2 秒轮询 `GET /api/entries/:id`，表单只读。
- `EntryForm.vue`：直接按 `NotebookEntry` 字段手写（v-model 绑一份深拷贝），保存时带 `version`；409 弹"别人改过了，请刷新"。前端也跑一次 zod 校验，只用来标红字段。
- `SourcePanel.vue`：左栏原始消息 + 附件缩略图；图片拖进右栏某个 section 就是 `attach`。
- 图片排序先用上下移动按钮，不引入拖拽库。

## 6. 实施顺序

每一步完成后都能跑起来、能验证。勾选项和验收以 milestones.md 为准，这里写落到哪些文件、先后顺序。

### M0b — LLM 实测（`spikes/m0b_llm.ts`）
1. `npm init`，装 `ai @ai-sdk/deepseek zod`。照 `spikes/m0_llm.py` 写 TS 版：同样的假消息、同一个 `get_member` 假工具、同一张生成图。
2. 依次试：AI SDK 原生结构化输出 → 不行就 prompt 内 schema + `NotebookEntry.parse` + 重试。分别在 thinking 开 / 关下跑。
3. 结论写进 design.md §11，确定 `agent.ts` 的实现方式。**这一步的结果可能改动 §3 agent.ts 的内部，但不改它的签名。**

### M1 — 骨架
1. `package.json`、`tsconfig.json`、`shared/entry.ts`（先放 schema，M2 再细化）。
2. `config.ts` + `config.example.toml`。
3. `db.ts`：DDL + `transition()`；`db.test.ts` 先测唯一索引和 transition。
4. `main.ts` + `api.ts` 的空壳 + 托管 `web/dist`；Vite + Vue + Tailwind + shadcn-vue 初始化，`Login.vue` 一个按钮。
5. `bot.ts` 登录上线 + `log.ts`，启动时发 "bot started"。
6. `auth.ts`：OAuth、成员检查、cookie、`/register`。
7. `files.ts` 的受保护下载路由（M2 才有文件，但现在就把 `/files` 挂到 `requireUser` 后面）。

### M2 — 网页录入与草稿
1. `shared/entry.ts` 定稿（含 `title`）。
2. `files.ts` 保存 + sharp；`POST /api/entries`。
3. `agent.ts`（按 M0b 结论）+ 工具 + system prompt；`agent.test.ts` 用 mock model。
4. `jobs.ts`；把 draft 接上；启动扫描。
5. `GET/PUT /api/entries/:id`（version 乐观锁）、revise / regenerate / discard。
6. 前端：`NewEntry.vue` → `Entry.vue` + `EntryForm.vue` + `SourcePanel.vue`。
7. FTS 写入 + `Entries.vue` 列表和搜索。

### M3 — 批准与归档
1. submit / approve / return 路由（提交者不能批准；pending 时被编辑回 draft_ready 已在 M2 的 PUT 里）。
2. `render.ts` + `render.test.ts`；批准时定 slug、存 `rendered_md`。
3. 归档后 admin 编辑写 `entry_revisions`；修订历史接口 + 前端折叠面板。
4. `export.md`、`export.zip`（fflate `zipSync`）。
5. `mirror.ts`（可选，没配就跳过）。

### M4 — Discord 接入
1. slash commands 注册；`/session start`（唯一索引兜底）。
2. 结束流程（抢锁 → 分页拉消息 → 下载附件 → enqueue draft → 回链接），end / kill / 闲置循环共用。
3. `@bot` 处理：`fetch_messages` 工具只在这里传给 agent；三条归属规则；quick 撞索引改走合并。
4. 未注册者处理。

### M5 — 运维与部署
1. 把各步骤失败统一接到 `jobs.ts` 的失败记录 + 日志频道；`Admin.vue`：失败列表 + 重试、成员改名。
2. `Dockerfile`（`node:26-slim`，装 git；`npm ci && vite build`；`CMD node server/main.ts`）+ `compose.yaml`（app + Caddy，`data/` 挂卷）+ `Caddyfile`。
3. 备份脚本 `scripts/backup.sh`（`sqlite3 .backup` + `rclone copy`），宿主机 cron 调用。
4. 部署说明写进 README。

## 7. 测试

`node --test server/`，不调真 API、不连 Discord。只测有分支逻辑的地方，每个一个文件：

| 文件 | 测什么 |
|---|---|
| `db.test.ts` | 两个唯一索引会拒绝第二次插入；`transition()` 非法迁移返回 false；`PUT` 的 version 冲突 |
| `agent.test.ts` | mock model 返回合法 / 非法 JSON：合法通过，非法触发重试，两次都非法抛错；attendees 后处理 |
| `render.test.ts` | 一个固定 entry 渲染成固定 Markdown（快照写在测试里）；slugify 边界：中文标题、超长、全符号 |
| `api.test.ts` | 用 Hono 的 `app.request()`：提交者 approve 被拒、非 admin 改 approved 被拒、未登录拿 `/files` 被拒 |

Discord 流程靠 M4 验收手测，不做 mock。`npm run check` = `tsc --noEmit && vue-tsc --noEmit -p web`。

## 8. 风险

| 风险 | 对策 |
|---|---|
| M0b 发现 AI SDK 结构化输出和 deepseek thinking 模式不兼容 | 已有退路（prompt 内 schema + zod + 重试）；`agent.ts` 签名不变，影响只在一个文件内 |
| deepseek 图片输入在 AI SDK 下不通 | 换 provider 只改配置；M0b 必须验证 |
| 进程重启打断草稿生成 | 启动扫描把 `drafting` 标为 `interrupted`，admin 重试 |
| 闲置循环和 `/session end` 同时触发 | `transition(collecting → drafting)` 原子抢锁，只有一个继续 |
| 两人同时 @bot 生成当天 quick | 唯一索引让第二个失败，改走合并 |
| 长 session 消息很多 | 分页拉取；DeepSeek 上下文 1M 够用；图片受 20 张上限约束 |
| PAT 泄露进日志 | `mirror.ts` 记录 git 错误前把 URL 里的 token 替换掉 |
