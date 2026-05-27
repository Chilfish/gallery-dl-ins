# @chilfish/gallery-dl-instagram — 架构文档

> TypeScript 重写版。原 Python 实现的参考文档见 [`gallery-dl.md`](./gallery-dl.md)。

## 1. 项目概览

```
gallery-dl-ins/
├── index.ts              # 公共 API 入口（barrel export）
├── sdk.ts                # 高层 SDK 封装（InstagramSDK）
├── config.ts             # 嵌套配置读取器
├── types.ts              # 共享类型：HttpClient、Storage、Message 协议
├── message.ts            # 消息工厂函数
├── package.json          # ESM 包，三入口：. / ./sdk / ./cli
├── tsdown.config.ts      # 构建配置
│
├── core/                 # 平台无关核心
│   ├── extractor.ts      # 抽象 Extractor 基类
│   └── job.ts            # Job 调度 + DownloadJob 实现
│
├── instagram/            # Instagram 模块
│   ├── index.ts          # 模块 barrel
│   ├── api.ts            # REST API 客户端
│   ├── base.ts           # InstagramExtractor 基类 + items() 管线
│   ├── extractors.ts     # 11 个子提取器
│   ├── parsers.ts        # 帖子解析器 (REST / GraphQL → ParsedPost)
│   └── types.ts          # Instagram 专用类型
│
├── cli/                  # CLI + adapter（Node.js 绑定）
│   ├── index.ts          # Commander 命令定义
│   ├── adapter.ts        # HttpClient / Storage / Logger 的 Node 实现
│   └── cookies.ts        # 内存 Cookie Jar
│
├── utils/                # 纯函数工具
│   ├── id-codec.ts       # Instagram ID ↔ shortcode
│   └── text.ts           # Unicode / HTML / URL 工具
│
└── docs/                 # 文档
    ├── sdk.md            # SDK 开发者指南
    ├── gallery-dl.md     # Python 原版架构参考
    ├── architecture.md   # 本文档
    ├── api-reference.md  # API 参考
    ├── cli.md            # CLI 使用指南
    └── migration-from-python.md  # Python → TS 迁移对照
```

**核心理念**：核心库（`core/` + `instagram/`）完全平台无关——只依赖 `HttpClient` / `Storage` / `Logger` 三个接口。`cli/adapter.ts` 负责把它们绑定到 Node.js（axios / fs / console），浏览器环境只需换一套 adapter。

## 2. 消息驱动的流水线

```
用户输入 URL
    │
    ▼
Job.run()
    │  1. Extractor.fromURL(url) 匹配正则 → 实例化
    │  2. extractor[Symbol.asyncIterator]() → items() 异步生成器
    │  3. 遍历 yield 的 Message，路由到对应 handler
    ▼
dispatch loop
    │  for await (msg of extractor):
    │    ├─ { type: 'directory' } → handleDirectory()  设定目标目录
    │    ├─ { type: 'url' }       → handleUrl()        下载文件
    │    └─ { type: 'queue' }     → handleQueue()      递归启动子 Job
    ▼
DownloadJob.handleUrl()
    │  1. 合并目录元数据 + 文件元数据
    │  2. 查 archive 去重（内存 Map）
    │  3. HTTP GET 下载
    │  4. Storage.write() 写入磁盘
    │  5. archive.add() 标记已下载
```

**为什么用消息而不是回调**：生成器天然支持暂停/恢复，配合 rate limiting 的 sleep 不会阻塞事件循环。Directory 消息让下游不需要知道 Instagram 的目录结构——Extractor 只管产出结构化数据。

## 3. Extractor 生命周期

```
constructor(opts)
    │  保存 url、regex match、config、http、storage、log
    │
    ▼
[Symbol.asyncIterator]()  被 Job 调用
    │
    ├─ await initialize()    ← 只执行一次（之后变成 no-op）
    │     └─ _init()         ← 子类钩子：创建 API 实例、生成 CSRF
    │
    └─ yield* items()        ← 核心提取逻辑（子类实现）
```

