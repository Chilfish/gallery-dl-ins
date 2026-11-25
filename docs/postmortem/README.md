# 事后分析索引（Postmortems）

> **开写代码前先读本页。** 历史踩坑与高频雷区在此，对照自查后再动工。
>
> 原则：**blameless** —— 不追「谁写错了」，只追「什么系统条件允许它发生」，然后修系统与流程。

## 索引表

| 编号 | 主题 | 根因归类 | 一句话教训 |
|---|---|---|---|
| [001](001-axios-to-native-fetch.md) | axios 依赖导致 CLI 自包含失败 | 构建配置 / 依赖选型 | 自包含 CLI 不能有外部运行时依赖；构建产物必须 smoke test |
| [002](002-circular-dependency-extractors-jobs.md) | 模块化重构引发循环依赖 | 设计建模 | `export … from` + 反向 import 即循环；同层互引用走注册表 |
| [003](003-binary-download-csrf.md) | 二进制损坏 & CSRF Cookie 不匹配 | 协议细节遗漏 | 二进制必须 `responseType: 'arraybuffer'`；CSRF 要同时进 Cookie 与 header |
| [004](004-queue-dispatch-missing-deps.md) | Queue 分发时子提取器缺少父依赖 | 依赖注入 / 静默失败 | 子 Job 必须继承父的 config/http/storage/log；静默错误必须上报 |
| [005](005-music-metadata-nesting-mismatch.md) | `MusicMetadata` 类型与真实响应不匹配 | 类型假设 ≠ 真实数据 | `music_info` 是 `MusicSticker` 容器；不要凭直觉包裹类型 |
| [006](006-stories-user-resolution.md) | stories `User not found` 与 REST `reels_media` 失效 | 错误语义 / 端点退化 | 错误必须保留状态码；HTML 抓取显式 `responseType: 'text'` 并准备多来源退路 |
| [007](007-highlight-page-payload.md) | highlight 直链只走 REST，页面 payload 形状与 `__typename` 分流失配 | 类型假设 / 端点退化 | 页面 payload 按路由区分形状；分流看 `items` 而不是 `__typename` |
| [008](008-rest-feed-deprecation.md) | 用户 feed REST 端点全面退役，缺少 doc_id GraphQL 退路 | 端点退化 / 依赖假设 | 用户 feed 走 doc_id GraphQL，REST 与页面 payload 只作降级；200 HTML 也要识别 |
| [009](009-rest-media-downscaled-candidates.md) | 单帖图片被 REST 端点降级到 1080px | 端点退化 / 数据形状假设 | 不同端点的候选阶梯不同；`original_width` 与候选上限不一致即降级信号 |

## 高频雷区（写码前自查）

### 1. 提取器与消息管线

- **`Message` 是 discriminated union**，不是 Python 的三元组。新增消息类型必须同时改 `types.ts`、`message.ts` 工厂、`Job` 的三个 handler。
- **子提取器依赖必须由父 Job 注入**（`config` / `http` / `storage` / `log`）。`handleQueue` 里漏传任何一个，子提取器会静默产出 0 条。见 [004](004-queue-dispatch-missing-deps.md)。
- **同层模块互引用走注册表**：子提取器文件底部 `register(subcategory, Cls)`，`UserExtractor` 运行时 `get(cat)`。直接 import 会形成 ESM 循环。见 [002](002-circular-dependency-extractors-jobs.md)。
- **正则分组索引**：`Extractor` 构造函数做 `[...match].slice(1)`，`this.groups[0]` 是第一个捕获组，不是完整匹配。改 pattern 时同步检查 `extractors/*.ts` 里 `groups[n]` 的下标与 `tests/unit/extractor-patterns.test.ts`。

### 2. HTTP 与认证

