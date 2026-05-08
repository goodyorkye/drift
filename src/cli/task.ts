import { type Command } from 'commander';
import { confirm, input, select } from '@inquirer/prompts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { cliActor } from '../core/actor.js';
import {
    abandonTask as abandonTaskAction,
    enqueueTask as enqueueTaskAction,
    removeTask as removeTaskAction,
    rerunTask as rerunTaskAction,
    resumeTask as resumeTaskAction,
} from '../core/task-actions.js';
import { inspectTaskDetails } from '../core/task-inspection.js';
import { buildCreationEntryHint, launchSpecCreationSession } from './creation.js';
import { DEFAULT_BUDGET_USD, DEFAULT_MAX_RETRIES, DEFAULT_RUNNER, DEFAULT_TIMEOUT_MS } from '../defaults.js';
import { generateTaskId } from '../ids.js';
import { taskSpecDir } from '../paths.js';
import { FileQueue } from '../queue.js';
import { DEFAULT_TASK_TYPE, Registry } from '../registry.js';
import { isRunnerAvailable, listAvailableRunners, listKnownRunners } from '../runners/index.js';
import {
    detectQueueStatus,
    ensureTaskSpec,
    listTasks,
    pathExists,
    readTask,
    writeTask,
} from '../storage.js';
import { formatLocalIsoTimestamp, formatTimestampForDisplay } from '../time.js';
import { type ExecutionResult, type RunnerName, type TaskMetadata } from '../types.js';

export function registerTaskCommands(program: Command): void {
    const task = program.command('task').description('Manage tasks');

    task.command('add').description('Create a new task').action(addTask);
    task.command('list').description('List tasks').option('--status <status>', 'Filter by status').action(listTaskItems);
    task.command('inspect <id>').description('Show task details, latest run, and artifacts').action(inspectTask);
    task.command('enqueue <id>').description('Enqueue a not_queued task').action(enqueueTask);
    task.command('remove <id>').description('Remove any non-running task').action(removeTask);
    task.command('resume <id>').description('Resume a paused task').action(resumeTask);
    task.command('abandon <id>').description('Abandon a paused task and move it to blocked').action(abandonTask);
    task.command('rerun <id>').description('Re-run a done or blocked task from scratch').action(rerunTask);
}

async function addTask(): Promise<void> {
    const registry = new Registry();
    await registry.load();
    const types = registry.listTypes();
    const availableRunners = await listAvailableRunners();
    const knownRunners = listKnownRunners();

    const type = await select({
        message: '选择任务类型',
        choices: types.map(taskType => ({
            name: `${taskType.label ?? taskType.type}  —  ${taskType.description}`,
            value: taskType.type,
        })),
        default: types.some(taskType => taskType.type === DEFAULT_TASK_TYPE) ? DEFAULT_TASK_TYPE : types[0]?.type,
    });

    const creationChoices = [
        ...availableRunners.map(runner => ({
            name: `使用 ${runner} 辅助创建`,
            value: runner,
        })),
        { name: '手工创建', value: 'manual' },
    ];

    const creationMethod = (await select({
        message: '选择创建方式',
        choices: creationChoices,
    })) as RunnerName | 'manual';

    const taskId = generateTaskId();
    const createdAt = formatLocalIsoTimestamp();
    await ensureTaskSpec(taskId);
    await fs.writeFile(path.join(taskSpecDir(taskId), 'task.md'), '');
    const taskType = registry.getType(type);

    if (creationMethod === 'manual') {
        console.log(`已创建任务目录：${taskSpecDir(taskId)}`);
        console.log('请编辑 spec/task.md，并按需将其他附加文件放入 spec/ 目录。');
        await input({ message: '编辑完成后按 Enter 继续检查' });
    } else {
        console.log(`即将进入 ${creationMethod} 创建会话，当前目录：${taskSpecDir(taskId)}`);
        console.log('请在会话中完成当前目录下的 task.md 和附加材料整理。退出会话后将继续当前流程。');
        for (const line of buildCreationEntryHint(taskType, 'task')) {
            console.log(line);
        }
        await launchCreationSession({
            method: creationMethod,
            taskId,
            taskType,
            guidePath: await registry.getGuidePath(type),
        });
    }

    if (!(await isValidTaskSpec(taskId))) {
        console.log(`任务未通过有效性检查，目录已保留：${taskSpecDir(taskId)}`);
        return;
    }

    const title = await input({ message: '任务标题' });
    if (availableRunners.length === 0) {
        console.log('当前未检测到可用 runner，将先创建任务并保留为 not_queued。安装 runner 后可再入队。');
    }
    const runner = (await select({
        message: '选择执行 runner',
        choices: knownRunners.map(name => ({
            name: availableRunners.includes(name) ? `${name}  (已检测到)` : `${name}  (当前未检测到)`,
            value: name,
        })),
        default: taskType.defaultRunner ?? DEFAULT_RUNNER,
    })) as RunnerName;

    console.log(`如需补充截图、参考资料等附加文件，请放入：${taskSpecDir(taskId)}`);
    await input({ message: '补充完成后按 Enter 继续' });

    const task: TaskMetadata = {
        taskId,
        type,
        title,
        runner,
        budgetUsd: taskType.defaultBudgetUsd ?? DEFAULT_BUDGET_USD,
        maxRetries: taskType.defaultMaxRetries ?? DEFAULT_MAX_RETRIES,
        timeoutMs: taskType.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
        createdAt,
        createdBy: { kind: creationMethod },
        retryCount: 0,
        status: 'not_queued',
        statusUpdatedAt: createdAt,
        latestRunId: null,
        lastEnqueuedAt: null,
        lastStartedAt: null,
        lastFinishedAt: null,
    };
    await writeTask(task);

    if (!(await isRunnerAvailable(runner))) {
        console.log(`任务已创建但未入队：${taskId}`);
        console.log(`当前未检测到 runner：${runner}。安装后可执行 drift task enqueue ${taskId} 入队。`);
        return;
    }

    const enqueue = await confirm({
        message: '是否立即加入队列？',
        default: true,
    });

    if (!enqueue) {
        console.log(`任务已创建但未入队：${taskId}`);
        return;
    }

    const queue = new FileQueue();
    await queue.ensureDirs();
    await queue.enqueue(await readTask(taskId));
    console.log(`✓ Task enqueued: ${taskId}`);
}

