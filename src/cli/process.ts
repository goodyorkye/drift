import { type Command } from 'commander'
import { execa } from 'execa'
import fs from 'node:fs/promises'
import path from 'node:path'
import { FileQueue } from '../queue.js'

const PID_FILE = '.drift.pid'
const LOG_DIR = 'logs'

export function registerProcessCommands(program: Command): void {
  program
    .command('start')
    .description('Start the Orchestrator and Scheduler')
    .option('--daemon', 'Run in background')
    .action(startProcess)

  program
    .command('stop')
    .description('Stop the Orchestrator (returns running tasks to pending)')
    .action(stopProcess)

  program
    .command('status')
    .description('Show process status, queue counts, and recent logs')
    .action(showStatus)

  program
    .command('logs')
    .description('Show execution logs')
    .option('--tail <n>', 'Number of lines to show', '20')
    .option('--follow', 'Follow log output')
    .action(showLogs)
}

async function startProcess(opts: { daemon?: boolean }): Promise<void> {
  if (await isRunning()) {
    const pid = await fs.readFile(PID_FILE, 'utf-8')
    console.log(`Already running (PID: ${pid.trim()})`)
    return
  }

  if (opts.daemon) {
    // TODO: spawn detached process, write PID
    console.log('Daemon mode: not yet implemented')
  } else {
    const { Orchestrator } = await import('../orchestrator.js')
    const orchestrator = new Orchestrator()
    await fs.writeFile(PID_FILE, String(process.pid))
    process.on('exit', () => fs.unlink(PID_FILE).catch(() => {}))
    await orchestrator.start()
  }
}

async function stopProcess(): Promise<void> {
  if (!(await isRunning())) {
    console.log('Not running.')
    return
  }

  const pid = parseInt(await fs.readFile(PID_FILE, 'utf-8'), 10)
  process.kill(pid, 'SIGTERM')

  // 将 running 任务归还到 pending
  const queue = new FileQueue()
  const running = await queue.list('running')
  await Promise.all(running.map(t => queue.transition(t, 'pending')))

  await fs.unlink(PID_FILE).catch(() => {})
  console.log(`Stopped (PID: ${pid}). ${running.length} running task(s) returned to pending.`)
}

async function showStatus(): Promise<void> {
  const running = await isRunning()
  if (running) {
    const pid = await fs.readFile(PID_FILE, 'utf-8')
    console.log(`Status: running (PID: ${pid.trim()})`)
  } else {
    console.log('Status: stopped')
  }

  const queue = new FileQueue()
  const statuses = ['pending', 'running', 'waiting', 'blocked', 'done'] as const
  console.log('\nQueue:')
  for (const status of statuses) {
    const tasks = await queue.list(status)
    console.log(`  ${status.padEnd(10)} ${tasks.length}`)
  }

  console.log('\nRecent logs:')
  await showLogs({ tail: '10' })
}

async function showLogs(opts: { tail: string; follow?: boolean }): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)
  const logFile = path.join(LOG_DIR, `${today}.jsonl`)

  try {
    const raw = await fs.readFile(logFile, 'utf-8')
    const lines = raw.trim().split('\n').filter(Boolean)
    const tail = parseInt(opts.tail, 10)
    const visible = lines.slice(-tail)
    for (const line of visible) {
      try {
        const entry = JSON.parse(line)
        const ts = entry.ts?.slice(11, 19) ?? ''
        const event = entry.event ?? ''
        const task = entry.taskId ? `[${entry.taskId}]` : ''
        const detail = entry.reason ?? entry.outputFile ?? entry.phase ?? ''
        console.log(`${ts}  ${event.padEnd(25)} ${task} ${detail}`)
      } catch {
        console.log(line)
      }
    }
  } catch {
    console.log('No logs found for today.')
  }
}

async function isRunning(): Promise<boolean> {
  try {
    const pid = parseInt(await fs.readFile(PID_FILE, 'utf-8'), 10)
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
