# Postmortem 001 — axios 依赖导致 CLI 自包含失败

**日期**：2026-05-31
**严重程度**：高 — CLI 在 `npx` 环境下无法运行
**影响范围**：所有通过 `npx @chilfish/gallery-dl-instagram` 使用的用户

## 根因分析

### 症状

```bash
$ npx @chilfish/gallery-dl-instagram@latest -v
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'axios' imported from dist/dl-ins.mjs
```

CLI bundle 报 `ERR_MODULE_NOT_FOUND`——`axios` 没有被打包进自包含的 CLI 产物。

### 根因

1. **`deps.onlyBundle` 配置不生效**：tsdown 的 `onlyBundle: ['commander', 'axios']` 声明只打包这两个包，但 `axios` 在 `peerDependencies` 中被声明为可选依赖，tsdown 将其视为外部依赖拒绝打包。

2. **硬编码版本号不同步**：CLI 的 `.version('0.1.0')` 硬编码在 `src/cli/index.ts` 中，package.json 升级到 0.2.0 后两者不一致。

3. **axios 本身就是多余的依赖**：项目只用了 axios 的基础功能（GET/POST + cookie + timeout + maxRedirects），Node.js 18+ 原生 `fetch` 完全覆盖这些需求，且不依赖 `node:fs/promises` 之外的任何外部包。

### 为什么之前没发现

- 本地开发用 `bun src/cli/index.ts` 直接跑 TS，node_modules 里有 axios
- tsdown 构建产物的集成测试缺失——没有 CI 做 `node dist/dl-ins.mjs` 的 smoke test

## 修复方案

### 短期（v0.2.1）

1. 去掉 `deps.onlyBundle`，让 tsdown 默认打包所有依赖——axios 仍然打进 bundle，CLI 可用但体积大
2. 同步硬编码版本号

### 长期（当前版本）

彻底移除 axios 依赖，换用原生 `fetch`：

- 创建 `src/fetcher.ts`：平台无关的 `createFetchHttpClient()`，复用 `buildUrl` / `mergeCookie` / `readBody` / `headersToRecord` 等 helper 函数
- `src/cli/adapter.ts` 从 ~280 行瘦身到 ~80 行——`createHttpClient` 和 `createWebClient` 退化为 `createFetchHttpClient` 的薄包装
- SDK 层 `http` 参数改为可选，默认使用 `createFetchHttpClient()`——浏览器环境零配置可用
- `node-factory.ts` 不再动态 import CLI adapter，直接用 `createFetchHttpClient({ cookie })`

### 效果

- `package.json` 中 `axios` 从 peer/dev deps 全部移除
- CLI bundle 体积：170KB（含 commander），无任何外部运行时依赖
- SDK 在浏览器 / Deno / Edge 零配置即用

## 预防措施

1. **CI smoke test**：每次构建后运行 `node dist/dl-ins.mjs --help` 验证 CLI 可执行
2. **依赖最小化原则**：Node.js 18+ 原生 API 已覆盖 HTTP/fetch/fs/promises，不引入第三方 HTTP 客户端
3. **CLI 构建产物自包含验证**：tsdown 构建后检查产物是否包含 `require('axios')` 等外部 import 语句
4. **版本号单一来源**：CLI 版本应从 `package.json` 动态读取，而非硬编码

## 相关 Commit

- `4bef64e` fix(build): bundle axios into CLI, sync version
- `4587e2a` refactor: replace axios with native fetch, extract shared fetcher
