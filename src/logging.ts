import fs from 'node:fs/promises';
import path from 'node:path';
import { LOGS_DIR } from './paths.js';
import { formatLocalDate, formatLocalIsoTimestamp, formatLocalTime } from './time.js';
import { type LogEntry } from './types.js';

export async function appendSystemLog(entry: Omit<LogEntry, 'ts'>): Promise<void> {
    const ts = formatLocalIsoTimestamp();
    const file = path.join(LOGS_DIR, 'system', `${formatLocalDate(new Date(ts))}.jsonl`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, JSON.stringify({ ts, ...entry }) + '\n');
}

export function formatSystemLogLine(entry: LogEntry): string {
    const time = entry.ts ? formatLocalTime(new Date(entry.ts)) : '';
    const target = entry.taskId ? `[${entry.taskId}]` : entry.scheduleId ? `[${entry.scheduleId}]` : '';
    const detail = entry.reason ?? entry.status ?? entry.runId ?? '';
    return `${time}  ${(entry.event ?? '').padEnd(20)} ${target} ${detail}`.trimEnd();
}
