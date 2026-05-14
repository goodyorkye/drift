import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export const PACKAGE_ROOT = path.resolve(MODULE_DIR, '..');
export const PROJECT_ROOT = path.resolve(process.env.DRIFT_ROOT ?? process.cwd());

export const WORKSPACE_DIR = path.join(PROJECT_ROOT, 'workspace');
export const QUEUE_DIR = path.join(WORKSPACE_DIR, 'queue');
export const TASKS_DIR = path.join(WORKSPACE_DIR, 'tasks');
export const SCHEDULES_DIR = path.join(WORKSPACE_DIR, 'schedules');
export const LOGS_DIR = path.join(WORKSPACE_DIR, 'logs');
export const DRAFTS_DIR = path.join(WORKSPACE_DIR, 'drafts');
export const TASK_DRAFTS_DIR = path.join(DRAFTS_DIR, 'tasks');
export const SCHEDULE_DRAFTS_DIR = path.join(DRAFTS_DIR, 'schedules');

export const BUILTIN_TASK_TYPES_DIR = path.join(PACKAGE_ROOT, 'task-types');
export const TASK_TYPES_DIR = path.join(PROJECT_ROOT, 'task-types');

export function taskRoot(taskId: string): string {
    return path.join(TASKS_DIR, taskId);
}

export function taskSpecDir(taskId: string): string {
    return path.join(taskRoot(taskId), 'spec');
}

export function taskWorkdir(taskId: string): string {
    return path.join(taskRoot(taskId), 'workdir');
}

export function taskRunsDir(taskId: string): string {
    return path.join(taskRoot(taskId), 'runs');
}

export function taskRunDir(taskId: string, runId: string): string {
    return path.join(taskRunsDir(taskId), runId);
}

export function taskRunStopRequestFile(taskId: string, runId: string): string {
    return path.join(taskRunDir(taskId, runId), 'stop-request.json');
}

export function taskManagedArtifactsDir(taskId: string): string {
    return path.join(taskRoot(taskId), 'managed-artifacts');
}

export function taskFile(taskId: string): string {
    return path.join(taskRoot(taskId), 'task.json');
}

export function taskDraftRoot(draftId: string): string {
    return path.join(TASK_DRAFTS_DIR, draftId);
}

export function taskDraftSpecDir(draftId: string): string {
    return path.join(taskDraftRoot(draftId), 'spec');
}

export function taskDraftMetaFile(draftId: string): string {
    return path.join(taskDraftRoot(draftId), 'draft.json');
}

export function scheduleDraftRoot(draftId: string): string {
    return path.join(SCHEDULE_DRAFTS_DIR, draftId);
}

export function scheduleDraftSpecDir(draftId: string): string {
    return path.join(scheduleDraftRoot(draftId), 'spec');
}

export function scheduleDraftMetaFile(draftId: string): string {
    return path.join(scheduleDraftRoot(draftId), 'draft.json');
}

export function queueStatusDir(status: string): string {
    return path.join(QUEUE_DIR, status);
}

export function queueTicketFile(status: string, taskId: string): string {
    return path.join(queueStatusDir(status), `${taskId}.json`);
}

export function scheduleRoot(scheduleId: string): string {
    return path.join(SCHEDULES_DIR, scheduleId);
}

export function scheduleSpecDir(scheduleId: string): string {
    return path.join(scheduleRoot(scheduleId), 'spec');
}

export function scheduleSharedStateDir(scheduleId: string): string {
    return path.join(scheduleRoot(scheduleId), 'shared-state');
}

export function scheduleFile(scheduleId: string): string {
    return path.join(scheduleRoot(scheduleId), 'schedule.json');
}

export function scheduleStateFile(scheduleId: string): string {
    return path.join(scheduleRoot(scheduleId), 'schedule-state.json');
}
