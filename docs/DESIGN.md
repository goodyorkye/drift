# drift-work 设计文档

> 项目名：drift-work  
> CLI 命令：`drift`  
> 语言：TypeScript / Node.js

---

## 一、项目定位

drift-work 是一个自主 Agent 任务管理系统。用户定义任务，系统负责创建、排队、调度、执行、暂停、恢复、完成、失败等生命周期管理，并保留可追溯的执行记录。

**核心目标**：让 Agent 在无人值守情况下稳定消费任务，同时保持结果可追溯、失败可恢复、系统边界清晰。

---

## 二、设计边界

### 1. 系统只做任务管理，不做任务编排

任务管理器不拆解任务内部步骤，不定义 `plan / implement / verify` 之类的系统阶段，也不对具体任务流程做判断。

### 2. 任务内容对系统是黑盒

任务的上下文、输入、执行方式、产物形式都由任务自身定义。对系统来说，任务正文可以是一段文本、一个 Markdown 文件或其他载荷。

### 3. 核心不理解任务业务语义

核心模型不内置 `targetRepo`、`timeRange`、`goal`、`acceptance` 等任务专属字段，也不内置 git 分支、验证命令、回滚等某类任务的执行逻辑。

### 4. 默认无 Phase

`Phase` 不作为核心任务模型的一部分存在。任务内部如何分解与执行，由 Agent 自主决定。

### 5. 系统只关心通用元数据与状态

例如任务 ID、类型、标题、状态、执行器、时间戳、重试次数、预算、运行记录、结果引用等。
JSON 中的时间字段统一使用当前运行环境时区的 ISO 8601 带偏移格式，例如 `2026-04-25T15:30:45.123+08:00`。

---

## 三、设计目标

- 稳定：状态由系统维护，不依赖 Agent 记忆或 prompt 约定
- 可扩展：新任务类型、新 Agent 不要求修改核心设计
- 可观测：运行历史、日志、结果、会话引用可追踪
- 人机协作：支持通用暂停、恢复、放弃，而不是任务内阶段审批
- 成本可控：每任务预算和重试上限可控

## 四、非目标

- 不做远程多用户 Web 平台
- 不做分布式
- 不引入数据库
- 不做任务 DSL
- 不做任务内部工作流编排器

本地 Web UI 作为 CLI 的观察、审计和轻量控制台存在，详见 `docs/decisions/0009-web-ui.md`。它不改变核心文件状态机，不提供认证/授权能力；局域网访问必须显式开启。
Web 版任务创建与定时任务创建采用“创建助手会话 + 草稿目录 + 人工确认系统字段”的工作台模式，详见 `docs/decisions/0010-web-creation-workbench.md`。

---

## 五、核心对象

### 1. TaskType

任务类别定义，用于描述某类任务的基本信息和默认执行配置。

在新设计中，`TaskType` 的职责收敛为“分类 + 默认配置”，而不是任务执行蓝图。

此外，每个 `TaskType` 可以拥有一套可选 guide 材料，作为类型级补充建议。若存在 guide，则由系统按路径提供给 Agent 作为只读补充材料；具体任务的 `task.md` 优先于类型 guide。

任务类型目录约定：

```text
task-types/
  <type>/
    task-type.json
    guide/
      guide.md
```

第一版 `TaskType` 建议只保留：

- `type`
- `label`
- `description`
- `defaultRunner`
- `defaultBudgetUsd`
- `defaultMaxRetries`
- `defaultTimeoutMs`

### 2. Schedule

定时规则，用于周期性地产生 `TaskInstance`。  
`Schedule` 不是任务实例本身，也不拥有任务工作目录。

`Schedule` 应作为独立模型存在，负责定义“何时触发”和“触发时如何生成任务”；它不复用 `TaskInstance` 结构。

当 `skipIfActive = true` 时，若同一 `scheduleId` 创建的任务仍处于 `pending / running / paused`，则跳过本次触发。

`scheduleId` 由用户输入或确认，采用 slug 风格命名，只允许小写字母、数字和 `-`。

`schedule.json` 保存定时规则与任务生成规格，建议最小字段包括：`scheduleId`、`type`、`title`、`runner`、`cron`、`skipIfActive`、`enabled`。`cron` 默认按当前运行环境时区解释。

