# 安全说明

Drift 会启动本地 agent runner，并在 `workspace/` 下保留任务材料、日志、运行输出和 artifacts。

## 报告安全问题

请优先通过私密渠道联系维护者，不要直接公开披露安全细节。如果暂时没有私密联系方式，可以在 GitHub issue 中只写最少背景信息，并请求安全联系渠道。

## 敏感数据

请不要提交：

- `workspace/`
- `.env` 文件
- 包含密钥的任务材料
- 含凭据或私密 prompt 的 runner 日志
- 复制到 shared-state 或 workdir 中的私有仓库
- 包含私有数据的生成产物

共享 Drift workspace 前，请先检查任务材料、日志和 artifacts。

## Runner 风险

执行 runner 可能调用外部工具或 agent CLI。请只在你信任的目录中运行 Drift，并确认所选 runner 可以读取和写入当前任务工作文件。
