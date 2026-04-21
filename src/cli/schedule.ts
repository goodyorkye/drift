import { type Command } from 'commander'
import { input, confirm } from '@inquirer/prompts'
import fs from 'node:fs/promises'
import { type SchedulesConfig, type Schedule } from '../types.js'

const SCHEDULES_FILE = 'scheduler/schedules.json'

export function registerScheduleCommands(program: Command): void {
  const schedule = program.command('schedule').description('Manage scheduled tasks')

  schedule
    .command('list')
    .description('List all schedules')
    .action(listSchedules)

  schedule
    .command('add')
    .description('Add a new schedule (interactive)')
    .action(addSchedule)

  schedule
    .command('enable <id>')
    .description('Enable a schedule')
    .action((id) => setEnabled(id, true))

  schedule
    .command('disable <id>')
    .description('Disable a schedule')
    .action((id) => setEnabled(id, false))

  schedule
    .command('run <id>')
    .description('Trigger a schedule immediately (without waiting for cron)')
    .action(runScheduleNow)
}

async function listSchedules(): Promise<void> {
  const config = await loadConfig()
  if (config.schedules.length === 0) {
    console.log('No schedules configured.')
    return
  }
  for (const s of config.schedules) {
    const status = s.enabled ? 'enabled ' : 'disabled'
    const last = s.lastEnqueuedAt ? `last: ${s.lastEnqueuedAt.slice(0, 16)}` : 'never run'
    console.log(`  [${status}] ${s.id}  cron: ${s.cron}  ${last}`)
    console.log(`           ${s.description}`)
  }
}

async function addSchedule(): Promise<void> {
  const id = await input({ message: 'Schedule ID (unique identifier)' })
  const description = await input({ message: 'Description' })
  const taskTemplate = await input({ message: 'Task template path (tasks/scheduled/...)' })
  const cron = await input({ message: 'Cron expression (e.g. "0 9 * * 1-5")' })

  const schedule: Schedule = { id, description, taskTemplate, cron, enabled: true }

  const config = await loadConfig()
  config.schedules.push(schedule)
  await saveConfig(config)
  console.log(`✓ Schedule added: ${id}`)
}

async function setEnabled(id: string, enabled: boolean): Promise<void> {
  const config = await loadConfig()
  const schedule = config.schedules.find(s => s.id === id)
  if (!schedule) throw new Error(`Schedule not found: ${id}`)
  schedule.enabled = enabled
  await saveConfig(config)
  console.log(`✓ Schedule ${id} ${enabled ? 'enabled' : 'disabled'}`)
}

async function runScheduleNow(id: string): Promise<void> {
  const config = await loadConfig()
  const schedule = config.schedules.find(s => s.id === id)
  if (!schedule) throw new Error(`Schedule not found: ${id}`)

  const { Scheduler } = await import('../scheduler.js')
  const scheduler = new Scheduler()
  await scheduler.enqueueFromSchedule(schedule)
  console.log(`✓ Schedule ${id} triggered`)
}

async function loadConfig(): Promise<SchedulesConfig> {
  try {
    const raw = await fs.readFile(SCHEDULES_FILE, 'utf-8')
    return JSON.parse(raw) as SchedulesConfig
  } catch {
    return { schedules: [] }
  }
}

async function saveConfig(config: SchedulesConfig): Promise<void> {
  await fs.writeFile(SCHEDULES_FILE, JSON.stringify(config, null, 2))
}
