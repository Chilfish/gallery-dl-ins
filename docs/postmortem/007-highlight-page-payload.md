---
编号: 007
主题: highlight 直链只走 REST，页面 payload 形状与 `__typename` 分流双重失配
日期: 2026-11-18
严重度: 中 — highlight 直链完全不可用，user stories 正常
根因归类: 类型假设 / 端点退化 / 单一数据源
---

# 007 — highlight 直链提取失败：页面 payload 未解析 + `__typename` 误判

## 摘要

`/stories/highlights/{id}/` 一律走 REST `reels_media`，而该端点对网页 session 已返回 500，于是整条路径没有可用数据源。同时 highlight 页面内嵌的是另一种形状 `xdt_api__v1__feed__reels_media__connection.edges[].node`，`html-payload` 不识别；即便补上解析，node 上的 `__typename: 'XDTReelDict'` 又会让基类误走 GraphQL 解析器并访问不存在的 `owner.id` 而崩溃。

## 影响

- `ig.extract('https://www.instagram.com/stories/highlights/{id}/')` 必定 500，或补完 payload 后崩溃。
- user stories 不受影响（页面 payload 形状不同，且不带 `__typename`）。
- 改动集中在 `html-payload.ts` / `stories.ts` / `base.ts` / `highlights.ts` + 4 个测试文件。

## 时间线

| commit / 事件 | 说明 |
|---|---|
| issue #3 | 给出两组 payload 样本、REST 500 现场与 `owner.id` 崩溃栈 |
| 本次修复 | connection 解析、highlight 页面优先、`items` 优先分流、pattern 收紧、离线回归 |

## 根因分析

1. **类型假设只覆盖一种页面**：`_storyFromPage()` 只请求 `/stories/{user}/`，highlight 被硬编码为 `highlightId ? null : …`，等于主动放弃页面数据源。
2. **payload 形状不止一种**：页面按路由渲染不同结构。`xdt_api__v1__feed__reels_media` 只对应 user stories；highlight 是 GraphQL connection，需要 `edges[].node` 映射。
3. **分流依据过窄**：`items()` 仅看 `__typename` 是否存在。highlight node 带 `__typename` 但仍是 REST reel 形状，GraphQL 解析器无法处理后者的字段集。
4. **URL 归属靠 resolve 顺序**：`InstagramHighlightsExtractor.pattern` 也会匹配 `/stories/highlights/{id}/`，仅因注册表顺序才落到 Stories，属于隐性依赖。

## 做得对的地方

- issue 直接给出了真实 payload 与崩溃栈，省去抓包。
- 已有 `MockHttpClient` 与页面 payload 测试设施，回归可以完全离线。

## 行动项

### 缓解

- [x] `html-payload.ts` 同时识别 `reels_media` 与 `reels_media__connection.edges[].node`。
- [x] `stories.ts` 的 `_storyFromPage()` 泛化为 `_reelsFromPage()`，highlight 请求 `/stories/highlights/{id}/` 并优先使用页面 payload。
- [x] highlight 不从 items 推导 `expiring_at`（缺失即类型标记），user stories 仍从 items 推导。
- [x] `base.ts` 分流改为 `post.items` 优先 REST，避免 `__typename` 误判。
- [x] `InstagramHighlightsExtractor.pattern` 加负向前瞻，不再匹配 `/stories/…`。
- [x] 页面 payload 的 node 自带 `user` / `title`，不再需要额外解析用户名。

### 预防

- [x] 单测：connection 形状解析、二层 pattern 归属、SDK resolve。
- [x] 集成测试：highlight 直链仅 mock 页面 HTML（无 REST 路由），并覆盖 `__typename: 'XDTReelDict'` + `items` 分流。
- [x] 真机探针 `bun run scripts/probe-stories.ts highlight <url>` 验证 12 条 media 产出。

## 教训

- 同一功能的不同路由可能有不同渲染形状，页面抓取要按路由分别验证。
- 分流判断要基于形状特征（`items`）而非单个标记字段（`__typename`）。
- 直链归属应写进 pattern，不要依赖注册表顺序。
