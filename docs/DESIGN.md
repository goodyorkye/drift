# drift-work 设计文档

> **项目名**：drift-work  
> **CLI 命令**：`drift`  
> **语言**：TypeScript / Node.js

---

## 一、项目定位

drift-work 是一个自主 Agent 任务调度执行系统。用户定义任务，系统自动调度分发给 AI Agent（Claude、Codex 等）执行，产出报告或代码变更。

**解决的核心问题**：让 AI Agent 在无人值守的情况下稳定、可靠地消费任务队列，结果可追溯，失败可恢复。

### 设计目标

- **稳定**：状态由系统维护，不依赖 Agent 记忆或 prompt 约定
- **可扩展**：新任务类型、新 Agent 无需改核心代码
- **可观测**：结构化日志，执行历史可查询
- **人机协作**：多阶段任务支持在关键节点暂停等待人工确认
- **成本可控**：每任务预算上限，失败自动熔断

### 非目标

- 不做 Web UI（CLI 足够）
- 不做分布式（单机运行）
- 不引入数据库（文件队列满足当前规模）

---

## 二、架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                      drift CLI                               │
│   task add/list/remove · schedule · start/stop · status     │
└──────┬───────────────────────────────────────┬──────────────┘
       │ 写入任务文件                           │ 调度配置 CRUD
       ▼                                       ▼
┌──────────────────┐                ┌─────────────────────────┐
│   queue/         │◄───────────────│      Scheduler          │
│   pending/       │  定时自动入队   │  (node-cron，独立进程)  │
│   running/       │                └─────────────────────────┘
│   done/          │
│   blocked/       │
│   waiting/       │  ← 多阶段任务等待人工确认
└──────┬───────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│                    Orchestrator                              │
│  取任务 → 加载类型定义 → 合并 phase_overrides               │
│  → 执行阶段 → 读 result.json → 推进/重试/阻塞              │
└──────────────────────┬──────────────────────────────────────┘
                       │ 按 agent 字段分发
            ┌──────────┼──────────┐
            ▼          ▼          ▼
       runners/    runners/   runners/
       claude.ts   codex.ts   (可扩展)
            │          │
            └────┬─────┘
                 │ 统一 Result Contract
                 ▼
        queue/running/{id}.result.json
        reports/{date}/{type}-{title}.md
```

---

## 三、核心概念

### 3.1 任务类型（Task Type）

任务类型是**流程定义**，描述一类任务如何执行：分几个阶段、每个阶段用什么模板、允许哪些工具、是否需要人工确认。

类型定义保存在 `task-types/` 目录，**稳定、可复用**，不随具体任务变化。

### 3.2 任务实例（Task Instance）

任务实例是**执行数据**，描述一个具体任务要做什么。只包含业务数据（目标、描述、约束）和运行时状态（当前阶段、重试次数），不包含流程逻辑。

### 3.3 阶段（Phase）

阶段是任务类型内的执行单元。多阶段任务（如功能开发）按顺序逐阶段推进，单阶段任务（如调研）只有一个 execute 阶段。

阶段支持以下控制属性：

| 属性 | 说明 |
|------|------|
| `template` | Prompt 模板路径 |
| `allowedTools` | 该阶段允许的工具列表 |
| `humanReview` | 是否在执行后暂停等待人工确认 |
| `gitCheckpoint` | 是否在执行前创建 git 分支 |
| `verificationCmd` | 执行后运行的验证命令 |
| `rollbackOnFailure` | 验证失败是否回滚 git 变更 |

### 3.4 Runner

Runner 是 Agent 的适配层。每个 Runner 封装具体 Agent 的 CLI 调用方式，对外提供统一接口，并负责确保 Result Contract（result.json）的存在。

### 3.5 Result Contract

Agent 完成任务后**必须**写入 `queue/running/{id}.result.json`，这是 Orchestrator 判断任务状态的唯一依据：

```json
{
  "status": "success | blocked | error",
  "reason": "失败时的原因说明",
  "outputFile": "reports/2026-04-21/research-xxx.md"
}
```

Orchestrator 不解析 Agent 的 stdout，只读这个文件。Runner 负责在 Agent 未写入时强制生成一个 error 记录。

### 3.6 队列状态机

```
pending → running → done
                  ↘ blocked    (重试次数耗尽)
                  ↘ pending    (失败但可重试，retry_count++)
         running → waiting     (humanReview 阶段完成，等待确认)
         waiting → running     (drift approve <id>)
