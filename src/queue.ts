import fs from 'node:fs/promises'
import path from 'node:path'
import { type TaskInstance, type QueueStatus } from './types.js'

const QUEUE_DIR = 'queue'

export class FileQueue {
  private dir(status: QueueStatus): string {
    return path.join(QUEUE_DIR, status)
  }

  /** 从 pending 取一个任务，原子移到 running。无任务返回 null。 */
  async dequeue(): Promise<TaskInstance | null> {
    const files = await fs.readdir(this.dir('pending')).catch(() => [])
    const jsonFiles = files.filter(f => f.endsWith('.json'))
    if (jsonFiles.length === 0) return null

    const file = jsonFiles[0]
    const src = path.join(this.dir('pending'), file)
    const dst = path.join(this.dir('running'), file)

    // fs.rename 在同文件系统内是原子操作
    await fs.rename(src, dst)
    const raw = await fs.readFile(dst, 'utf-8')
    return JSON.parse(raw) as TaskInstance
  }

  /** 将任务从 running 移到目标状态，同时更新任务文件内容。 */
  async transition(task: TaskInstance, to: QueueStatus): Promise<void> {
    const filename = `${task.id}.json`
    const src = path.join(this.dir('running'), filename)
    const dst = path.join(this.dir(to), filename)
    await fs.writeFile(src, JSON.stringify(task, null, 2))
    await fs.rename(src, dst)
  }

  /** 将任务从 waiting 移回 running（approve 操作）。 */
  async approve(taskId: string): Promise<TaskInstance> {
    const filename = `${taskId}.json`
    const src = path.join(this.dir('waiting'), filename)
    const dst = path.join(this.dir('running'), filename)
    await fs.rename(src, dst)
    const raw = await fs.readFile(dst, 'utf-8')
    return JSON.parse(raw) as TaskInstance
  }

  /** 将新任务写入 pending 队列。 */
  async enqueue(task: TaskInstance): Promise<void> {
    const file = path.join(this.dir('pending'), `${task.id}.json`)
    await fs.writeFile(file, JSON.stringify(task, null, 2))
  }

  /** 列出指定状态的所有任务。 */
  async list(status: QueueStatus): Promise<TaskInstance[]> {
    const files = await fs.readdir(this.dir(status)).catch(() => [])
    const tasks = await Promise.all(
      files
        .filter(f => f.endsWith('.json'))
        .map(async f => {
          const raw = await fs.readFile(path.join(this.dir(status), f), 'utf-8')
          return JSON.parse(raw) as TaskInstance
        })
    )
    return tasks.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  /** 删除 pending 中的任务。 */
  async remove(taskId: string): Promise<void> {
    const file = path.join(this.dir('pending'), `${taskId}.json`)
    await fs.unlink(file)
  }

  /** 读取 running 目录下的 result.json。 */
  async readResult(taskId: string): Promise<unknown> {
    const file = path.join(this.dir('running'), `${taskId}.result.json`)
    const raw = await fs.readFile(file, 'utf-8')
    return JSON.parse(raw)
  }

  /** 确保队列目录存在（启动时调用）。 */
  async ensureDirs(): Promise<void> {
    const statuses: QueueStatus[] = ['pending', 'running', 'done', 'blocked', 'waiting']
    await Promise.all(
      statuses.map(s => fs.mkdir(this.dir(s), { recursive: true }))
    )
  }
}