**一次性初始化**：`initialize()` 执行后把自己替换为空函数。同一 extractor 实例可被多次迭代（Queue 重试场景）。

## 4. InstagramExtractor 基类

### 4.1 类结构

```typescript
abstract class InstagramExtractor extends Extractor {
  category = 'instagram'       // 固定
  root = 'https://www.instagram.com'
  abstract subcategory         // 子类覆盖：'post' | 'posts' | 'reels' …

  api: InstagramRestAPI        // _init() 中创建
  csrfToken: Ref<string>       // CSRF token（Ref 跨对象共享）
  wwwClaim: Ref<string>        // IG WWW Claim header
  cursor: Ref<string | null>   // 分页游标

  abstract posts(): AsyncGenerator<InstagramPost>  // 子类提供帖子流
  items(): MessageIter         // 核心管线（基类实现）
}
```

### 4.2 `Ref<T>` 模式

```typescript
class Ref<T> { value: T }
```

`InstagramExtractor` 和 `InstagramRestAPI` 通过共享 `Ref` 对象来同步状态——CSRF token 更新、WWW Claim 更新、分页游标推进，不需要回调或事件系统。

### 4.3 `items()` 管线

```
items()
  │
  ├─ login()                          # 当前为空操作（cookie 已通过 adapter 注入）
  ├─ metadata()                       # 子类可选钩子：返回全局元数据
  │
  ├─ 读取配置：
  │   videos / previews / audio / max-posts / order-files / static-videos
  │
  ├─ 构建 ParserConfig                # root、findTags、parseTimestamp、videosDash…
  │
  ├─ for await (post of this.posts()) # 子类提供的帖子生成器
  │   │
  │   ├─ 判断 __typename 存在？ → parsePostGraphql()
  │   │          否则          → parsePostRest()
  │   │
  │   ├─ 合并全局 metadata
  │   ├─ yield Directory({ post_id, username, … })
  │   │
  │   └─ 遍历 parsed._files：
  │       ├─ audio_url  → yield Url(audio_url)
  │       ├─ video_url  → yield Url(video_url)
  │       └─ display_url → yield Url(image_url)
  │
  └─ [maxPosts 限制、reverse 反转]
```

## 5. 消息协议

三种消息类型组成 discriminated union：

```typescript
type Message =
  | { type: 'directory', metadata: Metadata }
  | { type: 'url', url: string, metadata: Metadata }
  | { type: 'queue', url: string, metadata: { _extractor: ExtractorClass } }
```

| 类型 | 用途 | 处理方 |
|------|------|--------|
| `directory` | 设定后续文件的输出目录 + 元数据 | `handleDirectory()` |
| `url` | 下载单个文件 | `handleUrl()` |
| `queue` | 委托给另一个 Extractor（递归） | `handleQueue()` |

### Queue 递归

`InstagramUserExtractor` 通过 Queue 消息分发子任务：

```
UserExtractor.items()
  │  yield Queue(..., { _extractor: PostsExtractor })
  │  yield Queue(..., { _extractor: ReelsExtractor })
  │  yield Queue(..., { _extractor: TaggedExtractor })
  …
  ▼
Job.handleQueue()
  │  new PostsExtractor(url)
  │  new DownloadJob(childExtr)
  │  childJob.run()  ← 递归
  │  merge archive back to parent
```

子 Job 继承父 Job 的 archive（去重共享）。

## 6. API 层 — InstagramRestAPI

### 6.1 `_call()` 统一请求

所有 API 调用经过 `_call()`，自动注入必需的请求头：

```
X-CSRFToken:        <动态 CSRF>
X-IG-App-ID:        936619743392459
X-ASBD-ID:          129477
X-IG-WWW-Claim:     <动态 WWW Claim>
X-Requested-With:   XMLHttpRequest
Referer:            https://www.instagram.com/
```

这些头是 Instagram 的反爬校验——缺任意一个都会 403。

### 6.2 用户查找策略链

```typescript
userByScreenName(name):
  for strategy in ['search', 'info', 'web']:
    try search → return
    try info   → return
    try web    → return
  throw NotFound
```

