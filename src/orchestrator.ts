import fs from 'node:fs/promises';
import path from 'node:path';
import { generateRunId } from './ids.js';
import { appendSystemLog } from './logging.js';
import { taskManagedArtifactsDir, taskRunDir, taskRunStopRequestFile, taskWorkdir } from './paths.js';
import { FileQueue } from './queue.js';
import { Registry } from './registry.js';
import { getRunner } from './runners/index.js';
import {
    createRunMeta,
    ensureTaskExecutionDirs,
    ensureWorkspaceDirs,
    initializeWorkdir,
    listQueueTickets,
    pathExists,
    readJson,
    readLatestRunResult,
    readScheduleState,
    readTask,
    updateRunMeta,
    writeRunAgentResult,
    writeScheduleState,
    writeTask,
} from './storage.js';
import { formatLocalIsoTimestamp } from './time.js';
import { type ExecutionResult, type QueueStatus, type RunMeta, type RunTrigger, type ScheduleState, type TaskMetadata } from './types.js';

export class Orchestrator {
    private readonly queue = new FileQueue();
    private readonly registry = new Registry();
    private running = false;

    async start(): Promise<void> {
        await ensureWorkspaceDirs();
        await this.queue.ensureDirs();
        await this.registry.load();
        await this.recoverOrphanRunningTasks();

        this.running = true;
        process.on('SIGTERM', () => this.stop());
        process.on('SIGINT', () => this.stop());

        while (this.running) {
            const progressed = await this.runOneIteration();
            if (!progressed) {
                await sleep(5_000);
            }
        }
    }

    stop(): void {
        this.running = false;
    }

    async runOneIteration(): Promise<boolean> {
        const task = await this.queue.claimNextPending();
        if (!task) return false;

        await this.executeTask(task);
        return true;
    }

    private async executeTask(task: TaskMetadata): Promise<void> {
        const startedAt = formatLocalIsoTimestamp();
        const runId = generateRunId();
        const runDir = taskRunDir(task.taskId, runId);
        const trigger = await this.getTrigger(task);

        await ensureTaskExecutionDirs(task.taskId);
        await initializeWorkdir(task.taskId);

        task.latestRunId = runId;
        task.lastStartedAt = startedAt;
        task.status = 'running';
        task.statusUpdatedAt = startedAt;
        await writeTask(task);

        const runMeta: RunMeta = {
            runId,
            taskId: task.taskId,
            runner: task.runner,
            trigger,
            status: 'running',
            startedAt,
            logRefs: {
                stdout: 'stdout.log',
                stderr: 'stderr.log',
            },
            ...(task.runnerEnv ? { runnerEnv: task.runnerEnv } : {}),
        };
        await createRunMeta(runMeta);
        await appendSystemLog({
            event: 'task_start',
            taskId: task.taskId,
            taskType: task.type,
            runner: task.runner,
            runId,
        });

        const runner = getRunner(task.runner);
        const execution = await runner.run(task, {
            runMeta,
            runDir,
            registry: this.registry,
        });

        if (execution.sessionRef) {
            await updateRunMeta(task.taskId, runId, { sessionRef: execution.sessionRef });
        }

        const stopped = await this.readStopRequest(task.taskId, runId);
        await this.finalizeExecution(
            task,
            runId,
            stopped
                ? {
                      status: 'blocked',
                      reason: stopped.reason,
                  }
                : execution.result,
        );
    }

    private async finalizeExecution(task: TaskMetadata, runId: string, result: ExecutionResult): Promise<void> {
        const finishedAt = formatLocalIsoTimestamp();
        const durationMs = task.lastStartedAt ? Date.now() - new Date(task.lastStartedAt).getTime() : undefined;

        await writeRunAgentResult(task.taskId, runId, result);

        const runStatus = result.status === 'error' ? 'failed' : 'finished';
        await updateRunMeta(task.taskId, runId, {
            status: runStatus,
            finishedAt,
            reason: result.reason,
            agentResultRef: 'agent-result.json',
        });

        task.lastFinishedAt = finishedAt;

        if (result.status === 'error') {
            task.retryCount += 1;
            if (task.retryCount >= task.maxRetries) {
                await this.finishTask(task, 'blocked', finishedAt, durationMs, result.reason);
            } else {
                await this.finishTask(task, 'pending', finishedAt, durationMs, result.reason);
            }
            return;
        }

        await this.runArtifactIntake(task, runId, result);

        if (result.status === 'success') {
            await this.finishTask(task, 'done', finishedAt, durationMs);
        } else if (result.status === 'paused') {
            await this.finishTask(task, 'paused', finishedAt, durationMs, result.reason);
        } else {
            await this.finishTask(task, 'blocked', finishedAt, durationMs, result.reason);
        }
    }

