# drift-work

自主 AI Agent 任务管理与调度系统。

`drift` 负责创建任务、排队、调度、启动 runner、记录运行结果和恢复异常状态。具体任务是什么、如何执行、产出什么，由执行 agent 根据任务材料自行决定。

## 快速开始

```bash
npm install
npm run build

# 交互式创建任务
drift task add

# 启动 orchestrator + scheduler
drift start

# 查看任务
drift task list
```

## 设计理念

- 系统只做任务管理，不做任务业务逻辑。
- 任务定义以 `spec/task.md` 为核心，不要求固定格式。
- `Phase` 不属于核心模型，任务分解是 agent 的执行细节。
- 任务类型只提供分类、展示说明、默认执行配置和可选 guide。
- 任务执行结果通过统一的 `agent-result.json` 协议回传。
- 没有可用 runner 时，也可以先创建任务；任务会保留为 `not_queued`，待安装 runner 后再 enqueue。

详细设计见 [docs/DESIGN.md](docs/DESIGN.md) 和 [docs/decisions/](docs/decisions/)。

## 架构

```text
drift CLI -> workspace/queue/pending/ <- Scheduler
                    |
                    v
              Orchestrator
                    |
                    v
            runners/{claude,codex}
                    |
                    v
      workspace/tasks/<taskId>/workdir/agent-result.json
```

## 状态机

```text
pending -> running -> done
                  -> pending   (retry)
                  -> paused    (agent 请求暂停)
                  -> blocked   (失败、重试耗尽或放弃)

paused -> pending  (drift task resume)
paused -> blocked  (drift task abandon)
done -> pending    (drift task rerun)
blocked -> pending (drift task rerun)
```

## CLI 命令

| 命令 | 说明 |
| --- | --- |
| `drift task add` | 交互式创建任务，可选择 `claude` / `codex` / 手工创建 |
| `drift task list` | 查看任务及最后状态 |
| `drift task enqueue <id>` | 将 `not_queued` 任务加入队列 |
| `drift task inspect <id>` | 查看任务详情、当前 queue 状态、latest run、sessionRef 和 artifacts |
| `drift task resume <id>` | 将 paused 任务恢复到 pending |
| `drift task abandon <id>` | 将 paused 任务放弃并转为 blocked |
| `drift task rerun <id>` | 将 done 或 blocked 任务从头重跑并重新入队 |
| `drift task remove <id>` | 删除 not_queued 或 pending 任务 |
| `drift start` | 启动 orchestrator 和 scheduler |
| `drift stop` | 停止后台进程 |
| `drift status` | 查看进程和队列概览 |
| `drift logs` | 查看运行日志 |
| `drift schedule add` | 交互式创建定时任务 |
| `drift schedule list` | 查看定时任务 |
| `drift schedule run <id>` | 手动触发一次定时任务 |
| `drift schedule clear-tasks <id>` | 清除某个定时任务创建的全部非活动任务实例目录 |
| `drift schedule enable <id>` | 启用定时任务 |
| `drift schedule disable <id>` | 禁用定时任务 |
| `drift schedule remove <id>` | 删除定时任务 |

## 目录结构

```text
src/
  cli/
  runners/
  orchestrator.ts
  scheduler.ts
  queue.ts
  registry.ts
  storage.ts
  types.ts
task-types/
  <type>/
    task-type.json
    guide/
      guide.md
workspace/
  tasks/
  schedules/
  queue/
  logs/
old/
docs/
```

单个任务目录：

```text
workspace/tasks/<taskId>/
  task.json
  spec/
    task.md
  workdir/
  runs/
  managed-artifacts/
```

## AgentResult

执行 agent 在当前 `workdir/` 根目录写入：

```json
{
  "status": "success | paused | blocked",
  "reason": "optional reason",
  "artifactRefs": ["relative/path/from/workdir.md"]
}
```

runner 会校验该文件，并复制到 `runs/<runId>/agent-result.json`。`artifactRefs` 必须是相对 `workdir/` 的路径。
若 `agent-result.json` 缺失、不是合法 JSON、或字段不符合协议，runner 会生成系统兜底 `error`。

`drift schedule add` 目前会先准备 `spec/`，再确认 `title`、`cron`、`runner`、可选 `runnerEnv` 预设、`skipIfActive` 和 `enabled`，最后展示创建摘要再落盘。`cron` 默认值是 `0 * * * *`。若所选 runner 当前不可用，schedule 会被强制创建为 `disabled`。

## Runner 默认策略

第一版默认使用自动执行 runner 策略，以减少无人值守运行中的交互阻塞：

- Claude runner 使用非交互执行，并启用 `bypassPermissions`
- Codex runner 使用 `exec --full-auto`

这些属于当前 runner 默认实现策略，而不是所有 runner 都必须遵守的通用协议。

## 定时任务共享状态

所有任务执行时都会看到一个 `shared-state` 绝对路径：

- 普通任务：指向当前任务自己的长期执行目录
- 定时任务：指向该 schedule 的共享状态目录

定时任务如果需要跨多次执行保存业务状态，可以使用：

```text
workspace/schedules/<scheduleId>/shared-state/
```

runner 会在执行由 schedule 生成的任务时注入该目录的绝对路径。管理器不解析其中内容；`task.md` 和任务材料文件不用于保存任务业务状态。

## 开发

```bash
npm run dev
npm run build
npm test
npm run typecheck
```
