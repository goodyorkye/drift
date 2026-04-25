import path from 'node:path';
import { execa } from 'execa';
import { type RunnerName } from '../types.js';

export type CreationMode = 'task' | 'schedule';

export interface CreationPromptTaskType {
    type: string;
    label?: string;
    description: string;
}

export async function launchSpecCreationSession(args: {
    method: RunnerName;
    cwd: string;
    taskType: CreationPromptTaskType;
    guidePath: string | null;
    mode: CreationMode;
}): Promise<void> {
    const systemPrompt = buildCreationPrompt(args.taskType, args.guidePath, args.mode);
    const kickoffPrompt = buildCreationKickoffPrompt(args.taskType, args.mode);
    const commandArgs = buildCreationCommandArgs(args.method, systemPrompt, kickoffPrompt, args.cwd, args.guidePath);

    await execa(args.method, commandArgs, {
        cwd: args.cwd,
        stdio: 'inherit',
    });
}

export function buildCreationPrompt(
    taskType: CreationPromptTaskType,
    guidePath: string | null,
    mode: CreationMode,
): string {
    const sharedStateNote =
        mode === 'schedule'
            ? '如果任务需要跨次执行记忆，只说明执行期可使用系统注入的 schedule shared-state 目录保存业务状态；不要写死具体绝对路径。'
            : '如果用户讨论跨次执行记忆或持续上下文，只把它整理成任务需求，不要替任务管理器设计状态存储方案。';

    const lines = [
        '你当前不是在执行任务，而是在帮助用户创建一份任务定义文件。',
        '',
        '工作边界：',
        '- 你只能围绕当前目录工作；当前目录就是本次要整理的任务材料目录。',
        '- 不要读取、搜索或引用当前目录之外的项目文件。',
        '- 不要向上级目录查找历史模板、旧任务、旧调度配置或示例文件。',
        '- 不要设计或修改任务管理器本身，不要建议更改系统目录结构。',
        '- 不要建议把业务运行状态写回任务材料目录，也不要自造其他系统状态路径。',
        '- 唯一例外：如果下面明确给出了 guide 绝对路径，可以只读参考该 guide。',
        '',
        '你的目标：',
        '- 在当前目录创建并完善 task.md',
        '- 如有需要，可在当前目录补充其他参考文件',
        '- 不要执行任务本身，不要开始实现或调研任务结果',
        '- 不要替系统选择 runner、scheduleId、taskId 或调度规则',
        '',
        `任务类型标识：${taskType.type}`,
        `任务类型名称：${taskType.label ?? taskType.type}`,
        `类型说明：${taskType.description}`,
        '',
        '要求：',
        '- task.md 必须是非空文件',
        '- task.md 不要求固定格式，但应让后续执行 agent 能读懂任务目标、背景、约束和期望产出',
        '- 如用户需求不够清楚，可以先和用户对话澄清，再整理成 task.md',
        '- 附加材料直接放在当前目录即可',
        `- ${sharedStateNote}`,
    ];

    if (guidePath) {
        lines.push('', `该 task-type 的创建参考 guide（只读参考，绝对路径）：${guidePath}`);
    }

    return lines.join('\n');
}

export function buildCreationKickoffPrompt(taskType: CreationPromptTaskType, mode: CreationMode): string {
    const kind = mode === 'schedule' ? '定时任务定义' : '任务定义';
    return `你现在在帮助用户创建一份「${taskType.label ?? taskType.type}」类型的${kind}。请先用中文简短说明你会帮助整理当前目录下的 task.md，并先询问用户这次想创建什么任务。`;
}

export function buildCreationEntryHint(taskType: CreationPromptTaskType, mode: CreationMode): string[] {
    const kind = mode === 'schedule' ? '定时任务' : '任务';
    return [
        `进入后请直接描述你想创建的${kind}需求，${taskType.label ?? taskType.type}助手会帮你整理当前目录下的 task.md。`,
        '如果你现在还没想完整，也可以先说一个粗略目标，它会继续追问并帮你收敛。',
    ];
}

export function buildCreationCommandArgs(
    method: RunnerName,
    systemPrompt: string,
    kickoffPrompt: string,
    cwd: string,
    guidePath: string | null,
): string[] {
    if (method === 'codex') {
        return ['-C', cwd, `${kickoffPrompt}\n\n${systemPrompt}`];
    }

    const args = [
        '--append-system-prompt',
        [
            '这是任务定义创建会话，不是任务执行会话。',
            '只在当前工作目录内创建和修改文件。',
            '不要读取或搜索当前工作目录之外的项目文件，除非用户消息明确给出只读 guide 路径。',
            '不要替任务管理器设计目录结构、状态文件或系统实现方案。',
            '',
            systemPrompt,
        ].join('\n'),
    ];

    if (guidePath) {
        args.push('--add-dir', path.dirname(guidePath));
    }

    args.push(kickoffPrompt);
    return args;
}
