# Postmortem 006 — stories 提取 `User not found` 与 REST `reels_media` 失效

**日期**：2026-11-14
**严重程度**：高 — stories 提取完全不可用，错误信息无法定位
**影响范围**：stories / highlights 用户解析、所有 REST API 错误语义

## 摘要

用户解析失败时，`userByScreenName()` 把三条策略的异常统一吞成 `User not found`，导致 404 / 429 / HTML 壳等真实原因全部丢失。同时 `userByWeb()` 依赖已不稳定的 `"profile_id":"` 特征，而 `_call()` 默认按 JSON 解码响应，遇到 HTML 直接抛 `SyntaxError`。REST `reels_media` 随后对网页 session 返回 500，stories 无任何可用退路。

修复后：`_call()` 保留状态码与 body 摘要；`userByName()` 对齐 `{ data: { user } }`；`userByWeb()` 支持 `page_id":"profilePage_<id>` 并显式按文本读取；stories 先解析页面内嵌 `xdt_api__v1__feed__reels_media`，失败才回退 REST；用户策略链可通过 `user-strategy` 配置。

## 影响

- `ig.extract('https://www.instagram.com/stories/<user>/')` 必定抛 `User not found`。
- 所有 `_call()` 端点的非 2xx 状态码不可见，排障只能靠抓包。
- highlights 依赖同一个 `userId()`，一并受影响。
- 新增 2 个单测文件、1 个 stories 集成用例；改动集中在 `api.ts` / `stories.ts` / `base.ts`。

## 时间线

| commit / 事件 | 说明 |
|---|---|
| issue #2 | 复现并给出现场证据（search 404、web_profile_info 429、页面无 profile_id、REST 500） |
| 本次修复 | 错误语义、`data.user`、web 特征、页面 payload 回退、`user-strategy` |

## 根因分析

1. **错误被统一吞掉**：`userByScreenName()` 的 `catch {}` 丢弃了每条策略的错误；每个方法又都 `throw new Error('User not found')`，异常信息层级扁平。
2. **HTTP 层假设响应必为 JSON**：`readBody()` 默认 `resp.json()`，HTML 响应在状态码被检查之前就抛 `SyntaxError`。`_call()` 也从不检查 `resp.status`。
3. **响应形状错位**：`userByName()` 返回 `data.data`，真实形状是 `{ data: { user } }`，即便请求成功也会得到 `undefined`。
4. **页面特征过期**：`userByWeb()` 只匹配 `"profile_id":"`；页面变体会省略该字段。且它未指定 `responseType: 'text'`，实际永远拿不到 HTML。
5. **单点依赖失效端点**：stories 只有 REST `reels_media` 一条路径；IG 网页端改走 GraphQL 后该端点返回 500，没有页面 payload 退路。
6. **策略不可配**：策略链硬编码，无法在 IG 侧策略失效时绕开。

## 做得对的地方

- issue 提供了逐策略的实测状态码，定位成本低。
- 现有 mock HTTP 测试让回归用例可以完全离线。

## 行动项

### 缓解

- [x] `_call()` 改用文本读取 + 自行 JSON 解析，非 2xx / 非 JSON 均抛出带状态码与 body 摘要的错误。
- [x] `userByName()` 解析 `{ data: { user } }`。
- [x] `userByWeb()` 使用 `responseType: 'text'`，支持 `page_id":"profilePage_<id>` 并回退 `profile_id`。
- [x] `userByScreenName()` 汇总每条策略的失败原因；默认 `search,web`，支持 `user-strategy` 配置。
- [x] `InstagramStoriesExtractor` 先解析 stories 页面 `data-sjs` 内嵌 payload（需 document 导航头），失败回退 `reelsMedia`。
- [x] 页面 payload 缺少 reel 级 `expiring_at` 时，从 items 推导，避免误判为 highlight。

### 预防

- [x] 单测覆盖 `data.user` 解析、非 2xx 抛错、非 JSON 抛错、`page_id` 提取、策略汇总与配置。
- [x] 集成测试覆盖页面 payload 回退。
- [ ] IG 端点/页面结构变化时，优先保留「多来源 + 可配置策略」，不要依赖单一特征字符串。

## 教训

- 错误信息必须保留状态码与响应摘要；`catch {}` 只应出现在确实要忽略错误的地方。
- 任何 HTML 抓取都必须显式 `responseType: 'text'`，并准备多组特征。
