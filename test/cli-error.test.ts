import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('CLI error handling', () => {
    const originalExitCode = process.exitCode;

    beforeEach(() => {
        process.exitCode = undefined;
    });

    afterEach(() => {
        process.exitCode = originalExitCode;
        vi.restoreAllMocks();
    });

    it('treats prompt cancellation as a quiet user abort', async () => {
        const { handleCliError } = await import('../src/cli/error.js');
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const error = Object.assign(new Error('User force closed the prompt with 0 null'), { name: 'ExitPromptError' });

        handleCliError(error);

        expect(logSpy).toHaveBeenCalledWith('\n已取消。');
        expect(process.exitCode).toBe(130);
    });

    it('prints a short message for normal errors', async () => {
        const { handleCliError } = await import('../src/cli/error.js');
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        handleCliError(new Error('Only paused tasks can be resumed.'));

        expect(errSpy).toHaveBeenCalledWith('Only paused tasks can be resumed.');
        expect(process.exitCode).toBe(1);
    });
});
