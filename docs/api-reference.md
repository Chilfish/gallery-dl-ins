# API Reference

> `@chilfish/gallery-dl-instagram` v0.1.0

## 入口

```typescript
// SDK 入口（平台无关核心 + Instagram 模块）
import { … } from '@chilfish/gallery-dl-instagram'

// CLI 入口
import { … } from '@chilfish/gallery-dl-instagram/cli'
```

---

## Core

### `Extractor` (abstract)

```typescript
import { Extractor } from '@chilfish/gallery-dl-instagram'
```

所有提取器的抽象基类。

| 成员 | 类型 | 说明 |
|------|------|------|
| `category` | `abstract string` | 分类名，如 `'instagram'` |
| `subcategory` | `abstract string` | 子分类名，如 `'post'` |
| `root` | `abstract string` | 根 URL，如 `'https://www.instagram.com'` |
| `pattern` | `static RegExp` | URL 匹配模式 |
| `url` | `string` | 输入的 URL |
| `groups` | `readonly string[]` | regex match groups |
| `requestInterval` | `[number, number]` | 请求间隔范围（秒），默认 `[6, 12]` |

**方法**：

```typescript
// 一次性初始化（之后自动变成 no-op）
await initialize(): Promise<void>

// 子类钩子：在 initialize 中调用
protected _init(): Promise<void>

// 异步迭代器入口（Job 调用）
[Symbol.asyncIterator](): MessageIter

// 子类必须实现的核心方法
abstract items(): MessageIter

// 层级配置读取 → config.interpolate(['extractor', category, subcategory], key)
protected _cfg(key: string, defaultVal?: ConfigValue): ConfigValue | undefined

// 限流 HTTP 请求
request(url: string, cfg?: RequestConfig): Promise<HttpResponse<unknown>>
requestJSON(url: string, cfg?: RequestConfig): Promise<unknown>

// Unix timestamp → ISO-8601
parseTimestamp(ts: number | null | undefined): string

// 生成随机 hex token
static generateToken(size?: number): string
```

### `ExtractorOptions`

```typescript
interface ExtractorOptions {
  url: string
  match: RegExpMatchArray
  config: ConfigManager
  http: HttpClient
  storage: Storage
  log: Logger
}
```

### `Logger`

```typescript
interface Logger {
  debug: (message: string, ...args: unknown[]) => void
  info:  (message: string, ...args: unknown[]) => void
  warn:  (message: string, ...args: unknown[]) => void
  error: (message: string, ...args: unknown[]) => void
}

// 空操作 Logger
const noopLogger: Logger
```

### `Job` (abstract)

```typescript
import { Job } from '@chilfish/gallery-dl-instagram'
```

消息调度的抽象基类。

```typescript
abstract class Job {
  extractor: Extractor
  status: number        // 0 = 成功，非 0 = 有错误

  async run(): Promise<number>  // 启动 → 遍历 extractor → 分发消息

  abstract handleDirectory(msg: DirectoryMsg): Promise<void>
  abstract handleUrl(msg: UrlMsg):             Promise<void>
  abstract handleQueue(msg: QueueMsg):         Promise<void>
}
```

### `DownloadJob`

```typescript
import { DownloadJob } from '@chilfish/gallery-dl-instagram'
```

`Job` 的具体实现——下载文件到 `Storage`。

```typescript
class DownloadJob extends Job {
  archive: Map<string, Set<string>>  // category → Set<archiveKey>

  // 注册 archive 格式：'{media_id}' / '{post_id}_{num}' 等
  registerArchive(category: string, format: string): void
}
```

**下载路径**：`{category}/{username}/{media_id}[_{num}].{extension}`

---

## Config

### `ConfigManager`

```typescript
import { ConfigManager } from '@chilfish/gallery-dl-instagram'
```

```typescript
class ConfigManager {
  constructor(data?: Config)

  // 点路径读取
  get(path: string, defaultValue?: ConfigValue): ConfigValue | undefined

  // 层级插值：依次查找 cfgPath[0].key, cfgPath[1].key, …, defaultVal
  interpolate(
    cfgPath: readonly string[],
    key: string,
    defaultVal?: ConfigValue,
  ): ConfigValue | undefined

  // 点路径写入
  set(path: string, value: unknown): void
}
```

### 类型

```typescript
type ConfigValue = string | number | boolean | null | ConfigValue[] | { [key: string]: ConfigValue }
interface Config { [key: string]: ConfigValue }
```

