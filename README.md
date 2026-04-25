# Drift

Drift 是一个本地 Agent 任务调度工具。你可以把代码审查、资料整理、周期巡检、文档更新等工作定义成任务，Drift 会负责排队、调度，并调用本机已安装的 Claude 或 Codex CLI 去执行这些自定义任务。

它尤其适合把“需要 agent 定期或批量处理”的工作沉淀下来：

- 手动创建一次性任务，例如让 Codex 根据当前项目材料实现一个功能。
- 创建定时任务，例如每天调用 Claude 检查某个仓库的 Git 状态并生成审计报告。
- 让任务拥有独立工作目录、运行日志、重试记录和 artifacts，方便追踪每次 agent 执行结果。

Drift 本身不理解具体业务，也不替 agent 做决策。它只管理任务生命周期：创建任务、排队、定时触发、启动 runner、记录执行结果、处理重试/暂停/恢复。具体任务做什么、怎么做、产出什么，由 Claude、Codex 或其他 runner 根据任务材料自行完成。

## 安装

不安装，直接运行：

```bash
npx @goodyorkye/drift --help
npx @goodyorkye/drift task add
```

或全局安装：

```bash
npm install -g @goodyorkye/drift
drift --help
```

Drift 需要 Node.js 20 或更新版本。

## 快速开始

在当前项目中创建任务：

```bash
drift task add
```

启动 orchestrator 和 scheduler：

```bash
drift start
```

查看运行情况：

```bash
drift status
drift task list
drift logs
```

Drift 首次在某个项目目录运行时，会在当前目录创建本地运行目录：

```text
workspace/
task-types/
```

`workspace/` 保存任务实例、队列 ticket、schedule、日志、run 记录和托管产物。`task-types/` 保存任务类型定义。如果当前目录没有 `task-types/`，Drift 会从 npm 包内置模板复制一份默认任务类型到当前项目。

## 设计理念

- Drift 只管理任务生命周期，不承载具体业务逻辑。
- 任务以 `spec/task.md` 为核心；该文件只要求存在且非空。
- 任务材料目录下的其他文件会作为附加材料保留和传递。
- 任务如何分解、如何执行，由执行 agent 自己决定。
- 每个任务实例都有独立的长期执行目录和 run 历史。
- Agent 通过 `agent-result.json` 返回执行结果。

## CLI 命令

| 命令                              | 说明                                                            |
| --------------------------------- | --------------------------------------------------------------- |
| `drift task add`                  | 交互式创建任务                                                  |
| `drift task list`                 | 查看任务及最后状态                                              |
| `drift task enqueue <id>`         | 将 `not_queued` 任务加入队列                                    |
| `drift task inspect <id>`         | 查看任务元数据、queue 状态、latest run、sessionRef 和 artifacts |
| `drift task resume <id>`          | 将 paused 任务恢复到 pending                                    |
| `drift task abandon <id>`         | 将 paused 任务放弃并转为 blocked                                |
| `drift task rerun <id>`           | 将 done 或 blocked 任务从头重跑                                 |
| `drift task remove <id>`          | 删除 `not_queued` 或 pending 任务                               |
| `drift start`                     | 启动 orchestrator 和 scheduler                                  |
| `drift stop`                      | 停止后台进程                                                    |
| `drift status`                    | 查看进程和队列概览                                              |
| `drift logs`                      | 查看运行日志                                                    |
| `drift schedule add`              | 交互式创建定时任务                                              |
| `drift schedule list`             | 查看定时任务                                                    |
| `drift schedule run <id>`         | 手动触发一次定时任务                                            |
| `drift schedule clear-tasks <id>` | 清除某个定时任务创建的全部非活动任务实例目录                    |
| `drift schedule enable <id>`      | 启用定时任务                                                    |
| `drift schedule disable <id>`     | 禁用定时任务                                                    |
| `drift schedule remove <id>`      | 删除定时任务                                                    |

## 运行目录

```text
workspace/tasks/<taskId>/
  task.json
  spec/
    task.md
  workdir/
    agent-result.json
  runs/
    <runId>/
      run-meta.json
      agent-result.json
      stdout.log
      stderr.log
  managed-artifacts/

workspace/schedules/<scheduleId>/
  schedule.json
  schedule-state.json
  spec/
    task.md
  shared-state/

workspace/queue/
  pending/
  running/
  paused/
  done/
  blocked/
```

队列状态由 `workspace/queue/<status>/` 下的轻量 ticket 文件表示。

## AgentResult 协议

执行 agent 在当前 `workdir/` 根目录写入 `agent-result.json`：

```json
{
    "status": "success",
    "reason": "optional reason",
    "artifactRefs": ["relative/path/from/workdir.md"]
}
```

合法状态：

```text
success | paused | blocked
```

`artifactRefs` 必须是相对 `workdir/` 的路径。若进程异常退出、结果缺失或结果非法，runner 会记录系统兜底错误结果。

## Runner

Drift 当前提供 Claude 和 Codex runner 适配层。没有检测到可用 runner 时，也可以先创建任务；任务会保留为 `not_queued`，之后再入队：

```bash
drift task enqueue <taskId>
```

第一版默认使用自动执行策略：

- Claude runner 使用非交互执行，并启用权限绕过。
- Codex runner 使用 `exec --full-auto`。

这些是当前 runner 的默认实现策略，不是所有 runner 都必须遵守的通用协议。

## 开发

```bash
npm install
npm run typecheck
npm test -- --run
npm run build
```

相关文档：

- [设计文档](docs/DESIGN.md)
- [架构决策](docs/decisions/)
- [发布流程](docs/RELEASE.md)

## 许可证

MIT
