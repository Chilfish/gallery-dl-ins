# 构建与发布

## 双构建

`tsdown.config.ts` 定义两个构建目标：

| 目标 | 入口 | 平台 | 格式 | 产物 |
|---|---|---|---|---|
| SDK | `src/index.ts`, `src/node.ts` | `neutral` | esm + cjs | `dist/index.js` / `.cjs`、`dist/node.js` / `.cjs` + `.d.ts` / `.d.cts` |
| CLI | `src/cli/index.ts` | `node` | esm | `dist/dl-ins.mjs`（一个自包含文件） |

```bash
bun run build        # tsdown
bun run typecheck    # tsc --noEmit
```

## 关键配置

```typescript
// SDK — 平台无关
platform: 'neutral',
deps: { neverBundle: [/^node:/, 'undici'] },   // node: 内置模块与可选 peer 保持外部引用

// CLI — 自包含
platform: 'node',
deps: { onlyBundle: ['commander'] },  // 白名单：只有 commander 打进产物
```

- **SDK 的 `neutral` 平台**不解析 `node:` 内置模块，必须显式 `neverBundle`，否则构建报警 `UNRESOLVED_IMPORT`。
- `undici` 是代理功能的**可选 peer 依赖**（`optional`），`src/node-factory.ts` 中懒加载 `ProxyAgent`；必须 `neverBundle`，不能打进 SDK。
- **CLI 的 `onlyBundle` 白名单**：新增需要打包进 CLI 的依赖必须登记，否则 `npx` 环境会 `ERR_MODULE_NOT_FOUND`。见 [postmortem 001](../postmortem/001-axios-to-native-fetch.md)。
- 不要使用 `outExtension`（tsdown v0.23 中不存在该选项，正确的是 `outExtensions`）；当前扩展名由 `format` + `package.json` 的 `type: module` 决定。

## 产物契约

`package.json` 是唯一事实来源：

```json
{
  "type": "module",
  "exports": {
    ".":      { "import": "./dist/index.js", "require": "./dist/index.cjs" },
    "./node": { "import": "./dist/node.js",  "require": "./dist/node.cjs" },
    "./package.json": "./package.json"
  },
  "main":   "./dist/index.cjs",
  "module": "./dist/index.js",
  "types":  "./dist/index.d.cts",
  "bin":    { "dl-ins": "dist/dl-ins.mjs" }
}
```

- **只有两个公开子路径**：`.` 与 `./node`。不存在 `./cli`，CLI 只通过 bin 暴露。
- `files` 只发布 `LICENSE` / `README.md` / `dist`。

## 验证顺序

```bash
bun run build
bun run typecheck
bun run test
```

pre-push 钩子（`lefthook.yml`）会自动跑 `bun run build`。pre-commit 对暂存的代码文件跑 `eslint --fix`。

## 发布前检查

> 发布流程与完整清单见 [git-workflow.md](./git-workflow.md#发布流程) 与 [release-checklist.md](./release-checklist.md)。本仓库通过 tag 触发的 `.github/workflows/publish.yml` 使用 npm Trusted Publisher（OIDC）发布，本地 `npm publish` 只用于排障。

- [ ] `dist/dl-ins.mjs` 顶部没有 `import ... from '<第三方包>'`（只能有 `node:*`）
- [ ] `dist/index.js` / `dist/node.js` 不包含 `node:` 实现代码（应是外部 import）
- [ ] `node dist/dl-ins.mjs --help` 可正常执行
- [ ] `CHANGELOG.md` 有与 `package.json` 版本一致的版本节
- [ ] `package.json` 的 `version` 与 npm 上不一致（避免重复发布）
- [ ] CLI `--version` 读自 `package.json`，无需手工改