---

## Messages

```typescript
import { directory, url, queue } from '@chilfish/gallery-dl-instagram'
```

### 消息工厂

```typescript
function directory(metadata?: Metadata): DirectoryMsg
function url(u: string, metadata?: Metadata): UrlMsg
function queue(u: string, metadata?: Metadata & { _extractor?: ExtractorClass }): QueueMsg
```

### 消息类型

```typescript
type Message = DirectoryMsg | UrlMsg | QueueMsg

interface DirectoryMsg {
  type: 'directory'
  metadata: Metadata
}

interface UrlMsg {
  type: 'url'
  url: string
  metadata: Metadata
}

interface QueueMsg {
  type: 'queue'
  url: string
  metadata: Metadata & { _extractor?: ExtractorClass }
}
```

### 辅助类型

```typescript
type Metadata = Record<string, unknown>
type MessageIter = AsyncGenerator<Message, void, unknown>

interface ExtractorClass {
  fromURL: (url: string) => Extractor | null
  subcategory: string
}
```

---

## HTTP & Storage 接口

```typescript
interface HttpClient {
  request<T>(config: {
    url: string
    method?: string
    headers?: Record<string, string>
    params?: Record<string, string | number | null | undefined>
    data?: unknown
    signal?: AbortSignal
    timeout?: number
  }): Promise<HttpResponse<T>>
}

interface HttpResponse<T = unknown> {
  status: number
  data: T
  headers: Record<string, string>
  url: string       // 最终 URL（重定向后）
}

interface Storage {
  exists: (path: string) => Promise<boolean>
  write:  (path: string, data: Uint8Array | string) => Promise<void>
  mkdir:  (path: string) => Promise<void>
}

interface RequestConfig {
  headers?: Record<string, string>
  params?: Record<string, string | number | null | undefined>
  method?: string
  data?: unknown
  timeout?: number
  signal?: AbortSignal
  withCredentials?: boolean
}
```

---

## Instagram 模块

### `InstagramExtractor` (abstract)

```typescript
import { InstagramExtractor } from '@chilfish/gallery-dl-instagram'
```

继承 `Extractor`，所有 Instagram 子提取器的基类。

| 成员 | 类型 | 说明 |
|------|------|------|
| `category` | `'instagram'` | 固定 |
| `root` | `'https://www.instagram.com'` | 固定 |
| `subcategory` | `abstract string` | 子类覆盖 |
| `api` | `InstagramRestAPI` | `_init()` 中创建 |
| `csrfToken` | `Ref<string>` | CSRF token |
| `wwwClaim` | `Ref<string>` | IG WWW Claim |
| `cursor` | `Ref<string \| null>` | 分页游标 |

**构造函数选项**：

```typescript
interface InstagramExtractorOptions extends ExtractorOptions {
  sessionId?: string
  cookies?: Record<string, string>
}
```

**方法**：

```typescript
// 登录（当前检查 cookie 存在即视为已登录）
async login(): Promise<void>

// 核心管线（基类实现，子类只需提供 posts()）
async* items(): MessageIter

// 子类钩子：全局元数据
async metadata(): Promise<Record<string, unknown>>

// 子类钩子：帖子流
abstract posts(): AsyncGenerator<InstagramPost>

// 游标管理
protected _initCursor(): string | null
protected _updateCursor(cursor: string | null): string | null

// 用户赋值 + 边计数映射
protected _assignUser(user: InstagramUser): void
```

### 子提取器

所有子提取器都继承 `InstagramExtractor`，有静态方法 `fromURL(url, opts)` 和 `pattern` 正则。

#### `InstagramPostExtractor`

```typescript
// pattern: /p/ | /tv/ | /reel/ | /share/ + shortcode
// subcategory: 'post' | 'reel'
```

下载单个帖子 / Reel / 分享链接。

#### `InstagramUserExtractor`

```typescript
// pattern: /{username}/
// subcategory: 'user'
```

Dispatch hub——通过 `--include` 配置分发子任务，自身不下载文件。

```typescript
// 配置
include: 'posts' | 'posts,reels,tagged,stories,highlights,info,avatar' | 'all'
```

#### `InstagramPostsExtractor`

```typescript
// pattern: /{username}/posts/
// subcategory: 'posts'
```

用户帖子流 → `api.userFeed(uid)`。

#### `InstagramReelsExtractor`

