import fs from 'node:fs/promises';
import path from 'node:path';
import cron from 'node-cron';
import { generateDraftId } from '../ids.js';
import { scheduleDraftSpecDir, scheduleRoot, scheduleSpecDir, taskSpecDir } from '../paths.js';
import { Registry } from '../registry.js';
import { isRunnerAvailable, listAvailableRunners, listKnownRunners } from '../runners/index.js';
import {
    createEmptyScheduleState,
    ensureScheduleDraftSpec,
    ensureScheduleSpec,
    listTasks,
    readScheduleDraft,
    removeScheduleDraftRoot,
    writeSchedule,
    writeScheduleDraft,
    writeScheduleState,
} from '../storage.js';
import { formatLocalIsoTimestamp } from '../time.js';
import { type ActorRef, type RunnerName, type ScheduleConfig, type ScheduleDraft, type TaskMetadata, type TaskType } from '../types.js';
import { runSpecCreationRound } from '../cli/creation.js';

export interface ScheduleDraftSummary {
    draft: ScheduleDraft;
    files: ScheduleDraftFileEntry[];
    taskMd: string;
}

export interface ScheduleDraftFileEntry {
    path: string;
    kind: 'file' | 'directory';
    size: number;
}

export interface CreateScheduleDraftInput {
    type: string;
    creationMethod: RunnerName | 'manual';
    specSource: 'new' | 'task';
    sourceTaskId?: string;
}

export interface FinalizeScheduleDraftInput {
    scheduleId: string;
    title: string;
    runner: RunnerName;
    cron: string;
    skipIfActive: boolean;
    enabled: boolean;
    actor: ActorRef;
}

export interface ScheduleCreateOptions {
    taskTypes: TaskType[];
    creationMethods: Array<RunnerName | 'manual'>;
    availableCreationMethods: RunnerName[];
    knownRunners: RunnerName[];
    availableRunners: RunnerName[];
    existingTasks: TaskMetadata[];
}

export async function getScheduleCreateOptions(): Promise<ScheduleCreateOptions> {
    const registry = new Registry();
    await registry.load();
    const availableCreationMethods = await listAvailableRunners();
    return {
        taskTypes: registry.listTypes(),
        creationMethods: [...availableCreationMethods, 'manual'],
        availableCreationMethods,
        knownRunners: listKnownRunners(),
        availableRunners: availableCreationMethods,
        existingTasks: sortTasksNewestFirst(await listTasks()),
    };
}

export async function createScheduleDraft(input: CreateScheduleDraftInput): Promise<ScheduleDraftSummary> {
    const registry = new Registry();
    await registry.load();
    const taskType = registry.getType(input.type);
    if (input.creationMethod !== 'manual' && !(await isRunnerAvailable(input.creationMethod))) {
        throw new Error(`Runner not available: ${input.creationMethod}`);
    }
    if (input.specSource === 'task' && !input.sourceTaskId) {
        throw new Error('Source task is required when copying from an existing task.');
    }

    const draftId = generateDraftId();
    const now = formatLocalIsoTimestamp();
    const guidePath = await registry.getGuidePath(input.type);
    await ensureScheduleDraftSpec(draftId);

    if (input.specSource === 'task' && input.sourceTaskId) {
        await fs.rm(scheduleDraftSpecDir(draftId), { recursive: true, force: true });
        await fs.mkdir(scheduleDraftSpecDir(draftId), { recursive: true });
        await fs.cp(taskSpecDir(input.sourceTaskId), scheduleDraftSpecDir(draftId), { recursive: true });
    } else {
        await fs.writeFile(path.join(scheduleDraftSpecDir(draftId), 'task.md'), '', 'utf-8');
    }

    const draft: ScheduleDraft = {
        draftId,
        kind: 'schedule',
        taskType,
        creationMethod: input.creationMethod,
        createdAt: now,
        updatedAt: now,
        guidePath,
        transcript: [],
        specSource: input.specSource,
        ...(input.sourceTaskId ? { sourceTaskId: input.sourceTaskId } : {}),
    };
    await writeScheduleDraft(draft);
    return getScheduleDraftSummary(draftId);
}

export async function getScheduleDraftSummary(draftId: string): Promise<ScheduleDraftSummary> {
    const draft = await readScheduleDraft(draftId);
    const files = await listScheduleDraftFiles(draftId);
    const taskMd = await readScheduleDraftFile(draftId, 'task.md').catch(() => '');
    return { draft, files, taskMd };
}

export async function listScheduleDraftFiles(draftId: string): Promise<ScheduleDraftFileEntry[]> {
    const base = scheduleDraftSpecDir(draftId);
    return listRelativeFiles(base, base);
}

