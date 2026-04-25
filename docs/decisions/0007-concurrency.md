# 0007 Concurrency

日期：2026-04-23

## 结论

第一版 Orchestrator 采用全局串行执行模型：

- 同一时刻只执行一个任务
- 全局并发度固定为 `1`
- Scheduler 可以持续产生 `pending` 任务
- 但 Orchestrator 只会串行消费它们

## 已确认规则

### 1. 并发模型

- Orchestrator 主循环一次只拉起一个任务进入 `running`
- 在当前任务离开 `running` 前，不再启动新的任务
- `pending` 队列可累积多个任务，按既定顺序等待消费

### 2. 范围

- 该限制是全局限制，不按 `TaskType`、runner 或 schedule 再细分
- 第一版不支持并发上限配置，也不支持按 runner 维度的独立配额

### 3. 后续扩展

- 如果未来需要并发，应作为单独设计扩展
- 扩展时需要同时定义：
  - 全局并发上限
  - 队列选择策略
  - `schedule-state` / `task.json` 的并发一致性处理
  - crash recovery 在并发模型下的行为

## 原因

这样设计的目标是：

- 降低第一版 Orchestrator 的实现复杂度
- 减少并发下的状态竞争和恢复复杂度
- 先把生命周期、结果协议和目录模型做稳
