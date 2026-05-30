# AGENTS.md — gallery-dl-instagram

> TypeScript 移植版 Instagram 媒体提取器。平台无关核心 + Node.js adapter + CLI。
> 原 Python 实现为 [gallery-dl](https://github.com/mikf/gallery-dl)，参考文档见 `docs/gallery-dl.md`。

## 项目概览

```
入口:
  src/index.ts         # barrel export — 全量 API 导出
  src/sdk.ts           # 平台无关 SDK — InstagramSDK class
  src/node-factory.ts  # Node.js 工厂 — createSDK({cookies})
  src/node.ts          # Node.js barrel — 从 node-factory 重导出
  src/cli/index.ts     # CLI — gdl-instagram <command>

核心:
  src/core/extractor.ts   # 抽象 Extractor 基类（AsyncGenerator 驱动）
  src/core/job.ts         # Job 调度 + DownloadJob（消息消费 + 文件写入）

Instagram 模块:
  src/instagram/base.ts       # InstagramExtractor 基类 + items() 管线
  src/instagram/api.ts        # REST API 客户端（端点 + 分页 + CSRF）
  src/instagram/extractors.ts # 11 个子提取器（post/user/stories/…）
  src/instagram/parsers.ts    # REST / GraphQL → ParsedPost 归一化
  src/instagram/types.ts      # Instagram 专用类型定义

平台适配:
  src/cli/adapter.ts    # Node.js 实现：HttpClient (cookie/jar) / Logger (console)
  src/cli/cookies.ts    # 内存 Cookie Jar（匿名 session 支持）
  src/cli/storage.ts    # Node.js fs/promises Storage

HTTP 层:
  src/fetcher.ts        # 平台无关 fetch-based HttpClient（SDK & CLI 共用）

共享:
  src/types.ts          # HttpClient / Storage / Message 协议接口
  src/config.ts         # ConfigManager — 嵌套配置 + 层级插值
  src/message.ts        # Message 工厂：directory() / url() / queue()
  src/utils/            # 纯函数工具（ID codec、文本处理）
```

## 架构原则

### 消息驱动的 AsyncGenerator 管线

```
Extractor.items() → AsyncGenerator<Message>
  ├─ { type: 'directory', metadata: { post_id, username, ... } }
  ├─ { type: 'url', url: 'https://...', metadata: { media_id, ... } }
  └─ { type: 'queue', url: '...', metadata: { _extractor: ... } }

Job.run() → 消费 Message 流 → handleDirectory / handleUrl / handleQueue
```

- Extractor 只产出结构化数据，不管下载
- Job 消费 Message，可替换（DownloadJob 写磁盘、浏览器端渲染 gallery 等）
- Queue 消息实现递归：UserExtractor → Queue(PostsExtractor) → Queue(PostExtractor)

### 平台无关核心 + Adapter 模式

核心库（`src/core/` + `src/instagram/`）只依赖三个接口：
- `HttpClient` — HTTP 请求
- `Storage` — 文件 I/O
- `Logger` — 日志输出

`src/cli/adapter.ts` 提供 Node.js 实现。浏览器 / Deno / Edge 换一套 adapter 即可。

### CSRF 认证

Instagram API 要求 `csrftoken` **同时作为 Cookie 和 X-CSRFToken header** 发送，二者值必须一致（参考 Python 版 `_init()` 中的 `self.cookies.set("csrftoken", ...)`）。

`_call()` 中：
```typescript
headers['Cookie'] = `csrftoken=${csrf}`
headers['X-CSRFToken'] = csrf
```

### Cookie 合并（adapter 层）
adapter 的 Cookie header 合并使用 **append** 而非 override：
```typescript
// sessionid=xxx + csrftoken=yyy → sessionid=xxx; csrftoken=yyy
if (k.toLowerCase() === 'cookie' && mergedHeaders.Cookie) {
  mergedHeaders.Cookie = `${mergedHeaders.Cookie}; ${v}`
}
```

## 命令

```bash
# 安装依赖
bun install

# 开发运行 CLI（直接跑 TS）
bun src/cli/index.ts <url> [options]

# 示例
bun src/cli/index.ts https://www.instagram.com/p/ABC123/ -v --cookies="..."
bun src/cli/index.ts https://www.instagram.com/username/ -v --cookies="..."
bun src/cli/index.ts tag cats -v --cookies="..."
bun src/cli/index.ts saved --cookies="..."

# 类型检查
bun run typecheck

# Lint
bun run lint

# 构建
bun run build
# → dist/index.mjs, dist/sdk.mjs, dist/cli/index.mjs
```

## 测试

```bash
# 运行全部测试
bun run test

# 监听模式
bun run test:watch

# 仅单元测试
bun run test:unit

# 覆盖率
bun run test:coverage
```

### 测试结构

```
tests/
  setup.ts                  # dotenv 加载 .env
  unit/
    id-codec.test.ts        # ID ↔ shortcode 转换
    text.test.ts            # 文本工具函数
    message.test.ts         # Message 工厂函数
    config.test.ts          # ConfigManager 配置系统
    extractor-patterns.test.ts  # ⚠️ 提取器 URL 模式匹配（回归测试）
    sdk-resolve.test.ts     # SDK URL 自动路由
    parsers.test.ts         # REST/GraphQL 解析器
  integration/
    extractor.test.ts       # 提取器 + mock HTTP（需 INSTAGRAM_COOKIES）
```

### Cookie 配置

集成测试通过 `.env` 文件加载 Instagram Cookie：

1. 复制 `.env.example` → `.env`
2. 从浏览器 DevTools → Application → Cookies 复制完整 Cookie 字符串
3. 填入 `INSTAGRAM_COOKIES=...`

测试会自动跳过需要 Cookie 但未配置的用例。

## 代码风格

### 注释规范

- **禁止手动分隔线**（`// ----...`），用 JSDoc 注释代替
- 类内逻辑分组用 `/** Section Name */`，不要用装饰线
- 函数 / 类 / 接口用标准 JSDoc：

```typescript
/** One-time async setup. Safe to call multiple times. */
async initialize(): Promise<void> { … }
```

- 冗余标签（仅在声明前重复声明名的）直接删除，代码结构已经够清晰

### TypeScript

- Strict mode，`strictNullChecks` 开启
- ESNext target，ESM 模块
- `verbatimModuleSyntax` — type import 显式标注
- 类型使用 discriminated union（Message = DirectoryMsg | UrlMsg | QueueMsg）
- 禁止 `any` — 用 `unknown` + 类型守卫

### 项目约定

- 使用 `Ref<T>` 包装器在 Extractor ↔ API 间共享可变状态（不用 EventEmitter）
- Rate limiting：基类 `requestInterval = [6, 12]` 秒，`_throttle()` 自动 sleep
- 文件下载：必须设 `responseType: 'arraybuffer'`，避免二进制被 UTF-8 解码损坏
- 登录态通过 `--cookies`（完整 Cookie 字符串）或 `--sessionid` 传入
- 没有 sessionid 时自动尝试匿名 session（Cookie Jar 方式），但 `/api/v1/` 端点通常需要登录

## SDK 使用

高层 API（推荐给 SDK 使用者）：

```typescript
import { createSDK } from '@chilfish/gallery-dl-instagram/node'

const ig = await createSDK({
  cookies: 'ds_user_id=...; sessionid=...; csrftoken=...',
})

// 只提取元数据
for await (const msg of ig.extract('https://www.instagram.com/p/ABC123/')) {
  if (msg.type === 'url') console.log(msg.url)
}

// 下载到磁盘
await ig.download('https://www.instagram.com/p/ABC123/', './downloads')
```

底层 API（自定义 adapter）：

```typescript
import { ConfigManager, DownloadJob, InstagramPostExtractor } from '@chilfish/gallery-dl-instagram'

const extractor = new InstagramPostExtractor({ url, match, config, http, storage, log })
const job = new DownloadJob(extractor)
job.basePath = './output'
await job.run()
```

## 子提取器清单

| 提取器 | 匹配 URL | 对应 API 方法 |
|--------|----------|--------------|
| `InstagramPostExtractor` | `/p/`, `/reel/`, `/share/` | `api.media(shortcode)` |
| `InstagramUserExtractor` | `/{username}/` | Dispatch Hub（Queue 分发） |
| `InstagramPostsExtractor` | `/{username}/posts/` | `api.userFeed(uid)` |
| `InstagramReelsExtractor` | `/{username}/reels/` | `api.userClips(uid)` |
| `InstagramTaggedExtractor` | `/{username}/tagged/` | `api.userTagged(uid)` |
| `InstagramStoriesExtractor` | `/stories/...` | `api.reelsMedia([reelId])` |
| `InstagramHighlightsExtractor` | `/{username}/highlights/` | `api.highlightsMedia(uid)` |
| `InstagramTagExtractor` | `/explore/tags/{tag}` | `api.tagsMedia(tag)` |
| `InstagramInfoExtractor` | `/{username}/info/` | `api.userByScreenName(name)` |
| `InstagramAvatarExtractor` | `/{username}/avatar/` | `api.userByScreenName(name)` |
| `InstagramSavedExtractor` | `/{username}/saved/` | `api.userSaved()` |

## 文档

| 文件 | 内容 |
|------|------|
| `docs/architecture.md` | 完整架构：流水线 / 生命周期 / 消息协议 / 配置系统 |
| `docs/sdk.md` | SDK 开发者指南：快速开始 / 三层 API / 浏览器 & Deno 适配 |
| `docs/api-reference.md` | 全量 API 参考（类 / 方法 / 类型签名） |
| `docs/cli.md` | CLI 使用指南（8 个子命令 + 选项） |
| `docs/migration-from-python.md` | Python → TS 迁移对照（差异 / 功能矩阵 / 类型映射） |
| `docs/gallery-dl.md` | Python 原版架构参考（保留，不作为 TS 版文档） |

## 注意事项

- 不要提交 `data/` 或下载文件（已在 `.gitignore`）
- 不要硬编码 cookie / token 到源码中
- Instagram API 图片分辨率上限为短边 1080px（CDN URL 带签名，修改参数会 403）
- 使用原生 `fetch` — HTTP 4xx/5xx 不抛异常，由调用方手动检测登录重定向
- Node.js fetch 默认最大 20 次重定向（匹配 Python 版 requests 行为）
- `src/cli/cookies.ts` 的 Cookie Jar 只在无 sessionid 时使用（匿名模式），效果有限——大多数 API 端点需要登录
