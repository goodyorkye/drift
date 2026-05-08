import { execa } from 'execa';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { taskWorkdir } from '../paths.js';
import { validateExecutionResult } from '../result-contract.js';
import { type TaskMetadata } from '../types.js';
import { type RunnerContext, type RunnerExecutionOutput } from './base.js';
import { BaseRunner } from './base.js';
import { pathExists, readJson, updateRunMeta } from '../storage.js';

export class CodexRunner extends BaseRunner {
    protected async execute(prompt: string, task: TaskMetadata, context: RunnerContext): Promise<RunnerExecutionOutput> {
        const stdoutPath = path.join(context.runDir, 'stdout.log');
        const stderrPath = path.join(context.runDir, 'stderr.log');
        await fs.mkdir(context.runDir, { recursive: true });

        const stdoutStream = fsSync.createWriteStream(stdoutPath);
        const stderrStream = fsSync.createWriteStream(stderrPath);

        const subprocess = execa('codex', ['exec', '--full-auto', '--skip-git-repo-check', '-'], {
            cwd: taskWorkdir(task.taskId),
            input: prompt,
            timeout: task.timeoutMs,
            stdout: 'pipe',
            stderr: 'pipe',
            env: { ...process.env, ...task.runnerEnv },
        });

        subprocess.stdout?.pipe(stdoutStream);
        subprocess.stderr?.pipe(stderrStream);
        if (subprocess.pid) {
            await updateRunMeta(task.taskId, context.runMeta.runId, { runnerPid: subprocess.pid });
        }

        let sessionRef: string | undefined;

        subprocess.stdout?.on('data', chunk => {
            const text = chunk.toString();
            const match = text.match(/session[^a-zA-Z0-9_-]*([a-zA-Z0-9_-]{8,})/i);
            if (!sessionRef && match?.[1]) sessionRef = match[1];
        });

        try {
            await subprocess;
        } finally {
            await Promise.all([
                new Promise<void>(resolve => stdoutStream.end(resolve)),
                new Promise<void>(resolve => stderrStream.end(resolve)),
            ]);
        }

        return {
            result: await this.readResult(task),
            sessionRef,
        };
    }

    private async readResult(task: TaskMetadata) {
        const resultFile = path.join(taskWorkdir(task.taskId), 'agent-result.json');
        if (!(await pathExists(resultFile))) {
            return { status: 'error' as const, reason: 'Agent did not write agent-result.json' };
        }
        return validateExecutionResult(await readJson<unknown>(resultFile), taskWorkdir(task.taskId));
    }
}