`schedule-state.json` 单独保存运行时观测信息，例如最后一次触发信息、累计状态统计、累计时间统计；第一版可以完整保留这些字段，尚未形成的数据允许为空。时间统计不必等任务结束后才更新，当前已知时长也可以记录。它固定放在 `workspace/schedules/<scheduleId>/schedule-state.json`，这些运行态数据不进入 `schedule.json`。

### 3. TaskInstance

一次具体任务实例。

- 手动任务：由用户直接创建 `TaskInstance`
- 定时任务：由 `Schedule` 自动创建 `TaskInstance`

`TaskInstance` 只承载任务管理所需的信息：

- 通用元数据
- 生命周期状态
- 重试 / 预算 / 时间戳等运行控制信息
- 轻量执行索引字段
- 任务原件落点

任务级 canonical metadata 建议落在：

`workspace/tasks/<taskId>/task.json`

其中包含任务基本信息、状态快照以及轻量索引字段；运行时状态真相仍由 `queue/` 目录位置表达。

其中 `runner` 表示该任务实例最终选定的执行 runner，并在创建任务时由用户显式选择。`budgetUsd`、`maxRetries`、`timeoutMs` 等实例级执行控制值也应在创建时从 `TaskType` 默认值或系统默认值固化到 `task.json`；`retryCount` 继续作为运行时累计值存在。

`task.json` 不内嵌完整 `RunRecord[]`；完整 run 历史只通过 `workspace/tasks/<taskId>/runs/` 目录读取，`task.json` 只保留 `latestRunId` 等轻量索引字段。

任务来源建议使用可扩展的 `createdBy` 结构，例如：

```json
{
  "kind": "manual | claude | codex | schedule",
  "sourceId": "optional"
}
```

### 4. RunRecord

一次执行尝试的记录。

- 每次启动 runner 都生成新的 `RunRecord`
- `resume` 也生成新的 `RunRecord`
- `runId` 表示执行尝试
- `sessionRef` 表示 agent 会话
- 多个 `RunRecord` 可以共享同一个 `sessionRef`

---

## 六、生命周期状态

核心状态收敛为：

- `pending`
- `running`
- `paused`
- `done`
- `blocked`

语义约定：

- `paused`：当前缺少继续执行条件，后续可以恢复
- `blocked`：任务失败或终止，不再继续自动执行

主要流转：

```text
pending -> running -> done
                 -> paused
                 -> blocked

paused -> pending   (resume)
paused -> blocked   (abandon)
done -> pending     (rerun)
blocked -> pending  (rerun)
```

其中 `not_queued` 是 `task.json` 专属初始状态，用于表示任务已创建但尚未正式入队；它不进入 `queue/` 状态机。用户可通过显式 enqueue 操作将其加入 `pending`。

一句话概括：

- `paused` = 等条件
- `blocked` = 出故障 / 终止
- `rerun` = 从头重跑该任务实例

---

## 七、任务目录模型

每个 `TaskInstance` 使用独立长期目录，任务结束后默认保留，不自动删除。清理策略独立设计。

目录职责如下：

```text
workspace/tasks/<taskId>/
  spec/
    task.md
    ...
  workdir/
    ...
  runs/
    <runId>/
      agent-result.json
      run-meta.json
      stdout.log
      stderr.log
      intake.json
  managed-artifacts/
    ...
```

- `spec/`：任务原件
- `workdir/`：执行现场
- `runs/`：单次执行记录
- `managed-artifacts/`：管理器接管后的正式产物

任务规则：

- `spec/` 下必须存在 `task.md`
- `task.md` 不约定固定格式，由 Agent 自主理解
- 任务初始化时，将 `spec/` 原样复制到 `workdir/`
- 后续 `resume` / 重试继续复用同一个 `workdir/`
- Agent 在 `workdir/` 中执行，并先读取 `task.md`

定时任务额外拥有 schedule 级别目录：

```text
workspace/schedules/<scheduleId>/
  schedule.json
  schedule-state.json
  spec/
    task.md
    ...
  shared-state/
    ...
```

- `schedule-state.json`：管理器拥有的调度观测状态
- `shared-state/`：任务业务状态黑盒目录，用于同一 schedule 下多次执行共享状态
- `shared-state/` 由管理器创建和保留，但不解析其中内容
- 所有任务执行时，runner 都会注入一个 `shared-state` 绝对路径
- 对普通任务，`shared-state` 指向该任务自己的长期执行目录
- 对由 schedule 生成的任务，`shared-state` 指向对应 schedule 的 `shared-state/`
- Agent 不应把业务状态写回 `spec/` 或 `schedule-state.json`