async function listRelativeFiles(root: string, current: string): Promise<ScheduleDraftFileEntry[]> {
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

export async function readScheduleDraftFile(draftId: string, relativePath: string): Promise<string> {
    return fs.readFile(resolveScheduleDraftFile(draftId, relativePath), 'utf-8');
}

export async function writeScheduleDraftFile(
    draftId: string,
    relativePath: string,
    content: string,
): Promise<ScheduleDraftSummary> {
    const file = resolveScheduleDraftFile(draftId, relativePath);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, 'utf-8');
    await touchScheduleDraft(draftId);
    return getScheduleDraftSummary(draftId);
}

export async function uploadScheduleDraftFile(
    draftId: string,
    relativePath: string,
    content: Buffer,
): Promise<ScheduleDraftSummary> {
    const file = resolveScheduleDraftFile(draftId, relativePath);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
    await touchScheduleDraft(draftId);
    return getScheduleDraftSummary(draftId);
}

export async function sendScheduleDraftMessage(
    draftId: string,
    message: string,
): Promise<{ draft: ScheduleDraftSummary; reply: string }> {
    const draft = await readScheduleDraft(draftId);
    if (draft.creationMethod === 'manual') {
        throw new Error('Manual drafts do not support assistant rounds.');
    }

    const reply = await runSpecCreationRound({
        method: draft.creationMethod,
        cwd: scheduleDraftSpecDir(draftId),
        taskType: draft.taskType,
        guidePath: draft.guidePath,
        mode: 'schedule',
        transcript: draft.transcript,
        userMessage: message,
    });

    const now = formatLocalIsoTimestamp();
    draft.transcript.push(
        { role: 'user', content: message, createdAt: now },
        { role: 'assistant', content: reply, createdAt: formatLocalIsoTimestamp() },
    );
    draft.updatedAt = formatLocalIsoTimestamp();
    await writeScheduleDraft(draft);

    return { draft: await getScheduleDraftSummary(draftId), reply };
}

export async function finalizeScheduleDraft(
    draftId: string,
    input: FinalizeScheduleDraftInput,
): Promise<{ schedule: ScheduleConfig; enabledCoerced: boolean }> {
    const draft = await readScheduleDraft(draftId);
    const taskMd = await readScheduleDraftFile(draftId, 'task.md');
    if (!taskMd.trim()) {
        throw new Error('task.md must be non-empty before creating a schedule.');
    }
    if (!input.title.trim()) {
        throw new Error('Schedule title is required.');
    }
    if (!cron.validate(input.cron)) {
        throw new Error('Cron expression is invalid.');
    }
    const scheduleIdValidation = await validateScheduleId(input.scheduleId);
    if (scheduleIdValidation !== true) {
        throw new Error(scheduleIdValidation);
    }

    await ensureScheduleSpec(input.scheduleId);
    await fs.rm(scheduleSpecDir(input.scheduleId), { recursive: true, force: true });
    await fs.mkdir(scheduleSpecDir(input.scheduleId), { recursive: true });
    await fs.cp(scheduleDraftSpecDir(draftId), scheduleSpecDir(input.scheduleId), { recursive: true });

    const runnerInstalled = await isRunnerAvailable(input.runner);
    const enabled = runnerInstalled ? input.enabled : false;
    const schedule: ScheduleConfig = {
        scheduleId: input.scheduleId,
        type: draft.taskType.type,
        title: input.title.trim(),
        runner: input.runner,
        cron: input.cron,
        skipIfActive: input.skipIfActive,
        enabled,
    };
    await writeSchedule(schedule);
    await writeScheduleState(createEmptyScheduleState(input.scheduleId));
    await removeScheduleDraftRoot(draftId);
    return { schedule, enabledCoerced: input.enabled !== enabled };
}

export async function validateScheduleId(value: string): Promise<true | string> {
    if (!/^[a-z0-9-]+$/.test(value)) {
        return 'scheduleId 只允许小写字母、数字和 -';
    }
    if (await scheduleIdExists(value)) {
        return `scheduleId 已存在：${value}`;
    }
    return true;
}

async function scheduleIdExists(value: string): Promise<boolean> {
    try {
        await fs.access(scheduleRoot(value));
        return true;
    } catch {
        return false;
    }
}

function sortTasksNewestFirst(tasks: TaskMetadata[]): TaskMetadata[] {
    return [...tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function resolveScheduleDraftFile(draftId: string, relativePath: string): string {
    const normalized = relativePath.replaceAll('\\', '/').replace(/^\/+/, '');
    if (!normalized) {
        throw new Error('Draft file path is required.');
    }

    const root = scheduleDraftSpecDir(draftId);
    const fullPath = path.resolve(root, normalized);
    const relative = path.relative(root, fullPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('Invalid draft file path.');
    }
    return fullPath;
}

async function touchScheduleDraft(draftId: string): Promise<void> {
    const draft = await readScheduleDraft(draftId);
    draft.updatedAt = formatLocalIsoTimestamp();
    await writeScheduleDraft(draft);
}