```typescript
// pattern: /{username}/reels/
// subcategory: 'reels'
```

用户 Reels → `api.userClips(uid)`。

#### `InstagramTaggedExtractor`

```typescript
// pattern: /{username}/tagged/
// subcategory: 'tagged'
```

用户被标记的帖子 → `api.userTagged(uid)`。额外产出 `tagged_owner_id` / `tagged_username` 元数据。

#### `InstagramStoriesExtractor`

```typescript
// pattern: /stories/highlights/{id}, /stories/{username}/{id}, /a{base64}?story_media_id={id}
// subcategory: 'stories' | 'highlights'
// 配置: split (boolean) — 每个 frame 独立产出
```

兼容 4 种 story/highlight URL 格式。

#### `InstagramHighlightsExtractor`

```typescript
// pattern: /{username}/highlights/
// subcategory: 'highlights'
```

拉取所有 highlights tray → 批量 `api.reelsMedia()`。

#### `InstagramTagExtractor`

```typescript
// pattern: /explore/tags/{tag}
// subcategory: 'tag'
```

Hashtag 帖子 → `api.tagsMedia(tag)`。接受 URL 或裸标签名。

#### `InstagramInfoExtractor`

```typescript
// pattern: /{username}/info/
// subcategory: 'info'
```

获取用户资料元数据，yield Directory 消息（不下文件）。

#### `InstagramAvatarExtractor`

```typescript
// pattern: /{username}/avatar/
// subcategory: 'avatar'
```

下载 HD 头像。优先 `hd_profile_pic_url_info`，fallback `hd_profile_pic_versions[]` → `profile_pic_url`。

#### `InstagramSavedExtractor`

```typescript
// pattern: /{username}/saved/
// subcategory: 'saved'
```

收藏夹 → `api.userSaved()`。

---

### `InstagramRestAPI`

Instagram REST API 客户端。由 `InstagramExtractor._init()` 创建，通过 `Ref` 共享状态。

```typescript
class InstagramRestAPI {
  constructor(opts: {
    http: HttpClient
    root: string
    csrfToken: { value: string }
    wwwClaim: { value: string }
    cursor: { value: string | null }
  })

  // ── 帖子 / 媒体 ──
  media(shortcode: string): AsyncGenerator<InstagramPost>

  // ── 用户内容 ──
  userFeed(userId: string): AsyncGenerator<InstagramPost>
  userClips(userId: string): AsyncGenerator<InstagramPost>
  userTagged(userId: string): AsyncGenerator<InstagramPost>
  userSaved(): AsyncGenerator<InstagramPost>
  userCollection(collectionId: string): AsyncGenerator<InstagramPost>

  // ── Stories / Highlights ──
  reelsMedia(reelIds: string[]): Promise<InstagramPost[]>
  reelsTray(): Promise<InstagramPost[]>
  highlightsTray(userId: string): Promise<{ id: string }[]>
  highlightsMedia(userId: string, chunkSize?: number): AsyncGenerator<InstagramPost>

  // ── Hashtag ──
  tagsMedia(tag: string): AsyncGenerator<InstagramPost>

  // ── 用户解析 ──
  userById(userId: string): Promise<InstagramUser>
  userByName(username: string): Promise<InstagramUser>
  userBySearch(username: string): Promise<InstagramUser>
  userByWeb(username: string): Promise<{ id: string }>
  userByScreenName(screenName: string): Promise<InstagramUser>   // search → info → web
  userId(screenName: string, checkPrivate?: boolean): Promise<string>

  // ── 社交图 ──
  userFollowers(userId: string): AsyncGenerator<InstagramUser>
  userFollowing(userId: string): AsyncGenerator<InstagramUser>
}
```

---

### Parsers

```typescript
import { parsePostRest, parsePostGraphql, extractTaggedUsers, extractAudio } from '@chilfish/gallery-dl-instagram'
```

```typescript
// REST API 响应 → 归一化 ParsedPost
function parsePostRest(post: InstagramPost, cfg: ParserConfig): ParsedPost

// GraphQL 响应 → 归一化 ParsedPost
function parsePostGraphql(post: Record<string, unknown>, cfg: ParserConfig): ParsedPost

// 从 4 种来源提取用户标签并去重
function extractTaggedUsers(src: Record<string, unknown>, dest: ParsedMedia): void

// 从 music_sticker 提取音频 ParsedMedia
function extractAudio(
  src: Record<string, unknown>,
  dest: Record<string, unknown>,
  sticker: MusicSticker,
  cfg: ParserConfig,
): ParsedMedia | null
```

