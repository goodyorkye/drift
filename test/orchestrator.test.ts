import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ExecutionResult, TaskMetadata } from '../src/types.js';

describe('Orchestrator artifact intake', () => {
    const originalCwd = process.cwd();
    const originalRoot = process.env.DRIFT_ROOT;
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-work-'));
        process.env.DRIFT_ROOT = tempDir;
        vi.resetModules();
    });

    afterEach(async () => {
        process.chdir(originalCwd);
        process.env.DRIFT_ROOT = originalRoot;
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('copies only artifactRefs that stay inside the task workdir and preserves relative paths', async () => {
        const { Orchestrator } = await import('../src/orchestrator.js');
        const { taskManagedArtifactsDir, taskRunDir, taskWorkdir } = await import('../src/paths.js');
        const { ensureTaskExecutionDirs, writeTask } = await import('../src/storage.js');

        const task = makeTask();
        const runId = 'run-1';
        await writeTask(task);
        await ensureTaskExecutionDirs(task.taskId);
        await fs.mkdir(taskRunDir(task.taskId, runId), { recursive: true });

        const workdir = taskWorkdir(task.taskId);
        await fs.writeFile(path.join(workdir, 'report.md'), '# report');
        await fs.mkdir(path.join(workdir, 'data'), { recursive: true });
        await fs.writeFile(path.join(workdir, 'data', 'summary.md'), '# summary');
        await fs.mkdir(path.join(workdir, 'reports'), { recursive: true });
        await fs.mkdir(path.join(workdir, 'notes'), { recursive: true });
        await fs.writeFile(path.join(workdir, 'reports', 'summary.md'), '# report summary');
        await fs.writeFile(path.join(workdir, 'notes', 'summary.md'), '# note summary');

        const escapedDir = path.resolve(workdir, '..', 'workdir-escape');
        await fs.mkdir(escapedDir, { recursive: true });
        await fs.writeFile(path.join(escapedDir, 'leak.md'), '# leak');

        const result: ExecutionResult = {
            status: 'success',
            artifactRefs: ['report.md', 'data', 'reports/summary.md', 'notes/summary.md', '../workdir-escape/leak.md', '/tmp/outside.md', 'missing.md'],
        };

        await (new Orchestrator() as unknown as {
            runArtifactIntake(task: TaskMetadata, runId: string, result: ExecutionResult): Promise<void>;
        }).runArtifactIntake(task, runId, result);

        const managedRoot = taskManagedArtifactsDir(task.taskId);
        await expect(fs.access(path.join(managedRoot, 'run-1', 'report.md'))).resolves.toBeUndefined();
        await expect(fs.access(path.join(managedRoot, 'run-1', 'data', 'summary.md'))).resolves.toBeUndefined();
        await expect(fs.access(path.join(managedRoot, 'run-1', 'reports', 'summary.md'))).resolves.toBeUndefined();
        await expect(fs.access(path.join(managedRoot, 'run-1', 'notes', 'summary.md'))).resolves.toBeUndefined();
        await expect(fs.access(path.join(managedRoot, 'run-1', 'leak.md'))).rejects.toThrow();

        const intake = JSON.parse(await fs.readFile(path.join(taskRunDir(task.taskId, runId), 'intake.json'), 'utf-8')) as Array<{
            sourceRef: string;
            managedRef: string;
        }>;
        expect(intake).toEqual([
            { sourceRef: 'report.md', managedRef: 'run-1/report.md' },
            { sourceRef: 'data', managedRef: 'run-1/data' },
            { sourceRef: 'reports/summary.md', managedRef: 'run-1/reports/summary.md' },
            { sourceRef: 'notes/summary.md', managedRef: 'run-1/notes/summary.md' },
        ]);
    });
});

