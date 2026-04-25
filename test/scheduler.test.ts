import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import type { TaskMetadata } from '../src/types.js';

describe('Scheduler', () => {
    const originalCwd = process.cwd();
    const originalRoot = process.env.DRIFT_ROOT;
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-work-'));
        process.env.DRIFT_ROOT = tempDir;
        vi.resetModules();
        await fs.mkdir(path.join(tempDir, 'task-types', 'research'), { recursive: true });
        await fs.writeFile(
            path.join(tempDir, 'task-types', 'research', 'task-type.json'),
            JSON.stringify(
                {
                    type: 'research',
                    label: 'Research',
                    description: 'Research task',
                    defaultRunner: 'claude',
                    defaultBudgetUsd: 3,
                    defaultMaxRetries: 2,
                    defaultTimeoutMs: 60_000,
                },
                null,
                2,
            ),
        );
    });

    afterEach(async () => {
        process.chdir(originalCwd);
        process.env.DRIFT_ROOT = originalRoot;
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('creates a task from a schedule and updates trigger statistics', async () => {
        const { Scheduler } = await import('../src/scheduler.js');
        const { scheduleSharedStateDir, scheduleSpecDir } = await import('../src/paths.js');
        const { ensureScheduleSpec, listTasks, readScheduleState, writeSchedule } = await import('../src/storage.js');

        await ensureScheduleSpec('daily-research');
        await fs.writeFile(path.join(scheduleSpecDir('daily-research'), 'task.md'), '# scheduled task');
        await writeSchedule({
            scheduleId: 'daily-research',
            type: 'research',
            title: 'Daily research',
            runner: 'claude',
            cron: '0 9 * * *',
            skipIfActive: true,
            enabled: true,
        });

        const taskId = await new Scheduler().enqueueFromSchedule('daily-research');

        expect(taskId).toBeTruthy();
        const tasks = await listTasks();
        expect(tasks).toHaveLength(1);
        expect(tasks[0]).toMatchObject({
            type: 'research',
            title: 'Daily research',
            runner: 'claude',
            createdBy: {
                kind: 'schedule',
                sourceId: 'daily-research',
            },
            budgetUsd: 3,
            maxRetries: 2,
            timeoutMs: 60_000,
            status: 'pending',
        });
        expect(await fs.readFile(path.join(tempDir, 'workspace', 'tasks', taskId!, 'spec', 'task.md'), 'utf-8')).toBe(
            '# scheduled task',
        );

        const state = await readScheduleState('daily-research');
        expect(state.lastAction).toBe('triggered');
        expect(state.lastTaskId).toBe(taskId);
        expect(state.stats.triggered).toBe(1);
        expect(state.stats.createdTasks).toBe(1);
        await expect(fs.access(scheduleSharedStateDir('daily-research'))).resolves.toBeUndefined();
    });

    it('skips creating a new task when skipIfActive is enabled and an active task exists', async () => {
        const { Scheduler } = await import('../src/scheduler.js');
        const { scheduleSpecDir } = await import('../src/paths.js');
        const { ensureScheduleSpec, readScheduleState, writeSchedule } = await import('../src/storage.js');

        await ensureScheduleSpec('daily-research');
        await fs.writeFile(path.join(scheduleSpecDir('daily-research'), 'task.md'), '# scheduled task');
        await writeSchedule({
            scheduleId: 'daily-research',
            type: 'research',
            title: 'Daily research',
            runner: 'claude',
            cron: '0 9 * * *',
            skipIfActive: true,
            enabled: true,
        });

        const scheduler = new Scheduler();
        await scheduler.enqueueFromSchedule('daily-research');
        const skippedTaskId = await scheduler.enqueueFromSchedule('daily-research');

        expect(skippedTaskId).toBeNull();
        const state = await readScheduleState('daily-research');
        expect(state.lastAction).toBe('skipped');
        expect(state.stats.triggered).toBe(1);
        expect(state.stats.createdTasks).toBe(1);
        expect(state.stats.skipped).toBe(1);
    });

    it('reloads an enabled schedule when its cron expression changes', async () => {
        const { Scheduler } = await import('../src/scheduler.js');
        const { ensureScheduleSpec, writeSchedule } = await import('../src/storage.js');
        const { scheduleSpecDir } = await import('../src/paths.js');

        await ensureScheduleSpec('daily-research');
        await fs.writeFile(path.join(scheduleSpecDir('daily-research'), 'task.md'), '# scheduled task');
        await writeSchedule({
            scheduleId: 'daily-research',
            type: 'research',
            title: 'Daily research',
            runner: 'claude',
            cron: '0 9 * * *',
            skipIfActive: true,
            enabled: true,
        });

        const scheduler = new Scheduler() as unknown as {
            jobs: Map<string, { job: unknown; cron: string }>;
            syncJobs(): Promise<void>;
        };

        await scheduler.syncJobs();
        const firstEntry = scheduler.jobs.get('daily-research');
        expect(firstEntry?.cron).toBe('0 9 * * *');

        await writeSchedule({
            scheduleId: 'daily-research',
            type: 'research',
            title: 'Daily research',
            runner: 'claude',
            cron: '30 10 * * *',
            skipIfActive: true,
            enabled: true,
        });

        await scheduler.syncJobs();
        const secondEntry = scheduler.jobs.get('daily-research');
        expect(secondEntry?.cron).toBe('30 10 * * *');
        expect(secondEntry?.job).not.toBe(firstEntry?.job);
    });

    it('skips registering a schedule with an invalid cron expression', async () => {
        const { Scheduler } = await import('../src/scheduler.js');
        const { ensureScheduleSpec, writeSchedule } = await import('../src/storage.js');
        const { scheduleSpecDir } = await import('../src/paths.js');

        await ensureScheduleSpec('broken-schedule');
        await fs.writeFile(path.join(scheduleSpecDir('broken-schedule'), 'task.md'), '# scheduled task');
        await writeSchedule({
            scheduleId: 'broken-schedule',
            type: 'research',
            title: 'Broken schedule',
            runner: 'claude',
            cron: 'bad cron',
            skipIfActive: true,
            enabled: true,
        });

        const scheduler = new Scheduler() as unknown as {
            jobs: Map<string, { job: unknown; cron: string }>;
            syncJobs(): Promise<void>;
        };

        await expect(scheduler.syncJobs()).resolves.toBeUndefined();
        expect(scheduler.jobs.has('broken-schedule')).toBe(false);
    });
});

