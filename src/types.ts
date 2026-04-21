// ─── Task Type (流程定义，保存在 task-types/) ────────────────────────────────

export interface Phase {
  name: string
  /** Prompt 模板路径，相对于项目根 */
  template: string
  /** 该阶段允许 Agent 使用的工具列表 */
  allowedTools: string[]
  /** 执行后暂停，等待 drift task approve */
  humanReview?: boolean
  /** 执行前创建 git 分支，分支名写入 task.branchName */
  gitCheckpoint?: boolean
  /** 执行后运行的 shell 验证命令 */
  verificationCmd?: string
  /** 验证命令失败时回滚 git 变更 */
  rollbackOnFailure?: boolean
}

export interface TaskType {
  type: string
  description: string
  phases: Phase[]
  defaultAgent?: string
  defaultMaxRetries?: number
  defaultBudgetUsd?: number
}

// ─── Task Instance (执行数据，保存在 queue/) ─────────────────────────────────

export interface TaskInstance {
  // 基本信息
  id: string
  type: string
  agent: string
  title: string
  description: string

  // 需求分析产出（drift task add 时填入）
  goal?: string
  constraints?: string[]
  acceptance?: string

  // 任务特定参数（由任务类型决定是否使用）
  targetRepo?: string
  timeRange?: string

  // Phase 级别覆盖（覆盖 task-types/ 中的默认值）
  phaseOverrides?: Partial<Record<string, Partial<Phase>>>

  // 运行时状态（由 Orchestrator 维护，用户不填写）
  currentPhaseIndex: number
  retryCount: number
  maxRetries: number
  budgetUsd: number
  createdAt: string
  lastAttemptedAt?: string
  outputFile?: string
  branchName?: string
  blockedReason?: string
}

export type QueueStatus = 'pending' | 'running' | 'done' | 'blocked' | 'waiting'

// ─── Result Contract (Agent 写入，Orchestrator 读取) ─────────────────────────

export type ResultStatus = 'success' | 'blocked' | 'error'

export interface TaskResult {
  status: ResultStatus
  /** 失败时必填 */
  reason?: string
  /** 产出报告的相对路径 */
  outputFile?: string
}

// ─── Schedule (定时任务配置，保存在 scheduler/schedules.json) ─────────────────

export interface Schedule {
  id: string
  description: string
  /** 指向 tasks/scheduled/ 下的模板文件 */
  taskTemplate: string
  /** 标准 cron 表达式 */
  cron: string
  enabled: boolean
  lastEnqueuedAt?: string
}

export interface SchedulesConfig {
  schedules: Schedule[]
}

// ─── Log (JSON Lines，保存在 logs/) ──────────────────────────────────────────

export type LogEvent =
  | 'task_enqueued'
  | 'task_start'
  | 'phase_start'
  | 'phase_done'
  | 'phase_waiting_review'
  | 'task_done'
  | 'task_retry'
  | 'task_blocked'
  | 'task_scheduled'

export interface LogEntry {
  ts: string
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
