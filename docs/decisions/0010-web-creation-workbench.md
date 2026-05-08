# 0010 Web Creation Workbench

日期：2026-05-06

## 结论

Web UI 的任务创建与定时任务创建，不采用纯表单模式，也不先做“建议器”过渡方案；直接采用**创建助手会话 + 草稿目录 + 人工确认系统字段**的工作台模式。

目标不是让 Web UI 替代 `task.md`，而是让 Web UI 在受限边界内，更高效地把用户意图整理成可执行的 `spec/task.md` 与附加材料。

## 与既有设计的关系

本决策是以下设计的 Web 化延伸：

- [0004 Task Creation](/Users/york/data/workspace/ai/n3/drift-work/docs/decisions/0004-task-creation.md)
- [0005 Scheduling](/Users/york/data/workspace/ai/n3/drift-work/docs/decisions/0005-scheduling.md)
- [0009 Web UI](/Users/york/data/workspace/ai/n3/drift-work/docs/decisions/0009-web-ui.md)

它不改变以下核心原则：

- `spec/task.md` 仍是任务定义中心
- 任务材料对系统仍是黑盒
- schedule 的系统控制项仍由用户明确确认
- Web UI 只是新的入口，不是第二套任务系统

## 为什么不是表单

Task 和 Schedule 的创建过程，真正复杂的部分不是填写元数据，而是把用户目标、背景、约束、附加材料整理成一份足够清晰的 `spec/task.md`。

如果只做表单，会出现两个问题：

- 用户仍然需要手工把需求组织成任务定义，Web UI 价值有限
- 后续很快又会需要把“辅助整理”补回来，形成重复建设

因此，Web 创建器的中心应该是**创建工作台**，而不是一组结构化字段。

## 为什么直接做真正会话

不先做轻量“建议器”，而是直接做真正的创建助手会话。原因如下：

- 用户想要的是“辅助整成”，不是“给点建议后自己拼”
- CLI 已经存在真实创建会话能力，Web 版可以在同一边界上复用
- 先做弱化版，后续仍大概率需要推翻并重做成真实会话

## 总体结构

Web UI 新增两个入口：

- `New Task`
- `New Schedule`

两者共用一个创建工作台：

- 左侧：当前草稿目录中的文件列表
- 中间：`task.md` 预览/编辑区
- 右侧：创建助手会话区

工作台之外，再用少量步骤承载系统字段确认与最终创建动作。

## 草稿目录模型

Web 创建阶段不直接在正式任务目录或 schedule 目录内工作，而是先创建草稿目录。

推荐目录：

```text
workspace/drafts/
  tasks/
    <draftId>/
      spec/
        task.md
        ...
  schedules/
    <draftId>/
      spec/
        task.md
        ...
```

约定：

- `draftId` 为短期草稿标识，不复用正式 `taskId` / `scheduleId`
- 创建助手会话的 cwd 固定为该草稿目录下的 `spec/`
- 用户确认创建前，不生成正式 `task.json` / `schedule.json`
- 草稿默认保留，是否增加清理策略另行设计

## 创建助手边界

创建助手会话必须继承 CLI 创建助手的工作边界，只围绕当前草稿目录工作。

允许：

- 读取和修改当前草稿目录中的文件
- 创建和完善 `task.md`
- 在当前目录下补充附加材料
- 基于用户上传材料进行整理
- 只读参考当前 task type 的 guide 路径

不允许：

- 读取、搜索或引用草稿目录之外的项目文件
- 替任务管理器设计目录结构、状态文件或系统实现方案
- 启动任务执行
- 修改 queue、schedule-state 或其他运行时目录
- 为用户隐式决定 cron、runner、enabled、skipIfActive 等系统字段
- 读写 `shared-state/`

一句话概括：

> 创建助手只负责把当前草稿目录整理成一份任务定义，不负责执行任务，也不负责管理器配置决策。

## Task 创建流程

Web Task Create 采用以下流程：

```text
选择 task type
-> 创建 task draft
-> 启动创建助手会话
-> 在工作台中整理 spec/
-> 校验 spec/task.md 非空
-> 用户确认 title / runner / budget / retries / timeout
-> 选择 Create as not_queued 或 Create and enqueue
-> 生成正式 task
```

其中：

