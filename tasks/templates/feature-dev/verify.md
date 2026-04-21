# 功能开发 - 验证阶段

## 说明

本阶段由 Orchestrator 自动运行 `verificationCmd`（如 `npm test`）。
Agent 的职责是在验证命令执行**之前**做代码自检，发现明显问题提前报告。

## 执行流程

1. 读取实现的文件，确认无明显语法错误和逻辑问题
2. 检查任务 `acceptance` 字段中列出的验收标准是否满足
3. 写入自检结果到 result.json

验证命令（`npm test` 等）由 Orchestrator 在 Agent 完成后自动运行。
若验证命令失败，Orchestrator 将自动回滚 git 分支。

## 成功标准

- 自检通过：`{"status": "success"}`
- 发现严重问题：`{"status": "blocked", "reason": "具体问题描述"}`
