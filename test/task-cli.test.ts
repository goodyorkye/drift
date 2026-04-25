import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import type { TaskMetadata } from '../src/types.js';

describe('task CLI', () => {
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
        vi.doUnmock('../src/runners/index.js');
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('enqueues a not_queued task when its runner is available', async () => {
        vi.doMock('../src/runners/index.js', async () => {
            const actual = await vi.importActual<typeof import('../src/runners/index.js')>('../src/runners/index.js');
            return {
                ...actual,
                isRunnerAvailable: async () => true,
            };
        });

        const { registerTaskCommands } = await import('../src/cli/task.js');
        const { writeTask, readTask, readQueueTicket } = await import('../src/storage.js');

        const task = makeTask();
        await writeTask(task);

        const program = new Command();
        registerTaskCommands(program);

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        await program.parseAsync(['node', 'test', 'task', 'enqueue', task.taskId]);

        expect((await readTask(task.taskId)).status).toBe('pending');
        await expect(readQueueTicket('pending', task.taskId)).resolves.toMatchObject({ taskId: task.taskId });
        expect(logSpy).toHaveBeenCalledWith(`✓ Task enqueued: ${task.taskId}`);
        logSpy.mockRestore();
    });

    it('rejects enqueue when the runner is not available', async () => {
        vi.doMock('../src/runners/index.js', async () => {
            const actual = await vi.importActual<typeof import('../src/runners/index.js')>('../src/runners/index.js');
            return {
                ...actual,
                isRunnerAvailable: async () => false,
            };
        });

        const { registerTaskCommands } = await import('../src/cli/task.js');
        const { writeTask } = await import('../src/storage.js');

        const task = makeTask();
        await writeTask(task);

        const program = new Command();
        registerTaskCommands(program);

        await expect(program.parseAsync(['node', 'test', 'task', 'enqueue', task.taskId])).rejects.toThrow(
            `Runner not available: ${task.runner}`,
        );
    });

    it('shows task, latest run, queue truth, and managed artifacts', async () => {
        const { registerTaskCommands } = await import('../src/cli/task.js');
        const { createRunMeta, writeQueueTicket, writeRunAgentResult, writeTask, writeJson } = await import('../src/storage.js');
        const { taskRunDir } = await import('../src/paths.js');

        const task = makeTask({
            status: 'done',
            latestRunId: 'run-1',
            lastEnqueuedAt: '2026-04-21T09:01:00.000Z',
            lastStartedAt: '2026-04-21T09:02:00.000Z',
            lastFinishedAt: '2026-04-21T09:05:00.000Z',
            createdBy: { kind: 'schedule', sourceId: 'daily-research' },
        });
        await writeTask(task);
        await writeQueueTicket('done', { taskId: task.taskId, enteredAt: '2026-04-21T09:05:00.000Z' });
        await createRunMeta({
            runId: 'run-1',
            taskId: task.taskId,
            runner: task.runner,
            trigger: 'resume',
            status: 'finished',
            startedAt: '2026-04-21T09:02:00.000Z',
            finishedAt: '2026-04-21T09:05:00.000Z',
            sessionRef: 'session-123',
            logRefs: {
                stdout: 'stdout.log',
                stderr: 'stderr.log',
            },
        });
        await writeRunAgentResult(task.taskId, 'run-1', {
            status: 'success',
            artifactRefs: ['report.md'],
        });
        await writeJson(path.join(taskRunDir(task.taskId, 'run-1'), 'intake.json'), [
            { sourceRef: 'report.md', managedRef: 'run-1/report.md' },
        ]);

        const program = new Command();
        registerTaskCommands(program);

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        await program.parseAsync(['node', 'test', 'task', 'inspect', task.taskId]);

        expect(logSpy.mock.calls.flat()).toContain(`Task: ${task.taskId}`);
        expect(logSpy.mock.calls.flat()).toContain('Queue Status: done');
        expect(logSpy.mock.calls.flat()).toContain('Created At: 2026-04-21 17:00:00');
        expect(logSpy.mock.calls.flat()).toContain('Last Finished At: 2026-04-21 17:05:00');
        expect(logSpy.mock.calls.flat()).toContain('  Session Ref: session-123');
        expect(logSpy.mock.calls.flat()).toContain('  Started At: 2026-04-21 17:02:00');
        expect(logSpy.mock.calls.flat()).toContain('  Result Status: success');
        expect(logSpy.mock.calls.flat()).toContain('  run-1/report.md');
        logSpy.mockRestore();
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
