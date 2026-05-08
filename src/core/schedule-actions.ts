import { appendSystemLog } from '../logging.js';
import { FileQueue } from '../queue.js';
import { Scheduler } from '../scheduler.js';
import {
    detectQueueStatus,
    listTasks,
    readSchedule,
    readScheduleState,
    removeQueueTicket,
    removeScheduleRoot,
    removeTaskRoot,
    writeSchedule,
    writeScheduleState,
} from '../storage.js';
import { type ActorRef, type ScheduleConfig } from '../types.js';

export interface ScheduleActionOptions {
    actor?: ActorRef;
}

export async function setScheduleEnabled(scheduleId: string, enabled: boolean, options: ScheduleActionOptions = {}): Promise<ScheduleConfig> {
    const schedule = await readSchedule(scheduleId);
    schedule.enabled = enabled;
    await writeSchedule(schedule);
    await appendSystemLog({
        event: enabled ? 'schedule_enabled' : 'schedule_disabled',
        actor: options.actor,
        scheduleId,
        status: enabled ? 'enabled' : 'disabled',
    });
    return schedule;
}

export async function runScheduleNow(scheduleId: string, options: ScheduleActionOptions = {}): Promise<{ taskId: string | null }> {
    const scheduler = new Scheduler();
    const taskId = await scheduler.enqueueFromSchedule(scheduleId);
    await appendSystemLog({
        event: taskId ? 'schedule_run_requested' : 'schedule_run_skipped',
        actor: options.actor,
        scheduleId,
        taskId: taskId ?? undefined,
    });
    return { taskId };
}

export async function removeSchedule(scheduleId: string, options: ScheduleActionOptions = {}): Promise<void> {
    await readSchedule(scheduleId);
    await removeScheduleRoot(scheduleId);
    await appendSystemLog({
        event: 'schedule_removed',
        actor: options.actor,
        scheduleId,
    });
}

export async function clearScheduleTasks(scheduleId: string, options: ScheduleActionOptions = {}): Promise<{ removed: number }> {
    await readSchedule(scheduleId);
    const tasks = (await listTasks()).filter(task => task.createdBy.kind === 'schedule' && task.createdBy.sourceId === scheduleId);
    const activeTasks = tasks.filter(task => ['pending', 'running', 'paused'].includes(task.status));
    if (activeTasks.length > 0) {
        const details = activeTasks.map(task => `${task.taskId} [${task.status}]`).join(', ');
        throw new Error(`Cannot clear tasks for schedule ${scheduleId} while active instances exist: ${details}`);
    }

    const queue = new FileQueue();
    await queue.ensureDirs();

    for (const task of tasks) {
        const queueStatus = await detectQueueStatus(task.taskId);
        if (queueStatus) await removeQueueTicket(queueStatus, task.taskId);
        await removeTaskRoot(task.taskId);
    }

    const state = await readScheduleState(scheduleId).catch(() => null);
    if (state && state.lastTaskId && tasks.some(task => task.taskId === state.lastTaskId)) {
        state.lastTaskId = null;
        await writeScheduleState(state);
    }

    await appendSystemLog({
        event: 'schedule_tasks_cleared',
        actor: options.actor,
        scheduleId,
        reason: `Removed ${tasks.length} task instance(s)`,
    });
    return { removed: tasks.length };
}
