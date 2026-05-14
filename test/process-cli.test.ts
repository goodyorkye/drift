import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

describe('process CLI', () => {
    afterEach(() => {
        vi.resetModules();
        vi.restoreAllMocks();
        vi.doUnmock('node:fs/promises');
        vi.doUnmock('../src/scheduler.js');
        vi.doUnmock('../src/orchestrator.js');
    });

    it('prints a startup confirmation when the process starts', async () => {
        vi.doMock('node:fs/promises', () => ({
            default: {
                readFile: vi.fn().mockRejectedValue(new Error('missing pid file')),
                writeFile: vi.fn().mockResolvedValue(undefined),
                unlink: vi.fn().mockResolvedValue(undefined),
            },
        }));
        vi.doMock('../src/scheduler.js', () => ({
            Scheduler: class {
                async start(): Promise<void> {}
            },
        }));
        vi.doMock('../src/orchestrator.js', () => ({
            Orchestrator: class {
                async start(): Promise<void> {}
            },
        }));

        const { registerProcessCommands } = await import('../src/cli/process.js');
        const program = new Command();
        registerProcessCommands(program);

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        await program.parseAsync(['node', 'test', 'start']);

        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Started'));
    });
});
