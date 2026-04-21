# 功能开发 - 实现阶段

## 前置条件

- 已在 git 分支 `drift/{taskId}` 上工作（由 Orchestrator 创建）
- 方案文档已在 `reports/{YYYY-MM-DD}/plan-{taskId}.md` 中

## 执行流程

1. 读取方案文档，按"实现顺序"逐步执行
2. 遵循方案中的文件变更清单
3. 每个主要步骤完成后确认结果符合预期
4. 实现完成，写入 result.json

## 决策规则

- 遇到方案未覆盖的情况：选择最保守方案，在 result.json reason 中说明
- 实现过程中发现方案有误：记录差异，继续用最合理的方式实现
- 3 次尝试后仍有错误：写入 result.json `{"status": "blocked", "reason": "..."}`

## 成功标准

- 所有方案中列出的文件变更已完成
- 无明显语法错误
- 写入 result.json `{"status": "success"}`
