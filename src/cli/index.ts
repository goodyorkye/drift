#!/usr/bin/env node
import { Command } from 'commander';
import { handleCliError } from './error.js';
import { registerTaskCommands } from './task.js';
import { registerScheduleCommands } from './schedule.js';
import { registerProcessCommands } from './process.js';

const program = new Command();

program.name('drift').description('Autonomous AI agent task scheduling and execution system').version('0.1.0');

registerTaskCommands(program);
registerScheduleCommands(program);
registerProcessCommands(program);

program.parseAsync(process.argv).catch(handleCliError);
