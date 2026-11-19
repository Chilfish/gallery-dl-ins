---
编号: 008
主题: 用户 feed REST 端点全面退役，缺少 doc_id GraphQL 退路
日期: 2026-11-19
严重度: 高
根因归类: 端点退化 / 依赖假设
---

# 008 — 用户 feed REST 端点全面退役，缺少 doc_id GraphQL 退路

## 摘要

Instagram 下线了网页端的一整批用户 REST 端点：`/v1/feed/user/{id}/`、`/v1/clips/user/`、`/v1/usertags/{id}/feed/`、`/v1/highlights/{id}/highlights_tray/`。请求不再返回 JSON，而是 404/403 或 200 HTML 壳（`no-js not-logged-in` / SPA shell）。移植版此前只有 REST 一条路径，导致用户帖子、Reels、tagged 全部取不到。修复方式是以 Relay `doc_id` GraphQL 为主路径，保留 REST 与页面 payload 作为降级链。

## 影响

- 受影响功能：`posts` / `reels` / `tagged` / `info`（`userById`）四个子提取器。
- 直接表现：`Instagram API error 404`、`non-JSON response`、`User not found`，或 200 HTML 被当作空数据。
- 隐藏风险：旧 `query_hash` GraphQL 也已退役，`--api graphql` 同样是死路径；错误信息无法区分「未登录」「端点下线」「doc_id 过期」。

## 时间线

| commit / 事件 | 说明 |
|---|---|
| `ed1b278` | 0.2.6 发布，用户 feed 仍走 REST |
| #4 | 实测 REST feed 对所有 id 返回 404 HTML；doc_id GraphQL 可用 |
| 本次修复 | 新增 posts/tagged/reels/profile 四个 doc_id 路径与降级链 |

## 根因分析

- **端点假设未验证**：Python 原版仍写 `/v1/feed/user/<id>/`，移植时直接照搬；没有定期用真实会话验证端点存活。
- **单一数据源**：`userFeed` / `userClips` / `userTagged` 只有一条 REST 路径，没有 GraphQL 或页面 payload 退路。
- **错误分类不足**：`_call` 只区分「非 2xx」与「非 JSON」，没有识别 200 HTML 里的 `not-logged-in` / `challenge` / `feedback_required`。
- **限流未覆盖 API**：`_call` 直接走 `http.request`，绕过 `Extractor.request` 的 6–12s 间隔，连续调用更容易触发 429。
- **POST 编码假设**：REST 客户端统一 `JSON.stringify`，而 IG 的 POST 端点期望 `application/x-www-form-urlencoded`。

## 做得对的地方

- 所有 API 请求集中在 `_call()`，改一处即可接入节流、错误分类与 form 编码。
- stories / highlights 已有页面 payload 解析，证明「HTML 内嵌数据」是可靠退路。
- 单元测试用 `FakeHttp` 路由模拟，可以在不触网的情况下覆盖 doc_id 形状与降级链。

## 行动项

### 缓解（针对已发生的具体缺口）

- [x] `api.ts` 新增 `DOC_IDS`：profile `28036671149327607`、posts `27014165781614298`、tagged `29179217291735675`、reels `28280418711631396`。
- [x] 新增 `_ensureLsd()`、`_graphql()`、`_graphqlPagination()`；先试 `i.instagram.com/api/graphql`，再试 `www.instagram.com/api/graphql`。
- [x] `userFeed` / `userClips` / `userTagged` / `userById` 改为 GraphQL → REST → 页面 payload 降级。
- [x] `_call()` 识别 200 HTML 的 `not-logged-in` / `challenge` / `feedback_required`，以及 JSON `status:"fail"`。
- [x] `_call()` 接入父提取器的节流请求；POST 改为 form-encoded。
- [x] `mergeCookie()` 按 cookie 名去重，避免重复 `csrftoken`。
- [x] `DownloadJob.handleQueue()` 透传 `csrfToken` / `wwwClaim` / `lsdToken`。
- [x] 补充单元与集成测试：doc_id 响应形状、分页、降级、form 编码、错误语义。

### 预防（针对整类问题）

- [x] Postmortem 索引新增本条，并在高频雷区补「REST 端点退化要有 doc_id / 页面 payload 退路」。
- [x] `architecture.md` 记录 GraphQL 主路径、降级顺序与错误语义。
- [ ] 每个版本发布前用真实会话跑一次 `posts` / `reels` / `tagged` / `info` 冒烟。

## doc_id 刷新方法

doc_id 随 Instagram 前端构建轮换。失效时按以下步骤更新 `src/instagram/api.ts` 的 `DOC_IDS`：

1. 用有效 cookie 抓取 `https://www.instagram.com/{username}/`、`/{username}/tagged/`、`/{username}/reels/`。
2. 从页面 `<script src="https://static.cdninstagram.com/...">` 下载 JS bundle。
3. 搜索 `__d("<OperationName>_instagramRelayOperation",[],(function(...){a.exports="<doc_id>"})`，其中：
   - posts：`PolarisProfilePostsQuery_instagramRelayOperation`
   - tagged：`PolarisProfileTaggedTabContentQuery_instagramRelayOperation`
   - reels：`PolarisProfileReelsTabContentQuery_instagramRelayOperation`
   - profile：`PolarisProfilePageContentQuery_instagramRelayOperation`
4. 同一 bundle 的 `__d("Polaris<...>Query.graphql"` 模块给出变量定义与响应字段（`edges` / `node.media` / `page_info`）。
5. 用 `POST https://i.instagram.com/api/graphql`（`doc_id` + `variables` + `lsd`）验证，再更新常量与测试。

## 教训

- REST 端点不会永远存在；每条数据路径都要有第二个来源（doc_id GraphQL 或页面 payload）。
- 分流看响应形状（`image_versions2` + `user`），不要看 `__typename`——GraphQL 节点也可能带 `__typename` 但仍是 REST 形状。
