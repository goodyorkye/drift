import { type Command } from 'commander';
import { confirm, input, select } from '@inquirer/prompts';
import fs from 'node:fs/promises';
import path from 'node:path';
import cron from 'node-cron';
import { buildCreationEntryHint, launchSpecCreationSession } from './creation.js';
import { FileQueue } from '../queue.js';
import { DEFAULT_TASK_TYPE, Registry } from '../registry.js';
import { scheduleRoot, scheduleSpecDir, taskSpecDir } from '../paths.js';
import { isRunnerAvailable, listAvailableRunners, listKnownRunners } from '../runners/index.js';
import { Scheduler } from '../scheduler.js';
import {
    createEmptyScheduleState,
    ensureScheduleSpec,
    listSchedules,
    pathExists,
    listTasks,
    detectQueueStatus,
    removeQueueTicket,
    readSchedule,
    readScheduleState,
    readTask,
    removeScheduleRoot,
    removeTaskRoot,
    writeSchedule,
    writeScheduleState,
} from '../storage.js';
import { formatTimestampForDisplay } from '../time.js';
import { type RunnerName, type ScheduleConfig, type TaskMetadata, type TaskType } from '../types.js';

export function registerScheduleCommands(program: Command): void {
    const schedule = program.command('schedule').description('Manage schedules');

    schedule.command('list').description('List schedules').action(listScheduleItems);
    schedule.command('add').description('Create a new schedule').action(addSchedule);
    schedule.command('enable <id>').description('Enable a schedule').action(id => setEnabled(id, true));
    schedule.command('disable <id>').description('Disable a schedule').action(id => setEnabled(id, false));
    schedule.command('run <id>').description('Trigger a schedule immediately').action(runScheduleNow);
    schedule
        .command('clear-tasks <id>')
        .description('Remove all task instance directories created by a schedule')
        .option('-y, --yes', 'Skip confirmation prompt')
        .action(clearScheduleTasks);
    schedule.command('remove <id>').description('Remove a schedule').action(removeSchedule);
}

async function listScheduleItems(): Promise<void> {
    const schedules = await listSchedules();
    if (schedules.length === 0) {
        console.log('No schedules configured.');
        return;
    }

    for (const schedule of schedules) {
        const state = await readScheduleState(schedule.scheduleId).catch(() => null);
        console.log(`${schedule.scheduleId}  [${schedule.enabled ? 'enabled' : 'disabled'}]  ${schedule.cron}`);
        console.log(`  ${schedule.type}  ${schedule.runner}  ${schedule.title}`);
        console.log(
            `  lastTriggered: ${formatTimestampForDisplay(state?.lastTriggeredAt)}  lastAction: ${state?.lastAction ?? '-'}  lastRun: ${state?.lastRunStatus ?? '-'}`,
        );
    }
}

