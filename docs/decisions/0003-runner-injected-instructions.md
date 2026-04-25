# 0003 Runner Injected Instructions

日期：2026-04-22

## 结论

runner 在启动 agent 时，应统一注入最小且稳定的系统说明。任务模板或 `task.md` 只描述任务业务内容，不重复定义系统协议。

## 已确认规则

### 1. 注入职责

- 系统统一注入执行边界与结果协议
- `task.md` 只负责任务业务内容
- 不同任务不应各自重复定义 `AgentResult` 协议

### 2. 必须注入的固定说明

runner 启动 agent 时，至少要明确告知以下内容：

- 当前工作目录是任务的 `workdir/`
- 应先读取 `task.md` 了解任务
- 如有需要，再读取 `workdir/` 下的其他文件
- 若该任务类型存在 guide，可按系统提供的绝对路径将其作为补充材料读取
- 不应把 `task.md` 或任务材料文件当作运行期状态存储
- 所有运行期修改、生成、整理文件都应在 `workdir/` 内进行

所有任务都应注入一个 `shared-state` 绝对路径：

- 对普通任务，它指向该任务自己的长期执行目录，可视为任务级持久状态目录
- 对定时任务，它指向 `workspace/schedules/<scheduleId>/shared-state/`

若任务由 schedule 生成，还应额外明确：

- `workspace/schedules/<scheduleId>/shared-state/` 的绝对路径
- 该目录是同一 schedule 下多个任务实例共享的业务状态目录
- agent 可以按任务需要读写该目录
- 管理器不解析其中内容
- agent 不应把业务状态写回 `task.md` 或任务材料文件
- agent 不应自行发明其他跨任务状态路径

### 3. AgentResult 协议

系统统一注入 `AgentResult` 协议，第一版最小结构如下：

```json
{
  "status": "success | paused | blocked",
  "reason": "可选；paused/blocked 时应填写",
  "artifactRefs": ["相对路径列表，可选"]
}
```

并明确告知：

- `status = success`：任务已完成
- `status = paused`：当前缺少继续执行条件，等待后续恢复
- `status = blocked`：任务当前不可继续，建议终止

### 4. AgentResult 文件位置

- agent 固定将结果写入当前工作目录下的 `agent-result.json`
- 不要求 agent 直接写 `runs/<runId>/` 下的文件
- 当前工作目录即任务的 `workdir/`
- 该文件由 runner 在执行结束后读取、校验并复制归档
- 若文件不是合法 JSON，或字段不符合协议，runner 应生成兜底 `error`

### 5. artifactRefs 规则

- `artifactRefs` 只能填写相对 `workdir/` 的相对路径
- `artifactRefs` 不限制具体文件格式
- `artifactRefs` 只应引用最终或关键产物，不必枚举全部中间文件
- 管理器会对这些路径执行统一 artifact intake

### 6. error 的职责边界

- `error` 不属于 agent 主动产出的任务结果状态
- agent 只负责产出 `success | paused | blocked`
- runner / 系统在进程异常、结果缺失、结果非法时生成兜底 `error`

### 7. 当前 runner 自动执行策略

第一版 runner 默认采用自动执行模式，由 runner 自己承担非交互执行策略。

当前实现约定：

- Claude runner 以非交互 print 模式执行，并使用 `bypassPermissions`
- Codex runner 以 `exec --full-auto` 执行
- 这些策略属于当前 runner 默认实现，用于减少无人值守执行中的交互阻塞
- 这是 runner 级实现策略，不是所有 runner 必须共享的协议
- 若后续需要更严格的权限模型，应作为 runner 策略演进单独调整

## 原因

这样设计的目标是：

- 让系统协议只定义一次，避免任务模板各写各的
- 保持任务内容和系统协议分层
- 收敛 agent 的工作边界，只让它关注 `workdir/` 与 `task.md`
- 让 runner 更容易做统一校验、归档和错误兜底
