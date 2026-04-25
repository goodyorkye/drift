import fs from 'node:fs/promises';
import cron from 'node-cron';
import { DEFAULT_BUDGET_USD, DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS } from './defaults.js';
import { generateTaskId } from './ids.js';
import { appendSystemLog } from './logging.js';
import { Registry } from './registry.js';
import { FileQueue } from './queue.js';
import {
    createEmptyScheduleState,
    ensureScheduleRoot,
    ensureTaskRoot,
    listSchedules,
    listTasks,
    readSchedule,
    readScheduleState,
    writeScheduleState,
} from './storage.js';
import { formatLocalIsoTimestamp } from './time.js';
import { scheduleSpecDir, taskSpecDir } from './paths.js';
import { type TaskMetadata } from './types.js';

const SYNC_INTERVAL_MS = 30_000;

export class Scheduler {
    private readonly queue = new FileQueue();
    private readonly registry = new Registry();
    private readonly jobs = new Map<string, { job: cron.ScheduledTask; cron: string }>();
    private registryLoaded = false;
    private syncTimer: NodeJS.Timeout | null = null;

    async start(): Promise<void> {
        await this.queue.ensureDirs();
        await this.ensureRegistryLoaded();
        await this.syncJobs();

        this.syncTimer = setInterval(() => {
            this.syncJobs().catch(() => {});
        }, SYNC_INTERVAL_MS);

        process.on('SIGTERM', () => this.stop());
        process.on('SIGINT', () => this.stop());
    }

    stop(): void {
        if (this.syncTimer) clearInterval(this.syncTimer);
        this.jobs.forEach(({ job }) => job.stop());
    }

    private async syncJobs(): Promise<void> {
        const schedules = await listSchedules();
        const enabledIds = new Set(schedules.filter(s => s.enabled).map(s => s.scheduleId));

        // 停用：已注册但不在 enabled 集合中
        for (const [scheduleId, entry] of this.jobs) {
            if (!enabledIds.has(scheduleId)) {
                entry.job.stop();
                this.jobs.delete(scheduleId);
            }
        }

        // 新增 / 重新启用 / cron 更新：enabled 且需要注册或重建
        for (const schedule of schedules) {
            if (!schedule.enabled) continue;
            const existing = this.jobs.get(schedule.scheduleId);
            if (existing && existing.cron === schedule.cron) continue;
            if (existing) {
                existing.job.stop();
                this.jobs.delete(schedule.scheduleId);
            }
            await ensureScheduleRoot(schedule.scheduleId);
            await this.ensureScheduleState(schedule.scheduleId);
            try {
                const job = cron.schedule(schedule.cron, async () => {
                    await this.enqueueFromSchedule(schedule.scheduleId);
                });
                this.jobs.set(schedule.scheduleId, { job, cron: schedule.cron });
            } catch (error) {
                await appendSystemLog({
                    event: 'schedule_invalid',
                    scheduleId: schedule.scheduleId,
                    reason: error instanceof Error ? error.message : 'Invalid cron expression',
                });
            }
        }
    }

    async enqueueFromSchedule(scheduleId: string): Promise<string | null> {
        await this.ensureRegistryLoaded();

        const schedule = await readSchedule(scheduleId);
        if (schedule.skipIfActive && (await this.isScheduleActive(scheduleId))) {
            const state = await this.ensureScheduleState(scheduleId);
            state.lastTriggeredAt = formatLocalIsoTimestamp();
            state.lastAction = 'skipped';
            state.stats.skipped += 1;
            await writeScheduleState(state);
            await appendSystemLog({ event: 'task_skipped', scheduleId });
            return null;
        }

        const taskType = this.registry.getType(schedule.type);
        const now = formatLocalIsoTimestamp();
        const taskId = generateTaskId();

        await ensureTaskRoot(taskId);
        await fs.mkdir(taskSpecDir(taskId), { recursive: true });
        await fs.cp(scheduleSpecDir(scheduleId), taskSpecDir(taskId), { recursive: true });

        const task: TaskMetadata = {
            taskId,
            type: schedule.type,
            title: schedule.title,
            runner: schedule.runner,
            budgetUsd: taskType.defaultBudgetUsd ?? DEFAULT_BUDGET_USD,
            maxRetries: taskType.defaultMaxRetries ?? DEFAULT_MAX_RETRIES,
            timeoutMs: taskType.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
            createdAt: now,
            createdBy: {
                kind: 'schedule',
                sourceId: scheduleId,
            },
            retryCount: 0,
            status: 'pending',
            statusUpdatedAt: now,
            latestRunId: null,
            lastEnqueuedAt: now,
            lastStartedAt: null,
            lastFinishedAt: null,
            ...(schedule.runnerEnv ? { runnerEnv: schedule.runnerEnv } : {}),
        };

        await this.queue.enqueue(task, now);

        const state = await this.ensureScheduleState(scheduleId);
        state.lastTriggeredAt = now;
        state.lastAction = 'triggered';
        state.lastTaskId = taskId;
        state.stats.triggered += 1;
        state.stats.createdTasks += 1;
        await writeScheduleState(state);

        await appendSystemLog({
            event: 'task_scheduled',
            scheduleId,
            taskId,
            taskType: task.type,
            runner: task.runner,
        });
        return taskId;
    }

    private async isScheduleActive(scheduleId: string): Promise<boolean> {
        const tasks = await listTasks();
        return tasks.some(
            task =>
                task.createdBy.kind === 'schedule' &&
                task.createdBy.sourceId === scheduleId &&
                ['pending', 'running', 'paused'].includes(task.status),
        );
    }

    private async ensureScheduleState(scheduleId: string) {
        const state = await readScheduleState(scheduleId).catch(async () => {
            const next = createEmptyScheduleState(scheduleId);
            await writeScheduleState(next);
            return next;
        });
        return state;
    }

    private async ensureRegistryLoaded(): Promise<void> {
        if (this.registryLoaded) return;
        await this.registry.load();
        this.registryLoaded = true;
    }
}
