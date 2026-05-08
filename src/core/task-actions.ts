import { appendSystemLog } from '../logging.js';
import { taskRunStopRequestFile } from '../paths.js';
import { FileQueue } from '../queue.js';
import { isRunnerAvailable } from '../runners/index.js';
import {
    detectQueueStatus,
    listTasks,
    readRunMeta,
    readTask,
    removeQueueTicket,
    removeTaskRoot,
    writeJson,
} from '../storage.js';
import { type ActorRef, type TaskMetadata } from '../types.js';

export interface TaskActionOptions {
    actor?: ActorRef;
    reason?: string;
}

export async function enqueueTask(taskId: string, options: TaskActionOptions = {}): Promise<TaskMetadata> {
    const task = await readTask(taskId);
    if (task.status !== 'not_queued') {
        throw new Error(`Only not_queued tasks can be enqueued. Current status: ${task.status}`);
    }
    if (!(await isRunnerAvailable(task.runner))) {
        throw new Error(`Runner not available: ${task.runner}. Install it before enqueuing this task.`);
    }

    const queue = new FileQueue();
    await queue.ensureDirs();
    await queue.enqueue(task);
    const persisted = await readTask(taskId);
    await appendSystemLog({
        event: 'task_enqueued',
        actor: options.actor,
        taskId: persisted.taskId,
        taskType: persisted.type,
        runner: persisted.runner,
        status: 'pending',
    });
    return persisted;
}

export async function resumeTask(taskId: string, options: TaskActionOptions = {}): Promise<TaskMetadata> {
    const task = await readTask(taskId);
    if (task.status !== 'paused') {
        throw new Error(`Only paused tasks can be resumed. Current status: ${task.status}`);
    }

    const queue = new FileQueue();
    const persisted = await queue.resume(taskId);
    await appendSystemLog({
        event: 'task_resumed',
        actor: options.actor,
        taskId: persisted.taskId,
        taskType: persisted.type,
        runner: persisted.runner,
        status: 'pending',
    });
    return persisted;
}

export async function rerunTask(taskId: string, options: TaskActionOptions = {}): Promise<TaskMetadata> {
    const task = await readTask(taskId);
    if (task.status !== 'done' && task.status !== 'blocked') {
        throw new Error(`Only done or blocked tasks can be rerun. Current status: ${task.status}`);
    }

    const queue = new FileQueue();
    const persisted = await queue.rerun(taskId);
    await appendSystemLog({
        event: 'task_rerun',
        actor: options.actor,
        taskId: persisted.taskId,
        taskType: persisted.type,
        runner: persisted.runner,
        status: 'pending',
    });
    return persisted;
}

export async function abandonTask(taskId: string, options: TaskActionOptions = {}): Promise<TaskMetadata> {
    const task = await readTask(taskId);
    if (task.status !== 'paused') {
        throw new Error(`Only paused tasks can be abandoned. Current status: ${task.status}`);
    }

    const queue = new FileQueue();
    return queue.abandon(taskId, options.reason ?? 'Task abandoned', options.actor);
}

export async function cancelTask(taskId: string, options: TaskActionOptions = {}): Promise<TaskMetadata> {
    const task = await readTask(taskId);
    if (task.status !== 'pending' && task.status !== 'not_queued') {
        throw new Error(`Only pending or not_queued tasks can be cancelled. Current status: ${task.status}`);
    }

    const queue = new FileQueue();
    await queue.moveTask(task, 'blocked');
    const persisted = await readTask(taskId);
    await appendSystemLog({
        event: 'task_cancelled',
        actor: options.actor,
        taskId: persisted.taskId,
        taskType: persisted.type,
        runner: persisted.runner,
        status: 'blocked',
        reason: options.reason ?? 'Task cancelled',
    });
    return persisted;
}

export async function stopTask(taskId: string, options: TaskActionOptions = {}): Promise<TaskMetadata> {
    const task = await readTask(taskId);
    if (task.status !== 'running') {
        throw new Error(`Only running tasks can be stopped. Current status: ${task.status}`);
    }
    if (!task.latestRunId) {
        throw new Error(`Running task has no latest run: ${taskId}`);
    }

    const reason = options.reason ?? 'Task stopped by user';
    await writeJson(taskRunStopRequestFile(task.taskId, task.latestRunId), {
        reason,
        actor: options.actor,
    });

    const runMeta = await readRunMeta(task.taskId, task.latestRunId).catch(() => null);
    if (runMeta?.runnerPid) {
        try {
            process.kill(runMeta.runnerPid, 'SIGTERM');
        } catch {
            // The orchestrator will still observe the stop request if the process has already exited.
        }
    }

    await appendSystemLog({
        event: 'task_stop_requested',
        actor: options.actor,
        taskId: task.taskId,
        taskType: task.type,
        runner: task.runner,
        runId: task.latestRunId,
        status: 'running',
        reason,
    });
    return readTask(taskId);
}

export async function clearHistory(options: TaskActionOptions & { statuses?: Array<'done' | 'blocked'> } = {}): Promise<{ removed: number }> {
    const statuses = new Set(options.statuses ?? ['done', 'blocked']);
    const tasks = (await listTasks()).filter(task => statuses.has(task.status as 'done' | 'blocked'));
    for (const task of tasks) {
        const queueStatus = await detectQueueStatus(task.taskId);
        if (queueStatus) await removeQueueTicket(queueStatus, task.taskId);
        await removeTaskRoot(task.taskId);
    }
    await appendSystemLog({
        event: 'task_history_cleared',
        actor: options.actor,
        status: Array.from(statuses).join(','),
        reason: `Removed ${tasks.length} historical task(s)`,
    });
    return { removed: tasks.length };
}

export async function removeTask(taskId: string, options: TaskActionOptions = {}): Promise<void> {
    const task = await readTask(taskId);
    if (task.status === 'running') {
        throw new Error(`Running tasks must be stopped before removal. Current status: ${task.status}`);
    }
    const queueStatus = await detectQueueStatus(task.taskId);
    if (queueStatus) await removeQueueTicket(queueStatus, task.taskId);
    await removeTaskRoot(task.taskId);
    await appendSystemLog({
        event: 'task_removed',
        actor: options.actor,
        taskId: task.taskId,
        taskType: task.type,
        runner: task.runner,
        status: task.status,
        reason: options.reason ?? 'Task removed',
    });
}
