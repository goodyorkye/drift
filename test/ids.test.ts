import { describe, expect, it, vi } from 'vitest';
import { generateRunId, generateTaskId } from '../src/ids.js';

describe('id generation', () => {
    it('uses the provided local timezone when embedding timestamps in ids', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.123456789);
        const date = new Date('2026-04-21T16:05:06.000Z');

        expect(generateTaskId(date, 'Asia/Shanghai')).toBe('task_20260422000506_4fzzzxjy');
        expect(generateRunId(date, 'Asia/Shanghai')).toBe('run_20260422000506_4fzzzxjy');
    });

    it('keeps the UTC calendar day when the local timezone matches UTC', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.123456789);
        const date = new Date('2026-04-21T16:05:06.000Z');

        expect(generateTaskId(date, 'UTC')).toBe('task_20260421160506_4fzzzxjy');
        expect(generateRunId(date, 'UTC')).toBe('run_20260421160506_4fzzzxjy');
    });
});