    private async finishTask(
        task: TaskMetadata,
        status: QueueStatus,
        finishedAt: string,
        durationMs?: number,
        reason?: string,
    ): Promise<void> {
        await this.queue.moveTask(task, status, finishedAt);
        const persisted = await readTask(task.taskId);

        await appendSystemLog({
            event: 'task_status',
            taskId: task.taskId,
            taskType: task.type,
            runId: persisted.latestRunId ?? undefined,
            status,
            reason,
            durationMs,
        });

        if (
            persisted.createdBy.kind === 'schedule' &&
            persisted.createdBy.sourceId &&
            (status === 'done' || status === 'paused' || status === 'blocked') &&
            durationMs !== undefined
        ) {
            await this.updateScheduleOutcome(persisted.createdBy.sourceId, status, durationMs, persisted.taskId);
        } else if (
            persisted.createdBy.kind === 'schedule' &&
            persisted.createdBy.sourceId &&
            (status === 'done' || status === 'paused' || status === 'blocked')
        ) {
            await this.updateScheduleOutcome(persisted.createdBy.sourceId, status, undefined, persisted.taskId);
        }
    }

    private async runArtifactIntake(task: TaskMetadata, runId: string, result: ExecutionResult): Promise<void> {
        const refs = 'artifactRefs' in result ? result.artifactRefs ?? [] : [];
        const intakeRecords: Array<{ sourceRef: string; managedRef: string }> = [];

        for (const ref of refs) {
            if (!ref || path.isAbsolute(ref)) continue;
            const root = taskWorkdir(task.taskId);
            const source = path.resolve(root, ref);
            const relativeSource = path.relative(root, source);
            if (relativeSource.startsWith('..') || path.isAbsolute(relativeSource)) continue;
            if (!(await pathExists(source))) continue;

            const managedRoot = taskManagedArtifactsDir(task.taskId);
            const target = path.join(managedRoot, runId, relativeSource);
            await fs.mkdir(path.dirname(target), { recursive: true });
            const stat = await fs.stat(source);
            if (stat.isDirectory()) {
                await fs.cp(source, target, { recursive: true });
            } else {
                await fs.copyFile(source, target);
            }
            intakeRecords.push({
                sourceRef: ref,
                managedRef: path.relative(managedRoot, target).replace(/\\/g, '/'),
            });
        }

        await fs.writeFile(path.join(taskRunDir(task.taskId, runId), 'intake.json'), JSON.stringify(intakeRecords, null, 2));
    }

    private async updateScheduleOutcome(scheduleId: string, status: Exclude<QueueStatus, 'pending' | 'running'>, durationMs?: number, taskId?: string): Promise<void> {
        const state = await readScheduleState(scheduleId);
        state.lastTaskId = taskId ?? state.lastTaskId ?? null;
        state.lastRunStatus = status;
        state.stats[status] += 1;

        if (durationMs !== undefined) {
            const completedCount = state.stats.done + state.stats.blocked + state.stats.paused - 1;
            const currentAvg = state.timing.avgDurationMs ?? 0;
            state.timing.lastDurationMs = durationMs;
            state.timing.avgDurationMs =
                completedCount >= 0 ? Math.round((currentAvg * completedCount + durationMs) / (completedCount + 1)) : durationMs;
        }

        await writeScheduleState(state);
    }

    private async getTrigger(task: TaskMetadata): Promise<RunTrigger> {
        const latest = await readLatestRunResult(task);
        if (latest?.status === 'paused') return 'resume';
        if (task.retryCount > 0) return 'retry';
        return 'initial';
    }

    private async readStopRequest(taskId: string, runId: string): Promise<{ reason: string } | null> {
        const file = taskRunStopRequestFile(taskId, runId);
        if (!(await pathExists(file))) return null;
        return readJson<{ reason?: string }>(file)
            .then(value => ({ reason: value.reason ?? 'Task stopped by user' }))
            .catch(() => ({ reason: 'Task stopped by user' }));
    }

    private async recoverOrphanRunningTasks(): Promise<void> {
        const tickets = await listQueueTickets('running');
        for (const ticket of tickets) {
            const task = await readTask(ticket.taskId);
            const runId = task.latestRunId;
            const now = formatLocalIsoTimestamp();
            const durationMs = task.lastStartedAt ? Date.now() - new Date(task.lastStartedAt).getTime() : undefined;

            if (runId && (await pathExists(taskRunDir(task.taskId, runId)))) {
                await updateRunMeta(task.taskId, runId, {
                    status: 'failed',
                    finishedAt: now,
                    reason: 'Recovered orphan running task after orchestrator restart',
                    agentResultRef: 'agent-result.json',
                });
                await writeRunAgentResult(task.taskId, runId, {
                    status: 'error',
                    reason: 'Recovered orphan running task after orchestrator restart',
                });
            }

            task.lastFinishedAt = now;
            await this.queue.moveTask(task, 'blocked', now);
            if (task.createdBy.kind === 'schedule' && task.createdBy.sourceId) {
                await this.updateScheduleOutcome(task.createdBy.sourceId, 'blocked', durationMs, task.taskId);
            }
            await appendSystemLog({
                event: 'task_recovered',
                taskId: task.taskId,
                taskType: task.type,
                runId: runId ?? undefined,
                status: 'blocked',
                reason: 'Recovered orphan running task after orchestrator restart',
                durationMs,
            });
        }
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
