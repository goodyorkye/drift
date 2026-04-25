# 0005 Scheduling

日期：2026-04-22

## 结论

`Schedule` 是独立模型，用于周期性地产生 `TaskInstance`，不复用 `TaskInstance` 结构。

- `Schedule` 负责定义何时触发
- `Schedule` 负责定义触发时如何生成任务
- `Schedule` 不是任务实例本身
- `Schedule` 不拥有任务工作目录

## 已确认规则

### 1. Schedule 的职责边界

`Schedule` 关心的是：

- 何时触发
- 是否启用
- 是否在已有活动任务时跳过
- 触发时应生成什么任务

`TaskInstance` 关心的是：

- 这次具体任务是什么
- 当前处于什么状态
- 有哪些执行记录
- 任务目录与产物在哪里

也就是说，`Schedule` 提供的是“任务生成规格”，而不是任务实例本体。

### 2. 推荐目录结构

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

其中：

- `schedule.json`：定时规则与任务生成规格
- `schedule-state.json`：该 schedule 的运行时状态与统计信息
- `spec/`：该 schedule 触发时要复制给新任务的任务原件
- `shared-state/`：该 schedule 下多个任务实例可共享的业务状态黑盒目录

其中 `schedule-state.json` 的固定路径为：

`workspace/schedules/<scheduleId>/schedule-state.json`

推荐的 `schedule.json` 最小结构：

```json
{
  "scheduleId": "daily-research",
  "type": "research",
  "title": "每日行业调研",
  "runner": "claude",
  "cron": "0 9 * * *",
  "skipIfActive": true,
  "enabled": true,
  "runnerEnv": {
    "TARGET_REPO": "/path/to/repo"
  }
}
```

约定：

- `type`、`title`、`runner` 属于任务生成规格的一部分
- `runnerEnv` 是可选字段，定义触发时传递给 runner 进程的额外环境变量
- `runnerEnv` 中的变量会与系统当前进程 env 合并（extend），不会替换
- `runnerEnv` 适合存放任务级配置变量（如目标仓库路径、输出语言等），不适合存放敏感值（如 API key）；敏感值应通过系统环境变量注入
- 它们用于定义“这条 schedule 触发时要生成什么任务”，不是任务运行时状态
- `cron` 按当前运行环境时区解释，不额外配置 `timezone`
- `schedule.json` 只保存配置真相，不保存 `lastRunAt`、`nextRunAt`、`lastTriggeredAt` 等运行时状态

推荐的 `schedule-state.json` 最小结构：

```json
{
  "scheduleId": "daily-research",
  "lastTriggeredAt": "2026-04-23T09:00:00.000+08:00",
  "lastAction": "triggered",
  "lastTaskId": "task_01...",
  "lastRunStatus": "done",
  "stats": {
    "triggered": 10,
    "skipped": 2,
    "createdTasks": 10,
    "done": 8,
    "blocked": 1,
    "paused": 1
  },
  "timing": {
    "lastDurationMs": 182000,
    "avgDurationMs": 165400
  }
}
```

约定：

- `schedule-state.json` 是运行时状态文件，不是配置文件
- 它用于保存最后一次执行信息、累计状态统计、累计时间统计等观测数据
- 它由管理器维护，不用于保存任务业务状态
- 其中时间字段使用当前运行环境时区的 ISO 8601 带偏移格式
- `lastAction` 表示最近一次调度动作，例如 `triggered` 或 `skipped`
- `lastRunStatus` 表示最近一次由该 schedule 生成的任务最终状态
- `stats` 保存累计次数统计
- `timing` 保存累计时间统计；第一版至少支持最近一次时长和平均时长
- 第一版可以完整保留上述最后一次信息、累计状态统计、累计时间统计字段，不再额外区分“必须字段”和“可选字段”
- 时间统计不必等任务结束后才更新；能记录当前已知时长时就应记录
- `lastDurationMs` 表示最近一次任务的当前已知时长；任务结束后它即为最终时长
- `avgDurationMs` 可基于所有已形成有效执行时长的任务更新，不必只限于成功完成的任务
- 若某项统计尚不存在，可缺省或为 `null`

更新责任：

- Scheduler 负责更新调度动作相关字段，例如：
  - `lastTriggeredAt`
  - `lastAction`
  - `lastTaskId`
  - `stats.triggered`
  - `stats.skipped`
  - `stats.createdTasks`
- Orchestrator 负责在由该 schedule 创建的任务发生状态推进时回写结果观测信息，例如：
  - `lastRunStatus`
  - `stats.done`
  - `stats.blocked`
  - `stats.paused`
  - `timing.lastDurationMs`
  - `timing.avgDurationMs`

`shared-state/` 的职责：

- 用于保存同一 schedule 跨多次执行需要共享的任务业务状态
- 例如游标、已处理项目集合、上次同步位置等
- 管理器不解析其中内容
- 执行 agent 可按任务需要读写其中内容
- `shared-state/` 不复制到每个任务的 `spec/` 或 `workdir/`
- runner 在执行由 schedule 生成的任务时，以绝对路径形式注入该目录
- agent 不应把业务状态写回 `spec/` 或 `schedule-state.json`

