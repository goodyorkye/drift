import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('CLI version', () => {
    it('matches the package version', async () => {
        const packageJson = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8')) as {
            version: string;
        };
        const { program } = await import('../src/cli/program.js');

        expect(program.version()).toBe(packageJson.version);
    });
});
