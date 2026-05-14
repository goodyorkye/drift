#!/usr/bin/env node
import { handleCliError } from './error.js';
import { program } from './program.js';

program.parseAsync(process.argv).catch(handleCliError);
