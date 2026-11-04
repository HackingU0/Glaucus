# vibedoc.bot Web UI 设计需求

## 产品是什么

一支 FTC 机器人队（高中生，10–20 人）的**工程笔记系统**。队员在 Discord 里聊天、发照片，或者在网页上粘贴一段文字、传几张图；AI 把这些素材整理成结构化的英文工程笔记草稿。队员在网页上检查、修改草稿，提交后由**另一名队员**批准归档。比赛时这些笔记会整理成 Portfolio 交给评委。

网页是主要界面，Discord 只负责采集素材。

**核心原则**：AI 只写草稿，学生对内容负责。界面要让人一眼看出哪些内容是 AI 写的、哪里缺信息、谁提交的、谁批准的。

## 用户与使用场景

- **队员**（大多数人）：用手机在车间里快速录入、看看草稿；回家后在电脑上仔细改稿；收到提醒后批准别人的笔记。
- **bot-admin**（1–2 名队长或导师）：处理失败任务、改队员名字、修改已归档的笔记。
- 全部内容私有，必须登录才能看。

## 技术约束

- 前端会用 **Vue 3 + Tailwind + shadcn-vue** 实现，请尽量用 shadcn 已有的组件：Button、Card、Badge、Tabs、Dialog、AlertDialog、Input、Textarea、Select、Tooltip、Toast（Sonner）、Collapsible、Table、DropdownMenu、Alert、Skeleton、Avatar。
- 不使用拖拽库。排序用上 / 下移按钮。
- **界面文案用中文，笔记内容是英文**（示例数据见文末）。

## 视觉方向

- 像一个安静、密度适中的工程工具，不要做成营销页。参考气质：Linear、GitHub 的 PR 页面、实验记录本。
- 以浅色主题为主，深色主题可选。
- 状态色要统一，下文每个状态都会用到：

| 状态 | 含义 | 建议色 |
|---|---|---|
| 收集中 | Discord session 进行中 | 灰 |
| AI 整理中 | AI 正在生成或修改 | 蓝（带动效） |
| 草稿 | 可编辑 | 中性 |
| 待批准 | 已提交，等另一人批准 | 琥珀 |
| 已归档 | 已批准，只读 | 绿 |
| 已丢弃 | 不要了 | 灰、弱化 |
| 失败 | 某一步出错（叠加在其他状态上） | 红 |

- **`[needs input]` 标记**：AI 遇到素材里没有的数据会写这个占位。表单和预览里都要醒目地高亮它（比如黄底），并在页面顶部显示"还有 N 处待补充"。这是最重要的视觉元素之一。

## 全局布局

- 顶栏：Logo "vibedoc"、导航（笔记 / 新建 / 管理（仅 admin 可见））、右侧头像下拉菜单（真名、退出登录）。
- 手机端顶栏收成汉堡菜单，或改用底部 tab。

## 页面

### 1. 登录页
- 只有一个按钮："用 Discord 登录"。
- 被拒绝状态："你不在队伍的 Discord 服务器里"。

### 2. 首次注册页
- 登录后第一次进入时显示。只有一个输入框："你的真名（会写进笔记的出勤名单）"，加一个确认按钮。

### 3. 笔记列表页（首页）
- 顶部：搜索框（全文搜索）、"新建笔记"按钮。
- 状态筛选 tab：待我批准（带数字角标，放第一位）/ 草稿 / 待批准 / 已归档 / 全部。已丢弃的默认隐藏。
- 每条笔记一行或一张卡片，显示：
  - 标题、日期；
  - 来源徽章（网页 / Session / 快速记录）；
  - 状态徽章；
  - 子系统标签（如 Intake、Drivetrain、Software）；
  - 出勤人数；
  - 失败时显示红色小图标；
  - 有 `[needs input]` 时显示小计数。
- 搜索结果要高亮匹配的词。
- 已归档的条目可以多选，选中后出现"导出 zip"按钮。
- 空状态："还没有笔记。在 Discord 里 `/session start`，或者点新建。"

### 4. 新建笔记页（手机优先）
- 大文本框："粘贴今天的记录（中英文都行）"。
- 日期，默认今天。
- 上传区：可多选文件、可拖入。图片显示缩略图，其他文件（视频、PDF、CAD）显示文件名卡片。可以删除单个文件。
- 提交按钮"生成草稿"，点了以后跳到笔记详情页（AI 整理中状态）。

### 5. 笔记详情页（核心页面，请重点设计）

同一个页面按状态呈现不同内容。

**页头**：标题、日期、来源徽章、状态徽章、"还有 N 处待补充"，以及提交人 / 批准人和时间。右侧放当前状态可用的操作按钮。

**电脑端两栏布局：**
- **左栏：原始素材**（约 40%，可收起）
  - Discord 来源：按时间排列的消息列表，每条有头像首字母、显示名、时间、内容、附件缩略图。
  - 网页录入：原始粘贴的文字。
  - 附件区：所有图片缩略图。每张图上有"添加到…"按钮，点开下拉菜单选择放进哪个 section。已被使用的图片打个标记。
  - 图片超过 20 张时提示"只有前 20 张发给了 AI"。
- **右栏：笔记表单**（约 60%），字段见下文"表单结构"。

**手机端**：单栏，顶部用 Tabs 切换"笔记 / 原始素材"。

**各状态下的页面：**

1. **AI 整理中**：表单区显示骨架屏和"AI 正在整理…"，所有操作禁用。如果是改稿或重新生成，就显示旧内容的只读半透明版本。
2. **草稿**
   - 表单可编辑。有未保存修改时，"保存"按钮高亮，并显示"未保存"。
   - **AI 改稿输入框**：固定在右栏底部，像聊天输入框。placeholder："告诉 AI 怎么改，比如：第二段说错了，最后选的是 goBILDA 轮子"。发送后进入 AI 整理中状态。
   - 操作按钮：保存、提交审核（主按钮）、更多菜单（重新生成、丢弃）。
   - 重新生成和丢弃都要先弹确认框。重新生成的确认框写明"会覆盖所有手动修改"。
   - 如果是被退回的草稿：顶部用琥珀色 Alert 显示"被 张三 退回：（理由）"。
