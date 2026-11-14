# 归档（Archive）

> 已完成阶段的文档统一存放于此。**仅供历史查阅，不主动读取**。
> 活跃文档只留在 `docs/` 的 `guide/` `reference/` `engineering/` `postmortem/`。

## 归档规则

- **何时归档**：文档描述的阶段已结束，不再需要作为当前事实被读取。
- **归档对象**：一次性调研、已完成的重写/迁移记录、被取代的方案。
- **不归档**：当前架构（`engineering/architecture.md`）、API 参考、使用指南、postmortem（postmortem 本身是长期资产）。
- **归档后**：在 [docs/README.md](../README.md) 的存档分类登记一行，标注「历史记录，不主动读取」。

## 已归档条目

| 文档 | 说明 |
|---|---|
| [gallery-dl.md](gallery-dl.md) | Python 原版 gallery-dl 的 Instagram 模块架构分析（生成器管线、生命周期、提取器清单）。TypeScript 重写已完成后仅作对照参考；现行架构见 [engineering/architecture.md](../engineering/architecture.md) |

## 常见问题

- **为什么归档？** 已完成阶段的文档留在活跃区会让每次读上下文都重放历史，浪费预算并可能误导当前决策。
- **想找回旧内容？** git 历史始终可追溯。