---

## 八、执行协议

### 1. AgentResult

Agent 负责写任务语义结果，不负责写执行元数据。

第一版 `AgentResult` 最小结构：

```json
{
  "status": "success | paused | blocked",
  "reason": "可选；paused/blocked 时应填写",
  "artifactRefs": ["相对路径列表，可选"]
}
```

约定：

- `status = success`：任务已完成
- `status = paused`：当前缺少继续执行条件
- `status = blocked`：任务当前不可继续
- `artifactRefs` 必须是相对 `workdir/` 的相对路径
- `artifactRefs` 不限制具体文件格式
- `error` 不由 Agent 主动产出，由 runner / 系统兜底生成

### 2. AgentResult 文件位置

- Agent 固定将结果写入当前工作目录下的 `agent-result.json`
- 不要求 Agent 直接写 `runs/<runId>/` 下的文件
- 当前工作目录即任务的 `workdir/`
- 每次新 run 启动前，runner 先删除旧的 `workdir/agent-result.json`
- runner 在执行结束后读取、校验并复制到 `runs/<runId>/agent-result.json`

### 3. Run Meta

`run-meta.json` 由 runner / 管理器维护，不由 Agent 写入。

职责：

- 记录 run 的启动、结束和最终运行状态
- 记录 `sessionRef`、日志引用、结果引用等执行元数据

状态语义与 `AgentResult` 分层：

- `run-meta.status`：运行状态，例如 `running | finished | failed`
- `AgentResult.status`：任务结果状态，例如 `success | paused | blocked`

`trigger` 建议只使用 `initial | resume | retry`；不单独保留 `manual` 枚举。

---

## 九、artifact intake

管理器读取 `artifactRefs` 后执行统一 intake。

规则：

- intake 默认使用“复制”，不默认移动
- 产物的最终搬运、归档、标准化落点、清理由管理器负责
- 原始 `workdir/` 现场默认保留

---

## 十、Runner 注入说明

runner 启动 Agent 时，应统一注入最小且稳定的系统说明。任务模板或 `task.md` 只描述任务业务内容，不重复定义系统协议。

所有任务都应看到一个 `shared-state` 概念；对 schedule 任务，它是唯一被系统明确允许的跨实例业务状态目录。

至少应注入：

- 当前工作目录是 `workdir/`
- 应先读取 `task.md`
- 如有需要，再读取 `workdir/` 下其他文件
- 所有运行期修改、生成、整理文件都应在 `workdir/` 内进行
- `shared-state` 绝对路径
- `AgentResult` 协议
- `artifactRefs` 的相对路径规则

---

## 十一、运行时目录总览

```text
workspace/
  queue/
    pending/
    running/
    paused/
    done/
    blocked/

  schedules/
    <scheduleId>/
      schedule.json
      schedule-state.json
      spec/
      shared-state/

  tasks/
    <taskId>/
      spec/
      workdir/
      runs/
      managed-artifacts/

  logs/
    system/
      YYYY-MM-DD.jsonl
```

---

## 十二、相关决策文档

更细的设计决策见：

- [0001 Execution Protocol](/Users/york/data/workspace/ai/n3/drift-work/docs/decisions/0001-execution-protocol.md)
- [0002 Task Model](/Users/york/data/workspace/ai/n3/drift-work/docs/decisions/0002-task-model.md)
- [0003 Runner Injected Instructions](/Users/york/data/workspace/ai/n3/drift-work/docs/decisions/0003-runner-injected-instructions.md)
- [0004 Task Creation](/Users/york/data/workspace/ai/n3/drift-work/docs/decisions/0004-task-creation.md)
- [0005 Scheduling](/Users/york/data/workspace/ai/n3/drift-work/docs/decisions/0005-scheduling.md)
- [0006 Crash Recovery](/Users/york/data/workspace/ai/n3/drift-work/docs/decisions/0006-crash-recovery.md)
- [0007 Concurrency](/Users/york/data/workspace/ai/n3/drift-work/docs/decisions/0007-concurrency.md)
- [0008 Schedule Shared State](/Users/york/data/workspace/ai/n3/drift-work/docs/decisions/0008-schedule-shared-state.md)
- [0009 Web UI](/Users/york/data/workspace/ai/n3/drift-work/docs/decisions/0009-web-ui.md)
- [0010 Web Creation Workbench](/Users/york/data/workspace/ai/n3/drift-work/docs/decisions/0010-web-creation-workbench.md)