async function addSchedule(): Promise<void> {
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
    const taskType = registry.getType(type);

    const specSource = (await select({
        message: '选择如何准备 spec/',
        choices: [
            { name: '从已有任务复制', value: 'existing' },
            ...availableRunners.map(runner => ({
                name: `使用 ${runner} 辅助生成`,
                value: runner,
            })),
            { name: '手工创建', value: 'manual' },
        ],
    })) as 'existing' | RunnerName | 'manual';

    let sourceTask: TaskMetadata | null = null;
    if (specSource === 'existing') {
        const sourceTaskId = await chooseExistingTaskId();
        sourceTask = await readTask(sourceTaskId);
    }

    const scheduleId = await input({ message: 'scheduleId（slug）', validate: validateScheduleId });

    await ensureScheduleSpec(scheduleId);
    await fs.writeFile(path.join(scheduleSpecDir(scheduleId), 'task.md'), '');

    let inheritedRunner: RunnerName | null = null;
    if (specSource === 'existing') {
        if (!sourceTask) {
            throw new Error('Missing source task for existing spec copy.');
        }
        inheritedRunner = sourceTask.runner;
        await fs.rm(scheduleSpecDir(scheduleId), { recursive: true, force: true });
        await fs.mkdir(scheduleSpecDir(scheduleId), { recursive: true });
        await fs.cp(taskSpecDir(sourceTask.taskId), scheduleSpecDir(scheduleId), { recursive: true });
    } else if (specSource === 'manual') {
        console.log(`已创建 schedule spec 目录：${scheduleSpecDir(scheduleId)}`);
        console.log('请编辑 spec/task.md，并按需放入附加文件。');
        await input({ message: '编辑完成后按 Enter 继续检查' });
    } else {
        console.log(`即将进入 ${specSource} 创建会话，当前目录：${scheduleSpecDir(scheduleId)}`);
        console.log('请在会话中完成当前目录下的 task.md 和附加材料整理。退出会话后将继续当前流程。');
        for (const line of buildCreationEntryHint(taskType, 'schedule')) {
            console.log(line);
        }
        await launchSpecCreationSession({
            method: specSource,
            cwd: scheduleSpecDir(scheduleId),
            taskType,
            guidePath: await registry.getGuidePath(type),
            mode: 'schedule',
        });
    }

    if (!(await isValidTaskMarkdown(path.join(scheduleSpecDir(scheduleId), 'task.md')))) {
        console.log(`schedule spec 未通过有效性检查，目录已保留：${scheduleSpecDir(scheduleId)}`);
        return;
    }

    const title = await input({
        message: '定时任务标题',
        default: sourceTask?.title,
    });

    const cron = await input({
        message: 'Cron 表达式',
        validate: validateCronExpression,
        default: '0 * * * *',
    });

    let runner: RunnerName;
    if (inheritedRunner) {
        const keepInherited = await confirm({
            message: `是否继承已有任务的执行 runner（${inheritedRunner}）？`,
            default: true,
        });
        runner = keepInherited
            ? inheritedRunner
            : ((await select({
                  message: '选择执行 runner',
                  choices: knownRunners.map(name => ({
                      name: availableRunners.includes(name) ? `${name}  (已检测到)` : `${name}  (当前未检测到)`,
                      value: name,
                  })),
              })) as RunnerName);
    } else {
        runner = (await select({
            message: '选择执行 runner',
            choices: knownRunners.map(name => ({
                name: availableRunners.includes(name) ? `${name}  (已检测到)` : `${name}  (当前未检测到)`,
                value: name,
            })),
        })) as RunnerName;
    }

    const runnerEnv = await selectRunnerEnvPreset(taskType, sourceTask);
    const skipIfActive = await confirm({ message: 'skipIfActive?', default: true });
    const runnerInstalled = await isRunnerAvailable(runner);
    if (!runnerInstalled) {
        console.log(`当前未检测到 runner：${runner}。本次 schedule 将强制创建为 disabled，安装后再 enable。`);
    }
    const enabled =
        runnerInstalled &&
        (await confirm({
            message: '创建后立即启用？',
            default: true,
        }));

    printScheduleSummary({
        scheduleId,
        type,
        title,
        specSource,
        sourceTask,
        runner,
        runnerEnv,
        cron,
        skipIfActive,
        enabled,
    });
    const confirmed = await confirm({
        message: '确认创建这个 schedule？',
        default: true,
    });
    if (!confirmed) {
        console.log(`已取消创建，目录已保留：${scheduleSpecDir(scheduleId)}`);
        return;
    }

    const schedule: ScheduleConfig = {
        scheduleId,
        type,
        title,
        runner,
        cron,
        skipIfActive,
        enabled,
        ...(runnerEnv ? { runnerEnv } : {}),
    };

    await writeSchedule(schedule);
    await writeScheduleState(createEmptyScheduleState(scheduleId));
    console.log(`✓ Schedule created: ${scheduleId}`);
}

async function setEnabled(scheduleId: string, enabled: boolean): Promise<void> {
    const schedule = await readSchedule(scheduleId);
    schedule.enabled = enabled;
    await writeSchedule(schedule);
    console.log(`✓ Schedule ${scheduleId} ${enabled ? 'enabled' : 'disabled'}`);
}

async function runScheduleNow(scheduleId: string): Promise<void> {
    const scheduler = new Scheduler();
    const taskId = await scheduler.enqueueFromSchedule(scheduleId);
    if (taskId) {
        console.log(`✓ Schedule ${scheduleId} triggered: ${taskId}`);
        return;
    }
    console.log(`- Schedule ${scheduleId} skipped: skipIfActive is enabled and an active task already exists`);
}

async function removeSchedule(scheduleId: string): Promise<void> {
    await removeScheduleRoot(scheduleId);
    console.log(`✓ Removed schedule: ${scheduleId}`);
}

