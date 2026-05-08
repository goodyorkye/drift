export type RunnerName = 'claude' | 'codex';

export type ActorSource = 'cli' | 'web' | 'scheduler' | 'system';

export interface ActorRef {
    name: string;
    source: ActorSource;
}

export interface RunnerEnvPreset {
    name: string;
    env: Record<string, string>;
}

export interface TaskType {
    type: string;
    label?: string;
    description: string;
    defaultRunner?: RunnerName;
    defaultBudgetUsd?: number;
    defaultMaxRetries?: number;
    defaultTimeoutMs?: number;
    runnerEnvPresets?: RunnerEnvPreset[];
}

export interface DraftMessage {
    role: 'user' | 'assistant';
    content: string;
    createdAt: string;
}

export interface TaskDraft {
    draftId: string;
    kind: 'task';
    taskType: TaskType;
    creationMethod: RunnerName | 'manual';
    createdAt: string;
    updatedAt: string;
    guidePath: string | null;
    transcript: DraftMessage[];
}

export type CreatedByKind = 'manual' | 'claude' | 'codex' | 'schedule';

export interface CreatedBy {
    kind: CreatedByKind;
    sourceId?: string;
}

export type TaskStatus = 'not_queued' | 'pending' | 'running' | 'paused' | 'done' | 'blocked';
export type QueueStatus = Exclude<TaskStatus, 'not_queued'>;

export interface TaskMetadata {
    taskId: string;
    type: string;
    title: string;
    runner: RunnerName;
    budgetUsd: number;
    maxRetries: number;
    timeoutMs: number;
    createdAt: string;
    createdBy: CreatedBy;
    retryCount: number;
    status: TaskStatus;
    statusUpdatedAt: string;
    latestRunId: string | null;
    lastEnqueuedAt: string | null;
    lastStartedAt: string | null;
    lastFinishedAt: string | null;
    runnerEnv?: Record<string, string>;
}

export interface QueueTicket {
    taskId: string;
    enteredAt: string;
}

export type AgentResultStatus = 'success' | 'paused' | 'blocked';

export interface AgentResult {
    status: AgentResultStatus;
    reason?: string;
    artifactRefs?: string[];
}

export interface ErrorResult {
    status: 'error';
    reason: string;
    artifactRefs?: string[];
}

export type ExecutionResult = AgentResult | ErrorResult;

export type RunTrigger = 'initial' | 'resume' | 'retry';
export type RunStatus = 'running' | 'finished' | 'failed';

export interface RunMeta {
    runId: string;
    taskId: string;
    runner: RunnerName;
    trigger: RunTrigger;
    status: RunStatus;
    startedAt: string;
    finishedAt?: string;
    sessionRef?: string;
    logRefs: {
        stdout: string;
        stderr: string;
    };
    agentResultRef?: string;
    reason?: string;
    runnerEnv?: Record<string, string>;
    runnerPid?: number;
}

export interface ScheduleConfig {
    scheduleId: string;
    type: string;
    title: string;
    runner: RunnerName;
    cron: string;
    skipIfActive: boolean;
    enabled: boolean;
    runnerEnv?: Record<string, string>;
}

export type ScheduleAction = 'triggered' | 'skipped';
export type ScheduleTerminalStatus = Extract<TaskStatus, 'done' | 'blocked' | 'paused'>;

export interface ScheduleState {
    scheduleId: string;
    lastTriggeredAt?: string | null;
    lastAction?: ScheduleAction | null;
    lastTaskId?: string | null;
    lastRunStatus?: ScheduleTerminalStatus | null;
    stats: {
        triggered: number;
        skipped: number;
        createdTasks: number;
        done: number;
        blocked: number;
        paused: number;
    };
    timing: {
        lastDurationMs?: number | null;
        avgDurationMs?: number | null;
    };
}

export interface LogEntry {
    ts: string;
    event: string;
    actor?: ActorRef;
    taskId?: string;
    taskType?: string;
    runner?: RunnerName;
    runId?: string;
    scheduleId?: string;
    status?: string;
    reason?: string;
    durationMs?: number;
}
