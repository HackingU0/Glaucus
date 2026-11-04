# 目标与里程碑

设计细节见 [design.md](design.md)。

## 目标

### 要实现的

1. **低门槛采集**：队员可以在 Discord 里随手记（session thread / @bot），也可以在网页上直接录入（粘文字 + 传图）。
2. **自动整理**：LLM 把原始素材整理成结构化的英文 `NotebookEntry`。只写素材里出现过的事实，数据、型号、测量值不编造，缺失的标 `[needs input]`。
3. **网页审核编辑**：草稿页左边原始素材、右边结构化表单；可以手改字段、调图片顺序和 caption、用自然语言让 AI 改稿、重新生成。
4. **人工审核后归档**：提交后由另一名队员在网页上批准；归档后只有 bot-admin 能改，留修订记录。可选镜像到私有 GitHub 仓库。
5. **可检索**：网页上浏览和全文搜索历史笔记；agent 写新笔记时能查历史，做跨活动关联。
6. **学生对内容负责**：agent 只产出和修改笔记内容；提交、批准、git、发消息全由确定性代码执行。
7. **全部私有**：所有页面和图片都要登录；镜像仓库、备份桶私有。
8. **好维护**：失败可见、能从失败步骤重试；每日备份；单台 VPS 一条 `docker compose up` 部署。

### 不做的

- 规则 / SDK 文档问答。
- 多租户（数据表留 `team_id`，真开放时再做）。
- 实时监听 Discord 消息（session 结束时一次性拉取）。
- 自动后台重试队列（失败由 `bot-admin` 手动重试）。
- GitHub PR 审核流程（改为网页 Approve）。
- 公开分享 / 公开展示。

## 里程碑

原则：先在网页上打通 **录入 → 草稿 → 编辑 → 批准** 闭环，Discord 作为信息源后接入。每个里程碑都有可验证的验收标准。

### M0 — LLM 实测（spike，Python）✅

风险最大的假设先验证，不写进正式代码。

- [x] 一个脚本：pydantic-ai + deepseek-flash，输入几条假消息 → 输出 `NotebookEntry`
- [x] 验证 function calling：注册一个假 tool，确认模型会调用
- [x] 验证图片输入：传一张压缩图，确认模型能描述
- [x] 记录结论；不行的项换 OpenAI / Anthropic 再测

**验收**：三项全部通过（或已确定替代 provider）。

### M0b — LLM 实测（spike，TS）✅

技术栈换成 TS，同样三项用 AI SDK 重测。

- [x] 一个脚本：AI SDK + `@ai-sdk/deepseek`，假消息 → zod 校验的 `NotebookEntry`
- [x] 确定可用的结构化输出模式（thinking 模式下 tool / json 模式可能不支持，退路为 prompt 内 schema + zod 解析 + 重试）
- [x] 验证 function calling 与结构化输出共存
- [x] 验证图片输入
- [x] 结论写回 design.md §11

**验收**：三项全部通过，输出模式已确定。

### M1 — 骨架

- [x] 仓库结构 `server/` / `web/` / `shared/`，`package.json`、`tsconfig`，`config.toml` + `.env` 加载
- [x] SQLite schema 初始化（members / entries / attachments / entry_revisions / entries_fts，含每频道一个 session 的唯一索引）
- [ ] Hono 服务 + Vue（Vite）构建产物托管，Tailwind + shadcn-vue 接好；所有路由和附件 URL 默认要求登录
- [ ] discord.js bot 上线，开启 Message Content intent
- [ ] Discord OAuth 登录 + 服务器成员检查 + 首次登录填真名；签名 cookie（代码已有，待真实账号验证）
- [x] 日志频道发送函数

**验收**：浏览器用 Discord 登录并填好真名；非队员登录被拒；未登录访问附件 URL 被拒；日志频道收到"bot started"。

### M2 — 网页录入与草稿