```

---

## 四、目录结构

```
drift-work/
├── src/
│   ├── orchestrator.ts      # 主循环，任务状态机
│   ├── scheduler.ts         # Cron 调度，独立进程
│   ├── queue.ts             # 文件队列操作（原子 mv）
│   ├── registry.ts          # 任务类型注册表
│   ├── runners/
│   │   ├── base.ts          # Runner 基类，合约校验
│   │   ├── claude.ts        # Claude CLI 封装
│   │   ├── codex.ts         # Codex CLI 封装
│   │   └── index.ts         # Runner 注册表
│   ├── cli/
│   │   ├── index.ts         # drift 命令入口
│   │   ├── task.ts          # drift task add/list/remove/approve
│   │   ├── schedule.ts      # drift schedule add/list/enable/disable/run
│   │   └── process.ts       # drift start/stop/status/logs
│   └── types.ts             # 全局类型定义
│
├── task-types/              # 任务类型定义（JSON，进 git）
│   ├── research.json
│   ├── code-review.json
│   ├── doc-review.json
│   └── feature-dev.json
│
├── tasks/
│   ├── templates/           # Prompt 模板（Markdown，进 git）
│   │   ├── research.md
│   │   ├── code-review.md
│   │   ├── doc-review.md
│   │   └── feature-dev/
│   │       ├── plan.md
│   │       ├── implement.md
│   │       └── verify.md
│   └── scheduled/           # 定时任务模板（JSON，进 git）
│
├── queue/                   # 运行时状态（不进 git）
│   ├── pending/
│   ├── running/
│   ├── done/
│   ├── blocked/
│   └── waiting/
│
├── reports/                 # 产出报告，按日期（不进 git）
├── logs/                    # JSON Lines 日志（不进 git）
├── scheduler/
│   └── schedules.json       # Cron 调度配置（进 git）
├── docs/
│   └── DESIGN.md            # 本文件
├── CLAUDE.md
├── package.json
└── tsconfig.json
```

---

## 五、数据结构

### 5.1 任务类型定义

```typescript
interface Phase {
  name: string
  template: string                 // 相对于项目根的路径
  allowedTools: string[]
  humanReview?: boolean            // 执行后暂停等待人工确认
  gitCheckpoint?: boolean          // 执行前创建 git 分支
  verificationCmd?: string         // 执行后运行的验证命令
  rollbackOnFailure?: boolean      // 验证失败时回滚 git 变更
}

interface TaskType {
  type: string
  description: string
  phases: Phase[]
  defaultAgent?: string            // 默认 agent，可被实例覆盖
  defaultMaxRetries?: number
  defaultBudgetUsd?: number
}
```

示例（`task-types/feature-dev.json`）：

```json
{
  "type": "feature-dev",
  "description": "多阶段功能开发：方案 → 实现 → 验证",
  "defaultMaxRetries": 1,
  "defaultBudgetUsd": 20.0,
  "phases": [
    {
      "name": "plan",
      "template": "tasks/templates/feature-dev/plan.md",
      "allowedTools": ["Read", "Glob", "Grep", "WebSearch"],
      "humanReview": true
    },
    {
      "name": "implement",
      "template": "tasks/templates/feature-dev/implement.md",
      "allowedTools": ["Read", "Write", "Edit", "Bash(git checkout -b*)", "Bash(npm*)"],
      "gitCheckpoint": true
    },
    {
      "name": "verify",
      "template": "tasks/templates/feature-dev/verify.md",
      "allowedTools": ["Read", "Bash(npm test*)", "Bash(pytest*)"],
      "verificationCmd": "npm test",
      "rollbackOnFailure": true
    }
  ]
}
```

### 5.2 任务实例

```typescript
interface TaskInstance {
  // 基本信息
  id: string                       // task-{timestamp}-{random}
  type: string                     // 对应 task-types/ 下的类型名
  agent: string                    // "claude" | "codex" | ...
  title: string
  description: string

  // 需求分析产出（drift task add 时填入）
  goal?: string                    // 要达成什么结果
  constraints?: string[]           // 范围限制
  acceptance?: string              // 验收标准

  // 任务特定参数
  targetRepo?: string              // code-review / feature-dev 用
  timeRange?: string               // code-review 用，如 "24 hours ago"

  // Phase 级别覆盖（覆盖类型定义的默认值）
  phaseOverrides?: Partial<Record<string, Partial<Phase>>>

  // 运行时状态（由 Orchestrator 维护，不由用户填写）
  currentPhaseIndex: number
  retryCount: number
  maxRetries: number
  budgetUsd: number
  createdAt: string                // ISO 8601
  lastAttemptedAt?: string
  outputFile?: string
  branchName?: string              // feature-dev 创建的分支名
  blockedReason?: string
}
```

### 5.3 调度配置

```typescript
interface Schedule {
  id: string
  description: string
  taskTemplate: string             // 指向 tasks/scheduled/ 下的模板文件
  cron: string                     // 标准 cron 表达式
  enabled: boolean
  lastEnqueuedAt?: string
}
```

### 5.4 日志条目（JSON Lines）

```typescript
type LogEvent =
  | 'task_enqueued'
  | 'task_start'
  | 'phase_start'
  | 'phase_done'
  | 'phase_waiting_review'
  | 'task_done'
  | 'task_retry'
  | 'task_blocked'
  | 'task_scheduled'

