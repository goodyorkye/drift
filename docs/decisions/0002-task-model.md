# 0002 Task Model

日期：2026-04-22

## 结论

系统的核心对象只管理任务生命周期与执行记录，不理解任务业务内容。

- 不再以 `Phase` 作为核心任务模型的一部分
- `TaskInstance` 是一次具体任务实例
- `Schedule` 负责周期性生成 `TaskInstance`
- 任务正文对系统保持黑盒
- 每个 `TaskInstance` 拥有独立长期目录

## 已确认规则

### 1. 核心边界

- 系统只做任务管理，不做任务编排
- 任务内容对系统是黑盒
- 任务的上下文、输入、执行方式、产物形式均由任务自身定义
- 系统只关心通用元数据、生命周期状态和执行记录
- `Phase` 不作为核心任务模型默认能力存在

### 2. TaskType / Schedule / TaskInstance

- `TaskType` 表示任务类别
- `Schedule` 表示定时规则，用于周期性地产生任务实例
- `TaskInstance` 表示一次具体执行的任务

也就是说：

- 手动任务：由用户直接创建 `TaskInstance`
- 定时任务：由 `Schedule` 自动创建 `TaskInstance`

`Schedule` 本身不是任务实例，也不拥有任务工作目录。

更细的定时任务设计见：

- `0005-scheduling.md`

### 3. TaskType 的职责边界

在新设计中，`TaskType` 收敛为“分类 + 默认配置”，而不是任务执行蓝图。

`TaskType` 适合承担的职责：

- 标识任务类别
- 提供展示名称和描述
- 提供默认 runner / agent
- 提供默认预算和重试次数
- 提供默认超时时间

每个任务类型使用独立目录，类型定义文件固定命名为 `task-type.json`。

推荐结构：

```text
task-types/
  <type>/
    task-type.json
    guide/
      guide.md
      ...
```

`task-type.json` 第一版最小结构：

```json
{
  "type": "research",
  "label": "调研任务",
  "description": "多源信息收集与分析",
  "defaultRunner": "claude",
  "defaultBudgetUsd": 10,
  "defaultMaxRetries": 3,
  "defaultTimeoutMs": 1800000,
  "runnerEnvPresets": [
    {
      "name": "中文简报",
      "env": {
        "REPORT_LANGUAGE": "zh-CN",
        "REPORT_DEPTH": "brief"
      }
    }
  ]
}
```

其中：

- `type`：唯一标识
- `label`：展示名称
- `description`：说明文本
- `defaultRunner`：默认执行器
- `defaultBudgetUsd`：默认预算
- `defaultMaxRetries`：默认重试次数
- `defaultTimeoutMs`：默认超时时间
- `runnerEnvPresets`：可选的 runner 环境变量预设，供创建交互时直接选择

这些默认执行配置在任务实例创建时会被固化到 `task.json`，执行阶段只读取任务实例，不再动态回查 `TaskType`。

`TaskType` 不再承担的职责：

- 定义任务步骤
- 定义系统阶段
- 定义验证命令、回滚逻辑、审批节点
- 强约束任务正文格式

### 4. TaskType Guide

每个 `TaskType` 可以有一套可选的 guide 目录，用于提供该类任务的通用执行建议，但它不是强制执行蓝图。

guide 的特征：

- 是可选补充材料，不是必需项
- 只有该类型真的提供 guide 时，runner 才注入
- guide 的作用是提供默认建议，不覆盖具体任务定义
- 具体任务的 `task.md` 优先于类型 guide

约定：

- guide 与 `task-type.json` 同属一个类型目录
- guide 目录中的 `guide.md` 是类型级补充材料
- guide 目录下允许存在其他附加文件
- guide 始终按路径引用，不复制进任务目录
- Agent 应先读取 `task.md`，再按需读取类型 guide
- 类型 guide 只是补充上下文，不覆盖具体任务正文
- guide 路径不需要写入 `TaskType` 字段，按目录约定发现即可

### 5. TaskInstance 最小职责

`TaskInstance` 只承载任务管理所需信息：

- 通用元数据，例如 `id`、`type`、`title`、`agent`
- 生命周期状态
- 重试、预算、时间戳等运行控制信息
- 轻量执行索引字段
- 任务内容引用或任务内容落点

系统不再在核心模型中内置下列任务专属字段：

- `goal`
- `acceptance`
- `targetRepo`
- `timeRange`

推荐的 `task.json` 第一版最小结构：

```json
{
  "taskId": "task_01JSF7K8N6W3R4T5Y6Z7A8B9C0",
  "type": "research",
  "title": "调研 xxx",
  "runner": "claude",
  "budgetUsd": 10,
  "maxRetries": 3,
  "timeoutMs": 1800000,
  "createdAt": "2026-04-22T12:34:56.000+08:00",
  "createdBy": {
    "kind": "manual"
  },
  "retryCount": 0,
  "status": "not_queued",
  "statusUpdatedAt": "2026-04-22T12:34:56.000+08:00",
  "latestRunId": null,
  "lastEnqueuedAt": null,
  "lastStartedAt": null,
  "lastFinishedAt": null,
  "runnerEnv": {
    "TARGET_REPO": "/path/to/repo"
  }
}
```

约定：

