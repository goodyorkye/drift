import { describe, expect, it } from 'vitest';
import { buildCreationCommandArgs, buildCreationEntryHint, buildCreationKickoffPrompt } from '../src/cli/creation.js';

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
});