---

### Instagram 类型

```typescript
// ── API 响应 ──
interface InstagramUser {
  pk: string; id?: string; username: string; full_name: string
  is_private?: boolean; followed_by_viewer?: boolean
  profile_pic_url?: string; profile_pic_url_hd?: string
  hd_profile_pic_url_info?: ImageCandidate
  hd_profile_pic_versions?: ImageCandidate[]
  // + edge_* count fields（_assignUser 映射为 count_*）
}

interface InstagramPost {
  pk: string; code: string; caption: Caption | null
  taken_at: number; user: InstagramUser
  carousel_media?: InstagramCarouselItem[]
  image_versions2: { candidates: ImageCandidate[] }
  video_versions?: VideoVersion[]
  video_dash_manifest?: string
  location?: InstagramLocation
  coauthor_producers?: InstagramUser[]
  music_metadata?: MusicMetadata
  items?: InstagramCarouselItem[]       // story/highlight
  // + 更多字段…
}

interface ImageCandidate   { url: string; width: number; height: number }
interface VideoVersion     { url: string; width: number; height: number; type: number }

// ── 解析输出 ──
interface ParsedPost {
  post_id: string; post_shortcode: string; post_url: string
  owner_id: string; username: string; fullname: string
  post_date: string; date: string; description: string
  tags?: string[]
  location_id?: string; location_slug?: string; location_url?: string
  likes: number; liked: boolean; pinned: string[]
  coauthors?: Coauthor[]
  sidecar_media_id?: string; sidecar_shortcode?: string
  type: 'post' | 'reel' | 'story' | 'highlight'
  count: number
  _files: ParsedMedia[]    // ← 文件列表（被 items() pop 后删除）
  // + story/highlight 特化字段…
}

interface ParsedMedia {
  num: number; date: string
  media_id: string; shortcode: string
  display_url: string; video_url: string | null
  width: number; width_original: number
  height: number; height_original: number
  tagged_users: TaggedUser[]
  audio_url?: string; audio_title?: string; audio_artist?: string
  audio_duration?: number; audio_timestamps?: number[]
  _ytdl_manifest_data?: string
  // + owner, author, expires, audience, sidecar refs…
}

interface ParserConfig {
  root: string
  findTags: (text: string) => string[]
  parseTimestamp: (ts: number | null | undefined) => string
  staticVideo: boolean
  warnVideo: boolean
  warnImage: number
  videosDash: boolean
}
```

---

## Utils

### ID Codec

```typescript
import { idFromShortcode, shortcodeFromId } from '@chilfish/gallery-dl-instagram'
```

```typescript
// Instagram shortcode → 数字 ID
function idFromShortcode(shortcode: string): string

// 数字 ID → Instagram shortcode
function shortcodeFromId(postId: string | number): string
```

使用 Base64 变体字母表：`A-Za-z0-9-_`。

### Text

```typescript
import {
  extract, extr, parseUnicodeEscapes, unescape, unquote,
  ensureHttpScheme, nameExtFromURL, parseInt, findTags
} from '@chilfish/gallery-dl-instagram'
```

| 函数 | 说明 |
|------|------|
| `extract(txt, begin, end)` | 提取子串，失败返回 `null` |
| `extr(txt, begin, end, default)` | 同上 + 默认值 |
| `parseUnicodeEscapes(text)` | `\uXXXX` → 字符 |
| `unescape(text)` | HTML 实体解码 |
| `unquote(text)` | URL 解码 |
| `ensureHttpScheme(url, scheme?)` | 补全 `https://` |
| `nameExtFromURL(url, meta)` | 从 URL 提取 filename/extension 写入 meta |
| `parseInt(value, default?)` | 安全整数解析 |
| `findTags(text)` | 返回 `#\w+` 匹配列表 |

---

## CLI Adapter

```typescript
import { createHttpClient, createStorage, createLogger } from '@chilfish/gallery-dl-instagram/cli'
```

```typescript
// Node.js HttpClient — native fetch 封装
function createHttpClient(sessionId?: string): HttpClient

// Node.js Storage — fs/promises 封装
function createStorage(): Storage

// Node.js Logger — console 封装
function createLogger(verbose: boolean): Logger
```
