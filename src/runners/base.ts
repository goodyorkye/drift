import fs from 'node:fs/promises'
import path from 'node:path'
import { type Phase, type TaskInstance, type TaskResult } from '../types.js'

const QUEUE_RUNNING_DIR = 'queue/running'

export abstract class BaseRunner {
  /**
   * 执行任务的具体逻辑，由子类实现。
   * 实现者负责调用 Agent CLI，并期望 Agent 写入 result.json。
   */
  protected abstract execute(
    prompt: string,
    phase: Phase,
    task: TaskInstance
  ): Promise<void>

  /**
   * 公共入口：构建 prompt → 执行 → 校验合约。
   * BaseRunner 确保无论 Agent 是否写入 result.json，文件最终都存在。
   */
  async run(phase: Phase, task: TaskInstance): Promise<TaskResult> {
    const prompt = await this.buildPrompt(phase, task)
    const resultFile = path.join(QUEUE_RUNNING_DIR, `${task.id}.result.json`)

    // 清理上次可能残留的 result.json
    await fs.unlink(resultFile).catch(() => {})

    try {
      await this.execute(prompt, phase, task)
    } catch (err) {
      // Agent 进程异常退出，enforceContract 会生成 error 记录
    }

    return this.enforceContract(resultFile)
  }

  /** 读取 Prompt 模板，注入任务参数。 */
  private async buildPrompt(phase: Phase, task: TaskInstance): Promise<string> {
    const template = await fs.readFile(phase.template, 'utf-8')
    const taskJson = JSON.stringify(task, null, 2)
    return [
      template,
      '',
      '---',
      '## 当前任务参数',
      '',
      '```json',
      taskJson,
      '```',
      '',
      '## Result Contract',
      '',
      `执行完成后，将结果写入 ${QUEUE_RUNNING_DIR}/${task.id}.result.json：`,
      '```json',
      '{"status": "success|blocked|error", "reason": "失败原因", "outputFile": "reports/..."}',
      '```',
    ].join('\n')
  }

  /** 确保 result.json 存在，若 Agent 未写入则生成 error 记录。 */
  private async enforceContract(resultFile: string): Promise<TaskResult> {
    try {
      const raw = await fs.readFile(resultFile, 'utf-8')
      return JSON.parse(raw) as TaskResult
    } catch {
      const fallback: TaskResult = {
        status: 'error',
        reason: 'Agent did not write result.json',
      }
      await fs.writeFile(resultFile, JSON.stringify(fallback, null, 2))
      return fallback
    }
  }
}