describe('schedule CLI', () => {
    const originalCwd = process.cwd();
    const originalRoot = process.env.DRIFT_ROOT;
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-work-'));
        process.env.DRIFT_ROOT = tempDir;
        vi.resetModules();
        await fs.mkdir(path.join(tempDir, 'task-types', 'research'), { recursive: true });
        await fs.writeFile(
            path.join(tempDir, 'task-types', 'research', 'task-type.json'),
            JSON.stringify(
                {
                    type: 'research',
                    label: 'Research',
                    description: 'Research task',
                    defaultRunner: 'claude',
                    defaultBudgetUsd: 3,
                    defaultMaxRetries: 2,
                    defaultTimeoutMs: 60_000,
                },
                null,
                2,
            ),
        );
    });

    afterEach(async () => {
        process.chdir(originalCwd);
        process.env.DRIFT_ROOT = originalRoot;
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('prints skipped when schedule run is ignored by skipIfActive', async () => {
        const { registerScheduleCommands } = await import('../src/cli/schedule.js');
        const { ensureScheduleSpec, writeSchedule } = await import('../src/storage.js');
        const { scheduleSpecDir } = await import('../src/paths.js');

        await ensureScheduleSpec('daily-research');
        await fs.writeFile(path.join(scheduleSpecDir('daily-research'), 'task.md'), '# scheduled task');
        await writeSchedule({
            scheduleId: 'daily-research',
            type: 'research',
            title: 'Daily research',
            runner: 'claude',
            cron: '0 9 * * *',
            skipIfActive: true,
            enabled: true,
        });

        const scheduler = await import('../src/scheduler.js');
        await new scheduler.Scheduler().enqueueFromSchedule('daily-research');

        const program = new Command();
        registerScheduleCommands(program);

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        await program.parseAsync(['node', 'test', 'schedule', 'run', 'daily-research']);

        expect(logSpy).toHaveBeenCalledWith('- Schedule daily-research skipped: skipIfActive is enabled and an active task already exists');
        logSpy.mockRestore();
    });

    it('rejects duplicate scheduleId values during creation validation', async () => {
        const { ensureScheduleSpec } = await import('../src/storage.js');
        const { validateScheduleId } = await import('../src/cli/schedule.js');

        await ensureScheduleSpec('daily-research');

        await expect(validateScheduleId('daily-research')).resolves.toBe('scheduleId 已存在：daily-research');
        await expect(validateScheduleId('new-schedule')).resolves.toBe(true);
    });

    it('validates cron expressions during creation', async () => {
        const { validateCronExpression } = await import('../src/cli/schedule.js');

        expect(validateCronExpression('0 9 * * *')).toBe(true);
        expect(validateCronExpression('bad cron')).toBe('Cron 表达式无效');
    });

    it('shows recent schedule state with display-friendly local times', async () => {
        const { registerScheduleCommands } = await import('../src/cli/schedule.js');
        const { ensureScheduleSpec, writeSchedule, writeScheduleState } = await import('../src/storage.js');
        const { scheduleSpecDir } = await import('../src/paths.js');
        const { formatTimestampForDisplay } = await import('../src/time.js');

        await ensureScheduleSpec('daily-research');
        await fs.writeFile(path.join(scheduleSpecDir('daily-research'), 'task.md'), '# scheduled task');
        await writeSchedule({
            scheduleId: 'daily-research',
            type: 'research',
            title: 'Daily research',
            runner: 'claude',
            cron: '0 9 * * *',
            skipIfActive: true,
            enabled: true,
        });
        await writeScheduleState({
            scheduleId: 'daily-research',
            lastTriggeredAt: '2026-04-21T09:00:00.000Z',
            lastAction: 'triggered',
            lastTaskId: 'task-1',
            lastRunStatus: 'done',
            stats: {
                triggered: 1,
                skipped: 0,
                createdTasks: 1,
                done: 1,
                blocked: 0,
                paused: 0,
            },
            timing: {},
        });

        const program = new Command();
        registerScheduleCommands(program);

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        await program.parseAsync(['node', 'test', 'schedule', 'list']);

        expect(logSpy.mock.calls.flat()).toContain('daily-research  [enabled]  0 9 * * *');
        expect(logSpy.mock.calls.flat()).toContain(
            `  lastTriggered: ${formatTimestampForDisplay('2026-04-21T09:00:00.000Z')}  lastAction: triggered  lastRun: done`,
        );
        logSpy.mockRestore();
    });

    it('clears finished task instances created by a schedule and resets stale lastTaskId', async () => {
        const { registerScheduleCommands } = await import('../src/cli/schedule.js');
        const { ensureScheduleSpec, writeQueueTicket, writeSchedule, writeScheduleState, writeTask, pathExists, readScheduleState } = await import(
            '../src/storage.js'
        );
        const { scheduleSpecDir, taskRoot } = await import('../src/paths.js');

        await ensureScheduleSpec('daily-research');
        await fs.writeFile(path.join(scheduleSpecDir('daily-research'), 'task.md'), '# scheduled task');
        await writeSchedule({
            scheduleId: 'daily-research',
            type: 'research',
            title: 'Daily research',
            runner: 'claude',
            cron: '0 9 * * *',
            skipIfActive: true,
            enabled: true,
        });
        await writeTask(makeScheduledTask('task-a', 'done'));
        await writeTask(makeScheduledTask('task-b', 'blocked'));
        await writeQueueTicket('done', { taskId: 'task-a', enteredAt: '2026-04-21T09:05:00.000Z' });
        await writeQueueTicket('blocked', { taskId: 'task-b', enteredAt: '2026-04-21T09:06:00.000Z' });
        await writeScheduleState({
            scheduleId: 'daily-research',
            lastTriggeredAt: '2026-04-21T09:00:00.000Z',
            lastAction: 'triggered',
            lastTaskId: 'task-b',
            lastRunStatus: 'blocked',
            stats: {
                triggered: 2,
                skipped: 0,
                createdTasks: 2,
                done: 1,
                blocked: 1,
                paused: 0,
            },
            timing: {
                lastDurationMs: 1000,
                avgDurationMs: 1000,
            },
        });

        const program = new Command();
        registerScheduleCommands(program);

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        await program.parseAsync(['node', 'test', 'schedule', 'clear-tasks', 'daily-research', '--yes']);

        expect(await pathExists(taskRoot('task-a'))).toBe(false);
        expect(await pathExists(taskRoot('task-b'))).toBe(false);
        expect((await readScheduleState('daily-research')).lastTaskId).toBeNull();
        expect(logSpy).toHaveBeenCalledWith('✓ Cleared 2 task instance(s) for schedule: daily-research');
        logSpy.mockRestore();
    });

    it('refuses to clear tasks when the schedule still has active instances', async () => {
        const { registerScheduleCommands } = await import('../src/cli/schedule.js');
        const { ensureScheduleSpec, writeSchedule, writeTask } = await import('../src/storage.js');
        const { scheduleSpecDir } = await import('../src/paths.js');

        await ensureScheduleSpec('daily-research');
        await fs.writeFile(path.join(scheduleSpecDir('daily-research'), 'task.md'), '# scheduled task');
        await writeSchedule({
            scheduleId: 'daily-research',
            type: 'research',
            title: 'Daily research',
            runner: 'claude',
            cron: '0 9 * * *',
            skipIfActive: true,
            enabled: true,
        });
        await writeTask(makeScheduledTask('task-active', 'running'));

        const program = new Command();
        registerScheduleCommands(program);

        await expect(program.parseAsync(['node', 'test', 'schedule', 'clear-tasks', 'daily-research', '--yes'])).rejects.toThrow(
            'Cannot clear tasks for schedule daily-research while active instances exist: task-active [running]',
        );
    });
});

function makeScheduledTask(taskId: string, status: TaskMetadata['status']): TaskMetadata {
    return {
        taskId,
        type: 'research',
        title: `Task ${taskId}`,
        runner: 'claude',
        budgetUsd: 3,
        maxRetries: 2,
        timeoutMs: 60_000,
        createdAt: '2026-04-21T09:00:00.000Z',
        createdBy: {
            kind: 'schedule',
            sourceId: 'daily-research',
        },
        retryCount: 0,
        status,
        statusUpdatedAt: '2026-04-21T09:00:00.000Z',
        latestRunId: null,
        lastEnqueuedAt: null,
        lastStartedAt: null,
        lastFinishedAt: null,
    };
}
