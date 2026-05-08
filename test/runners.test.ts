import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { type RunnerContext } from '../src/runners/base.js';
import { type TaskMetadata } from '../src/types.js';

describe('runner registry', () => {
    it('registers the codex runner advertised by the CLI', async () => {
        const { getRunner } = await import('../src/runners/index.js');
        expect(() => getRunner('codex')).not.toThrow();
    });
});

describe('BaseRunner prompt', () => {
    const originalCwd = process.cwd();
    const originalRoot = process.env.DRIFT_ROOT;
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-work-'));
        process.env.DRIFT_ROOT = tempDir;
        vi.resetModules();
    });

    afterEach(async () => {
        process.chdir(originalCwd);
        process.env.DRIFT_ROOT = originalRoot;
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('injects the schedule shared-state path for scheduled tasks', async () => {
        const { BaseRunner } = await import('../src/runners/base.js');
        const { scheduleSharedStateDir } = await import('../src/paths.js');

        class CapturingRunner extends BaseRunner {
            prompt = '';

            protected async execute(prompt: string) {
                this.prompt = prompt;
                return {
                    result: {
                        status: 'success' as const,
                    },
                };
            }
        }

        const runner = new CapturingRunner();
        const task = makeTask({
            createdBy: {
                kind: 'schedule',
                sourceId: 'daily-research',
            },
        });

        await runner.run(task, makeContext());

        const sharedStateDir = scheduleSharedStateDir('daily-research');
        expect(runner.prompt).toContain('shared-state 目录');
        expect(runner.prompt).toContain(sharedStateDir);
        expect(runner.prompt).toContain('不要把 task.md 或任务材料文件当作运行期状态存储。');
        expect(runner.prompt).not.toContain('schedule-state.json');
        expect(runner.prompt).not.toContain('spec/');
        expect(runner.prompt).not.toContain('workdir');
        await expect(fs.access(sharedStateDir)).resolves.toBeUndefined();
    });

    it('injects a task-local shared-state path for non-scheduled tasks', async () => {
        const { BaseRunner } = await import('../src/runners/base.js');
        const { taskWorkdir } = await import('../src/paths.js');

        class CapturingRunner extends BaseRunner {
            prompt = '';

            protected async execute(prompt: string) {
                this.prompt = prompt;
                return {
                    result: {
                        status: 'success' as const,
                    },
                };
            }
        }

        const runner = new CapturingRunner();
        const task = makeTask({ createdBy: { kind: 'manual' } });

        await runner.run(task, makeContext());

        const sharedStateDir = taskWorkdir(task.taskId);
        expect(runner.prompt).toContain(sharedStateDir);
        expect(runner.prompt).toContain('shared-state 目录');
        expect(runner.prompt).toContain('如果任务的主要目的就是生成某种内容结果');
        expect(runner.prompt).toContain('默认应把最终内容落成当前工作目录内的文件');
        expect(runner.prompt).toContain('不要漏填 artifactRefs');
    });
});

describe('result contract', () => {
    it('rejects invalid agent-result status values', async () => {
        const { validateExecutionResult } = await import('../src/result-contract.js');

        expect(() => validateExecutionResult({ status: 'foo' }, '/tmp/workdir')).toThrow('Invalid agent-result.json');
    });

    it('rejects artifactRefs that escape the current workdir', async () => {
        const { validateExecutionResult } = await import('../src/result-contract.js');

        expect(() => validateExecutionResult({ status: 'success', artifactRefs: ['../escape.md'] }, '/tmp/workdir')).toThrow(
            'must stay inside the current workdir',
        );
    });
});

function makeContext(): RunnerContext {
    return {
        runMeta: {
            runId: 'run-1',
            taskId: 'task-1',
            runner: 'claude',
            trigger: 'initial',
            status: 'running',
            startedAt: '2026-04-21T09:00:00.000Z',
            logRefs: {
                stdout: 'stdout.log',
                stderr: 'stderr.log',
            },
        },
        runDir: '/tmp/run-1',
        registry: {
            getGuidePath: async () => null,
        } as RunnerContext['registry'],
    };
}

function makeTask(overrides: Partial<TaskMetadata> = {}): TaskMetadata {
    return {
        taskId: 'task-1',
        type: 'research',
        title: 'Test task',
        runner: 'claude',
        budgetUsd: 10,
        maxRetries: 1,
        timeoutMs: 1000,
        createdAt: '2026-04-21T09:00:00.000Z',
        createdBy: { kind: 'manual' },
        retryCount: 0,
        status: 'running',
        statusUpdatedAt: '2026-04-21T09:00:00.000Z',
        latestRunId: 'run-1',
        lastEnqueuedAt: '2026-04-21T09:00:00.000Z',
        lastStartedAt: '2026-04-21T09:00:00.000Z',
        lastFinishedAt: null,
        ...overrides,
    };
}
