# 文档索引

> `@chilfish/gallery-dl-instagram`（CLI: `dl-ins`）的内部文档中央索引。新增文档请登记到对应分类。
>
> 约定：**文档即事实** —— 文档与代码不一致时以代码为准，并修正文档；**文档先行（仅三类）** —— 只有「公开契约变化 / 新增或修改端点 / 事故与可靠性修复」必须先写文档，其余改动当天补一条开发日志。

## 产品定位

TypeScript 移植版 Instagram 媒体提取器：平台无关核心（只依赖 `HttpClient` / `Storage` / `Logger` 三个接口）+ Node.js adapter + CLI。提取器产出 `Message` 流，由 `Job` 消费——同一套核心可跑在 Node.js、Bun、浏览器、Deno、Edge。

原 Python 实现为 [gallery-dl](https://github.com/mikf/gallery-dl)，其 Instagram 模块架构分析存档于 [archive/gallery-dl.md](archive/gallery-dl.md)（历史参考，不主动读取）。

## Agent 使用文档

| 文档 | 说明 | 何时阅读 |
|---|---|---|
| [AGENTS.md](../AGENTS.md) | 仓库级硬约束 + 常用命令 + 文档导航 | 任何开发任务开始前 |
| [postmortem/README.md](postmortem/README.md) | 事故索引 + 高频雷区自查清单 | 写码前 |
| [engineering/code-style.md](engineering/code-style.md) | 命名、注释、模块划分、禁止事项 | 写代码前 |
| [engineering/testing.md](engineering/testing.md) | 测试分层、mock 设施、Cookie 配置 | 加测试前 |

## guide/ — 使用指南

面向使用者（SDK 调用方 / CLI 用户）。

| 文档 | 说明 |
|---|---|
| [sdk.md](guide/sdk.md) | 快速开始、三层 API、浏览器 & Deno 适配、配置项、类型契约 |
| [cli.md](guide/cli.md) | CLI 命令与全部生效选项、认证、输出结构、排障 |

## reference/ — 参考手册

| 文档 | 说明 |
|---|---|
| [api-reference.md](reference/api-reference.md) | 全量导出面：Core / Config / Message / HTTP 接口 / Instagram 模块 / Utils |
| [python-parity.md](reference/python-parity.md) | Python gallery-dl → TypeScript 的差异、功能矩阵、类型映射 |

## engineering/ — 工程与架构

| 文档 | 说明 | 何时阅读 |
|---|---|---|
| [architecture.md](engineering/architecture.md) | 流水线、生命周期、消息协议、API 层、分页引擎、配置系统、设计决策 | 任何架构级变更前 |
| [cli-architecture.md](engineering/cli-architecture.md) | CLI 入口、命令树、选项→配置的映射、新增命令流程 | 添加/修改 CLI 命令 |
| [code-style.md](engineering/code-style.md) | 注释规范、TypeScript 约定、项目惯例、禁止事项 | 写代码前 |
| [testing.md](engineering/testing.md) | 单元 / 集成测试分层、`MockHttpClient`、Cookie 与 `.env` | 新增测试、排查测试失败 |
| [build-and-release.md](engineering/build-and-release.md) | tsdown 双构建、产物形状、exports/bin 约束、发包检查 | 改构建配置、发布前 |
| [git-workflow.md](engineering/git-workflow.md) | Commit / PR / 发布规范、验证门禁、OIDC 发布凭据 | 提交、开 PR、发版前 |
| [release-checklist.md](engineering/release-checklist.md) | 版本纪律、发布前门禁、真实环境冒烟、发布步骤与核验 | 每次里程碑发布 |

## postmortem/ — 事后分析

| 文档 | 说明 |
|---|---|
| [README.md](postmortem/README.md) | 索引表 + **高频雷区自查清单** + 新增一条的流程 |
| [TEMPLATE.md](postmortem/TEMPLATE.md) | 事故报告模板 |
| [001](postmortem/001-axios-to-native-fetch.md) | axios 依赖导致 CLI 自包含失败 |
| [002](postmortem/002-circular-dependency-extractors-jobs.md) | 模块化拆分引发 ESM 循环依赖 |
| [003](postmortem/003-binary-download-csrf.md) | 二进制下载损坏 & CSRF Cookie 不匹配 |
| [004](postmortem/004-queue-dispatch-missing-deps.md) | Queue 分发时子提取器缺少父依赖 |
| [005](postmortem/005-music-metadata-nesting-mismatch.md) | `MusicMetadata` 类型与真实 API 响应不匹配 |
| [006](postmortem/006-stories-user-resolution.md) | stories `User not found` 与 REST `reels_media` 失效 |
| [007](postmortem/007-highlight-page-payload.md) | highlight 直链只走 REST，页面 payload 形状与 `__typename` 分流失配 |
| [008](postmortem/008-rest-feed-deprecation.md) | 用户 feed REST 端点退役，改用 doc_id GraphQL + 降级链 |

## archive/ — 存档

历史记录，**不主动读取**。

| 文档 | 说明 |
|---|---|
| [README.md](archive/README.md) | 归档约定与目录 |
| [gallery-dl.md](archive/gallery-dl.md) | Python 原版 Instagram 模块架构分析（迁移期参考） |

## 约定

- 内部文档使用中文；代码标识符、CLI 选项、字段名保留英文。
- **文档即事实**：路径、命令、选项、字段必须与当前代码一致；发现不一致以代码为准并修正文档。
- **文档先行（仅三类）**：公开契约变化 / 新增或修改端点 / 事故与可靠性修复，先写文档再写代码；内部重构、测试、常规 bugfix 在开发日志补一条即可。
- **归档**：不再需要主动阅读的阶段文档移入 `archive/`。
- **Postmortem**：遇到返工或事故，按 [TEMPLATE.md](postmortem/TEMPLATE.md) 沉淀一条，并更新「高频雷区」。
- 新增文档必须在本索引登记一行，标注「说明」与「何时阅读」。
