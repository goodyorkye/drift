import fs from 'node:fs/promises';
import path from 'node:path';
import {
    LOGS_DIR,
    SCHEDULES_DIR,
    TASKS_DIR,
    QUEUE_DIR,
    queueStatusDir,
    queueTicketFile,
    scheduleFile,
    scheduleRoot,
    scheduleSharedStateDir,
    scheduleSpecDir,
    scheduleStateFile,
    taskFile,
    taskManagedArtifactsDir,
    taskRoot,
    taskRunDir,
    taskRunsDir,
    taskSpecDir,
    taskWorkdir,
} from './paths.js';
import {
    type AgentResult,
    type QueueStatus,
    type QueueTicket,
    type RunMeta,
    type ScheduleConfig,
    type ScheduleState,
    type TaskMetadata,
} from './types.js';

const QUEUE_STATUSES: QueueStatus[] = ['pending', 'running', 'paused', 'done', 'blocked'];

export async function ensureWorkspaceDirs(): Promise<void> {
    await fs.mkdir(TASKS_DIR, { recursive: true });
    await fs.mkdir(SCHEDULES_DIR, { recursive: true });
    await fs.mkdir(LOGS_DIR, { recursive: true });
    await fs.mkdir(QUEUE_DIR, { recursive: true });
    await Promise.all(QUEUE_STATUSES.map(status => fs.mkdir(queueStatusDir(status), { recursive: true })));
}

export async function pathExists(target: string): Promise<boolean> {
    try {
        await fs.access(target);
        return true;
    } catch {
        return false;
    }
}

export async function ensureTaskRoot(taskId: string): Promise<void> {
    await fs.mkdir(taskRoot(taskId), { recursive: true });
}

export async function ensureTaskSpec(taskId: string): Promise<void> {
    await ensureTaskRoot(taskId);
    await fs.mkdir(taskSpecDir(taskId), { recursive: true });
}

export async function ensureTaskExecutionDirs(taskId: string): Promise<void> {
    await ensureTaskRoot(taskId);
    await Promise.all([
        fs.mkdir(taskWorkdir(taskId), { recursive: true }),
        fs.mkdir(taskRunsDir(taskId), { recursive: true }),
        fs.mkdir(taskManagedArtifactsDir(taskId), { recursive: true }),
    ]);
}

export async function writeJson(target: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify(value, null, 2));
}

export async function readJson<T>(target: string): Promise<T> {
    const raw = await fs.readFile(target, 'utf-8');
    return JSON.parse(raw) as T;
}

export async function writeTask(task: TaskMetadata): Promise<void> {
    await ensureTaskRoot(task.taskId);
    await writeJson(taskFile(task.taskId), task);
}

export async function readTask(taskId: string): Promise<TaskMetadata> {
    return readJson<TaskMetadata>(taskFile(taskId));
}

