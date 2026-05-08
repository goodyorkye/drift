import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { type TaskMetadata } from '../src/types.js';

describe('web boundary helpers', () => {
    const originalRoot = process.env.DRIFT_ROOT;
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-web-'));
        process.env.DRIFT_ROOT = tempDir;
        vi.resetModules();
    });

    afterEach(async () => {
        process.env.DRIFT_ROOT = originalRoot;
        vi.doUnmock('../src/runners/index.js');
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('rejects write requests without a web actor', async () => {
        const { actorFromHeaders } = await import('../src/web/server.js');

        expect(() => actorFromHeaders({})).toThrow('Missing or invalid actor name.');
    });

    it('records the declared web actor on task actions', async () => {
        const { writeTask, writeQueueTicket } = await import('../src/storage.js');
        const { actorFromHeaders } = await import('../src/web/server.js');
        const { resumeTask } = await import('../src/core/task-actions.js');
        const { LOGS_DIR } = await import('../src/paths.js');
        const { formatLocalDate } = await import('../src/time.js');

        const task = makeTask({ status: 'paused' });
        await writeTask(task);
        await writeQueueTicket('paused', { taskId: task.taskId, enteredAt: task.statusUpdatedAt });

        await resumeTask(task.taskId, { actor: actorFromHeaders({ 'x-drift-user': 'York' }) });

        const logFile = path.join(LOGS_DIR, 'system', `${formatLocalDate()}.jsonl`);
        const lines = (await fs.readFile(logFile, 'utf-8')).trim().split('\n');
        expect(JSON.parse(lines.at(-1) ?? '{}')).toMatchObject({
            event: 'task_resumed',
            actor: { name: 'York', source: 'web' },
            taskId: task.taskId,
        });
    });

    it('blocks task actions in read-only mode', async () => {
        const { assertWebWriteAllowed } = await import('../src/web/server.js');

        expect(() => assertWebWriteAllowed({ readOnly: true })).toThrow('Web UI is running in read-only mode.');
    });

    it('cancels a pending task into blocked', async () => {
        const { writeTask, writeQueueTicket, readTask, detectQueueStatus } = await import('../src/storage.js');
        const { cancelTask } = await import('../src/core/task-actions.js');

        const task = makeTask({ status: 'pending' });
        await writeTask(task);
        await writeQueueTicket('pending', { taskId: task.taskId, enteredAt: task.statusUpdatedAt });

        await cancelTask(task.taskId, { actor: { name: 'York', source: 'web' } });

        expect((await readTask(task.taskId)).status).toBe('blocked');
        expect(await detectQueueStatus(task.taskId)).toBe('blocked');
    });

    it('writes a stop request for a running task', async () => {
        const { writeTask, writeQueueTicket, createRunMeta, pathExists } = await import('../src/storage.js');
        const { stopTask } = await import('../src/core/task-actions.js');
        const { taskRunStopRequestFile } = await import('../src/paths.js');

        const task = makeTask({ status: 'running', latestRunId: 'run-1' });
        await writeTask(task);
        await writeQueueTicket('running', { taskId: task.taskId, enteredAt: task.statusUpdatedAt });
        await createRunMeta({
            runId: 'run-1',
            taskId: task.taskId,
            runner: task.runner,
            trigger: 'initial',
            status: 'running',
            startedAt: task.statusUpdatedAt,
            logRefs: { stdout: 'stdout.log', stderr: 'stderr.log' },
        });

        await stopTask(task.taskId, { actor: { name: 'York', source: 'web' }, reason: 'Stop from test' });

        expect(await pathExists(taskRunStopRequestFile(task.taskId, 'run-1'))).toBe(true);
    });

    it('allows removing blocked tasks but rejects running ones', async () => {
        const { writeTask, writeQueueTicket, pathExists } = await import('../src/storage.js');
        const { removeTask } = await import('../src/core/task-actions.js');
        const { taskRoot } = await import('../src/paths.js');

        const blockedTask = makeTask({ taskId: 'task-blocked', status: 'blocked' });
        await writeTask(blockedTask);
        await removeTask(blockedTask.taskId, { actor: { name: 'York', source: 'web' } });
        expect(await pathExists(taskRoot(blockedTask.taskId))).toBe(false);

        const runningTask = makeTask({ taskId: 'task-running', status: 'running' });
        await writeTask(runningTask);
        await writeQueueTicket('running', { taskId: runningTask.taskId, enteredAt: runningTask.statusUpdatedAt });
        await expect(removeTask(runningTask.taskId, { actor: { name: 'York', source: 'web' } })).rejects.toThrow(
            'Running tasks must be stopped before removal.',
        );
    });

    it('resolves managed artifacts inside the task boundary only', async () => {
        const { writeTask } = await import('../src/storage.js');
        const { resolveManagedArtifact } = await import('../src/core/task-inspection.js');
        const { taskManagedArtifactsDir } = await import('../src/paths.js');

        const task = makeTask({ taskId: 'task-artifact' });
        await writeTask(task);
        const artifactDir = taskManagedArtifactsDir(task.taskId);
        await fs.mkdir(path.join(artifactDir, 'run-1'), { recursive: true });
        await fs.writeFile(path.join(artifactDir, 'run-1', 'report.md'), '# report');

        await expect(resolveManagedArtifact(task.taskId, 'run-1/report.md')).resolves.toMatchObject({
            name: 'report.md',
        });
        await expect(resolveManagedArtifact(task.taskId, '../escape.txt')).rejects.toThrow('Invalid artifact path.');
    });

    it('toggles an existing schedule', async () => {
        const { writeSchedule, readSchedule } = await import('../src/storage.js');
        const { setScheduleEnabled } = await import('../src/core/schedule-actions.js');

        await writeSchedule({
            scheduleId: 'daily-test',
            type: 'research',
            title: 'Daily test',
            runner: 'claude',
            cron: '0 * * * *',
            skipIfActive: true,
            enabled: false,
        });

        await setScheduleEnabled('daily-test', true, { actor: { name: 'York', source: 'web' } });

        expect((await readSchedule('daily-test')).enabled).toBe(true);
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
        status: 'not_queued',
        statusUpdatedAt: '2026-04-21T09:00:00.000Z',
        latestRunId: null,
        lastEnqueuedAt: null,
        lastStartedAt: null,
        lastFinishedAt: null,
        ...overrides,
    };
}
