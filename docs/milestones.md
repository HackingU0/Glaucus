# 里程碑

设计见 [design.md](design.md)。原则：尽早打通 **session → 草稿 → PR** 闭环，其余功能在闭环上叠加。每个里程碑都有可验证的验收标准。

## M0 — LLM 实测（spike）

风险最大的假设先验证，不写进正式代码。

- [ ] 一个脚本：pydantic-ai + deepseek-flash，输入几条假消息 → 输出 `NotebookEntry`
- [ ] 验证 function calling：注册一个假 tool，确认模型会调用
- [ ] 验证图片输入：传一张压缩图，确认模型能描述
- [ ] 记录结论；不行的项换 OpenAI / Anthropic 再测

**验收**：三项全部通过（或已确定替代 provider）。

## M1 — 骨架

- [ ] 项目结构、依赖（`pyproject.toml`）、`config.toml` + `.env` 加载
- [ ] SQLite schema 初始化（members / entries / attachments / entries_fts）
- [ ] bot 上线，开启 Message Content intent
- [ ] `/register`，`bot-admin` 修改注册名
- [ ] 日志频道发送函数

**验收**：bot 在线，队员能注册，日志频道能收到"bot started"。

## M2 — Session 收集

- [ ] `/session start [subsystem]` 建 thread；已有 session 时拒绝并给链接
- [ ] `/session end`、`/session kill`
- [ ] 闲置超时检测（后台循环，看 thread 最后消息时间）
- [ ] 结束时拉取 thread 全部历史 → 存 `source_messages`
- [ ] 下载附件原图 + Pillow 压缩 1600px

**验收**：开一个 session、发文字和图片、结束后，数据库里有完整消息快照，磁盘上有原图和压缩图。

## M3 — 草稿生成与改稿

- [ ] `NotebookEntry` pydantic 模型
- [ ] Agent + 工具（`search_entries`、`get_entry`、`get_member`、`list_attachments`、`attach_image`）
- [ ] 事实约束 system prompt
- [ ] Markdown 渲染函数（f-string 模板）
- [ ] 草稿发到 thread（超长转 `.md` 附件）
- [ ] 回复自然语言改稿；[🔄 重新生成] 按钮
- [ ] 未注册者标 `[unregistered]` 并提醒
- [ ] 一个 `TestModel` 测试：假消息 → 草稿 → 渲染，不调真 API

**验收**：真实 session 结束后 thread 里出现英文草稿，回复一句修改意见后草稿正确更新。

## M4 — 发布到 GitHub（闭环完成）

- [ ] 笔记仓库准备：机器账号、fine-grained PAT、main 分支保护
- [ ] 本地 clone 管理；建分支 `entry/<date>-<slug>`、写 md + 压缩图、commit、push（subprocess git）
- [ ] httpx 开 PR
- [ ] [📤 提交] 按钮
- [ ] 改稿后向同一分支追加 commit
- [ ] 轮询 `pr_open` → `merged` / `rejected`，写日志频道
- [ ] `rejected` 后 @bot 重新开 PR

**验收**：session → 草稿 → 提交 → GitHub 上出现 PR → 人工合并 → bot 状态变 `merged`。

## M5 — @bot 快速记录

- [ ] 监听 @bot 提及
- [ ] `fetch_messages` 工具（硬上限 50）
- [ ] 归属规则：有 session 并入，否则建 `kind=quick` 当天记录
- [ ] 快速记录走 M3 / M4 同一流程

**验收**：无 session 时 @bot 一条带图消息，生成快速记录草稿并能提交 PR；有 session 时内容并入该 session。

## M6 — 运维与部署

- [ ] 各步骤失败记录 `failed_step` + 日志频道报错
- [ ] `/retry <entry_id>`
- [ ] Dockerfile + VPS 部署说明
- [ ] 每日备份 cron（`sqlite3 .backup` + 原图 → rclone → B2 / R2）

**验收**：人为制造一次 push 失败，日志频道报错，`/retry` 后成功；备份文件出现在对象存储中。
