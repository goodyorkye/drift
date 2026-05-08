import fs from 'node:fs/promises';
import path from 'node:path';
import { taskManagedArtifactsDir, taskRunDir, taskRunsDir, taskSpecDir, taskWorkdir } from '../paths.js';
import {
    detectQueueStatus,
    listTasks,
    pathExists,
    readJson,
    readRunAgentResult,
    readRunMeta,
    readTask,
} from '../storage.js';
import { type ExecutionResult, type QueueStatus, type RunMeta, type TaskMetadata } from '../types.js';

export interface TaskRunDetails {
    runMeta: RunMeta | null;
    result: ExecutionResult | null;
    artifacts: string[];
}

export interface TaskDetails {
    task: TaskMetadata;
    queueStatus: QueueStatus | null;
    latestRun: TaskRunDetails | null;
}

export async function listTaskSummaries(status?: string): Promise<TaskMetadata[]> {
    const tasks = await listTasks();
    return status ? tasks.filter(task => task.status === status) : tasks;
}

export async function inspectTaskDetails(taskId: string): Promise<TaskDetails> {
    const task = await readTask(taskId);
    const queueStatus = await detectQueueStatus(taskId);
    const latestRun = task.latestRunId ? await readTaskRunDetails(task.taskId, task.latestRunId) : null;
    return { task, queueStatus, latestRun };
}

export async function listTaskRuns(taskId: string): Promise<RunMeta[]> {
    const runsDir = taskRunsDir(taskId);
    const entries = await fs.readdir(runsDir, { withFileTypes: true }).catch(() => []);
    const runs = await Promise.all(
        entries
            .filter(entry => entry.isDirectory())
            .map(async entry => readRunMeta(taskId, entry.name).catch(() => null)),
    );
    return runs.filter((run): run is RunMeta => run !== null).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

export async function readTaskRunDetails(taskId: string, runId: string): Promise<TaskRunDetails> {
    const runMeta = await readRunMeta(taskId, runId).catch(() => null);
    const result = await readRunAgentResult(taskId, runId).catch(() => null);
    const artifacts = await readManagedArtifacts(taskId, runId);
    return { runMeta, result, artifacts };
}

export async function readRunLog(
    taskId: string,
    runId: string,
    stream: 'stdout' | 'stderr',
    options: { tailBytes?: number } = {},
): Promise<string> {
    const runDir = taskRunDir(taskId, runId);
    const file = path.join(runDir, `${stream}.log`);
    const relative = path.relative(runDir, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('Invalid log path.');
    }
    if (!options.tailBytes || options.tailBytes <= 0) {
        return fs.readFile(file, 'utf-8').catch(() => '');
    }

    const stat = await fs.stat(file).catch(() => null);
    if (!stat?.isFile()) return '';

    const length = Math.min(stat.size, options.tailBytes);
    const handle = await fs.open(file, 'r');
    try {
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, stat.size - length);
        let text = buffer.toString('utf-8');
        if (length < stat.size) {
            const newline = text.indexOf('\n');
            if (newline >= 0) text = text.slice(newline + 1);
        }
        return text;
    } finally {
        await handle.close();
    }
}

export async function listTaskFiles(taskId: string, area: 'spec' | 'workdir' = 'spec'): Promise<Array<{ path: string; kind: 'file' | 'directory'; size: number }>> {
    const root = area === 'spec' ? taskSpecDir(taskId) : taskWorkdir(taskId);
    const files: Array<{ path: string; kind: 'file' | 'directory'; size: number }> = [];
    await walkTaskFiles(root, root, files);
    return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function readTaskFile(taskId: string, area: 'spec' | 'workdir', ref: string): Promise<string> {
    const root = area === 'spec' ? taskSpecDir(taskId) : taskWorkdir(taskId);
    const target = path.resolve(root, ref);
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('Invalid task file path.');
    }
    const stat = await fs.stat(target);
    if (!stat.isFile()) throw new Error('Task file is not a file.');
    if (stat.size > 1024 * 1024) throw new Error('Task file is too large to preview.');
    return fs.readFile(target, 'utf-8');
}

export async function resolveManagedArtifact(taskId: string, ref: string): Promise<{ file: string; name: string; size: number }> {
    const root = taskManagedArtifactsDir(taskId);
    const target = path.resolve(root, ref);
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('Invalid artifact path.');
    }
    const stat = await fs.stat(target);
    if (!stat.isFile()) throw new Error('Artifact path is not a file.');
    return { file: target, name: path.basename(target), size: stat.size };
}

async function walkTaskFiles(root: string, current: string, files: Array<{ path: string; kind: 'file' | 'directory'; size: number }>): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        const relative = path.relative(root, fullPath).replace(/\\/g, '/');
        const stat = await fs.stat(fullPath).catch(() => null);
        if (!stat) continue;
        files.push({ path: relative, kind: entry.isDirectory() ? 'directory' : 'file', size: stat.size });
        if (entry.isDirectory() && files.length < 500) {
            await walkTaskFiles(root, fullPath, files);
        }
    }
}

export async function readManagedArtifacts(taskId: string, runId: string): Promise<string[]> {
    const intakeFile = path.join(taskRunDir(taskId, runId), 'intake.json');
    if (!(await pathExists(intakeFile))) return [];

    const intake = await readJson<Array<{ sourceRef: string; managedRef: string }>>(intakeFile);
    return intake.map(record => record.managedRef);
}