async function clearScheduleTasks(scheduleId: string, opts: { yes?: boolean }): Promise<void> {
    await readSchedule(scheduleId);

    const tasks = (await listTasks()).filter(task => task.createdBy.kind === 'schedule' && task.createdBy.sourceId === scheduleId);
    if (tasks.length === 0) {
        console.log(`No task instances found for schedule: ${scheduleId}`);
        return;
    }

    const activeTasks = tasks.filter(task => ['pending', 'running', 'paused'].includes(task.status));
    if (activeTasks.length > 0) {
        const details = activeTasks.map(task => `${task.taskId} [${task.status}]`).join(', ');
        throw new Error(`Cannot clear tasks for schedule ${scheduleId} while active instances exist: ${details}`);
    }

    if (!opts.yes) {
        const confirmed = await confirm({
            message: `确认删除 schedule ${scheduleId} 创建的 ${tasks.length} 个任务实例目录？`,
            default: false,
        });
        if (!confirmed) {
            console.log('已取消。');
            return;
        }
    }

    const queue = new FileQueue();
    await queue.ensureDirs();

    for (const task of tasks) {
        const queueStatus = await detectQueueStatus(task.taskId);
        if (queueStatus) {
            await removeQueueTicket(queueStatus, task.taskId);
        }
        await removeTaskRoot(task.taskId);
    }

    const state = await readScheduleState(scheduleId).catch(() => null);
    if (state && state.lastTaskId && tasks.some(task => task.taskId === state.lastTaskId)) {
        state.lastTaskId = null;
        await writeScheduleState(state);
    }

    console.log(`✓ Cleared ${tasks.length} task instance(s) for schedule: ${scheduleId}`);
}

async function chooseExistingTaskId(): Promise<string> {
    const tasks = await listTasks();
    if (tasks.length === 0) {
        throw new Error('No existing tasks available to copy from.');
    }

    return select({
        message: '选择来源任务',
        choices: tasks.map(task => ({
            name: `${task.taskId}  [${task.status}]  ${task.title}`,
            value: task.taskId,
        })),
    });
}

async function selectRunnerEnvPreset(taskType: TaskType, sourceTask: TaskMetadata | null): Promise<Record<string, string> | undefined> {
    const presetChoices: Array<{ name: string; value: string }> = [{ name: '不设置 runnerEnv', value: '__none__' }];
    const presetMap = new Map<string, Record<string, string>>();

    if (sourceTask?.runnerEnv && Object.keys(sourceTask.runnerEnv).length > 0) {
        const inheritedKey = '__inherit_source__';
        presetChoices.push({
            name: '继承来源任务 runnerEnv',
            value: inheritedKey,
        });
        presetMap.set(inheritedKey, sourceTask.runnerEnv);
    }

    for (const preset of taskType.runnerEnvPresets ?? []) {
        const key = `preset:${preset.name}`;
        presetChoices.push({
            name: preset.name,
            value: key,
        });
        presetMap.set(key, preset.env);
    }

    if (presetChoices.length === 1) return undefined;

    const selected = await select({
        message: '选择 runnerEnv 预设',
        choices: presetChoices,
        default: sourceTask?.runnerEnv ? '__inherit_source__' : '__none__',
    });

    if (selected === '__none__') return undefined;
    return presetMap.get(selected);
}

export async function validateScheduleId(value: string): Promise<true | string> {
    if (!/^[a-z0-9-]+$/.test(value)) {
        return 'scheduleId 只允许小写字母、数字和 -';
    }
    if (await pathExists(scheduleRoot(value))) {
        return `scheduleId 已存在：${value}`;
    }
    return true;
}

export function validateCronExpression(value: string): true | string {
    return cron.validate(value) ? true : 'Cron 表达式无效';
}

function formatEnvInline(env: Record<string, string>): string {
    return Object.entries(env)
        .map(([key, value]) => `${key}=${value}`)
        .join(', ');
}

function printScheduleSummary(args: {
    scheduleId: string;
    type: string;
    title: string;
    specSource: 'existing' | RunnerName | 'manual';
    sourceTask: TaskMetadata | null;
    runner: RunnerName;
    runnerEnv?: Record<string, string>;
    cron: string;
    skipIfActive: boolean;
    enabled: boolean;
}): void {
    console.log('');
    console.log('创建摘要：');
    console.log(`  scheduleId: ${args.scheduleId}`);
    console.log(`  type: ${args.type}`);
    console.log(`  title: ${args.title}`);
    console.log(`  spec 来源: ${formatSpecSource(args.specSource, args.sourceTask)}`);
    console.log(`  runner: ${args.runner}`);
    console.log(`  runnerEnv: ${args.runnerEnv ? formatEnvInline(args.runnerEnv) : '-'}`);
    console.log(`  cron: ${args.cron}`);
    console.log(`  skipIfActive: ${args.skipIfActive}`);
    console.log(`  enabled: ${args.enabled}`);
}

function formatSpecSource(specSource: 'existing' | RunnerName | 'manual', sourceTask: TaskMetadata | null): string {
    if (specSource === 'existing') {
        return sourceTask ? `从已有任务复制 (${sourceTask.taskId})` : '从已有任务复制';
    }
    if (specSource === 'manual') return '手工创建';
    return `使用 ${specSource} 辅助生成`;
}

async function isValidTaskMarkdown(file: string): Promise<boolean> {
    try {
        const content = await fs.readFile(file, 'utf-8');
        return content.trim().length > 0;
    } catch {
        return false;
    }
}
