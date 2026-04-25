# 0008 Schedule Shared State

日期：2026-04-23

## 结论

定时任务可以拥有一个 schedule 级别的共享业务状态目录：

```text
workspace/schedules/<scheduleId>/shared-state/
```

该目录用于解决“同一 schedule 多次触发生成多个 `TaskInstance`，但任务业务需要跨次记忆”的问题。

## 已确认规则

### 1. 职责边界

- `shared-state/` 是任务业务状态黑盒目录
- 管理器只负责创建、保留、清理该目录
- 管理器不解析、校验或理解该目录中的业务内容
- 执行 agent 可以按任务需要读写该目录

### 2. 与其他目录的区别

- `spec/` 是任务原件，不写回运行时业务状态
- `schedule-state.json` 是管理器拥有的调度观测状态，不存任务业务状态
- `workdir/` 是单个 `TaskInstance` 的执行现场
- `shared-state/` 是同一 `scheduleId` 下多个执行实例共享的业务状态

### 3. Runner 注入

所有任务在执行时都可以看到一个 `shared-state` 绝对路径：

- 普通任务：该路径指向当前任务自己的长期执行目录
- 定时任务：该路径指向 `workspace/schedules/<scheduleId>/shared-state/`

这样做的目的是让任务定义不需要先区分“这是一次性任务还是定时任务”。

当任务由 schedule 生成，即：

```json
{
  "createdBy": {
    "kind": "schedule",
    "sourceId": "<scheduleId>"
  }
}
```

runner 在启动 agent 时，应注入 `shared-state/` 的绝对路径，并明确：

- 这是唯一被系统明确允许的跨实例业务状态目录
- agent 不应把业务运行状态写回 `task.md` 或任务材料文件
- agent 不应自行发明其他跨任务状态路径

### 4. 创建任务阶段

创建助手只负责整理 `task.md`。

如果用户讨论“多次执行如何不漏、不重、如何记住上次进度”等问题：

- 创建助手应把它整理为任务需求
- 若这是定时任务，可以说明执行期会由系统提供 schedule shared-state 目录
- 创建助手不应自行设计管理器状态文件
- 创建助手不应建议写回任务材料目录或其他系统状态路径
- 创建助手不应写死某个绝对路径到 `task.md`

## 原因

这样设计的目标是：

- 保持任务管理器任务无关
- 不让业务状态污染 `spec/` 与 `schedule-state.json`
- 给定时任务提供通用跨次执行记忆能力
- 让具体状态格式完全由任务自己决定