describe('Orchestrator crash recovery', () => {
    const originalCwd = process.cwd();
    const originalRoot = process.env.DRIFT_ROOT;
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-work-'));
        process.env.DRIFT_ROOT = tempDir;
        vi.resetModules();
    });

    afterEach(async () => {
        process.chdir(originalCwd);
        process.env.DRIFT_ROOT = originalRoot;
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('blocks orphan running tasks, stamps finishedAt, and writes a system error when the run dir exists', async () => {
        const { Orchestrator } = await import('../src/orchestrator.js');
        const { FileQueue } = await import('../src/queue.js');
        const { createRunMeta, readQueueTicket, readRunAgentResult, readRunMeta, readTask, writeQueueTicket, writeTask } = await import(
            '../src/storage.js'
        );

        const task = makeTask();
        await new FileQueue().ensureDirs();
        await writeTask(task);
        await writeQueueTicket('running', { taskId: task.taskId, enteredAt: '2026-04-21T09:00:00.000Z' });
        await createRunMeta({
            runId: 'run-1',
            taskId: task.taskId,
            runner: 'claude',
            trigger: 'initial',
            status: 'running',
            startedAt: '2026-04-21T09:00:00.000Z',
            logRefs: {
                stdout: 'stdout.log',
                stderr: 'stderr.log',
            },
        });

        await (new Orchestrator() as unknown as { recoverOrphanRunningTasks(): Promise<void> }).recoverOrphanRunningTasks();

        expect((await readTask(task.taskId)).status).toBe('blocked');
        expect((await readTask(task.taskId)).lastFinishedAt).toBeTruthy();
        await expect(readQueueTicket('blocked', task.taskId)).resolves.toMatchObject({ taskId: task.taskId });
        await expect(readQueueTicket('running', task.taskId)).rejects.toThrow();
        expect((await readRunMeta(task.taskId, 'run-1')).status).toBe('failed');
        expect((await readRunAgentResult(task.taskId, 'run-1')).status).toBe('error');
    });

    it('blocks orphan running tasks without touching run metadata when the run dir is missing', async () => {
        const { Orchestrator } = await import('../src/orchestrator.js');
        const { FileQueue } = await import('../src/queue.js');
        const { pathExists, readQueueTicket, readTask, writeQueueTicket, writeTask } = await import('../src/storage.js');
        const { taskRunDir } = await import('../src/paths.js');

        const task = makeTask();
        await new FileQueue().ensureDirs();
        await writeTask(task);
        await writeQueueTicket('running', { taskId: task.taskId, enteredAt: '2026-04-21T09:00:00.000Z' });

        await (new Orchestrator() as unknown as { recoverOrphanRunningTasks(): Promise<void> }).recoverOrphanRunningTasks();

        expect((await readTask(task.taskId)).status).toBe('blocked');
        await expect(readQueueTicket('blocked', task.taskId)).resolves.toMatchObject({ taskId: task.taskId });
        await expect(readQueueTicket('running', task.taskId)).rejects.toThrow();
        expect(await pathExists(taskRunDir(task.taskId, 'run-1'))).toBe(false);
    });
});

describe('Orchestrator schedule outcome stats', () => {
    const originalCwd = process.cwd();
    const originalRoot = process.env.DRIFT_ROOT;
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-work-'));
        process.env.DRIFT_ROOT = tempDir;
        vi.resetModules();
    });

    afterEach(async () => {
        process.chdir(originalCwd);
        process.env.DRIFT_ROOT = originalRoot;
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('updates terminal status counters and duration statistics', async () => {
        const { Orchestrator } = await import('../src/orchestrator.js');
        const { createEmptyScheduleState, readScheduleState, writeScheduleState } = await import('../src/storage.js');

        await writeScheduleState(createEmptyScheduleState('daily-research'));

        const orchestrator = new Orchestrator() as unknown as {
            updateScheduleOutcome(scheduleId: string, status: 'done' | 'paused' | 'blocked', durationMs?: number, taskId?: string): Promise<void>;
        };
        await orchestrator.updateScheduleOutcome('daily-research', 'done', 100, 'task-a');
        await orchestrator.updateScheduleOutcome('daily-research', 'blocked', 300, 'task-b');
        await orchestrator.updateScheduleOutcome('daily-research', 'paused', undefined, 'task-c');

        const state = await readScheduleState('daily-research');
        expect(state.lastTaskId).toBe('task-c');
        expect(state.lastRunStatus).toBe('paused');
        expect(state.stats.done).toBe(1);
        expect(state.stats.blocked).toBe(1);
        expect(state.stats.paused).toBe(1);
        expect(state.timing.lastDurationMs).toBe(300);
        expect(state.timing.avgDurationMs).toBe(200);
    });
});

function makeTask(overrides: Partial<TaskMetadata> = {}): TaskMetadata {
    return {
        taskId: 'task-1',
        type: 'research',
        title: 'Test task',
        runner: 'claude',
        budgetUsd: 10,
        maxRetries: 1,
        timeoutMs: 1000,
        createdAt: '2026-04-21T09:00:00.000Z',
        createdBy: { kind: 'manual' },
        retryCount: 0,
        status: 'running',
        statusUpdatedAt: '2026-04-21T09:00:00.000Z',
        latestRunId: 'run-1',
        lastEnqueuedAt: '2026-04-21T09:00:00.000Z',
        lastStartedAt: '2026-04-21T09:00:00.000Z',
        lastFinishedAt: null,
        ...overrides,
    };
}
