import path from 'node:path';
import { z } from 'zod';
import { type ExecutionResult } from './types.js';

const AgentResultSchema = z
    .object({
        status: z.enum(['success', 'paused', 'blocked']),
        reason: z.string().optional(),
        artifactRefs: z.array(z.string()).optional(),
    })
    .strict();

export function validateExecutionResult(value: unknown, cwd: string): ExecutionResult {
    const parsed = AgentResultSchema.safeParse(value);
    if (!parsed.success) {
        throw new Error(`Invalid agent-result.json: ${parsed.error.issues.map(issue => issue.message).join('; ')}`);
    }

    for (const ref of parsed.data.artifactRefs ?? []) {
        validateArtifactRef(ref, cwd);
    }

    return parsed.data;
}

function validateArtifactRef(ref: string, cwd: string): void {
    if (ref.trim().length === 0) {
        throw new Error('Invalid agent-result.json: artifactRefs cannot contain empty paths');
    }
    if (path.isAbsolute(ref)) {
        throw new Error(`Invalid agent-result.json: artifactRefs must be relative paths: ${ref}`);
    }

    const resolved = path.resolve(cwd, ref);
    const relative = path.relative(cwd, resolved);
    if (!relative || relative === '.' || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`Invalid agent-result.json: artifactRefs must stay inside the current workdir: ${ref}`);
    }
}
