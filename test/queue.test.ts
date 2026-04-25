import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { TaskMetadata } from '../src/types.js';

describe('FileQueue', () => {
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

    it('claims the oldest pending task and moves it to running', async () => {
        const { FileQueue } = await import('../src/queue.js');
        const { writeTask } = await import('../src/storage.js');
        const queue = new FileQueue();
        await queue.ensureDirs();

        const firstTask = makeTask({ taskId: 'task-a', createdAt: '2026-04-21T09:00:00.000Z' });
        const secondTask = makeTask({ taskId: 'task-b', createdAt: '2026-04-21T09:01:00.000Z' });

        await writeTask(firstTask);
        await writeTask(secondTask);
        await queue.enqueue(firstTask, '2026-04-21T09:00:00.000Z');
        await queue.enqueue(secondTask, '2026-04-21T09:01:00.000Z');

        const claimed = await queue.claimNextPending();

        expect(claimed?.taskId).toBe('task-a');
        await expect(fs.access(path.join(tempDir, 'workspace', 'queue', 'pending', 'task-a.json'))).rejects.toThrow();
        await expect(fs.access(path.join(tempDir, 'workspace', 'queue', 'running', 'task-a.json'))).resolves.toBeUndefined();
    });

    it('resume moves a paused task back to pending', async () => {
        const { FileQueue } = await import('../src/queue.js');
        const { readQueueTicket, readTask, writeTask } = await import('../src/storage.js');
        const queue = new FileQueue();
        await queue.ensureDirs();

        const task = makeTask({ taskId: 'task-paused', status: 'paused' });
        await writeTask(task);
        await fs.mkdir(path.join(tempDir, 'workspace', 'queue', 'paused'), { recursive: true });
        await fs.writeFile(
            path.join(tempDir, 'workspace', 'queue', 'paused', 'task-paused.json'),
            JSON.stringify({ taskId: task.taskId, enteredAt: '2026-04-21T09:00:00.000Z' }, null, 2),
        );

        const resumed = await queue.resume(task.taskId);

        expect(resumed.status).toBe('pending');
        expect((await readTask(task.taskId)).status).toBe('pending');
        expect((await readQueueTicket('pending', task.taskId)).taskId).toBe(task.taskId);
    });

    it('rerun moves a done task to pending and resets workdir', async () => {
        const { FileQueue } = await import('../src/queue.js');
        const { readQueueTicket, readTask, writeTask } = await import('../src/storage.js');
        const queue = new FileQueue();
        await queue.ensureDirs();

        const task = makeTask({ taskId: 'task-rerun', status: 'done', retryCount: 2 });
        await writeTask(task);
        await fs.mkdir(path.join(tempDir, 'workspace', 'queue', 'done'), { recursive: true });
        await fs.writeFile(
            path.join(tempDir, 'workspace', 'queue', 'done', 'task-rerun.json'),
            JSON.stringify({ taskId: task.taskId, enteredAt: '2026-04-21T09:00:00.000Z' }, null, 2),
        );

        // spec/task.md 是任务原件
        const specDir = path.join(tempDir, 'workspace', 'tasks', 'task-rerun', 'spec');
        await fs.mkdir(specDir, { recursive: true });
        await fs.writeFile(path.join(specDir, 'task.md'), '# task content');

        // workdir 里有上次执行留下的额外文件
        const workdir = path.join(tempDir, 'workspace', 'tasks', 'task-rerun', 'workdir');
        await fs.mkdir(workdir, { recursive: true });
        await fs.writeFile(path.join(workdir, 'task.md'), '# task content');
        await fs.writeFile(path.join(workdir, 'leftover.txt'), 'old state');

        const result = await queue.rerun(task.taskId);

        expect(result.status).toBe('pending');
        expect(result.retryCount).toBe(0);
        expect((await readTask(task.taskId)).status).toBe('pending');
        expect((await readQueueTicket('pending', task.taskId)).taskId).toBe(task.taskId);
        // workdir 已被重置：旧文件消失，spec 文件在
        await expect(fs.access(path.join(workdir, 'leftover.txt'))).rejects.toThrow();
        await expect(fs.access(path.join(workdir, 'task.md'))).resolves.toBeUndefined();
    });

    it('rerun rejects tasks that are not done or blocked', async () => {
        const { FileQueue } = await import('../src/queue.js');
        const { writeTask } = await import('../src/storage.js');
        const queue = new FileQueue();
        await queue.ensureDirs();

        const task = makeTask({ taskId: 'task-running', status: 'running' });
        await writeTask(task);

        await expect(queue.rerun(task.taskId)).rejects.toThrow('done or blocked');
    });

    it('abandon moves a paused task to blocked', async () => {
        const { FileQueue } = await import('../src/queue.js');
        const { readQueueTicket, readTask, writeTask } = await import('../src/storage.js');
        const queue = new FileQueue();
        await queue.ensureDirs();

        const task = makeTask({ taskId: 'task-abandon', status: 'paused' });
        await writeTask(task);
        await fs.mkdir(path.join(tempDir, 'workspace', 'queue', 'paused'), { recursive: true });
        await fs.writeFile(
            path.join(tempDir, 'workspace', 'queue', 'paused', 'task-abandon.json'),
            JSON.stringify({ taskId: task.taskId, enteredAt: '2026-04-21T09:00:00.000Z' }, null, 2),
        );

        const abandoned = await queue.abandon(task.taskId);

        expect(abandoned.status).toBe('blocked');
        expect((await readTask(task.taskId)).status).toBe('blocked');
        expect((await readQueueTicket('blocked', task.taskId)).taskId).toBe(task.taskId);
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
