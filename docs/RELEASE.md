# 发布流程

Drift 通过 npm 发布，包名为 `@goodyorkye/drift`。

## 发布前检查

```bash
npm run typecheck
npm test -- --run
npm run build
npm pack --dry-run
```

确认 npm 包中包含 `dist/`、`task-types/`、`README.md`、`LICENSE` 和 `package.json`，并确认没有包含 `workspace/`。

## 发布到 npm

登录 npm：

```bash
npm login
npm whoami
```

升级版本并发布：

```bash
npm version patch
npm publish
git push --follow-tags
```

项目根目录的 `.npmrc` 会让当前项目的 npm 命令默认使用 npm 官方 registry。
