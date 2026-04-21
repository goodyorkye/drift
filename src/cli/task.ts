import { type Command } from 'commander'
import { input, select, checkbox } from '@inquirer/prompts'
import { FileQueue } from '../queue.js'
import { Registry } from '../registry.js'
import { type TaskInstance, type QueueStatus } from '../types.js'

export function registerTaskCommands(program: Command): void {
  const task = program.command('task').description('Manage tasks')

  task
    .command('add')
    .description('Add a new task (interactive requirement analysis)')
    .option('--type <type>', 'Task type (research|code-review|doc-review|feature-dev)')
    .option('--agent <agent>', 'Agent to use (claude|codex)', 'claude')
    .option('--title <title>', 'Task title')
    .action(addTask)

  task
    .command('list')
    .description('List tasks')
    .option('--status <status>', 'Filter by status (pending|running|done|blocked|waiting)')
    .action(listTasks)

  task
    .command('remove <id>')
    .description('Remove a pending task')
    .action(removeTask)

  task
    .command('approve <id>')
    .description('Approve a waiting task to continue to next phase')
    .action(approveTask)
}

async function addTask(opts: { type?: string; agent: string; title?: string }): Promise<void> {
  const registry = new Registry()
  await registry.load()
  const types = registry.listTypes()

  // 问询任务类型
  const taskType = opts.type ?? await select({
    message: '选择任务类型',
    choices: types.map(t => ({ name: `${t.type}  —  ${t.description}`, value: t.type })),
  })

  // 问询标题
  const title = opts.title ?? await input({ message: '任务标题' })

  // 需求分析：目标
  const description = await input({ message: '任务描述（做什么）' })
  const goal = await input({ message: '预期结果（用来做什么）' })
  const acceptance = await input({ message: '验收标准（怎样算完成）' })

  const typeConfig = registry.getType(taskType)
  const now = new Date().toISOString()
  const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

  const instance: TaskInstance = {
    id,
    type: taskType,
    agent: opts.agent,
    title,
    description,
    goal,
    acceptance,
    currentPhaseIndex: 0,
    retryCount: 0,
    maxRetries: typeConfig.defaultMaxRetries ?? 3,
    budgetUsd: typeConfig.defaultBudgetUsd ?? 10,
    createdAt: now,
  }

  const queue = new FileQueue()
  await queue.ensureDirs()
  await queue.enqueue(instance)
  console.log(`✓ Task added: ${id}`)
}

async function listTasks(opts: { status?: string }): Promise<void> {
  const queue = new FileQueue()
  const statuses: QueueStatus[] = opts.status
    ? [opts.status as QueueStatus]
    : ['pending', 'running', 'waiting', 'blocked', 'done']

  for (const status of statuses) {
    const tasks = await queue.list(status)
    if (tasks.length === 0) continue
    console.log(`\n[${status.toUpperCase()}]`)
    for (const t of tasks) {
      console.log(`  ${t.id}  ${t.type}  ${t.title}`)
    }
  }
}

async function removeTask(id: string): Promise<void> {
  const queue = new FileQueue()
  await queue.remove(id)
  console.log(`✓ Removed: ${id}`)
}

async function approveTask(id: string): Promise<void> {
  const queue = new FileQueue()
  const task = await queue.approve(id)
  task.currentPhaseIndex++
  console.log(`✓ Approved: ${id}, advancing to phase ${task.currentPhaseIndex}`)
}
