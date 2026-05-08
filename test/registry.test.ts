import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('registry task type ordering', () => {
    const originalRoot = process.env.DRIFT_ROOT;
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-registry-'));
        process.env.DRIFT_ROOT = tempDir;
    });

    afterEach(async () => {
        process.env.DRIFT_ROOT = originalRoot;
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('places general first so it becomes the default creation type', async () => {
        const { Registry } = await import('../src/registry.js');

        const registry = new Registry();
        await registry.load();
        const types = registry.listTypes();

        expect(types[0]?.type).toBe('general');
        expect(types.some(taskType => taskType.type === 'research')).toBe(true);
    });
});
