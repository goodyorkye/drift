import { type Command } from 'commander';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Orchestrator } from '../orchestrator.js';
import { LOGS_DIR } from '../paths.js';
import { Scheduler } from '../scheduler.js';
import { formatLocalDate } from '../time.js';
import { listTasks } from '../storage.js';
import { formatSystemLogLine } from '../logging.js';

const PID_FILE = path.join(os.tmpdir(), 'drift-work.pid');

export function registerProcessCommands(program: Command): void {
    program.command('start').description('Start the orchestrator and scheduler').action(startProcess);
    program.command('stop').description('Stop the process').action(stopProcess);
    program.command('status').description('Show process status').action(showStatus);
    program.command('logs').description('Show recent logs').option('--tail <n>', 'Number of lines to show', '20').action(showLogs);
}

async function startProcess(): Promise<void> {
    if (await isRunning()) {
        const pid = await fs.readFile(PID_FILE, 'utf-8');
        console.log(`Already running (PID: ${pid.trim()})`);
        return;
    }

    await fs.writeFile(PID_FILE, String(process.pid));
    process.on('exit', () => fs.unlink(PID_FILE).catch(() => {}));

    const scheduler = new Scheduler();
    await scheduler.start();

    const orchestrator = new Orchestrator();
    console.log(`Started Drift (PID: ${process.pid}). Scheduler is active and the queue watcher is running.`);
    console.log('Use `drift status`, `drift logs`, or `drift stop` from another terminal to manage it.');
    await orchestrator.start();
}

async function stopProcess(): Promise<void> {
    if (!(await isRunning())) {
        console.log('Not running.');
        return;
    }

    const pid = parseInt(await fs.readFile(PID_FILE, 'utf-8'), 10);
    process.kill(pid, 'SIGTERM');
    await fs.unlink(PID_FILE).catch(() => {});
    console.log(`Stopped (PID: ${pid}). Running tasks will be recovered on next start.`);
}

async function showStatus(): Promise<void> {
    if (await isRunning()) {
        const pid = await fs.readFile(PID_FILE, 'utf-8');
        console.log(`Status: running (PID: ${pid.trim()})`);
    } else {
        console.log('Status: stopped');
    }

    const tasks = await listTasks();
    const counts = new Map<string, number>();
    for (const task of tasks) {
        counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
    }

    console.log('\nTasks:');
    for (const status of ['not_queued', 'pending', 'running', 'paused', 'blocked', 'done']) {
        console.log(`  ${status.padEnd(12)} ${counts.get(status) ?? 0}`);
    }
}

async function showLogs(opts: { tail: string }): Promise<void> {
    const file = path.join(LOGS_DIR, 'system', `${formatLocalDate()}.jsonl`);

    try {
        const raw = await fs.readFile(file, 'utf-8');
        const lines = raw.trim().split('\n').filter(Boolean);
        const tail = Math.max(1, parseInt(opts.tail, 10));
        for (const line of lines.slice(-tail)) {
            console.log(formatSystemLogLine(JSON.parse(line)));
        }
    } catch {
        console.log('No logs found for today.');
    }
}

async function isRunning(): Promise<boolean> {
    try {
        const pid = parseInt(await fs.readFile(PID_FILE, 'utf-8'), 10);
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}