- `title` 不强制在最开始填写，可以在助手完成后再确认
- `runner`、`budgetUsd`、`maxRetries`、`timeoutMs` 仍由用户在最终确认阶段决定
- 如果任务目的本身是在生成某种内容结果，创建助手默认应把“生成文件产物”整理进 `task.md`；除非用户明确说不要文件产物，否则不应写出“无需生成文件”之类的要求
- 正式创建后，Task 仍遵循 [0004 Task Creation](/Users/york/data/workspace/ai/n3/drift-work/docs/decisions/0004-task-creation.md)

## Schedule 创建流程

Web Schedule Create 与 Task Create 共用工作台，但分为两段：

```text
选择 task type
-> 选择 spec 来源（New / Copy from existing task）
-> 创建 schedule draft
-> 启动创建助手会话
-> 在工作台中整理 spec/
-> 校验 spec/task.md 非空
-> 用户确认 scheduleId / title / cron / runner / skipIfActive / enabled
-> 生成正式 schedule 与 schedule-state
```

约定：

- `spec` 整理和 schedule 系统参数填写分开
- 若来源为 `Copy from existing task`，则先复制该任务的 `spec/` 到草稿目录，再进入助手工作台
- `scheduleId`、`cron`、`skipIfActive`、`enabled` 必须由用户明确确认
- 若所选 runner 当前不可用，创建时应强制 `enabled = false`
- 正式创建后，Schedule 仍遵循 [0005 Scheduling](/Users/york/data/workspace/ai/n3/drift-work/docs/decisions/0005-scheduling.md)

## 工作台能力

第一版工作台最小能力：

- 显示草稿目录文件列表
- 上传附加文件到草稿 `spec/`
- 在草稿目录中新建空文件
- 查看并编辑 `task.md`
- 查看助手会话输出
- 刷新文件变化
- 展示最终创建摘要

第一版可以不做：

- 文件重命名
- 文件 diff 可视化
- 多会话并发创建
- 浏览器内嵌 terminal 级交互模拟

## Web API 方向

第一版实现建议新增一组草稿与创建会话 API，而不是直接复用正式 task/schedule API。

示意接口：

```text
POST /api/drafts/tasks
POST /api/drafts/schedules
POST /api/drafts/schedules/from-task/:taskId

GET  /api/drafts/:draftId
GET  /api/drafts/:draftId/files
GET  /api/drafts/:draftId/files/content?path=task.md
POST /api/drafts/:draftId/files/upload
POST /api/drafts/:draftId/files/content

POST /api/drafts/:draftId/session/start
GET  /api/drafts/:draftId/session
POST /api/drafts/:draftId/session/input
POST /api/drafts/:draftId/session/stop

POST /api/drafts/:draftId/finalize-task
POST /api/drafts/:draftId/finalize-schedule
```

这些 API 的职责是：

- 管理草稿目录
- 管理创建助手会话
- 最终将草稿转成正式 task 或 schedule

它们不负责执行任务本身。

## 分阶段实施

推荐分两阶段推进：

### 第一阶段：Task Create Assistant

- 只做 Task 创建工作台
- 打通草稿目录、创建助手会话、最终创建任务
- 支持创建为 `not_queued` 或直接 enqueue
- 当前实现中，助手会话以“轮次调用 + 草稿 transcript”方式延续上下文；仍然严格限制在草稿 `spec/` 目录内工作
- 当前实现同时支持 `manual`、`claude`、`codex` 三种创建方式；其中 `manual` 只使用草稿编辑流程，不显示助手会话区

### 第二阶段：Schedule Create Assistant

- 复用同一个创建工作台
- 增加 `Copy from existing task`
- 增加 schedule 参数确认页
- 最终创建 schedule 与 `schedule-state.json`

## 非目标

本决策明确不包含以下内容：

- 在 Web 中嵌入正式执行 runner 会话
- 让创建助手跨目录搜索整个 workspace
- 用结构化表单替代 `task.md`
- 让创建助手自动决定 schedule 系统控制项
- 在第一版中支持多人同时编辑同一草稿

## 结果

这样设计后，Web 创建器将具备以下特征：

- 与 CLI 创建语义一致
- 比纯表单更接近真实用户需求
- 保持 `spec/task.md` 作为中心
- 保持管理器与任务内容之间的边界清晰
- 能自然扩展到 Task 与 Schedule 两条创建路径
