import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { type TaskMetadata } from '../src/types.js';

describe('schedule draft flow', () => {
    const originalRoot = process.env.DRIFT_ROOT;
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-schedule-draft-'));
        process.env.DRIFT_ROOT = tempDir;
        vi.resetModules();
    });

    afterEach(async () => {
        process.env.DRIFT_ROOT = originalRoot;
        vi.doUnmock('../src/runners/index.js');
        vi.doUnmock('../src/cli/creation.js');
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('creates a manual schedule draft with an empty task.md', async () => {
        const { createScheduleDraft } = await import('../src/core/schedule-drafts.js');

        const draft = await createScheduleDraft({ type: 'research', creationMethod: 'manual', specSource: 'new' });

        expect(draft.draft.creationMethod).toBe('manual');
        expect(draft.draft.specSource).toBe('new');
        expect(draft.files).toEqual([expect.objectContaining({ path: 'task.md', kind: 'file' })]);
        expect(draft.taskMd).toBe('');
    });

    it('can seed a schedule draft from an existing task spec', async () => {
        const { createScheduleDraft } = await import('../src/core/schedule-drafts.js');
        const { writeTask } = await import('../src/storage.js');
        const { ensureTaskSpec } = await import('../src/storage.js');
        const { taskSpecDir } = await import('../src/paths.js');

        const task = makeTask({ taskId: 'task-source', title: 'Source task' });
        await writeTask(task);
        await ensureTaskSpec(task.taskId);
        await fs.writeFile(path.join(taskSpecDir(task.taskId), 'task.md'), '# Goal\nSeed schedule');
        await fs.writeFile(path.join(taskSpecDir(task.taskId), 'notes.md'), 'context');

        const draft = await createScheduleDraft({
            type: 'research',
            creationMethod: 'manual',
            specSource: 'task',
            sourceTaskId: task.taskId,
        });

        expect(draft.draft.specSource).toBe('task');
        expect(draft.draft.sourceTaskId).toBe(task.taskId);
        expect(draft.taskMd).toContain('Seed schedule');
        expect(draft.files).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ path: 'task.md' }),
                expect.objectContaining({ path: 'notes.md' }),
            ]),
        );
    });

    it('finalizes a schedule draft into a real schedule and removes the draft root', async () => {
        const { createScheduleDraft, writeScheduleDraftFile, finalizeScheduleDraft } = await import('../src/core/schedule-drafts.js');
        const { readSchedule, readScheduleState, pathExists } = await import('../src/storage.js');
        const { scheduleDraftRoot, scheduleSpecDir } = await import('../src/paths.js');

        const draft = await createScheduleDraft({ type: 'research', creationMethod: 'manual', specSource: 'new' });
        await writeScheduleDraftFile(draft.draft.draftId, 'task.md', '# Goal\nNightly digest');
        await writeScheduleDraftFile(draft.draft.draftId, 'notes.md', 'details');

        const result = await finalizeScheduleDraft(draft.draft.draftId, {
            scheduleId: 'nightly-digest',
            title: 'Nightly digest',
            runner: 'claude',
            cron: '0 * * * *',
            skipIfActive: true,
            enabled: true,
            actor: { name: 'York', source: 'web' },
        });

        expect((await readSchedule(result.schedule.scheduleId)).title).toBe('Nightly digest');
        expect((await readScheduleState(result.schedule.scheduleId)).scheduleId).toBe('nightly-digest');
        expect(await fs.readFile(path.join(scheduleSpecDir(result.schedule.scheduleId), 'notes.md'), 'utf-8')).toBe('details');
        expect(await pathExists(scheduleDraftRoot(draft.draft.draftId))).toBe(false);
    });

    it('uses assistant rounds for non-manual schedule drafts', async () => {
        vi.doMock('../src/runners/index.js', () => ({
            isRunnerAvailable: vi.fn().mockResolvedValue(true),
            listAvailableRunners: vi.fn().mockResolvedValue(['claude']),
            listKnownRunners: vi.fn().mockReturnValue(['claude', 'codex']),
        }));
        vi.doMock('../src/cli/creation.js', () => ({
            runSpecCreationRound: vi.fn().mockResolvedValue('我已经整理好了 schedule task.md。'),
        }));

        const { createScheduleDraft, sendScheduleDraftMessage } = await import('../src/core/schedule-drafts.js');

        const draft = await createScheduleDraft({ type: 'research', creationMethod: 'claude', specSource: 'new' });
        const reply = await sendScheduleDraftMessage(draft.draft.draftId, '帮我整理一个每日调研定时任务');

        expect(reply.reply).toContain('整理好了');
        expect(reply.draft.draft.transcript).toHaveLength(2);
    });

    it('lists existing source tasks newest first in schedule create options', async () => {
        const { getScheduleCreateOptions } = await import('../src/core/schedule-drafts.js');
        const { writeTask } = await import('../src/storage.js');

        await writeTask(
            makeTask({
                taskId: 'task-old',
                title: 'Old task',
                createdAt: '2026-05-01T09:00:00.000+08:00',
                statusUpdatedAt: '2026-05-01T09:00:00.000+08:00',
            }),
        );
        await writeTask(
            makeTask({
                taskId: 'task-new',
                title: 'New task',
                createdAt: '2026-05-03T09:00:00.000+08:00',
                statusUpdatedAt: '2026-05-03T09:00:00.000+08:00',
            }),
        );

        const options = await getScheduleCreateOptions();
        expect(options.existingTasks.map(task => task.taskId)).toEqual(['task-new', 'task-old']);
    });
});

function makeTask(overrides: Partial<TaskMetadata> = {}): TaskMetadata {
    return {
        taskId: 'task-1',
        type: 'research',
        title: 'Source task',
        runner: 'claude',
        budgetUsd: 10,
        maxRetries: 1,
        timeoutMs: 1000,
        createdAt: '2026-05-01T09:00:00.000+08:00',
        createdBy: { kind: 'manual' },
        retryCount: 0,
        status: 'not_queued',
        statusUpdatedAt: '2026-05-01T09:00:00.000+08:00',
        latestRunId: null,
        lastEnqueuedAt: null,
        lastStartedAt: null,
        lastFinishedAt: null,
        ...overrides,
    };
}
