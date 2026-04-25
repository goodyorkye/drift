# 贡献指南

感谢你愿意帮助改进 Drift。

## 本地开发

```bash
npm install
npm run typecheck
npm test -- --run
npm run build
```

Drift 会把运行时数据写入 `workspace/`。请不要提交 `workspace/`、`dist/`、`node_modules/`、本地日志、任务输出或任何凭据。

## 设计原则

Drift 是任务生命周期管理器，不是任务业务逻辑引擎。任务相关的具体行为应放在任务材料、任务类型 guide 或执行 agent 中。

修改核心行为前，建议先阅读：

- [docs/DESIGN.md](docs/DESIGN.md)
- [docs/decisions/](docs/decisions/)

## Pull Request

- 保持改动聚焦。
- 行为变更需要补充或更新测试。
- 提交前请运行 typecheck、测试和 build。
- CLI 行为变化时，请同步更新用户文档。
