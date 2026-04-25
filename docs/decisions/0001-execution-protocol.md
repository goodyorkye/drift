# 0001 Execution Protocol

日期：2026-04-22

## 结论

系统将任务结果协议、执行记录协议和任务工作目录职责明确分层：

- agent 只负责在 `workdir/` 内工作，并写出任务语义结果
- runner / 管理器负责维护 run 级执行记录、校验结果、复制归档产物
- `TaskInstance` 使用长期 `workdir/`
- 每次启动 runner 都生成新的 `RunRecord`

## 已确认规则

### 1. 任务工作目录

- 每个 `TaskInstance` 有独立长期工作目录
- 任务初始化时，将 `spec/` 原样复制到 `workdir/`
- 后续 `resume` / 重试继续复用同一个 `workdir/`
- `rerun` 表示“从头重跑该任务实例”
- `rerun` 时，先将 `workdir/` 重置为最新 `spec/` 的副本，再重新入队
- 任务结束后默认保留 `workdir/`，不自动删除

### 2. AgentResult 文件位置

- agent 固定将结果写入当前工作目录下的 `agent-result.json`
- agent 不直接写 `runs/<runId>/` 下的文件
- 当前工作目录即任务的 `workdir/`
- 每次新 run 启动前，runner 先删除旧的 `workdir/agent-result.json`

### 3. AgentResult 结构

```json
{
  "status": "success | paused | blocked",
  "reason": "可选；paused/blocked 时应填写",
  "artifactRefs": ["相对路径列表，可选"]
}
```

- `status` 是任务结果状态，不是运行状态
- `artifactRefs` 必须是相对 `workdir/` 的相对路径
- `artifactRefs` 不限制具体文件格式
- `error` 不由 agent 主动产出；由 runner / 系统在异常时兜底生成

### 4. artifact intake

- 管理器读取 `artifactRefs` 后执行统一 intake
- intake 默认使用“复制”，不默认移动
- 产物的最终搬运、归档、标准化落点、清理由管理器负责
- 原始 `workdir/` 现场默认保留

### 5. RunRecord 与 run 目录

- 每次启动 runner 都生成新的 `RunRecord`
- `resume` 也生成新的 `RunRecord`
- `rerun` 也生成新的 `RunRecord`
- `runId` 表示一次执行尝试
- `sessionRef` 表示 agent 会话
- 多个 `RunRecord` 可以共享同一个 `sessionRef`

推荐目录：

```text
workspace/tasks/<taskId>/
  spec/
  workdir/
  runs/
    <runId>/
      run-meta.json
      agent-result.json
      stdout.log
      stderr.log
      intake.json
  managed-artifacts/
```

### 6. agent-result.json 的归档

- runner 在执行结束后读取并校验 `workdir/agent-result.json`
- 校验通过后，复制到 `runs/<runId>/agent-result.json`
- 如果文件不存在、不是合法 JSON、字段非法，runner 生成兜底 `error` 结果
- 不要求 agent 实现额外的原子写入协议；runner 只在 agent 进程结束后读取结果文件

### 7. run-meta.json

- `run-meta.json` 由 runner / 管理器维护，不由 agent 写入
- 在启动 runner 前先创建 `runs/<runId>/run-meta.json`
- 初始状态写为 `running`
- 执行结束后更新为最终状态

推荐最小结构：

```json
{
  "runId": "run-001",
  "taskId": "task-123",
  "runner": "claude",
  "trigger": "initial | resume | retry",
  "status": "running | finished | failed",
  "startedAt": "2026-04-22T10:00:00.000+08:00",
  "finishedAt": "2026-04-22T10:03:21.000+08:00",
  "sessionRef": "optional",
  "logRefs": {
    "stdout": "stdout.log",
    "stderr": "stderr.log"
  },
  "agentResultRef": "agent-result.json",
  "reason": "optional",
  "runnerEnv": {
    "TARGET_REPO": "/path/to/repo"
  }
}
```

其中：

- `run-meta.status` 表示运行状态：`running | finished | failed`
- `AgentResult.status` 表示任务结果状态：`success | paused | blocked`
- 二者不共用同一套状态枚举
- `run-meta.json` 中的时间字段使用当前运行环境时区的 ISO 8601 带偏移格式
- `runnerEnv` 是本次 run 实际注入的环境变量快照，从 `task.json.runnerEnv` 复制而来，用于审计和调试
- `trigger` 只表示本次 run 的来源：
  - `initial`：首次执行
  - `resume`：从 `paused` 恢复后的再次执行
  - `retry`：失败或阻塞后的重试执行

## 原因

这样设计的目标是：

- 收敛 agent 的工作边界，只让它在 `workdir/` 内活动
- 把任务结果和执行元数据明确分层
- 保留任务现场，便于 `resume`、人工核查和失败排查
- 保持任务管理器只做任务管理，不介入任务业务内容
