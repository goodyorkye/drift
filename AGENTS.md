# drift-work

自主 Agent 任务管理与调度系统。CLI 命令：`drift`。

## 项目结构速查

| 路径 | 说明 |
| --- | --- |
| `src/` | TypeScript 源码 |
| `src/types.ts` | 全局类型定义 |
| `src/queue.ts` | 文件队列操作，所有状态转换入口 |
| `src/orchestrator.ts` | 串行消费队列、启动 runner、推进状态 |
| `src/scheduler.ts` | 根据 schedule 周期性创建任务实例 |
| `src/registry.ts` | 加载 `task-types/` 任务类型定义 |
| `src/runners/` | Agent 适配层（`claude` / `codex` 等） |
| `src/cli/` | `drift` 命令实现 |
| `task-types/` | 任务类型目录；每个类型使用 `task-types/<type>/task-type.json` |
| `workspace/tasks/` | 任务实例目录 |
| `workspace/schedules/` | 定时任务目录 |
| `workspace/queue/` | 运行时 queue ticket |
| `workspace/logs/` | 运行日志 |
| `old/` | 废弃旧设计文件归档，不能作为新实现依据 |
| `docs/` | 当前设计文档 |

## 当前设计原则

- 系统只做任务管理，不做具体任务业务逻辑。
- `Phase` 不属于核心模型；任务如何分解、如何执行由执行 agent 自己决定。
- 任务正文对管理器是黑盒，最小定义文件是任务材料目录下的 `task.md`。
- `task.md` 不要求固定格式，只要求存在且非空。
- 任务材料目录下的其他文件都是任务附加材料，系统不解析语义。
- 执行时，runner 会将任务材料复制到该任务的长期执行目录。
- 每个 `TaskInstance` 拥有独立长期目录，默认不在任务结束后自动删除。

## 核心状态机

队列状态由 `workspace/queue/<status>/<taskId>.json` 表示，ticket 只保存轻量信息：

```text
pending -> running -> done
                  -> pending   (retry)
                  -> paused    (agent 请求暂停)
                  -> blocked   (失败或放弃)

paused -> pending  (resume)
paused -> blocked  (abandon)
```

`task.json.status` 保留任务最后状态，包含一个额外的 `not_queued` 初始状态。`not_queued` 只存在于 `task.json`，不进入 queue 状态机；后续可通过 `drift task enqueue <id>` 显式入队。
排查任务时可使用 `drift task inspect <id>` 查看 `task.json`、queue 真相、latest run、sessionRef 和 artifact 列表。

## 任务目录模型

```text
workspace/tasks/<taskId>/
  task.json
  <task-material-dir>/
    task.md
  <execution-dir>/
    agent-result.json
  runs/
    <runId>/
      run-meta.json
      agent-result.json
      stdout.log
      stderr.log
  managed-artifacts/
```

## AgentResult

执行 agent 只需要在当前工作目录根目录写入 `agent-result.json`：

```json
{
  "status": "success | paused | blocked",
  "reason": "可选原因",
  "artifactRefs": ["relative/path/from/current-directory.md"]
}
```

约定：

- `artifactRefs` 必须是相对当前工作目录的路径。
- agent 不写 `error`；进程异常、结果缺失、结果非法由 runner 生成系统错误结果。
- runner 会校验当前工作目录下的 `agent-result.json`，再复制到 `runs/<runId>/agent-result.json`。
- 每次启动新 run 前，runner 先删除旧的 `agent-result.json`。

## 创建任务

`drift task add` 的创建助手只负责帮助用户整理当前目录下的 `task.md` 与附加材料，不执行任务本身。

创建助手会话的 cwd 必须是：

```text
该任务的材料目录
```

创建助手默认只能围绕当前目录工作，不应读取、搜索或引用项目其他目录。注入给创建助手的 prompt 不暴露内部目录名；若任务类型存在 guide，系统会以只读参考路径显式注入。

创建助手不应替任务管理器设计状态目录或系统文件。如果用户讨论跨次执行状态，只把它整理为任务需求；定时任务执行期会由 runner 注入该 schedule 的 `shared-state/` 目录。

## 定时任务共享状态

```text
workspace/schedules/<scheduleId>/shared-state/
```

所有任务执行时都会看到一个 `shared-state` 绝对路径。对普通任务，它指向当前任务自己的长期执行目录；对定时任务，它指向上面的 schedule 共享状态目录。管理器只负责创建、保留、清理，不解析其中内容。执行 agent 可以在系统注入该路径后按任务需要读写；不要把业务状态写回 `task.md` 或任务材料文件，也不要自造其他状态路径。

## 开发命令

```bash
npm run dev
npm run build
npm test
npm run typecheck
```

详细设计见 `docs/DESIGN.md` 和 `docs/decisions/`。
