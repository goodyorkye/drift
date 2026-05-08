# 0009 Web UI

日期：2026-05-06

## 结论

Drift 增加本地 Web UI，作为当前 workspace 的观察、审计和轻量控制台。

第一版 Web UI 不做登录、不做权限系统、不做数据库、不做远程多用户平台。它可以显式允许局域网访问，但默认只监听本机地址。

## 定位

Web UI 是 CLI 的补充入口，不是第二套任务系统。

- 状态真相仍由 `workspace/queue/` 与 `task.json` 表达
- 状态转换仍通过核心队列/任务操作入口完成
- Web API 不直接绕过状态机写 queue ticket
- Orchestrator / Scheduler 的生命周期仍由现有核心模块负责
- 任务正文、workdir、shared-state 和 artifacts 仍保持黑盒语义

## 访问模型

默认命令：

```bash
drift web
```

默认监听：

```text
127.0.0.1:8787
```

允许局域网访问时必须显式开启：

```bash
drift web --allow-lan
drift web --host 0.0.0.0
```

只读观察模式：

```bash
drift web --read-only
```

当监听地址不是 localhost 时，启动输出必须提醒用户：当前没有认证，能访问该地址的人可以操作这个 workspace。

## 用户标识

Web UI 不认证用户身份，但记录客户端声明的用户标识用于审计。

浏览器端约定：

- 用户名保存在浏览器 `localStorage`
- 写操作请求必须携带 `X-Drift-User`
- 用户名只用于审计展示，不参与授权判断

服务端约定：

- 写接口缺少合法 `X-Drift-User` 时拒绝请求
- 用户名限制为非空短文本
- 记录为 actor：

```json
{
  "name": "York",
  "source": "web"
}
```

CLI、Scheduler 和系统恢复也可以使用 actor：

```json
{ "name": "local-user", "source": "cli" }
{ "name": "scheduler", "source": "scheduler" }
{ "name": "system", "source": "system" }
```

## 第一版功能

只读能力：

- 查看进程状态和任务状态统计
- 查看任务列表
- 查看任务详情，包括 queue truth、latest run、sessionRef 和 artifacts
- 查看 queue 分组
- 查看 schedule 列表和 schedule-state
- 查看 run 日志

轻量写能力：

- enqueue `not_queued` task
- cancel `not_queued` / `pending` task
- stop `running` task
- remove any non-running task
- resume `paused` task
- rerun `done` / `blocked` task
- abandon `paused` task
- clear historical `done` / `blocked` task instances

任务查看能力：

- 查看 `spec/` 文件列表与任务定义
- 查看 `workdir/` 文件列表与可预览文本文件
- 查看 latest run、runs 历史、stdout/stderr 和 managed artifacts
- 下载 managed artifacts 文件
- 在日志页按当前选中 run 查看 stdout / stderr，并支持 tail 风格跟随

任务创建能力：

- 通过 Task Create Assistant 创建 task 草稿
- 在 Web 工作台中查看草稿文件、编辑 `task.md`、向创建助手发送消息
- 支持在草稿目录中新建空文件与上传附加文件
- 最终创建为 `not_queued` 或直接 enqueue
- 选择 `manual` 创建方式时，不显示创建助手会话区，直接进入草稿编辑流程

`Schedule Create Assistant`、schedule 编辑 UI、artifact 在线编辑仍属于后续扩展。

运行中停止采用持久化 stop request：

- runner 启动后将 `runnerPid` 写入 `run-meta.json`
- Web stop 写入 `runs/<runId>/stop-request.json`
- 如 `runnerPid` 存在，Web API 向 runner 进程发送 `SIGTERM`
- Orchestrator 收尾时识别 stop request，将本次任务结束为 `blocked`，避免按普通 runner error 自动重试

已经在旧版本代码中启动、且 `run-meta.json` 没有 `runnerPid` 的运行中任务，只能记录 stop request；是否能立即中断取决于 runner 进程是否已可定位。

## 前端实现

Web UI 使用独立前端应用实现，避免在 Node server 中继续堆叠内联 HTML。

```text
src/web/client/
  index.html
  src/main.tsx
  src/styles.css
```

构建输出：

```text
dist/web/client/
```

`drift web` 继续由 Node 服务提供 API 与静态文件：

- `/api/*` 由后端处理
- 其他 GET 路径服务 React 构建产物
- 若前端尚未构建，页面提示先运行 `npm run build:web` 或 `npm run build`

开发与发布命令：

```bash
npm run build:web
npm run build
drift web
```

当前前端默认以英文展示，浏览器端可切换为中文并在本地保留语言偏好；用户名也保存在浏览器本地并作为 `X-Drift-User` 传给写接口。

## API 约定

示例接口：

```text
GET  /api/status
GET  /api/tasks
GET  /api/tasks/:id
GET  /api/tasks/:id/runs
GET  /api/tasks/:id/runs/:runId/logs/stdout
GET  /api/tasks/:id/runs/:runId/logs/stderr
GET  /api/queue
GET  /api/schedules
GET  /api/task-create/options
GET  /api/drafts/tasks/:draftId
GET  /api/drafts/tasks/:draftId/files/content?path=task.md

POST /api/tasks/:id/enqueue
POST /api/tasks/:id/resume
POST /api/tasks/:id/rerun
POST /api/tasks/:id/abandon
POST /api/drafts/tasks
POST /api/drafts/tasks/:draftId/files/content
POST /api/drafts/tasks/:draftId/session
POST /api/drafts/tasks/:draftId/finalize
```

写接口必须通过核心 task action 模块执行，并把 actor 传入审计日志。

## 安全边界

局域网不是安全边界。无登录模式下，Web UI 只能用于可信网络。

最低要求：

- 默认只监听 localhost
- LAN 访问必须显式开启
- 写接口必须携带 actor
- 所有文件读取必须限制在 drift workspace 内
- 日志与 artifact 路径必须做归一化和越界检查
- 启动时清楚提示无认证风险
- 可选支持只读模式，禁用所有写接口

## 后续扩展

未来如需远程部署或多人协作，应作为新的设计议题，单独定义认证、授权、审计、并发写入、部署边界和敏感数据处理策略。
