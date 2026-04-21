import fs from 'node:fs/promises'
import path from 'node:path'
import { type TaskType, type Phase, type TaskInstance } from './types.js'

const TASK_TYPES_DIR = 'task-types'

export class Registry {
  private cache = new Map<string, TaskType>()

  /** 加载所有任务类型定义到缓存。 */
  async load(): Promise<void> {
    const files = await fs.readdir(TASK_TYPES_DIR)
    await Promise.all(
      files
        .filter(f => f.endsWith('.json'))
        .map(async f => {
          const raw = await fs.readFile(path.join(TASK_TYPES_DIR, f), 'utf-8')
          const type = JSON.parse(raw) as TaskType
          this.cache.set(type.type, type)
        })
    )
  }

  getType(typeName: string): TaskType {
    const type = this.cache.get(typeName)
    if (!type) throw new Error(`Unknown task type: "${typeName}". Check task-types/ directory.`)
    return type
  }

  listTypes(): TaskType[] {
    return Array.from(this.cache.values())
  }

  /**
   * 解析任务当前阶段，合并 phaseOverrides。
   * 实例的 phaseOverrides 会覆盖类型定义中的对应字段。
   */
  resolvePhase(type: TaskType, task: TaskInstance): Phase {
    const base = type.phases[task.currentPhaseIndex]
    if (!base) {
      throw new Error(
        `Task ${task.id} has currentPhaseIndex=${task.currentPhaseIndex} but type "${type.type}" only has ${type.phases.length} phases`
      )
    }
    const override = task.phaseOverrides?.[base.name] ?? {}
    return { ...base, ...override }
  }

  isLastPhase(type: TaskType, task: TaskInstance): boolean {
    return task.currentPhaseIndex >= type.phases.length - 1
  }
}
