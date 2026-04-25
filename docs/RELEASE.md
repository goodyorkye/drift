# 发布流程

Drift 通过 npm 发布，包名为 `@goodyorkye/drift`。

## 自动发布

仓库包含 GitHub Actions 工作流：

```text
.github/workflows/publish.yml
```

它会在推送 `v*` tag 时自动发布到 npm：

```bash
npm version patch
git push --follow-tags
```

也可以在 GitHub Actions 页面手动运行 `Publish` workflow。

## 配置 npm Trusted Publishing

推荐使用 npm Trusted Publishing，让 GitHub Actions 通过 OIDC 发布，不需要在 GitHub secrets 里保存长期 npm token。

在 npmjs.com 中进入 `@goodyorkye/drift` 包的设置页，找到 Trusted Publisher，添加 GitHub Actions publisher：

```text
Organization or user: goodyorkye
Repository: drift
Workflow filename: publish.yml
Environment name: 留空
```

注意：

- workflow 文件名只填 `publish.yml`，不要填 `.github/workflows/publish.yml`。
- GitHub 仓库地址需要和 `package.json` 的 `repository.url` 保持一致。
- Trusted Publishing 需要 GitHub 托管 runner；不要用 self-hosted runner 发布。
- 如果 npm 包还不存在，可能需要先手动发布一次，再到包设置中添加 Trusted Publisher。

## 发布前检查

```bash
npm run typecheck
npm test -- --run
npm run build
npm pack --dry-run
```

确认 npm 包中包含 `dist/`、`task-types/`、`README.md`、`LICENSE` 和 `package.json`，并确认没有包含 `workspace/`。

## 手动发布到 npm

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
