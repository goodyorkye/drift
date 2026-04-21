import { ClaudeRunner } from './claude.js'
import { type BaseRunner } from './base.js'

const registry = new Map<string, BaseRunner>([
  ['claude', new ClaudeRunner()],
])

export function getRunner(agent: string): BaseRunner {
  const runner = registry.get(agent)
  if (!runner) throw new Error(`Unknown agent: "${agent}". Register it in src/runners/index.ts`)
  return runner
}

export { BaseRunner }