3. **待批准**
   - 默认显示**渲染好的阅读视图**（排版像一页正式的工程笔记），而不是表单。
   - **批准人**（提交者以外的人）看到"批准"（主按钮，绿色）和"退回"两个按钮。点退回弹出对话框，必须填理由。
   - **提交者本人**看到"等待其他队员批准"，批准按钮禁用，悬停提示"不能批准自己提交的笔记"。
   - 任何人都可以点"编辑"。编辑前提示"修改后需要重新提交审核"。
4. **已归档**
   - 阅读视图，显示批准人和时间。
   - 操作：导出 .md。admin 还能看到"编辑"按钮，点之前警告"修改会留下修订记录"。
   - 底部有可折叠的"修订历史"：列出修改人和时间，点开可以查看旧版本（只读阅读视图）。
5. **已丢弃**：灰色阅读视图，顶部写明"已丢弃"。
6. **失败**（叠加在以上任一状态上）：顶部红色 Alert 显示"生成失败：（步骤）——（错误信息）"。admin 能看到"重试"按钮，普通队员看到"已通知管理员"。

**冲突对话框**：保存时如果别人已经改过，弹出"这条笔记刚被别人改过，请刷新后再改"，并提供"刷新"按钮（会丢失本地修改，要写明）。

**表单结构**（右栏，从上到下）：
- 标题（Input）
- 日期、开始时间、结束时间（同一行）
- 出勤：人名 chips，可删可加。未注册的人显示为虚线边框，带 `unregistered` 小标。
- 目标 Goals：文本列表，每行可删，末尾有"+ 添加"。
- **Sections**（主体，每个 section 一张 Card，可上 / 下移、删除；底部有"+ 添加 section"）：
  - 子系统（Select，可选项如 Intake / Drivetrain / Outtake / Software / Strategy / Outreach）；
  - 完成的工作（Textarea）；
  - 遇到的问题（文本列表）；
  - **决策**：子卡片列表，每个包含"决策"、"考虑过的方案"（文本列表）、"理由"；
  - 测试结果（Textarea，可空）；
  - 图片：网格排列，每张有 caption 输入框，可上 / 下移、移除。
- 下一步 Next steps：文本列表。
- 所有 `[needs input]` 都高亮。点顶部的"还有 N 处待补充"会依次跳到每一处。

### 6. 管理页（仅 admin）
- Tabs："失败任务"和"队员"。
- 失败任务：表格，列出标题、失败步骤、错误信息、时间、"重试"按钮。
- 队员：表格，列出真名、Discord 名、注册时间，真名可以在行内编辑。

## 需要交付的

1. 可点击的 HTML 原型，用下面的示例数据填充。
2. 电脑端：列表页、新建页、详情页的 6 种状态、管理页。
3. 手机端：列表页、新建页、详情页（草稿、待批准状态，各含两个 tab）。
4. 空状态、加载中、错误这几种情况至少各出现一次。

不用设计：Discord 里的界面、邮件和通知、营销页。

## 示例数据

原始素材（Discord session，频道 #build）：

```
[Alice Chen 15:02] 今天调 intake，原来 REV 的轮子太滑，球老是吸不进来
[Bob Li 15:20] 试了 goBILDA 的 gripper wheel 和 compliant wheel，compliant 吸得最稳，10 次成功 9 次  [图片: intake_test.jpg]
[Alice Chen 15:41] 那就定 compliant 了，下次把转速从 0.8 降到 0.6 试试，现在有点打飞
[Carol Wu 16:05] 底盘那边 odometry 偏了，还没查出原因  [图片: odo_log.png]
```

AI 生成的草稿：

```json
{
  "title": "Intake wheel selection and odometry drift",
  "date": "2026-11-02", "start_time": "15:00", "end_time": "[needs input]",
  "attendees": ["Alice Chen", "Bob Li", "Carol Wu"],
  "goals": ["Improve intake reliability", "Investigate odometry drift"],
  "sections": [
    {
      "subsystem": "Intake",
      "work_done": "Tested replacement intake wheels after the original REV wheels slipped and failed to pull game elements in.",
      "problems": ["REV wheels too slippery; elements not intaken consistently", "Elements are ejected too hard at 0.8 power"],
      "decisions": [{
        "decision": "Use goBILDA compliant wheels for the intake",
        "alternatives_considered": ["REV wheels (original)", "goBILDA gripper wheels"],
        "rationale": "Compliant wheels gave the most consistent intake: 9/10 successful attempts."
      }],
      "test_results": "Compliant wheel: 9/10 successful intakes. Gripper wheel: [needs input].",
      "images": [{"attachment_id": 1, "caption": "Compliant wheel intake test"}]
    },
    {
      "subsystem": "Drivetrain",
      "work_done": "Observed odometry drift during testing. Root cause not yet identified.",
      "problems": ["Odometry position drifts by [needs input]"],
      "decisions": [],
      "test_results": null,
      "images": [{"attachment_id": 2, "caption": "Odometry log showing drift"}]
    }
  ],
  "next_steps": ["Lower intake power from 0.8 to 0.6 and retest", "Find the cause of odometry drift"]
}
```

列表页可以再编几条：已归档的 "Drivetrain gear ratio trade study"（10-28）、待批准的 "Autonomous path tuning"（10-30）、失败的快速记录 "Quick note 2026-11-03"、收集中的 Session "#software"。