- **二进制下载必须 `responseType: 'arraybuffer'`**，否则被 UTF-8 解码损坏。见 [003](003-binary-download-csrf.md)。
- **CSRF 双写**：`csrftoken` 必须同时作为 `Cookie` 和 `X-CSRFToken` header 发送，值一致。
- **Cookie 合并是 append 不是覆盖**：`sessionid=…; csrftoken=…`。
- **原生 `fetch` 不对 4xx/5xx 抛异常**，登录/challenge 重定向要手动检测 `response.url`。
- **反爬头缺一即 403**：`X-IG-App-ID` / `X-ASBD-ID` / `X-IG-WWW-Claim` / `X-Requested-With` / `Referer`，统一由 `InstagramRestAPI._call()` 注入。
- **错误保留状态码与 body 摘要**：`_call()` 按文本读取后自行解析 JSON，非 2xx / 非 JSON 都要抛带上下文的错误；禁止 `catch {}` 后统一 `User not found`。见 [006](006-stories-user-resolution.md)。
- **HTML 抓取必须 `responseType: 'text'` 且准备多特征**：`profile_id` 会缺席，优先 `page_id":"profilePage_<id>`；stories 数据优先取页面内嵌 `xdt_api__v1__feed__reels_media`。见 [006](006-stories-user-resolution.md)。
- **同一功能的页面 payload 按路由可能有不同形状**：user stories 是 `reels_media`，highlight 页面是 `reels_media__connection.edges[].node`。补页面解析时按路由分别取样本。见 [007](007-highlight-page-payload.md)。
- **REST/GraphQL 分流看形状而非单个标记**：`items` / `image_versions2 + user` 存在即 REST 形状；doc_id GraphQL 节点也带 `__typename`，不要据此走旧 GraphQL 解析器。见 [007](007-highlight-page-payload.md)、[008](008-rest-feed-deprecation.md)。
- **端点退化要留退路**：用户 feed / clips / usertags 的 REST 端点已退役，主路径是 `POST i.instagram.com/api/graphql` + `doc_id`；REST 与页面 payload 只作降级。见 [008](008-rest-feed-deprecation.md)。
- **200 也可能是拒绝**：`not-logged-in` / `challenge_required` / `feedback_required` / SPA HTML 壳要单独识别，不能统一报 `non-JSON response`。
- **doc_id 会随 IG 构建轮换**：集中在 `api.ts` 的 `DOC_IDS`，失效时按 [008](008-rest-feed-deprecation.md#doc_id-刷新方法) 从 JS bundle 重新提取。

### 3. 配置与选项

- **配置键是连字符**：`max-posts`、`static-videos`、`order-files`，通过 `_cfg(key)` 走 `extractor → instagram → subcategory` 逐级插值。
- **CLI 选项必须真的被读取**：`options.ts` 里声明了但没有任何 `_cfg()` 消费的选项是死选项，不要写进文档（当前 `--api`、`--order-posts` 即属此类）。

### 4. 构建与发布

- **CLI 产物自包含**：`deps.onlyBundle: ['commander']` 白名单，新增打包依赖要登记，否则 `npx` 下 `ERR_MODULE_NOT_FOUND`。见 [001](001-axios-to-native-fetch.md)。
- **SDK 是中性平台**：`platform: 'neutral'` 下 `node:` 内置模块必须 `neverBundle`。
- **产物入口以 `package.json` 为准**：`dist/index.js|cjs`、`dist/node.js|cjs`、bin `dl-ins`。没有 `/cli` 子路径导出。

### 5. 数据形状

- **类型对齐真实响应，不对齐直觉**：`music_info` 是 `MusicSticker` 容器，不是 `MusicAssetInfo`。见 [005](005-music-metadata-nesting-mismatch.md)。
- **静默丢弃是可观测性缺陷**：解析器拿不到字段时至少 `log.warn`，不要 `return null` 了事。
- **同一实体不同端点的候选阶梯可能不同**：REST `media/info` 只给 1080px 降级候选，帖子页才给原图（可达 3072px）。`original_width` 与候选上限不一致就是降级信号；图片尺寸这类静默降级不会报错，新增数据源时先抓包核对。见 [009](009-rest-media-downscaled-candidates.md)。

## 如何新增一条

1. `git log` 定位相关 commit，确认影响范围。
2. 复制 [TEMPLATE.md](TEMPLATE.md)，编号顺延（`NNN-short-slug.md`）。
3. 在本索引表加一行；若命中既有归类，在「高频雷区」补一条规则。
4. 根因属于流程级 → 同步更新 [AGENTS.md](../../AGENTS.md) 的强制规范。