### 3. 触发时的处理流程

- 生成新的 `taskId`
- 创建新的任务目录 `workspace/tasks/<taskId>/`
- 将 `workspace/schedules/<scheduleId>/spec/` 复制到该任务的 `spec/`
- 生成该任务的 `task.json`
- 设置 `createdBy = { kind: "schedule", sourceId: scheduleId }`
- 将任务加入队列
- Scheduler 更新 `schedule-state.json` 中与本次触发直接相关的字段
- 后续由 Orchestrator 在任务状态推进时继续更新该 schedule 的结果观测字段

### 3.1 创建 schedule 的交互流程

`drift schedule add` 的推荐流程：

```text
选择 TaskType
-> 选择如何准备 spec/
   - 从已有任务复制
   - 手工创建
   - 用 claude/codex 辅助生成
-> 如果选择“从已有任务复制”，先选来源任务
-> 输入 scheduleId
-> 完成 spec/
-> 输入 title
-> 输入 cron
-> 确定执行 runner
-> 选择可选的 runnerEnv 预设
-> 配置调度规则
   - skipIfActive
   - enabled
-> 展示创建摘要并确认
-> 创建 schedule
```

约定：

- `title` 应在 `spec/` 确定之后再输入
- `scheduleId` 应在 `title` 之前输入
- `cron` 应在执行 runner 之前输入，并提供合理默认值
- 若 `spec/` 从已有任务复制，则来源任务的选择应尽量提前，以便继承默认标题、runner 与可选 runnerEnv
- 执行 runner 的确定发生在 `spec/` 确定之后
- 若 `spec/` 从已有任务复制，则默认继承原任务的 `runner`
- 若 `spec/` 从已有任务复制且原任务存在 `runnerEnv`，创建交互可允许直接继承
- 否则由用户显式选择执行 runner
- 若当前 `TaskType` 提供 `runnerEnvPresets`，创建交互可直接选择一套预设
- 调度规则放在 `spec/` 和执行 runner 都确定之后再配置
- 在最终写入前，应展示创建摘要并进行一次确认
- 若用户选择的 runner 当前不可用，`schedule add` 仍可继续，但应强制将 `enabled = false`

### 3.2 scheduleId

- `scheduleId` 应由用户显式输入或确认
- `scheduleId` 是长期使用的人工可读标识
- 与自动生成、机器优先的 `taskId` 不同，`scheduleId` 应更偏向人工友好
- `scheduleId` 采用 slug 风格命名
- 只允许小写字母、数字和 `-`
- 不允许空格，以及 `/`、`\`、`.` 等路径敏感字符
- 命名应尽量短、稳定、可读，例如 `daily-research`、`weekly-git-audit`
- 创建时必须检查 `scheduleId` 是否已存在；若目录已存在，应拒绝覆盖

### 3.3 cron 输入校验

- `drift schedule add` 在写入 `schedule.json` 前应校验 `cron` 表达式
- 创建交互中 `cron` 默认值为 `0 * * * *`
- 非法 `cron` 不应进入持久化配置
- 若用户手工修改文件写入了非法 `cron`，Scheduler 在同步时应跳过该 schedule 并记录系统日志，而不是让整个同步流程崩溃

### 4. skipIfActive

第一版 `skipIfActive` 采用简单语义：

> 若存在同一 `scheduleId` 创建的任务，且该任务尚未结束，则跳过本次触发。

其中：

- 视为 active 的状态：
  - `pending`
  - `running`
  - `paused`

- 不视为 active 的状态：
  - `done`
  - `blocked`

约定：

- 只检查 `createdBy.kind = "schedule"` 且 `createdBy.sourceId = 当前 scheduleId` 的任务
- `paused` 默认视为 active，避免同一 schedule 在上一轮任务尚未收口时继续生成新任务

### 5. Schedule 动态发现

Scheduler 启动后会定期（默认每 30 秒）重新扫描 `schedules/` 目录，无需重启即可感知 schedule 变更。

扫描规则：

- **新增**：目录中存在、`enabled: true`、当前未注册的 schedule → 注册 cron job
- **停用**：已注册的 schedule 满足以下任一条件 → stop cron job 并从注册表移除
  - `schedule.json` 中 `enabled` 改为 `false`
  - `schedules/` 目录下该 scheduleId 已不存在
- **重新启用**：之前因 `enabled: false` 未注册、现在改为 `true` → 视同新增，注册 cron job
- **cron 更新**：已注册且仍为 `enabled`，但 `cron` 表达式发生变化 → stop 旧 job 并按新 `cron` 重建 job

约定：

- 轮询间隔固定为 30 秒，不支持配置
- 轮询至少感知 `enabled`、目录存在性以及 `cron` 表达式变化
- 若某个已启用 schedule 的 `cron` 非法，则该 schedule 本轮不同步注册，并记录系统日志

## 原因

这样设计的目标是：

- 让定时任务与手动任务最终落到统一的 `TaskInstance` 模型
- 保持 `Schedule` 与 `TaskInstance` 的职责分离
- 避免 schedule 文件混入任务运行时字段
- 让 `skipIfActive` 的行为简单、可预测
- 无需重启进程即可感知新增、停用、重新启用的 schedule
