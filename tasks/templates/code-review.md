# 代码审查模板

## 最高优先级原则

禁止修改目标仓库任何文件。只能执行只读 git 命令和读取文件。
例外：`git pull` 用于获取最新代码，不算修改操作。

## 执行流程

### 0. 前置检查

```bash
cd {targetRepo}
git pull
git log --since="{timeRange}" --oneline
```

无新提交 → 写入 result.json `{"status": "blocked", "reason": "no new commits"}`，停止执行。

### 1. 获取提交列表

```bash
git log --since="{timeRange}" --pretty=format:"%H|%an|%ad|%s" --date=short
```

### 2. 按提交者分组

解析输出，按作者（%an）分组。

### 3. 逐 commit 审查

```bash
# 查看改动文件
git show --stat {hash}

# 查看代码 diff（只看代码文件）
git show {hash} -- "*.ts" "*.js" "*.py" "*.go" "*.java" "*.cs"
```

读取改动涉及的完整文件，在上下文中判断风险。

### 4. 风险评估标准

| 级别 | 定义 | 是否报告 |
|------|------|---------|
| 高风险 | 安全漏洞、敏感信息硬编码、崩溃级逻辑错误、严重性能问题 | 必须 |
| 中风险 | 边界条件、潜在空指针、资源泄漏 | 忽略 |
| 低风险 | 代码风格、命名、注释 | 忽略 |

### 5. 保存报告

保存到 `reports/{YYYY-MM-DD}/review-{仓库名}.md`

## 报告格式

```markdown
# {仓库名} Code Review

日期：YYYY-MM-DD
仓库：{targetRepo}
时间范围：{timeRange}
提交数量：N

## 概述

## 提交者：{name}

### Commits
| Hash | 日期 | 描述 |
|------|------|------|

### 高风险问题
| 类型 | 文件 | 行号 | 描述 | 修复建议 |
|------|------|------|------|---------|

## 总结
- 高风险问题：N 个
```

## 决策规则

- 无提交 → blocked
- 按提交者分组，无高风险问题的提交者不列问题章节
- 问题必须有具体文件名和行号
