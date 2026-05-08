import fs from 'node:fs/promises';
import path from 'node:path';
import { BUILTIN_TASK_TYPES_DIR, TASK_TYPES_DIR } from './paths.js';
import { type TaskType } from './types.js';
import { pathExists } from './storage.js';

export const DEFAULT_TASK_TYPE = 'general';

export class Registry {
    private cache = new Map<string, TaskType>();

    async load(): Promise<void> {
        this.cache.clear();
        await ensureProjectTaskTypes();
        const entries = await fs.readdir(TASK_TYPES_DIR, { withFileTypes: true }).catch(() => []);
        await Promise.all(
            entries
                .filter(entry => entry.isDirectory())
                .map(async entry => {
                    const raw = await fs.readFile(path.join(this.typeDir(entry.name), 'task-type.json'), 'utf-8');
                    const taskType = JSON.parse(raw) as TaskType;
                    this.cache.set(taskType.type, taskType);
                }),
        );
    }

    listTypes(): TaskType[] {
        return Array.from(this.cache.values()).sort((a, b) => {
            if (a.type === DEFAULT_TASK_TYPE && b.type !== DEFAULT_TASK_TYPE) return -1;
            if (b.type === DEFAULT_TASK_TYPE && a.type !== DEFAULT_TASK_TYPE) return 1;
            return a.type.localeCompare(b.type);
        });
    }

    getType(typeName: string): TaskType {
        const taskType = this.cache.get(typeName);
        if (!taskType) {
            throw new Error(`Unknown task type: "${typeName}". Check task-types/ directory.`);
        }
        return taskType;
    }

    async getGuidePath(typeName: string): Promise<string | null> {
        const guide = path.join(this.typeDir(typeName), 'guide', 'guide.md');
        return (await pathExists(guide)) ? guide : null;
    }

    private typeDir(typeName: string): string {
        return path.join(TASK_TYPES_DIR, typeName);
    }
}

async function ensureProjectTaskTypes(): Promise<void> {
    const entries = await fs.readdir(BUILTIN_TASK_TYPES_DIR, { withFileTypes: true }).catch(() => []);
    const typeDirs = entries.filter(entry => entry.isDirectory());
    if (typeDirs.length === 0) return;

    await fs.mkdir(TASK_TYPES_DIR, { recursive: true });
    await Promise.all(
        typeDirs.map(async entry => {
            const source = path.join(BUILTIN_TASK_TYPES_DIR, entry.name);
            const target = path.join(TASK_TYPES_DIR, entry.name);
            if (await pathExists(target)) return;
            await fs.cp(source, target, { recursive: true });
        }),
    );
}
