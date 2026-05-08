import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { formatSystemLogLine } from '../logging.js';
import { LOGS_DIR } from '../paths.js';
import { listTasks } from '../storage.js';
import { formatLocalDate } from '../time.js';

const PID_FILE = path.join(os.tmpdir(), 'drift-work.pid');

export async function getProcessStatus(): Promise<{ running: boolean; pid: number | null; counts: Record<string, number> }> {
    const pid = await readRunningPid();
    const counts: Record<string, number> = {};
    for (const task of await listTasks()) {
        counts[task.status] = (counts[task.status] ?? 0) + 1;
    }
    for (const status of ['not_queued', 'pending', 'running', 'paused', 'blocked', 'done']) {
        counts[status] = counts[status] ?? 0;
    }
    return { running: pid !== null, pid, counts };
}

export async function readSystemLogs(tail = 20): Promise<string[]> {
    const file = path.join(LOGS_DIR, 'system', `${formatLocalDate()}.jsonl`);
    const raw = await fs.readFile(file, 'utf-8').catch(() => '');
    return raw
        .trim()
        .split('\n')
        .filter(Boolean)
        .slice(-Math.max(1, tail))
        .map(line => formatSystemLogLine(JSON.parse(line)));
}

export async function readRunningPid(): Promise<number | null> {
    try {
        const pid = parseInt(await fs.readFile(PID_FILE, 'utf-8'), 10);
        process.kill(pid, 0);
        return pid;
    } catch {
        return null;
    }
}