- [x] `NotebookEntry` zod schema（`shared/`，含 `title`）
- [x] 新建 entry 页：粘贴文字 + 上传附件（图片 sharp 压缩 1600px，非图片只存原文件），日期默认今天
- [ ] Agent + 工具（`search_entries`、`get_entry`、`get_member`、`list_attachments`、`attach_image`）（前 2 个已有，后 3 个未做）
- [x] 事实约束 system prompt
- [x] 异步生成草稿，前端轮询状态
- [x] 草稿页：左原始素材，右结构化表单；保存（`updated_at` 乐观锁，`drafting` 期间只读）
- [x] AI 改稿输入框、重新生成（弹确认）、丢弃
- [ ] entry 列表 + FTS5 搜索（列表已有；网页搜索目前是前端子串匹配，FTS5 只给 agent 用）
- [x] 一个 mock model 测试：假消息 → 草稿 → 校验通过，不调真 API

**验收**：网页粘文字传图 → 出现英文草稿；手改一个字段、用 AI 改一句，都正确保存。

### M3 — 批准与归档（闭环完成）

- [x] 提交 → `pending_approval`；他人 Approve / 填理由退回；提交者本人不能批准
- [ ] `pending_approval` 期间被编辑 → 回到 `draft_ready`
- [x] 批准时定 slug、渲染 Markdown（模板字符串）
- [x] 归档后只读；bot-admin 修改写 `entry_revisions`，网页可看修订历史
- [ ] 单条 `.md` 下载、选中多条打包 zip（含压缩图）（接口已测，页面上还没点过）
- [ ] 状态变化写日志频道（代码已有，真实频道待确认）
- [ ] （可选）GitHub 镜像：私有仓库 + `contents:write` PAT，批准 / 修改后直推 main（`child_process` git）

**验收**：A 网页录入 → 草稿 → 提交；A 自己点不了 Approve；B 退回，A 改完重提，B 批准 → 状态 `approved`，能下载 `.md`；bot-admin 改一个字段，修订历史里看得到旧版本。配了镜像的话，私有仓库 main 上出现对应文件。

### M4 — Discord 接入

- [ ] `/session start [subsystem]` 在当前频道建 thread；该频道已有 session 时拒绝并给链接
- [ ] `/session end`、`/session kill`（作用于当前频道的 session）
- [ ] 闲置超时检测（后台循环，看 thread 最后消息时间）
- [ ] 结束时拉取 thread 全部历史 → `source_messages`，下载附件
- [ ] 生成草稿，thread 里回复网页链接
- [ ] 监听 @bot 提及；`fetch_messages` 工具（硬上限 50）
- [ ] 归属规则：thread 内只回"已记录"；所在频道有 session 则追加到它；否则并入当天未提交的 quick，没有就新建
- [ ] 未注册者标 `[unregistered]` 并提醒去网页登录

**验收**：开一个 session、发文字和图片、结束后 thread 里出现链接，打开是完整草稿；无 session 时 @bot 一条带图消息，生成快速记录草稿；有 session 的频道里 @bot，内容并入该 session；两个频道能同时各开一个 session。

### M5 — 运维与部署

- [ ] 各步骤失败记录 `failed_step` + 日志频道报错 + 网页显示
- [ ] 网页上 `bot-admin` 重试按钮、修改他人注册名
- [ ] Dockerfile + Compose（app + Caddy）+ VPS 部署说明
- [ ] 每日备份 cron（`sqlite3 .backup` + 原图 → rclone → B2 / R2）

**验收**：人为制造一次 LLM 调用失败（如填错 API key），日志频道报错，改回后网页上重试成功；备份文件出现在私有对象存储中。

## 待定决策

1. **Discord 的痛点**：最麻烦的是审稿改稿，还是队员不习惯用 slash command？如果是后者，M4 还能再砍。

## 已定决策（2026-11-04）

- **审核门**：网页 Approve（提交者以外的队员批准），不走 GitHub PR；GitHub 只做可选的私有只读镜像。
- **可见性**：全部私有。
- **并行 session**：每个频道最多一个。
- **归档后修改**：只有 bot-admin 能改，留修订记录。

## 以后再说（未排期）

- **PDF 导出**：多写一个模板。
- **多平台采集**：网页提供录入 API，写一个薄的 AstrBot 插件接 QQ / 微信 / Telegram 等，采集后调 API、回网页链接。等真有非 Discord 平台的需求再做。
- **多租户**：`/setup` 向导、权限隔离、后台。等真开放给其他队伍再做。