async function listTaskItems(opts: { status?: string }): Promise<void> {
    const tasks = await listTasks();
    const filtered = opts.status ? tasks.filter(task => task.status === opts.status) : tasks;

    if (filtered.length === 0) {
        console.log('No tasks found.');
        return;
    }

    for (const task of filtered) {
        console.log(`${task.taskId}  [${task.status}]  ${task.type}  ${task.title}`);
    }
}

async function removeTask(taskId: string): Promise<void> {
    await removeTaskAction(taskId, { actor: cliActor() });
    console.log(`✓ Removed: ${taskId}`);
}

async function enqueueTask(taskId: string): Promise<void> {
    await enqueueTaskAction(taskId, { actor: cliActor() });
    console.log(`✓ Task enqueued: ${taskId}`);
}

async function inspectTask(taskId: string): Promise<void> {
    const details = await inspectTaskDetails(taskId);
    const { task, queueStatus } = details;

    console.log(`Task: ${task.taskId}`);
    console.log(`Title: ${task.title}`);
    console.log(`Type: ${task.type}`);
    console.log(`Runner: ${task.runner}`);
    console.log(`Created By: ${formatCreatedBy(task)}`);
    console.log(`Task Status: ${task.status}`);
    console.log(`Queue Status: ${queueStatus ?? '-'}`);
    console.log(`Latest Run: ${task.latestRunId ?? '-'}`);
    console.log(`Retry Count: ${task.retryCount}/${task.maxRetries}`);
    console.log(`Created At: ${formatTimestampForDisplay(task.createdAt)}`);
    console.log(`Last Enqueued At: ${formatTimestampForDisplay(task.lastEnqueuedAt)}`);
    console.log(`Last Started At: ${formatTimestampForDisplay(task.lastStartedAt)}`);
    console.log(`Last Finished At: ${formatTimestampForDisplay(task.lastFinishedAt)}`);

    if (task.latestRunId && details.latestRun) {
        const { runMeta, result, artifacts } = details.latestRun;

        console.log('');
        console.log('Latest Run Details:');
        console.log(`  Run ID: ${task.latestRunId}`);
        console.log(`  Trigger: ${runMeta?.trigger ?? '-'}`);
        console.log(`  Run Status: ${runMeta?.status ?? '-'}`);
        console.log(`  Session Ref: ${runMeta?.sessionRef ?? '-'}`);
        console.log(`  Started At: ${formatTimestampForDisplay(runMeta?.startedAt)}`);
        console.log(`  Finished At: ${formatTimestampForDisplay(runMeta?.finishedAt)}`);
        console.log(`  Reason: ${result?.reason ?? runMeta?.reason ?? '-'}`);
        console.log(`  Result Status: ${result?.status ?? '-'}`);

        console.log('');
        console.log('Artifacts:');
        if (artifacts.length === 0) {
            console.log('  -');
        } else {
            for (const artifact of artifacts) {
                console.log(`  ${artifact}`);
            }
        }
        return;
    }

    console.log('');
    console.log('Latest Run Details:');
    console.log('  -');
}

async function resumeTask(taskId: string): Promise<void> {
    await resumeTaskAction(taskId, { actor: cliActor() });
    console.log(`✓ Resumed: ${taskId}`);
}

async function rerunTask(taskId: string): Promise<void> {
    await rerunTaskAction(taskId, { actor: cliActor() });
    console.log(`✓ Rerun enqueued: ${taskId}`);
}

async function abandonTask(taskId: string): Promise<void> {
    await abandonTaskAction(taskId, { actor: cliActor() });
    console.log(`✓ Abandoned: ${taskId}`);
}

async function isValidTaskSpec(taskId: string): Promise<boolean> {
    const file = path.join(taskSpecDir(taskId), 'task.md');
    if (!(await pathExists(file))) return false;
    const content = await fs.readFile(file, 'utf-8');
    return content.trim().length > 0;
}

async function launchCreationSession(args: {
    method: RunnerName;
    taskId: string;
    taskType: { type: string; label?: string; description: string };
    guidePath: string | null;
}): Promise<void> {
    const cwd = taskSpecDir(args.taskId);
    await launchSpecCreationSession({
        method: args.method,
        cwd,
        taskType: args.taskType,
        guidePath: args.guidePath,
        mode: 'task',
    });
}

function formatCreatedBy(task: TaskMetadata): string {
    if (!task.createdBy.sourceId) return task.createdBy.kind;
    return `${task.createdBy.kind} (${task.createdBy.sourceId})`;
}