export async function listTasks(): Promise<TaskMetadata[]> {
    const entries = await fs.readdir(TASKS_DIR, { withFileTypes: true }).catch(() => []);
    const tasks = await Promise.all(
        entries
            .filter(entry => entry.isDirectory())
            .map(async entry => {
                const file = taskFile(entry.name);
                if (!(await pathExists(file))) return null;
                return readJson<TaskMetadata>(file);
            }),
    );
    return tasks.filter((task): task is TaskMetadata => task !== null).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function removeTaskRoot(taskId: string): Promise<void> {
    await fs.rm(taskRoot(taskId), { recursive: true, force: true });
}

export async function initializeWorkdir(taskId: string): Promise<void> {
    await ensureTaskExecutionDirs(taskId);
    const workdir = taskWorkdir(taskId);
    const marker = path.join(workdir, 'task.md');
    if (await pathExists(marker)) return;
    await fs.cp(taskSpecDir(taskId), workdir, { recursive: true });
}

export async function resetWorkdir(taskId: string): Promise<void> {
    const workdir = taskWorkdir(taskId);
    await fs.rm(workdir, { recursive: true, force: true });
    await fs.cp(taskSpecDir(taskId), workdir, { recursive: true });
}

export async function writeQueueTicket(status: QueueStatus, ticket: QueueTicket): Promise<void> {
    await writeJson(queueTicketFile(status, ticket.taskId), ticket);
}

export async function readQueueTicket(status: QueueStatus, taskId: string): Promise<QueueTicket> {
    return readJson<QueueTicket>(queueTicketFile(status, taskId));
}

export async function listQueueTickets(status: QueueStatus): Promise<QueueTicket[]> {
    const files = await fs.readdir(queueStatusDir(status)).catch(() => []);
    const tickets = await Promise.all(
        files
            .filter(file => file.endsWith('.json'))
            .map(file => readJson<QueueTicket>(path.join(queueStatusDir(status), file))),
    );
    return tickets.sort((a, b) => a.enteredAt.localeCompare(b.enteredAt));
}

export async function removeQueueTicket(status: QueueStatus, taskId: string): Promise<void> {
    await fs.unlink(queueTicketFile(status, taskId)).catch(() => {});
}

export async function detectQueueStatus(taskId: string): Promise<QueueStatus | null> {
    for (const status of QUEUE_STATUSES) {
        if (await pathExists(queueTicketFile(status, taskId))) return status;
    }
    return null;
}

export async function transitionQueueTicket(taskId: string, from: QueueStatus, to: QueueStatus, enteredAt: string): Promise<void> {
    const src = queueTicketFile(from, taskId);
    const dst = queueTicketFile(to, taskId);
    await fs.rename(src, dst);
    await writeJson(dst, { taskId, enteredAt } satisfies QueueTicket);
}

export async function createRunMeta(runMeta: RunMeta): Promise<void> {
    await fs.mkdir(taskRunDir(runMeta.taskId, runMeta.runId), { recursive: true });
    await writeJson(path.join(taskRunDir(runMeta.taskId, runMeta.runId), 'run-meta.json'), runMeta);
}

export async function readRunMeta(taskId: string, runId: string): Promise<RunMeta> {
    return readJson<RunMeta>(path.join(taskRunDir(taskId, runId), 'run-meta.json'));
}

export async function updateRunMeta(taskId: string, runId: string, patch: Partial<RunMeta>): Promise<RunMeta | null> {
    const file = path.join(taskRunDir(taskId, runId), 'run-meta.json');
    if (!(await pathExists(file))) return null;
    const current = await readJson<RunMeta>(file);
    const next = { ...current, ...patch };
    await writeJson(file, next);
    return next;
}

export async function writeRunAgentResult(taskId: string, runId: string, result: AgentResult | { status: 'error'; reason: string; artifactRefs?: string[] }): Promise<void> {
    await writeJson(path.join(taskRunDir(taskId, runId), 'agent-result.json'), result);
}

export async function readRunAgentResult(taskId: string, runId: string): Promise<AgentResult | { status: 'error'; reason: string; artifactRefs?: string[] }> {
    return readJson(path.join(taskRunDir(taskId, runId), 'agent-result.json'));
}

export async function readLatestRunResult(task: TaskMetadata): Promise<AgentResult | { status: 'error'; reason: string; artifactRefs?: string[] } | null> {
    if (!task.latestRunId) return null;
    const file = path.join(taskRunDir(task.taskId, task.latestRunId), 'agent-result.json');
    if (!(await pathExists(file))) return null;
    return readJson(file);
}

export async function ensureScheduleRoot(scheduleId: string): Promise<void> {
    await fs.mkdir(scheduleRoot(scheduleId), { recursive: true });
    await fs.mkdir(scheduleSharedStateDir(scheduleId), { recursive: true });
}

export async function ensureScheduleSpec(scheduleId: string): Promise<void> {
    await ensureScheduleRoot(scheduleId);
    await fs.mkdir(scheduleSpecDir(scheduleId), { recursive: true });
}

export async function writeSchedule(schedule: ScheduleConfig): Promise<void> {
    await ensureScheduleRoot(schedule.scheduleId);
    await writeJson(scheduleFile(schedule.scheduleId), schedule);
}

export async function readSchedule(scheduleId: string): Promise<ScheduleConfig> {
    return readJson<ScheduleConfig>(scheduleFile(scheduleId));
}

export async function listSchedules(): Promise<ScheduleConfig[]> {
    const entries = await fs.readdir(SCHEDULES_DIR, { withFileTypes: true }).catch(() => []);
    const schedules = await Promise.all(
        entries
            .filter(entry => entry.isDirectory())
            .map(async entry => {
                const file = scheduleFile(entry.name);
                if (!(await pathExists(file))) return null;
                return readJson<ScheduleConfig>(file);
            }),
    );
    return schedules
        .filter((schedule): schedule is ScheduleConfig => schedule !== null)
        .sort((a, b) => a.scheduleId.localeCompare(b.scheduleId));
}

export function createEmptyScheduleState(scheduleId: string): ScheduleState {
    return {
        scheduleId,
        lastTriggeredAt: null,
        lastAction: null,
        lastTaskId: null,
        lastRunStatus: null,
        stats: { triggered: 0, skipped: 0, createdTasks: 0, done: 0, blocked: 0, paused: 0 },
        timing: {
            lastDurationMs: null,
            avgDurationMs: null,
        },
    };
}

export async function readScheduleState(scheduleId: string): Promise<ScheduleState> {
    const file = scheduleStateFile(scheduleId);
    if (!(await pathExists(file))) {
        const state = createEmptyScheduleState(scheduleId);
        await writeJson(file, state);
        return state;
    }
    return readJson<ScheduleState>(file);
}

export async function writeScheduleState(state: ScheduleState): Promise<void> {
    await ensureScheduleRoot(state.scheduleId);
    await writeJson(scheduleStateFile(state.scheduleId), state);
}

export async function removeScheduleRoot(scheduleId: string): Promise<void> {
    await fs.rm(scheduleRoot(scheduleId), { recursive: true, force: true });
}
