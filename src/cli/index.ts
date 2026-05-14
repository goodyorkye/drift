#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Command } from 'commander';
import { handleCliError } from './error.js';
import { registerTaskCommands } from './task.js';
import { registerScheduleCommands } from './schedule.js';
import { registerProcessCommands } from './process.js';
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

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
    program.parseAsync(process.argv).catch(handleCliError);
}
