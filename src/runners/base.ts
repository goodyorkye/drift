import fs from 'node:fs/promises';
import path from 'node:path';
import { type Registry } from '../registry.js';
import { type ExecutionResult, type RunMeta, type TaskMetadata } from '../types.js';
import { scheduleSharedStateDir, taskWorkdir } from '../paths.js';

export interface RunnerContext {
    runMeta: RunMeta;
    runDir: string;
    registry: Registry;
}

export interface RunnerExecutionOutput {
    result: ExecutionResult;
    sessionRef?: string;
}

export abstract class BaseRunner {
    protected abstract execute(prompt: string, task: TaskMetadata, context: RunnerContext): Promise<RunnerExecutionOutput>;

    async run(task: TaskMetadata, context: RunnerContext): Promise<RunnerExecutionOutput> {
        const prompt = await this.buildPrompt(task, context);
        const resultFile = path.join(taskWorkdir(task.taskId), 'agent-result.json');

        await fs.unlink(resultFile).catch(() => {});

        try {
            return await this.execute(prompt, task, context);
        } catch (error) {
            const reason = error instanceof Error ? error.message : 'Runner execution failed';
            return {
                result: {
                    status: 'error',
                    reason,
                },
            };
        }
    }

    private async buildPrompt(task: TaskMetadata, context: RunnerContext): Promise<string> {
        const guidePath = await context.registry.getGuidePath(task.type);
        const sharedStatePath =
            task.createdBy.kind === 'schedule' && task.createdBy.sourceId
                ? scheduleSharedStateDir(task.createdBy.sourceId)
                : taskWorkdir(task.taskId);
        await fs.mkdir(sharedStatePath, { recursive: true });
        const sections = [
            '你正在被 drift-work 任务管理器调度执行任务。',
            '',
            '系统规则：',
            '- 当前工作目录就是你的任务执行目录，跨次执行（resume/retry）保持不变。',
            '- 先读取当前目录下的 task.md 了解任务。',
            '- 如有需要，再读取当前目录下的其他文件。',
            '- 不要把 task.md 或任务材料文件当作运行期状态存储。',
            '- 所有运行期修改、生成、整理文件都应在当前工作目录内进行。',
            '- 如需跨次执行保留业务状态，读写下方提供的 shared-state 目录。',
            '- shared-state 是任务业务状态黑盒目录，管理器不解析其中内容。',
            '',
            `shared-state 目录（可读写，绝对路径）：${sharedStatePath}`,
        ];

        sections.push(
            '',
            '系统状态边界：',
            '- 如需跨次业务状态，只使用系统明确注入的 shared-state 目录。',
            '- 不要自行发明其他跨任务状态路径。',
            '',
            'AgentResult 协议：',
            '```json',
            JSON.stringify(
                {
                    status: 'success | paused | blocked',
                    reason: '可选；paused/blocked 时应填写',
                    artifactRefs: ['相对当前工作目录的路径，可选'],
                },
                null,
                2,
            ),
            '```',
            '- 将最终结果写入当前工作目录下的 agent-result.json。',
            '- artifactRefs 只能填写相对当前工作目录的路径。',
        );

        if (guidePath) {
            sections.push('', `类型 guide（只读补充材料，绝对路径）：${guidePath}`);
        }

        sections.push('', `任务类型：${task.type}`, `任务标题：${task.title}`);
        return sections.join('\n');
    }
}
