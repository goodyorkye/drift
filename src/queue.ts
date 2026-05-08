import { appendSystemLog } from './logging.js';
import {
    detectQueueStatus,
    ensureWorkspaceDirs,
    listQueueTickets,
    readTask,
    removeQueueTicket,
    resetWorkdir,
    transitionQueueTicket,
    writeQueueTicket,
    writeTask,
} from './storage.js';
import { formatLocalIsoTimestamp } from './time.js';
import { type ActorRef, type QueueStatus, type QueueTicket, type TaskMetadata } from './types.js';

export class FileQueue {
    async ensureDirs(): Promise<void> {
        await ensureWorkspaceDirs();
    }

    async enqueue(task: TaskMetadata, enteredAt: string = formatLocalIsoTimestamp()): Promise<void> {
        task.status = 'pending';
        task.statusUpdatedAt = enteredAt;
        task.lastEnqueuedAt = enteredAt;
        await writeTask(task);
        await writeQueueTicket('pending', { taskId: task.taskId, enteredAt });
    }

    async claimNextPending(): Promise<TaskMetadata | null> {
        const tickets = await listQueueTickets('pending');
        const ticket = tickets[0];
        if (!ticket) return null;

        const now = formatLocalIsoTimestamp();
        await transitionQueueTicket(ticket.taskId, 'pending', 'running', now);
        return readTask(ticket.taskId);
    }

    async moveTask(task: TaskMetadata, to: QueueStatus, enteredAt: string = formatLocalIsoTimestamp()): Promise<void> {
        const from = await detectQueueStatus(task.taskId);
        if (!from) {
            await writeQueueTicket(to, { taskId: task.taskId, enteredAt });
        } else if (from !== to) {
            await transitionQueueTicket(task.taskId, from, to, enteredAt);
        } else {
            await writeQueueTicket(to, { taskId: task.taskId, enteredAt });
        }

        task.status = to;
        task.statusUpdatedAt = enteredAt;
        if (to === 'pending') task.lastEnqueuedAt = enteredAt;
        await writeTask(task);
    }

    async rerun(taskId: string): Promise<TaskMetadata> {
        const task = await readTask(taskId);
        if (task.status !== 'done' && task.status !== 'blocked') {
            throw new Error(`Only done or blocked tasks can be rerun. Current status: ${task.status}`);
        }
        task.retryCount = 0;
        await resetWorkdir(task.taskId);
        await this.moveTask(task, 'pending');
        return readTask(taskId);
    }

    async resume(taskId: string): Promise<TaskMetadata> {
        const task = await readTask(taskId);
        await this.moveTask(task, 'pending');
        return readTask(taskId);
    }

    async abandon(taskId: string, reason: string = 'Task abandoned', actor?: ActorRef): Promise<TaskMetadata> {
        const task = await readTask(taskId);
        await this.moveTask(task, 'blocked');
        await appendSystemLog({
            event: 'task_status',
            actor,
            taskId: task.taskId,
            taskType: task.type,
            status: 'blocked',
            reason,
        });
        return readTask(taskId);
    }

    async list(status: QueueStatus): Promise<Array<QueueTicket & { task: TaskMetadata }>> {
        const tickets = await listQueueTickets(status);
        const tasks = await Promise.all(
            tickets.map(async ticket => ({
                ...ticket,
                task: await readTask(ticket.taskId),
            })),
        );
        return tasks;
    }

    async remove(taskId: string): Promise<void> {
        const status = await detectQueueStatus(taskId);
        if (status) {
            await removeQueueTicket(status, taskId);
        }
    }
}
