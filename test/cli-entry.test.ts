import { afterEach, describe, expect, it, vi } from 'vitest';

describe('CLI entrypoint', () => {
    const originalArgv = process.argv.slice();

    afterEach(() => {
        process.argv = originalArgv.slice();
        vi.resetModules();
        vi.restoreAllMocks();
        vi.doUnmock('../src/cli/program.js');
        vi.doUnmock('../src/cli/error.js');
    });

    it('parses argv even when loaded through a wrapper process', async () => {
        const parseAsync = vi.fn().mockResolvedValue(undefined);
        const handleCliError = vi.fn();

        vi.doMock('../src/cli/program.js', () => ({
            program: {
                parseAsync,
            },
        }));
        vi.doMock('../src/cli/error.js', () => ({
            handleCliError,
        }));

        process.argv = ['node', '/pm2/ProcessContainerFork.js', 'web'];
        await import('../src/cli/index.js');

        expect(parseAsync).toHaveBeenCalledWith(process.argv);
        expect(handleCliError).not.toHaveBeenCalled();
    });
});
