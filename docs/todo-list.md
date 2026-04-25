# Todo List

当前设计结论已收敛到：

- [docs/DESIGN.md](/Users/york/data/workspace/ai/n3/drift-work/docs/DESIGN.md)
- [docs/decisions/](/Users/york/data/workspace/ai/n3/drift-work/docs/decisions)

本文件只记录**当前实现仍需完善的事项**。已完成的旧模型迁移不再重复列为待办。

## 已完成的迁移基线

- [x] 核心模型移除 `Phase`
- [x] 任务正文迁移为 `spec/task.md` 黑盒模型
- [x] 任务实例目录迁移为 `spec/`、`workdir/`、`runs/`、`managed-artifacts/`
- [x] 队列迁移为 `workspace/queue/<status>/<taskId>.json` 轻量 ticket
- [x] 生命周期迁移为 `pending / running / paused / done / blocked`
- [x] `not_queued` 明确为 `task.json` 专属初始状态
- [x] `RunRecord` 迁移为 `runs/<runId>/run-meta.json`
- [x] `task.json` 只保留 `latestRunId` 等轻量索引字段
- [x] `AgentResult` 迁移为 `workdir/agent-result.json`
- [x] runner 负责校验并归档 `agent-result.json`
- [x] `artifactRefs` 使用相对 `workdir/` 路径，并由管理器复制进 `managed-artifacts/`
- [x] `TaskType` 收敛为分类、展示说明、默认执行配置和可选 guide
- [x] `Schedule` 迁移为独立模型，使用 `schedule.json` / `schedule-state.json`
- [x] schedule 通过 `createdBy.kind/sourceId` 关联生成的任务
- [x] Orchestrator 启动时处理 orphan `running` 任务
- [x] 第一版 Orchestrator 明确为串行执行模型
- [x] `drift task add` 迁移为围绕 `spec/task.md` 的交互式创建流程
- [x] 创建任务支持 `claude` / `codex` / `manual`
- [x] 创建任务的 agent 会话 cwd 固定为 `workspace/tasks/<taskId>/spec/`
- [x] 创建任务的 agent prompt 明确禁止读取、搜索或引用当前 `spec/` 之外的项目文件

## P1

- [ ] 补充端到端 CLI 测试：`task add`、`task resume`、`task abandon`、`schedule add`、`schedule run`
- [x] 补充 crash recovery 测试：存在 run 目录、不存在 run 目录两种 orphan `running` 情况
- [x] 补充 artifact intake 测试：相对路径、绝对路径、越界路径、缺失文件、目录 artifact
- [x] 补充 schedule-state 统计测试：triggered/skipped/createdTasks/done/blocked/paused 与平均耗时

## P2

- [ ] 梳理 runner 参数配置入口，避免 `claude` / `codex` 的执行参数散落在各自文件中
- [ ] 为 creation agent 与 execution agent 分别建立 runner 能力说明，明确哪些 runner 支持 sessionRef、cwd、附加 guide 路径
- [x] 优化创建任务时无可用执行 runner 的体验：允许先创建 `not_queued` 任务，并在安装 runner 后再 enqueue
- [x] 增加 `task inspect <id>`，集中展示 `task.json`、queue 状态、latest run、sessionRef、artifact 列表

## P3

- [ ] 设计 workspace 清理策略：任务目录、run 记录、managed artifacts、孤儿 spec 目录的保留与删除规则
- [ ] 设计并实现 runner session 恢复策略：可复用 session 时复用旧 `workdir/`，不可复用时创建新的 run 记录并明确上下文边界
- [ ] 设计 API 层前的稳定读模型：任务列表、任务详情、run 历史、schedule 状态如何对外暴露
