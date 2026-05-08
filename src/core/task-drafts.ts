import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_BUDGET_USD, DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS } from '../defaults.js';
import { generateDraftId, generateTaskId } from '../ids.js';
import { taskDraftSpecDir, taskSpecDir } from '../paths.js';
import { Registry } from '../registry.js';
import { isRunnerAvailable, listAvailableRunners, listKnownRunners } from '../runners/index.js';
import {
    ensureTaskDraftSpec,
    ensureTaskSpec,
    readTaskDraft,
    readTask,
    removeTaskDraftRoot,
    writeTask,
    writeTaskDraft,
} from '../storage.js';
import { formatLocalIsoTimestamp } from '../time.js';
import { type ActorRef, type RunnerName, type TaskDraft, type TaskMetadata, type TaskType } from '../types.js';
import { enqueueTask } from './task-actions.js';
import { runSpecCreationRound } from '../cli/creation.js';

export interface TaskDraftSummary {
    draft: TaskDraft;
    files: DraftFileEntry[];
    taskMd: string;
}

export interface DraftFileEntry {
    path: string;
    kind: 'file' | 'directory';
    size: number;
}

export interface CreateTaskDraftInput {
    type: string;
    creationMethod: RunnerName | 'manual';
}

export interface FinalizeTaskDraftInput {
    title: string;
    runner: RunnerName;
    budgetUsd?: number;
    maxRetries?: number;
    timeoutMs?: number;
    enqueue?: boolean;
    actor: ActorRef;
}

export interface TaskCreateOptions {
    taskTypes: TaskType[];
    creationMethods: Array<RunnerName | 'manual'>;
    availableCreationMethods: RunnerName[];
    knownRunners: RunnerName[];
    availableRunners: RunnerName[];
}

export async function getTaskCreateOptions(): Promise<TaskCreateOptions> {
    const registry = new Registry();
    await registry.load();
    const availableCreationMethods = await listAvailableRunners();
    return {
        taskTypes: registry.listTypes(),
        creationMethods: [...availableCreationMethods, 'manual'],
        availableCreationMethods,
        knownRunners: listKnownRunners(),
        availableRunners: availableCreationMethods,
    };
}

export async function createTaskDraft(input: CreateTaskDraftInput): Promise<TaskDraftSummary> {
    const registry = new Registry();
    await registry.load();
    const taskType = registry.getType(input.type);
    if (input.creationMethod !== 'manual' && !(await isRunnerAvailable(input.creationMethod))) {
        throw new Error(`Runner not available: ${input.creationMethod}`);
    }

    const draftId = generateDraftId();
    const now = formatLocalIsoTimestamp();
    const guidePath = await registry.getGuidePath(input.type);
    await ensureTaskDraftSpec(draftId);
    await fs.writeFile(path.join(taskDraftSpecDir(draftId), 'task.md'), '', 'utf-8');

    const draft: TaskDraft = {
        draftId,
        kind: 'task',
        taskType,
        creationMethod: input.creationMethod,
        createdAt: now,
        updatedAt: now,
        guidePath,
        transcript: [],
    };
    await writeTaskDraft(draft);
    return getTaskDraftSummary(draftId);
}

export async function getTaskDraftSummary(draftId: string): Promise<TaskDraftSummary> {
    const draft = await readTaskDraft(draftId);
    const files = await listDraftFiles(draftId);
    const taskMd = await readDraftFile(draftId, 'task.md').catch(() => '');
    return { draft, files, taskMd };
}

export async function listDraftFiles(draftId: string): Promise<DraftFileEntry[]> {
    const base = taskDraftSpecDir(draftId);
    return listRelativeFiles(base, base);
}

async function listRelativeFiles(root: string, current: string): Promise<DraftFileEntry[]> {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    const files = await Promise.all(
        entries.map(async entry => {
            const fullPath = path.join(current, entry.name);
            const relativePath = path.relative(root, fullPath).replaceAll(path.sep, '/');
            const stats = await fs.stat(fullPath);
            if (entry.isDirectory()) {
                const nested = await listRelativeFiles(root, fullPath);
                return [{ path: relativePath, kind: 'directory' as const, size: 0 }, ...nested];
            }
            return [{ path: relativePath, kind: 'file' as const, size: stats.size }];
        }),
    );
    return files.flat().sort((a, b) => a.path.localeCompare(b.path));
}

