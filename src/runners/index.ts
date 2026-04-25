import { execa } from 'execa';
import { ClaudeRunner } from './claude.js';
import { CodexRunner } from './codex.js';
import { type BaseRunner } from './base.js';
import { type RunnerName } from '../types.js';

const registry = new Map<RunnerName, BaseRunner>([
    ['claude', new ClaudeRunner()],
    ['codex', new CodexRunner()],
]);

export function getRunner(name: RunnerName): BaseRunner {
    const runner = registry.get(name);
    if (!runner) {
        throw new Error(`Unknown runner: "${name}". Register it in src/runners/index.ts`);
    }
    return runner;
}

export function listKnownRunners(): RunnerName[] {
    return Array.from(registry.keys());
}

export async function isRunnerAvailable(name: RunnerName): Promise<boolean> {
    try {
        await execa('which', [name], { stdin: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

export async function listAvailableRunners(): Promise<RunnerName[]> {
    const names = listKnownRunners();
    const available = await Promise.all(
        names.map(async name => ({
            name,
            available: await isRunnerAvailable(name),
        })),
    );
    return available.filter(item => item.available).map(item => item.name);
}

export { BaseRunner };
