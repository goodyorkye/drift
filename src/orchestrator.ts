import { execa } from 'execa'
import { FileQueue } from './queue.js'
import { Registry } from './registry.js'
import { getRunner } from './runners/index.js'
import { type TaskInstance, type LogEntry } from './types.js'
import fs from 'node:fs/promises'
import path from 'node:path'

export class Orchestrator {
  private queue = new FileQueue()
  private registry = new Registry()
  private running = false

  async start(): Promise<void> {
    await this.queue.ensureDirs()
    await this.registry.load()
    this.running = true

    process.on('SIGTERM', () => this.stop())
    process.on('SIGINT', () => this.stop())

    while (this.running) {
      const hasMore = await this.runOneIteration()
      if (!hasMore) {
        await sleep(5_000)
      }
    }
  }

  stop(): void {
    this.running = false
  }

  async runOneIteration(): Promise<boolean> {
    const task = await this.queue.dequeue()
    if (!task) return false

    const startedAt = Date.now()
    const type = this.registry.getType(task.type)
    const phase = this.registry.resolvePhase(type, task)

    await this.log({ event: 'phase_start', taskId: task.id, taskType: task.type, phase: phase.name, agent: task.agent })

    // git checkpoint
    if (phase.gitCheckpoint && task.targetRepo) {
      const branch = `drift/${task.id}`
      await execa('git', ['-C', task.targetRepo, 'checkout', '-b', branch])
      task.branchName = branch
    }

    const runner = getRunner(task.agent)
    const result = await runner.run(phase, task)

    task.lastAttemptedAt = new Date().toISOString()

    if (result.status === 'success') {
      if (phase.humanReview) {
        // 等待人工确认后再推进阶段
        await this.queue.transition(task, 'waiting')
        await this.log({ event: 'phase_waiting_review', taskId: task.id, phase: phase.name })
      } else if (this.registry.isLastPhase(type, task)) {
        // 最后阶段：运行验证命令（如有）
        if (phase.verificationCmd && task.targetRepo) {
          const ok = await runVerification(phase.verificationCmd, task.targetRepo)
          if (!ok) {
            if (phase.rollbackOnFailure && task.branchName && task.targetRepo) {
              await rollbackGit(task.targetRepo, task.branchName)
            }
            await this.handleFailure(task, 'Verification command failed')
            return true
          }
        }
        task.outputFile = result.outputFile
        await this.queue.transition(task, 'done')
        await this.log({ event: 'task_done', taskId: task.id, outputFile: task.outputFile, durationMs: Date.now() - startedAt })
      } else {
        // 推进到下一阶段，移回 running
        task.currentPhaseIndex++
        await this.queue.transition(task, 'running')
        await this.log({ event: 'phase_done', taskId: task.id, phase: phase.name })
      }
    } else {
      await this.handleFailure(task, result.reason ?? 'Unknown error')
    }

    return true
  }

  private async handleFailure(task: TaskInstance, reason: string): Promise<void> {
    task.retryCount++
    if (task.retryCount >= task.maxRetries) {
      task.blockedReason = reason
      await this.queue.transition(task, 'blocked')
      await this.log({ event: 'task_blocked', taskId: task.id, reason })
    } else {
      await this.queue.transition(task, 'pending')
      await this.log({ event: 'task_retry', taskId: task.id, reason })
    }
  }

  private async log(entry: Omit<LogEntry, 'ts'>): Promise<void> {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry })
    const file = path.join('logs', `${today()}.jsonl`)
    await fs.mkdir('logs', { recursive: true })
    await fs.appendFile(file, line + '\n')
  }
}

async function runVerification(cmd: string, cwd: string): Promise<boolean> {
  try {
    await execa(cmd, { shell: true, cwd })
    return true
  } catch {
    return false
  }
}

async function rollbackGit(repo: string, branch: string): Promise<void> {
  await execa('git', ['-C', repo, 'checkout', 'main'])
  await execa('git', ['-C', repo, 'branch', '-D', branch])
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}