| 策略 | 端点 | 说明 |
|------|------|------|
| `search` | `instagram.com/web/search/topsearch/` | 用户名精确匹配 |
| `info` | `/api/v1/users/web_profile_info/` | API 查询 |
| `web` | `instagram.com/{username}` | HTML 页面正则提取 `profile_id` |

### 6.3 分页引擎

四种分页模式，全部基于游标（cursor-based）：

| 引擎 | HTTP 方法 | 分页字段 | 用途 |
|------|-----------|----------|------|
| `_pagination` | GET | `next_max_id` → `max_id` | 用户帖子、tagged、saved |
| `_paginationPost` | POST | `paging_info.max_id` | 用户 Reels |
| `_paginationSections` | POST | `next_max_id` + `next_page` | 标签帖子 |
| `_paginationFollowing` | GET | 整数 `next_max_id` | 粉丝/关注列表 |

游标持久化：用户通过 `--cursor` 传入上次的 cursor 值即可断点续传。

## 7. 解析器 — parsers.ts

### 7.1 帖子类型分流

```
parsePostRest(post):
  if post.items?          → parseStoryRest()    # Story / Highlight
  if post.carousel_media? → 展开每个 item        # 轮播
  else                    → 单元素数组包装        # 单图/视频
```

### 7.2 媒体文件提取

每个 media item 提取：

| 文件类型 | 来源字段 | 选择策略 |
|----------|----------|----------|
| 图片 | `image_versions2.candidates[0]` | 第一个候选（最高分辨率） |
| 视频 | `video_versions` | `max(width × height × type)` |
| DASH | `video_dash_manifest` | 记录 manifest_data（供外部下载器） |
| 音频 | `music_asset_info.progressive_download_url` | story 音乐贴纸 / reels 音乐元数据 |

### 7.3 静态视频处理

Instagram 有时把视频标记为图片（`original_media_type = 1` 但 `media_type ≠ 1`）。当 `static-videos: false` 时，解析器删除 `video_versions`，强制只下载封面图。

```typescript
if (!cfg.staticVideo
  && item.original_media_type === 1
  && item.original_media_type !== item.media_type
) {
  delete item.video_versions  // 只下载封面
}
```

### 7.4 用户标签提取

合并 4 种来源去重：

| 来源 | 字段 | 帖子类型 |
|------|------|----------|
| GraphQL edges | `edge_media_to_tagged_user.edges` | 旧帖子 |
| REST usertags | `usertags.in` | 新帖子 |
| Reel mentions | `reel_mentions` | Reels |
| Bloks stickers | `story_bloks_stickers` | Story |

### 7.5 GraphQL vs REST 归一化

两者产出相同的 `ParsedPost` 结构。差异点：

| | REST | GraphQL |
|---|------|---------|
| 轮播检测 | `carousel_media` 数组 | `edge_sidecar_to_children.edges` |
| 描述 | `caption.text` | `edge_media_to_caption.edges[].node.text` |
| 点赞 | `like_count` | `edge_media_preview_like.count` |
| Unicode | 已经是原始文本 | 需要 `parseUnicodeEscapes` 解码 |

## 8. 子提取器全景

```
InstagramUserExtractor (Dispatch Hub)
    │  通过 --include 配置决定启用哪些子提取器
    │  yield Queue(…, { _extractor: XxxExtractor })
    │
    ├── InstagramPostsExtractor      → api.userFeed(uid)
    ├── InstagramReelsExtractor      → api.userClips(uid)
    ├── InstagramTaggedExtractor     → api.userTagged(uid)
    ├── InstagramStoriesExtractor    → api.reelsMedia([reelId])
    ├── InstagramHighlightsExtractor → api.highlightsMedia(uid)
    ├── InstagramInfoExtractor       → api.userByScreenName(name)
    └── InstagramAvatarExtractor     → api.userByScreenName(name)

InstagramPostExtractor
    ├── share URL → 302 重定向 → 获取真实 shortcode
    └── api.media(shortcode) → 单个帖子

InstagramStoriesExtractor
    ├── highlight:XXXX → 直接作为 reel ID
    ├── --split → 每个 frame 独立产出
    └── --mediaId → 只取出特定 frame

InstagramSavedExtractor
    └── api.userSaved() → 需要 auth cookie
```

