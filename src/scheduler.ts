import fs from 'node:fs/promises'
import path from 'node:path'
import cron from 'node-cron'
import { type Schedule, type SchedulesConfig, type TaskInstance } from './types.js'
import { FileQueue } from './queue.js'

const SCHEDULES_FILE = 'scheduler/schedules.json'

export class Scheduler {
  private queue = new FileQueue()
  private tasks: cron.ScheduledTask[] = []

  async start(): Promise<void> {
    await this.queue.ensureDirs()
    const config = await this.loadConfig()

    for (const schedule of config.schedules) {
      if (!schedule.enabled) continue

      const task = cron.schedule(schedule.cron, async () => {
        await this.enqueueFromSchedule(schedule)
      })

      this.tasks.push(task)
    }

    process.on('SIGTERM', () => this.stop())
    process.on('SIGINT', () => this.stop())
  }

  stop(): void {
    this.tasks.forEach(t => t.stop())
  }

  async enqueueFromSchedule(schedule: Schedule): Promise<void> {
    const templateRaw = await fs.readFile(schedule.taskTemplate, 'utf-8')
    const template = JSON.parse(templateRaw) as Partial<TaskInstance>

    const now = new Date().toISOString()
    const id = `sched-${schedule.id}-${now.slice(0, 16).replace(/[T:]/g, '-')}`

    const task: TaskInstance = {
      ...template,
      id,
      createdAt: now,
      currentPhaseIndex: 0,
      retryCount: 0,
      maxRetries: template.maxRetries ?? 3,
      budgetUsd: template.budgetUsd ?? 10,
    } as TaskInstance

    await this.queue.enqueue(task)
    await this.updateLastEnqueued(schedule.id, now)

    console.log(JSON.stringify({
      ts: now,
      event: 'task_scheduled',
      scheduleId: schedule.id,
      taskId: id,
    }))
  }

  private async loadConfig(): Promise<SchedulesConfig> {
    const raw = await fs.readFile(SCHEDULES_FILE, 'utf-8')
    return JSON.parse(raw) as SchedulesConfig
  }

  private async updateLastEnqueued(scheduleId: string, ts: string): Promise<void> {
    const config = await this.loadConfig()
    const schedule = config.schedules.find(s => s.id === scheduleId)
    if (schedule) {
      schedule.lastEnqueuedAt = ts
      await fs.writeFile(SCHEDULES_FILE, JSON.stringify(config, null, 2))
    }
  }
}
