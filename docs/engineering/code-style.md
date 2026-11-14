# 代码规范

> 硬约束在 [AGENTS.md](../../AGENTS.md)，本文件给理由与示例。

## 注释

- **禁止手写分隔线**（`// ─────`、`// ----`）。分组用 JSDoc 的 `/** Section Name */`。
- 函数、类、接口用标准 JSDoc；**只在声明能说明什么**——不要复述签名。
- 冗余标签直接删。`/** Post ID */ postId: string` 在类型已明示时是噪音。
- 用 `` `` `` 包代码标识符，与项目其余 JSDoc 保持一致。

```typescript
/** One-time async setup. Safe to call multiple times. */
async initialize(): Promise<void> { … }

/** Extract csrftoken value from a Cookie header string. */
export function extractCsrf(cookies: string): string { … }
```

## TypeScript

- `strict` + `strictNullChecks` + `verbatimModuleSyntax`。type-only import 必须写 `import type`。
- **禁止 `any`**。不确定的形状用 `unknown` + 类型守卫；确实需要时收窄到边界层并加注释。
- 用 discriminated union 建模多态数据（`Message`、`ConfigValue`），不要用可选字段堆砌。
- 导出面只通过 barrel（`src/index.ts`、`src/instagram/index.ts`、`src/cli/*`）；内部模块不要被外部路径引用。

## 模块划分

按职责拆文件，单文件巨型脚本视为缺陷：

```
core/       平台无关：Extractor / Job / DownloadJob / PrintJob / format
instagram/  Instagram 领域：base / api / parsers / types / extractors
cli/        Node.js 绑定：index(命令) / options / runner / adapter / storage / cookies
utils/      纯函数：id-codec / text
```

- **一个提取器一个文件**，文件名用 kebab-case（`posts-list.ts`）。
- **平台无关层不得 import `node:*`**。需要 fs 的代码只能出现在 `src/cli/storage.ts`。
- 共享常量只写一处（`APP_ID`、`UA`、`BASE_RE`）。

## 项目惯例

- **`Ref<T>` 而非 EventEmitter**：`InstagramExtractor` ↔ `InstagramRestAPI` 共享 CSRF / WWW Claim / cursor。
- **配置读取走 `_cfg(key, default)`**，路径自动为 `[extractor, category, subcategory]`；不要直接读 `process.env`。
- **限流内建**：`requestInterval = [6, 12]`，`_throttle()` 在每次 `request()` 前 sleep；不提供关闭开关。
- **错误带上下文**：`Failed to download ${filename}: …` 而不是 `Download failed`。

## 禁止事项

| 禁止 | 原因 |
|---|---|
| 引入第三方 HTTP 客户端 | 原生 `fetch` 已覆盖；CLI 需自包含 |
| 在核心层 `console.log` | 必须走 `Logger` 接口 |
| 硬编码 cookie / token | 从 `--cookies` / `--sessionid` / `.env` 注入 |
| 提交 `data/`、下载文件、`.env` | 已在 `.gitignore` |
| 递归方式分页等待 | 用 `while` 循环，避免深层 Promise 链 |
