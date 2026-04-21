import { execa } from 'execa'
import { BaseRunner } from './base.js'
import { type Phase, type TaskInstance } from '../types.js'

export class ClaudeRunner extends BaseRunner {
  protected async execute(
    prompt: string,
    phase: Phase,
    task: TaskInstance
  ): Promise<void> {
    const args = [
      '-p', prompt,
      '--max-turns', '30',
      '--max-budget-usd', String(task.budgetUsd),
      '--permission-mode', 'acceptEdits',
      ...phase.allowedTools.flatMap(tool => ['--allowedTools', tool]),
    ]

    // execa 在进程退出时会自动清理子进程
    await execa('claude', args, {
      timeout: 3600_000,
      // stdout/stderr 继承到父进程，方便调试；正式运行时可改为 pipe
      stdio: 'inherit',
    })
  }
}
