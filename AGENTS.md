# AGENTS.md

> TypeScript 移植版 Instagram 媒体提取器：平台无关核心（`HttpClient` / `Storage` / `Logger` 三接口）+ Node.js adapter + CLI（`dl-ins`）。
> 原 Python 实现为 [gallery-dl](https://github.com/mikf/gallery-dl)。

## 先读哪里

| 内容 | 文档 |
|---|---|
| 文档总索引 | [docs/README.md](docs/README.md) |
| 写码前自查的高频雷区 | [docs/postmortem/README.md](docs/postmortem/README.md) |
| 架构与流水线 | [docs/engineering/architecture.md](docs/engineering/architecture.md) |
| 代码规范 | [docs/engineering/code-style.md](docs/engineering/code-style.md) |
| 测试分层与 mock | [docs/engineering/testing.md](docs/engineering/testing.md) |
| 构建与产物契约 | [docs/engineering/build-and-release.md](docs/engineering/build-and-release.md) |
| SDK / CLI 用法 | [docs/guide/sdk.md](docs/guide/sdk.md) · [docs/guide/cli.md](docs/guide/cli.md) |

## 命令

```bash
bun install
bun run cli <url> [options]   # 直接跑 TS 版 CLI
bun run typecheck             # tsc --noEmit
bun run lint                  # eslint --fix
bun run test                  # vitest run（默认离线）
bun run test:unit             # 仅单元
bun run build                 # tsdown（SDK + CLI 双构建）
```

pre-commit 跑 `eslint --fix`，pre-push 跑 `build`（`lefthook.yml`）。

## 强制规范

1. **文档即事实**：路径、命令、选项、字段必须与代码一致；发现不一致以代码为准并修正文档。
2. **文档先行（仅三类）**：公开契约变化 / 新增或修改端点 / 事故与可靠性修复，先写文档再写代码。
3. **开写前先读** [高频雷区](docs/postmortem/README.md)，避免重复踩坑。
4. **平台无关层不得 import `node:*`**；需要 fs 的代码只能出现在 `src/cli/storage.ts`。
5. **禁止 `any`**：用 `unknown` + 类型守卫；配置读取统一走 `_cfg(key, default)`。
6. **二进制下载必须 `responseType: 'arraybuffer'`**，二进制被文本解码会损坏文件。
7. **子提取器依赖由父 Job 注入**：`config` / `http` / `storage` / `log` 缺一即静默产出 0 条。
8. **同层模块互引用走注册表**（`extractors/registry.ts`），直接 import 会形成 ESM 循环。
9. **错误带上下文**：`Failed to download ${filename}: …`，不要笼统的 `Download failed`。
10. **不加无意义注释、不做无关重构**；提交按逻辑单元拆分，Conventional Commits。

## 不可协商的约束

- **CLI 产物自包含**：`deps.onlyBundle: ['commander']` 白名单，新增打包依赖必须登记。
- **SDK 为 `neutral` 平台**：`node:` 内置模块必须 `neverBundle`。
- **公开子路径只有 `.` 与 `./node`**，没有 `./cli`；bin 名 `dl-ins`。
- **限流内建**：请求间隔 6–12 秒随机，不提供关闭开关。
- **不硬编码 cookie / token**：从 `--cookies` / `--sessionid` / `.env` 注入。
- **不提交** `data/`、下载文件、`.env`。
- **Instagram CDN URL 带签名**（`stp=`），改参数即 403；分辨率上限短边 1080px。

## 工作流

读文档 → 查高频雷区 → 实现 → `typecheck` + `test` → 更新文档 → 提交。

## 维护本文件

只写每次任务都成立、且无法从代码或 docs 推断的约束。细节写进 `docs/`，这里只留指针。同一规则只留一处，发现矛盾先修再新增。
