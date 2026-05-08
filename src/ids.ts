import { formatLocalSecondStampCompact } from './time.js';

function timestampPrefix(date: Date = new Date(), timeZone?: string): string {
    return formatLocalSecondStampCompact(date, timeZone);
}

function randomSuffix(length: number = 10): string {
    return Math.random().toString(36).slice(2, 2 + length).padEnd(length, '0');
}

export function generateTaskId(date?: Date, timeZone?: string): string {
    return `task_${timestampPrefix(date, timeZone)}_${randomSuffix(8)}`;
}

export function generateRunId(date?: Date, timeZone?: string): string {
    return `run_${timestampPrefix(date, timeZone)}_${randomSuffix(8)}`;
}

export function generateDraftId(date?: Date, timeZone?: string): string {
    return `draft_${timestampPrefix(date, timeZone)}_${randomSuffix(8)}`;
}
