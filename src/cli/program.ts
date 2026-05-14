import fs from 'node:fs';
import { Command } from 'commander';
import { registerProcessCommands } from './process.js';
import { registerScheduleCommands } from './schedule.js';
import { registerTaskCommands } from './task.js';
import { registerWebCommand } from './web.js';

const packageJson = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')) as {
    version?: string;
};

export function buildProgram(): Command {
    const program = new Command();

    program
        .name('drift')
        .description('Autonomous AI agent task scheduling and execution system')
        .version(packageJson.version ?? '0.0.0');

    registerTaskCommands(program);
    registerScheduleCommands(program);
    registerProcessCommands(program);
    registerWebCommand(program);

    return program;
}

export const program = buildProgram();