interface LogEntry {
  ts: string          // ISO 8601
  event: LogEvent
  taskId?: string
  taskType?: string
  phase?: string
  agent?: string
  scheduleId?: string
  outputFile?: string
  costUsd?: number
  durationMs?: number
  reason?: string
}
```

---

## 六、关键流程

### 6.1 单阶段任务执行（research / code-review）

```
Orchestrator.runOneIteration()
  │
  ├─ queue.dequeue()                    # mv pending/→running/（原子）
  ├─ registry.getType(task.type)        # 加载类型定义
  ├─ resolvePhase(type, task)           # 合并 phaseOverrides
  ├─ runner.run(phase, task)            # 调用 Agent
  │    └─ 写 running/{id}.result.json
  ├─ readResult()
  │    ├─ status=success → mv running/→done/，记录 outputFile
  │    ├─ status!=success，retry<max → mv running/→pending/，retry++
  │    └─ status!=success，retry>=max → mv running/→blocked/
  └─ log(entry)
```

### 6.2 多阶段任务执行（feature-dev）

```
阶段 0（plan）：
  run agent → humanReview=true → mv running/→waiting/
  ↓ drift task approve <id>
  mv waiting/→running/，currentPhaseIndex++

阶段 1（implement）：
  gitCheckpoint=true → git checkout -b drift/{id}，记录 branchName
  run agent → result.json
  ↓ success → currentPhaseIndex++，继续下一阶段

阶段 2（verify）：
  run agent → result.json
  → exec verificationCmd
    ├─ 通过 → mv running/→done/
    └─ 失败，rollbackOnFailure=true → git checkout main，删除分支
                                    → mv running/→blocked/
```

### 6.3 定时触发

```
Scheduler（独立进程，每分钟轮询）
  │
  ├─ 读取 scheduler/schedules.json
  ├─ 遍历 enabled=true 的条目
  ├─ 判断 cron 是否命中（基于 lastEnqueuedAt）
  └─ 命中 → 从 taskTemplate 复制，生成新 TaskInstance（新 id + 新时间戳）
           → mv 到 queue/pending/{id}.json
           → 更新 lastEnqueuedAt
           → 写日志
```

---

## 七、CLI 命令设计

```
drift task add [--type research|code-review|doc-review|feature-dev]
               [--agent claude|codex]
               [--title "标题"]
               # 参数不足时交互式问询，强制执行需求分析

drift task list [--status pending|running|done|blocked|waiting]
drift task remove <id>
drift task approve <id>            # 将 waiting 任务推进到下一阶段

drift schedule add                 # 交互式创建定时任务
drift schedule list
drift schedule enable <id>
drift schedule disable <id>
drift schedule run <id>            # 立即触发一次（不等 cron）

drift start [--daemon]             # 启动 Orchestrator + Scheduler
drift stop                         # SIGTERM 进程组，归还 running 任务到 pending
drift status                       # 进程状态 + 队列各目录计数 + 最近日志

drift logs [--tail 20] [--follow]  # 读取 logs/*.jsonl
```

---

## 八、扩展指南

### 添加新任务类型

1. `task-types/` 下新建 `{type}.json`，定义 `phases`
2. `tasks/templates/` 下新建对应 Prompt 模板
3. 无需修改任何核心代码

### 接入新 Agent

1. `src/runners/` 下新建 `{agent}.ts`，继承 `BaseRunner`
2. 实现 `execute(prompt, phase, task)` 方法
3. 在 `src/runners/index.ts` 注册
4. BaseRunner 的 `enforceContract()` 会在 Agent 未写 result.json 时自动生成 error 记录

### 添加定时任务

1. `tasks/scheduled/` 下新建任务模板 JSON（TaskInstance 格式，省略运行时字段）
2. `drift schedule add` 填写 cron 表达式和模板路径

---

## 九、技术栈

| 类别 | 选型 | 说明 |
|------|------|------|
| 语言 | TypeScript | 类型安全，编译期发现配置错误 |
| 运行时 | Node.js 20+ | 原生 ESM，fs/promises 稳定 |
| 子进程 | `execa` | 可靠的进程管理和信号处理 |
| Cron | `node-cron` | 标准 cron 语法，轻量 |
| 运行时校验 | `zod` | 加载任务/类型文件时校验格式 |
| CLI | `commander` | 成熟，TypeScript 友好 |
| 交互式问询 | `@inquirer/prompts` | 现代 API，替代 readline |
| 测试 | `vitest` | 快，TypeScript 原生支持 |

无数据库：队列用文件系统（`fs.rename` 原子操作），报告保存为 Markdown，日志用 JSON Lines。规模增大后可平滑迁移到 SQLite（仅替换 `src/queue.ts`）。

---

## 十、开放问题

1. **并发执行**：当前设计串行。并行执行多个任务需在 Orchestrator 引入 worker 池和并发队列控制。

2. **Agent 费用解析**：`costUsd` 在日志里有意义，但各 Agent CLI 输出格式不同，是否值得解析需权衡维护成本。

3. **waiting 状态通知**：多阶段任务进入 waiting 后，当前依赖用户主动 `drift status`，可考虑系统通知或 Webhook。

4. **报告索引**：`reports/` 平铺结构，任务量增大后考虑生成 `reports/index.md`。