## 9. DownloadJob — 下载管线

```typescript
class DownloadJob extends Job {
  archive: ArchiveMap           // category → Set<archiveKey>
  _archiveFmts: Map<string, string>  // category → format 模板

  handleDirectory(msg):
    1. 更新 _currentDir 元数据
    2. Storage.mkdir('{category}/{username}')

  handleUrl(msg):
    1. 合并 _currentDir + msg.metadata
    2. 查 archive（_isArchived）→ 跳过
    3. HTTP GET 获取内容
    4. Storage.write('{category}/{username}/{media_id}.{ext}')
    5. _archive() 标记

  handleQueue(msg):
    1. 获取 _extractor 类
    2. new ChildExtractor(url)
    3. new DownloadJob(child) ← 继承 archive
    4. childJob.run()         ← 递归
    5. 合并 archive 回父 Job
}
```

## 10. 限流与反爬

| 机制 | 实现 | 说明 |
|------|------|------|
| 请求间隔 | `Extractor._throttle()` | 6~12 秒随机 |
| UA 伪装 | Chrome 131 Windows | adapter 中设置 |
| CSRF | `Extractor.generateToken(16)` | 随机生成 + 响应 cookie 更新 |
| App ID | `X-IG-App-ID: 936619743392459` | API `_call()` 中固定注入 |
| WWW Claim | `x-ig-set-www-claim` 响应头 | 动态更新，跨请求同步 |
| 登录检测 | `request()` 拦截 | 检测 redirect 到 `/accounts/login/` 或 `/challenge/` |
| Cookie | `--sessionid` 命令行参数 | 从浏览器导出 |

## 11. 配置系统 — ConfigManager

```typescript
const config = new ConfigManager({
  extractor: {
    instagram: {
      videos: false,
      'max-posts': 10,
    },
  },
})

// 层级插值查找
config.interpolate(['extractor', 'instagram', 'post'], 'videos')
// 依次查找: extractor.instagram.post.videos
//         → extractor.instagram.videos      ✓ 命中
//         → extractor.videos
```

在 `items()` 中通过 `this._cfg(key, default)` 读取，自动使用 `[extractor, category, subcategory]` 路径插值。

## 12. 关键设计决策

| 决策 | 原因 |
|------|------|
| 平台无关核心 + adapter 模式 | 同一套代码可跑在 Node.js、Bun、浏览器、Edge Function |
| `Ref<T>` 而非 EventEmitter | 共享可变状态简单直接，不需要引入事件系统 |
| 消息驱动而非回调 | AsyncGenerator 天然支持暂停/恢复，配合 rate limiting 不阻塞 |
| Archive 在内存而非文件 | 单次运行的下载量不需要持久化；需要时可替换 Storage 实现 |
| `fromURL()` 工厂而非依赖注入 | 每个 extractor 自包含其 URL 匹配逻辑，Queue 分发无需注册表 |
| Commander 而非 DIY CLI | 自动生成帮助、参数校验、类型转换 |

## 13. 与 Python 原版的主要差异

| 方面 | Python gallery-dl | TypeScript 移植版 |
|------|-------------------|-------------------|
| 异步模型 | 同步生成器 + requests | AsyncGenerator + axios |
| 配置 | 全局 dict + 多文件加载 | ConfigManager + 层级插值 |
| Post-processing | 独立 post-processor 链 | 当前未实现（预留 Storage 接口） |
| Archive | SQLite / 文本文件 | 内存 Map（可替换） |
| Cookies | 从浏览器自动提取 | 命令行 `--sessionid` |
| 登录 | 支持 username/password（已封） | 仅 cookie |
| 视频合并 | yt-dlp / FFmpeg | 未实现 |
| 日志 | logging 模块 | Logger 接口 + console adapter |
| 类型 | 运行时 duck typing | 编译时 TypeScript 类型 |