export async function readDraftFile(draftId: string, relativePath: string): Promise<string> {
    const file = resolveDraftFile(draftId, relativePath);
    return fs.readFile(file, 'utf-8');
}

export async function writeDraftFile(
    draftId: string,
    relativePath: string,
    content: string,
): Promise<TaskDraftSummary> {
    const file = resolveDraftFile(draftId, relativePath);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, 'utf-8');
    await touchDraft(draftId);
    return getTaskDraftSummary(draftId);
}

export async function uploadDraftFile(
    draftId: string,
    relativePath: string,
    content: Buffer,
): Promise<TaskDraftSummary> {
    const file = resolveDraftFile(draftId, relativePath);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
    await touchDraft(draftId);
    return getTaskDraftSummary(draftId);
}

export async function sendTaskDraftMessage(
    draftId: string,
    message: string,
): Promise<{ draft: TaskDraftSummary; reply: string }> {
    const draft = await readTaskDraft(draftId);
    if (draft.creationMethod === 'manual') {
        throw new Error('Manual drafts do not support assistant rounds.');
    }

    const reply = await runSpecCreationRound({
        method: draft.creationMethod,
        cwd: taskDraftSpecDir(draftId),
        taskType: draft.taskType,
        guidePath: draft.guidePath,
        mode: 'task',
        transcript: draft.transcript,
        userMessage: message,
    });

    const now = formatLocalIsoTimestamp();
    draft.transcript.push(
        { role: 'user', content: message, createdAt: now },
        { role: 'assistant', content: reply, createdAt: formatLocalIsoTimestamp() },
    );
    draft.updatedAt = formatLocalIsoTimestamp();
    await writeTaskDraft(draft);

    return {
        draft: await getTaskDraftSummary(draftId),
        reply,
    };
}

export async function finalizeTaskDraft(
    draftId: string,
    input: FinalizeTaskDraftInput,
): Promise<{ task: TaskMetadata; enqueued: boolean }> {
    const draft = await readTaskDraft(draftId);
    const taskMd = await readDraftFile(draftId, 'task.md');
    if (!taskMd.trim()) {
        throw new Error('task.md must be non-empty before creating a task.');
    }

    if (!input.title.trim()) {
        throw new Error('Task title is required.');
    }

    if (input.enqueue && !(await isRunnerAvailable(input.runner))) {
        throw new Error(`Runner not available: ${input.runner}`);
    }

    const taskId = generateTaskId();
    await ensureTaskSpec(taskId);
    await fs.cp(taskDraftSpecDir(draftId), taskSpecDir(taskId), { recursive: true });
    const createdAt = formatLocalIsoTimestamp();
    const task: TaskMetadata = {
        taskId,
        type: draft.taskType.type,
        title: input.title.trim(),
        runner: input.runner,
        budgetUsd: input.budgetUsd ?? draft.taskType.defaultBudgetUsd ?? DEFAULT_BUDGET_USD,
        maxRetries: input.maxRetries ?? draft.taskType.defaultMaxRetries ?? DEFAULT_MAX_RETRIES,
        timeoutMs: input.timeoutMs ?? draft.taskType.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
        createdAt,
        createdBy: { kind: draft.creationMethod },
        retryCount: 0,
        status: 'not_queued',
        statusUpdatedAt: createdAt,
        latestRunId: null,
        lastEnqueuedAt: null,
        lastStartedAt: null,
        lastFinishedAt: null,
    };
    await writeTask(task);

    let enqueued = false;
    if (input.enqueue) {
        await enqueueTask(taskId, { actor: input.actor });
        enqueued = true;
    }

    await removeTaskDraftRoot(draftId);
    return { task: await readTask(taskId), enqueued };
}

function resolveDraftFile(draftId: string, relativePath: string): string {
    const normalized = relativePath.replaceAll('\\', '/').replace(/^\/+/, '');
    if (!normalized) {
        throw new Error('Draft file path is required.');
    }

    const root = taskDraftSpecDir(draftId);
    const fullPath = path.resolve(root, normalized);
    const relative = path.relative(root, fullPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('Invalid draft file path.');
    }
    return fullPath;
}

async function touchDraft(draftId: string): Promise<void> {
    const draft = await readTaskDraft(draftId);
    draft.updatedAt = formatLocalIsoTimestamp();
    await writeTaskDraft(draft);
}
