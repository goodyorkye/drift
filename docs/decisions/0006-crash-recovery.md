# 0006 Crash Recovery

日期：2026-04-23

## 结论

第一版采用保守恢复策略：

- Orchestrator 启动时应检查 `queue/running/` 中遗留的任务
- 这些任务视为上一次进程异常退出后留下的 orphan running 任务
- 系统不自动将其重新放回 `pending`
- 系统将其收敛为失败执行，并移动到 `blocked`

## 已确认规则

### 1. 识别对象

- 在 Orchestrator 启动时，扫描 `queue/running/`
- 对每个仍处于 `running` 的任务执行恢复检查

### 2. 第一版恢复策略

若发现遗留的 `running` 任务：

- 将该任务视为 orphan running 任务
- 若存在最新 `run-meta.json`，则将其更新为 `failed`
- 若存在对应 `runs/<runId>/` 目录，则生成 runner 兜底 `error` 结果
- 若 `runs/<runId>/` 目录根本不存在，则跳过 run 级记录更新
- 将任务从 `running` 迁移到 `blocked`
- 更新 `task.json.status = blocked`
- 更新 `task.json.statusUpdatedAt`
- 更新 `task.json.lastFinishedAt`

### 3. 不自动重入 pending

- 第一版不自动将 orphan running 任务重新放回 `pending`
- 原因是系统无法确认该任务是否已经产生副作用
- 对未知状态的任务，保守地终止并交给人工判断更安全

### 4. 与 Schedule 的联动

- 若该任务由某个 `Schedule` 生成，应继续按 `createdBy.sourceId` 回写对应的 `schedule-state.json`
- 该次恢复导致的最终结果视为一次失败执行，可用于更新该 schedule 的结果统计

## 原因

这样设计的目标是：

- 避免在进程崩溃后对不确定状态的任务进行隐式重试
- 让系统恢复行为简单、可预测、可审计
- 优先保证安全性，而不是自动恢复吞吐
