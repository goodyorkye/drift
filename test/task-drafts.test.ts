import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('task draft flow', () => {
    const originalRoot = process.env.DRIFT_ROOT;
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-draft-'));
        process.env.DRIFT_ROOT = tempDir;
        vi.resetModules();
    });

    afterEach(async () => {
        process.env.DRIFT_ROOT = originalRoot;
        vi.doUnmock('../src/runners/index.js');
        vi.doUnmock('../src/cli/creation.js');
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('creates a manual task draft with an empty task.md', async () => {
        const { createTaskDraft } = await import('../src/core/task-drafts.js');

        const draft = await createTaskDraft({ type: 'research', creationMethod: 'manual' });

        expect(draft.draft.creationMethod).toBe('manual');
        expect(draft.files).toEqual([
            expect.objectContaining({ path: 'task.md', kind: 'file' }),
        ]);
        expect(draft.taskMd).toBe('');
    });

    it('writes draft files and blocks path escapes', async () => {
        const { createTaskDraft, writeDraftFile, readDraftFile, uploadDraftFile } = await import('../src/core/task-drafts.js');

        const draft = await createTaskDraft({ type: 'research', creationMethod: 'manual' });
        await writeDraftFile(draft.draft.draftId, 'notes/context.md', 'hello');
        await uploadDraftFile(draft.draft.draftId, 'attachments/input.txt', Buffer.from('uploaded', 'utf-8'));

        await expect(readDraftFile(draft.draft.draftId, 'notes/context.md')).resolves.toBe('hello');
        await expect(readDraftFile(draft.draft.draftId, 'attachments/input.txt')).resolves.toBe('uploaded');
        await expect(writeDraftFile(draft.draft.draftId, '../escape.txt', 'nope')).rejects.toThrow('Invalid draft file path.');
    });

    it('finalizes a draft into a real task and removes the draft root', async () => {
        const { createTaskDraft, writeDraftFile, finalizeTaskDraft } = await import('../src/core/task-drafts.js');
        const { readTask, pathExists } = await import('../src/storage.js');
        const { taskDraftRoot, taskSpecDir } = await import('../src/paths.js');

        const draft = await createTaskDraft({ type: 'research', creationMethod: 'manual' });
        await writeDraftFile(draft.draft.draftId, 'task.md', '# Goal\nShip it');
        await writeDraftFile(draft.draft.draftId, 'notes.md', 'extra');

        const result = await finalizeTaskDraft(draft.draft.draftId, {
            title: 'Ship it',
            runner: 'claude',
            actor: { name: 'York', source: 'web' },
        });

        expect(result.enqueued).toBe(false);
        expect((await readTask(result.task.taskId)).createdBy.kind).toBe('manual');
        expect(await fs.readFile(path.join(taskSpecDir(result.task.taskId), 'notes.md'), 'utf-8')).toBe('extra');
        expect(await pathExists(taskDraftRoot(draft.draft.draftId))).toBe(false);
    });

    it('uses the assistant round helper for non-manual drafts', async () => {
        vi.doMock('../src/runners/index.js', () => ({
            isRunnerAvailable: vi.fn().mockResolvedValue(true),
            listAvailableRunners: vi.fn().mockResolvedValue(['claude']),
            listKnownRunners: vi.fn().mockReturnValue(['claude', 'codex']),
        }));
        vi.doMock('../src/cli/creation.js', () => ({
            runSpecCreationRound: vi.fn().mockResolvedValue('我已经整理好了 task.md。'),
        }));

        const { createTaskDraft, sendTaskDraftMessage } = await import('../src/core/task-drafts.js');

        const draft = await createTaskDraft({ type: 'research', creationMethod: 'claude' });
        const reply = await sendTaskDraftMessage(draft.draft.draftId, '帮我整理一个调研任务');

        expect(reply.reply).toContain('整理好了');
        expect(reply.draft.draft.transcript).toHaveLength(2);
        expect(reply.draft.draft.transcript[0]?.role).toBe('user');
        expect(reply.draft.draft.transcript[1]?.role).toBe('assistant');
    });
});
