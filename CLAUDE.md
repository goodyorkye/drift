# drift-work

自主 Agent 任务调度执行系统。CLI 命令：`drift`。

## 项目结构速查

| 路径 | 说明 |
|------|------|
| `src/` | TypeScript 源码 |
| `src/types.ts` | 全局类型定义（Phase / TaskType / TaskInstance 等） |
| `src/queue.ts` | 文件队列操作，所有状态转换入口 |
| `src/orchestrator.ts` | 主循环，任务状态机 |
| `src/scheduler.ts` | Cron 调度，独立进程 |
| `src/registry.ts` | 任务类型注册表，加载 task-types/ |
| `src/runners/` | Agent 适配层（claude / codex / ...） |
| `src/cli/` | drift 命令实现 |
| `task-types/` | 任务类型 JSON 定义（流程逻辑，稳定） |
| `tasks/templates/` | Prompt 模板 Markdown |
| `tasks/scheduled/` | 定时任务模板（TaskInstance 格式，无运行时字段） |
| `scheduler/schedules.json` | Cron 调度配置 |
| `queue/` | 运行时状态（不进 git，Orchestrator 维护） |
| `reports/` | 产出报告，按日期目录（不进 git） |
| `logs/` | JSON Lines 日志（不进 git） |
| `docs/` | 设计文档 |

## 核心架构

```
drift CLI → queue/pending/ ← Scheduler (cron)
                ↓
          Orchestrator (状态机)
                ↓
          runners/{agent}.ts
                ↓
          queue/running/{id}.result.json  ← Agent 写入
                ↓
          queue/done/ | blocked/ | waiting/
```

**关键约定**：
- Orchestrator 是唯一的状态转换者，Agent 只写 `result.json`
- 队列转换用 `fs.rename()`，同文件系统内是原子操作
- 任务类型定义（`task-types/`）描述流程，任务实例（`queue/`）只含数据和运行时状态
- 阶段（Phase）定义在任务类型上，实例可通过 `phaseOverrides` 覆盖个别字段

## 队列状态机

```
pending → running → done
                  ↘ pending    (失败可重试)
                  ↘ blocked    (重试耗尽)
         running → waiting     (humanReview 阶段，等待 drift task approve)
         waiting → running     (人工确认后继续)
```

## 开发命令

```bash
npm run dev          # 开发模式（tsx，无需编译）
npm run build        # 编译 TypeScript → dist/
npm test             # vitest
npm run typecheck    # tsc --noEmit，不产生输出文件
```

## 扩展方式

**新任务类型**：`task-types/` 加 JSON + `tasks/templates/` 加模板，不改核心代码。

**新 Agent**：`src/runners/` 下新建类继承 `BaseRunner`，实现 `execute()` 方法，在 `src/runners/index.ts` 注册。BaseRunner 提供 `enforceContract()` 兜底确保 result.json 存在。

## Result Contract

每个任务执行后，`queue/running/{id}.result.json` 必须存在：

```json
{
  "status": "success | blocked | error",
  "reason": "失败原因（失败时必填）",
  "outputFile": "reports/YYYY-MM-DD/type-title.md"
}
```

Orchestrator 只读这个文件判断任务结果，不解析 Agent stdout。

## 详细设计

见 `docs/DESIGN.md`。
