import { describe, expect, it } from 'vitest';
import { buildCreationCommandArgs, buildCreationEntryHint, buildCreationKickoffPrompt, buildCreationPrompt, buildCreationRoundPrompt } from '../src/cli/creation.js';

describe('creation session command args', () => {
    it('injects Claude creation guidance as system prompt and sends a short kickoff prompt', () => {
        const args = buildCreationCommandArgs('claude', 'CREATE TASK PROMPT', 'KICKOFF PROMPT', '/tmp/task/spec', null);

        expect(args[0]).toBe('--append-system-prompt');
        expect(args[1]).toContain('CREATE TASK PROMPT');
        expect(args).toContain('KICKOFF PROMPT');
        expect(args).not.toContain('CREATE TASK PROMPT');
    });

    it('keeps Codex creation guidance as the initial prompt for the TUI', () => {
        const args = buildCreationCommandArgs('codex', 'CREATE TASK PROMPT', 'KICKOFF PROMPT', '/tmp/task/spec', null);

        expect(args).toEqual(['-C', '/tmp/task/spec', 'KICKOFF PROMPT\n\nCREATE TASK PROMPT']);
    });

    it('builds a visible kickoff prompt for the user-facing opening message', () => {
        const prompt = buildCreationKickoffPrompt(
            {
                type: 'research',
                label: '调研任务',
                description: 'Research task',
            },
            'task',
        );

        expect(prompt).toContain('调研任务');
        expect(prompt).toContain('帮助整理当前目录下的 task.md');
        expect(prompt).toContain('先询问用户这次想创建什么任务');
    });

    it('builds a CLI entry hint so the user knows what to say after entering the session', () => {
        const lines = buildCreationEntryHint(
            {
                type: 'research',
                label: '调研任务',
                description: 'Research task',
            },
            'task',
        );

        expect(lines[0]).toContain('直接描述你想创建的任务需求');
        expect(lines[0]).toContain('调研任务助手');
        expect(lines[1]).toContain('粗略目标');
    });

    it('builds a creation round prompt that carries prior transcript into the next assistant round', () => {
        const prompt = buildCreationRoundPrompt({
            taskType: {
                type: 'research',
                label: '调研任务',
                description: 'Research task',
            },
            mode: 'task',
            transcript: [
                { role: 'user', content: '我要做一个竞品调研', createdAt: '2026-05-06T10:00:00.000+08:00' },
                { role: 'assistant', content: '我会先帮你澄清目标。', createdAt: '2026-05-06T10:00:05.000+08:00' },
            ],
            userMessage: '目标是给销售团队做一页结论摘要',
        });

        expect(prompt).toContain('历史对话');
        expect(prompt).toContain('用户（2026-05-06T10:00:00.000+08:00）');
        expect(prompt).toContain('助手（2026-05-06T10:00:05.000+08:00）');
        expect(prompt).toContain('目标是给销售团队做一页结论摘要');
    });

    it('tells the creation assistant to default content-generating tasks toward file artifacts', () => {
        const prompt = buildCreationPrompt(
            {
                type: 'general',
                label: '通用任务',
                description: 'General task',
            },
            null,
            'task',
        );

        expect(prompt).toContain('如果任务目的本身是在生成某种内容结果');
        expect(prompt).toContain('默认应把“生成可下载文件产物”写进任务要求');
        expect(prompt).toContain('除非用户明确要求不要文件产物');
    });
});