- `task.json` 是任务级 canonical metadata
- `runner` 表示该任务实例实际采用的 runner，而不是默认值
- 创建任务时，`runner` 由用户显式选择并写入 `task.json`
- `budgetUsd`、`maxRetries`、`timeoutMs` 是该任务实例最终采用的执行控制值
- 这些执行控制值在创建任务时从 `TaskType` 默认值或系统默认值固化到 `task.json`
- `retryCount` 是运行时累计值，与 `maxRetries` 分层
- `runnerEnv` 是可选字段，定义 runner 进程启动时额外注入的环境变量；会与系统当前进程 env 合并（extend），不会替换；适合存放任务级配置变量，不适合存放敏感值
- `status` 允许包含：
  - `not_queued`
  - `pending`
  - `running`
  - `paused`
  - `done`
  - `blocked`
- 对已入队任务来说，`queue/` 目录位置仍然是运行时状态真相
- `task.json.status` 是同步后的状态快照，便于查询与展示
- `statusUpdatedAt` 表示状态快照最后一次更新时间
- `latestRunId`、`lastEnqueuedAt`、`lastStartedAt`、`lastFinishedAt` 属于轻量索引字段
- JSON 时间字段统一使用当前运行环境时区的 ISO 8601 带偏移格式，而不是固定 UTC `Z`
- `task.json` 不内嵌完整 `RunRecord[]`
- 完整 run 历史只通过 `workspace/tasks/<taskId>/runs/` 目录读取
- `createdBy` 使用可扩展结构，第一版至少支持：

```json
{
  "kind": "manual"
}
```

推荐第一版结构：

```json
{
  "kind": "manual | claude | codex | schedule",
  "sourceId": "optional"
}
```

约定：

- `kind` 表示任务的创建来源
- `sourceId` 是可选来源引用
- 当 `kind = schedule` 时，`sourceId` 可用于保存 `scheduleId`
- 其他创建方式暂不要求必须提供 `sourceId`

### 5.1 queue ticket

`queue/` 目录中的文件只承担“状态票据”职责，不保存完整任务元数据。

推荐最小结构：

```json
{
  "taskId": "task_01JSF7K8N6W3R4T5Y6Z7A8B9C0",
  "enteredAt": "2026-04-22T12:35:10.000+08:00"
}
```

约定：

- `queue/` 中的目录位置表达当前状态
- `enteredAt` 表示进入当前状态目录的时间
- 每次进入新状态时，`enteredAt` 必须刷新
- `queue ticket` 只保存最小状态票据，不重复保存任务元数据

### 5.2 not_queued

- `not_queued` 是 `task.json` 专属的初始状态
- 它表示任务目录与 `spec/task.md` 已创建完成，但任务尚未正式加入队列
- `not_queued` 不进入 `queue/` 状态机，也不出现在 `queue/` 目录中
- 用户可以后续通过显式 enqueue 操作将其加入队列
- 一旦任务入队，状态流转即进入正式生命周期：`pending / running / paused / done / blocked`

### 6. 任务正文与任务目录

每个 `TaskInstance` 使用独立目录，最小结构如下：

```text
workspace/tasks/<taskId>/
  spec/
    task.md
    ...
  workdir/
    ...
  runs/
    <runId>/
      ...
  managed-artifacts/
    ...
```

其中：

- `spec/`：任务原件
- `workdir/`：执行现场
- `runs/`：单次执行记录
- `managed-artifacts/`：管理器接管后的正式产物

### 7. task.md 规则

- `spec/` 下必须存在 `task.md`
- `task.md` 不约定固定格式
- `task.md` 由 agent 自主理解
- `spec/` 下其他文件不做额外结构要求，原样保留即可

### 8. spec 与 workdir 的关系

- 任务初始化时，将 `spec/` 原样复制到 `workdir/`
- agent 实际在 `workdir/` 中执行
- agent 首先读取 `task.md` 了解任务
- 如有需要，再读取 `workdir/` 下其他文件，以及按路径引用的类型 guide 补充材料
- 后续 `resume` / 重试继续复用同一个 `workdir/`
- 不在每次 run 启动时重新覆盖整个 `workdir/`

### 9. 生命周期状态

核心状态收敛为：

- `pending`
- `running`
- `paused`
- `done`
- `blocked`

其中：

- `paused` 表示当前缺少继续执行条件，可后续恢复
- `blocked` 表示任务失败或终止，不再继续自动执行

状态流转规则：

- `paused -> resume -> pending`
- `paused -> abandon -> blocked`
- `not_queued -> enqueue -> pending`
- `done -> rerun -> pending`
- `blocked -> rerun -> pending`

语义规则：

- `paused` = 等条件
- `blocked` = 出故障 / 终止

`rerun` 约定：

- `rerun` 只允许作用于 `done` 或 `blocked` 任务
- `rerun` 的语义是“从头重新执行该任务实例”，不是继续上一次现场
- `rerun` 时应先重置该任务的 `workdir/`，再重新进入 `pending`
- `rerun` 时 `retryCount` 重置为 `0`
- `rerun` 后会产生新的 `RunRecord`

### 10. TaskInstance 与 RunRecord

- `TaskInstance` 不在 `task.json` 中内嵌完整 `RunRecord[]`
- run 历史通过 `runs/` 目录维护，`task.json` 只保留轻量索引字段
- 每次启动 runner 都生成新的 `RunRecord`
- `resume` 也生成新的 `RunRecord`
- `runId` 表示一次执行尝试
- `sessionRef` 表示 agent 会话
- 多个 `RunRecord` 可以共享同一个 `sessionRef`

## 原因

这样设计的目标是：

- 保持任务管理器边界清晰，不侵入任务业务语义
- 把“任务实例”和“执行尝试”分开
- 让手动任务与定时任务使用同一种实例模型
- 让 `task.md` 成为简单统一的任务入口，而不是引入额外 DSL
- 保持 `workdir/` 连续性，便于 `resume`、重试和人工核查
