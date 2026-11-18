# API 参考

> `@chilfish/gallery-dl-instagram` v0.2.5 — 公开导出面（`src/index.ts` + `src/node.ts`）。
> 用法示例见 [guide/sdk.md](../guide/sdk.md)；内部实现见 [engineering/architecture.md](../engineering/architecture.md)。

## 入口

```typescript
// 平台无关核心 + Instagram 模块
import { … } from '@chilfish/gallery-dl-instagram'

// Node.js 便利工厂（cookies → HttpClient + fs Storage）
import { createSDK } from '@chilfish/gallery-dl-instagram/node'
```

只有这两个子路径。**不存在 `./cli` 导出**——CLI adapter 是内部实现，只通过 `dl-ins` bin 暴露。

---

## Core

### `Extractor`（abstract）

所有提取器的基类。

```typescript
import { Extractor } from '@chilfish/gallery-dl-instagram'
```

| 成员 | 类型 | 说明 |
|---|---|---|
| `category` | `abstract readonly string` | 分类名，如 `'instagram'` |
| `subcategory` | `abstract readonly string` | 子分类名，`'post'` / `'posts'` / … |
| `root` | `abstract readonly string` | 根 URL |
| `pattern` | `static readonly RegExp` | URL 匹配正则（子类覆盖） |
| `url` | `readonly string` | 输入 URL |
| `groups` | `readonly string[]` | 捕获组，**已 `slice(1)`**：`groups[0]` 是第一个捕获组 |
| `config` / `http` / `storage` / `log` | `readonly` | 构造时注入的依赖 |
| `requestInterval` | `protected [number, number]` | 请求间隔秒数范围，默认 `[6, 12]` |

方法：

```typescript
async initialize(): Promise<void>          // 一次性初始化，之后变 no-op
protected async _init(): Promise<void>     // 子类初始化钩子

[Symbol.asyncIterator](): MessageIter      // 先 initialize()，再 yield* items()
abstract items(): MessageIter              // 子类必须实现

protected _cfg(key: string, defaultVal?: ConfigValue): ConfigValue | undefined
async request(url: string, cfg?: RequestConfig): Promise<HttpResponse<unknown>>
async requestJSON(url: string, cfg?: RequestConfig): Promise<unknown>
parseTimestamp(ts: number | null | undefined): string   // Unix → ISO-8601
static generateToken(size?: number): string             // 随机 hex
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

### `Logger` / `noopLogger`

```typescript
interface Logger {
  debug: (message: string, ...args: unknown[]) => void
  info:  (message: string, ...args: unknown[]) => void
  warn:  (message: string, ...args: unknown[]) => void
  error: (message: string, ...args: unknown[]) => void
}

const noopLogger: Logger   // 全部空实现
```

### `Job`（abstract）

消息调度基类。`run()` 遍历 extractor，按 `msg.type` 路由。

```typescript
abstract class Job {
  readonly extractor: Extractor
  status: number                     // 位掩码：0 成功，4 = 下载失败

  async run(): Promise<number>
  protected _report(): void          // 子类覆盖以输出摘要

  abstract handleDirectory(msg: DirectoryMsg): Promise<void>
  abstract handleUrl(msg: UrlMsg): Promise<void>
  abstract handleQueue(msg: QueueMsg): Promise<void>
}
```

### `DownloadJob`

```typescript
class DownloadJob extends Job {
  basePath: string                            // 输出根目录，默认 ''
  readonly archive: Map<string, Set<string>>  // category → archiveKey 集合

  registerArchive(category: string, format: string): void   // 例 '{media_id}'
}
```

- 目录固定 `{category}/{username}`，文件名 `{media_id}[_{num}].{extension}`。
- `handleUrl()` 以 `responseType: 'arraybuffer'` 下载后写入 `Storage`。
- `handleQueue()` 用父 Job 的 `config`/`http`/`storage`/`log` 构造子 extractor，并继承 archive。

### `PrintJob`

```typescript
class PrintJob extends Job   // 用 ANSI 边框打印帖子/资料，不写文件
```

---

## Config

```typescript
import { ConfigManager } from '@chilfish/gallery-dl-instagram'

class ConfigManager {
  constructor(data?: Config)

  get(path: string, defaultValue?: ConfigValue): ConfigValue | undefined
  interpolate(cfgPath: readonly string[], key: string, defaultVal?: ConfigValue): ConfigValue | undefined
  set(path: string, value: unknown): void
}

type ConfigValue = string | number | boolean | null | ConfigValue[] | { [key: string]: ConfigValue }
interface Config { [key: string]: ConfigValue }
```

---

## Messages

```typescript
import { directory, queue, url } from '@chilfish/gallery-dl-instagram'

function directory(metadata?: Metadata): DirectoryMsg
function url(u: string, metadata?: Metadata): UrlMsg
function queue(u: string, metadata?: Metadata & { _extractor?: ExtractorClass }): QueueMsg
```

```typescript
type Message = DirectoryMsg | UrlMsg | QueueMsg

interface DirectoryMsg { readonly type: 'directory', readonly metadata: Metadata }
interface UrlMsg       { readonly type: 'url', readonly url: string, readonly metadata: Metadata }
interface QueueMsg     { readonly type: 'queue', readonly url: string, readonly metadata: Metadata & { readonly _extractor?: ExtractorClass } }

type Metadata = Record<string, unknown>
type MessageIter = AsyncGenerator<Message, void, unknown>

/** Queue 分发所需的最小类形状 */
interface ExtractorClass {
  pattern: RegExp
  subcategory: string
}
```

---

## HTTP & Storage 接口

```typescript
interface HttpClient {
  request: <T = unknown>(config: {
    url: string
    method?: string
    headers?: Record<string, string>
    params?: Record<string, string | number | null | undefined>
    data?: unknown
    signal?: AbortSignal
    timeout?: number
    responseType?: 'arraybuffer' | 'text' | 'json'
  }) => Promise<HttpResponse<T>>
}

interface HttpResponse<T = unknown> {
  status: number
  data: T
  headers: Record<string, string>
  url: string              // 重定向后的最终 URL
  request?: RequestConfig
}

interface Storage {
  exists: (path: string) => Promise<boolean>
  write: (path: string, data: Uint8Array | string) => Promise<void>
  mkdir: (path: string) => Promise<void>
}

interface RequestConfig {
  headers?: Record<string, string>
  params?: Record<string, string | number | null | undefined>
  method?: string
  data?: unknown
  timeout?: number
  signal?: AbortSignal
  withCredentials?: boolean
  responseType?: 'arraybuffer' | 'text' | 'json'
}
```

### `InstagramSDK`

```typescript
class InstagramSDK {
  readonly http: HttpClient
  readonly storage: Storage
  readonly log: Logger
  readonly config: ConfigManager

  constructor(opts?: { http?: HttpClient, storage?: Storage, log?: Logger, csrfToken?: string })

  extract(url: string): MessageIter
  download(url: string, outputDir?: string): Promise<{ posts: number, files: number, bytes: number }>
}

export type { ExtractOptions, SDKOptions }
```

### `createSDK`（来自 `./node`）

```typescript
function createSDK(opts?: CreateSDKOptions): Promise<InstagramSDK>

interface CreateSDKOptions {
  cookies?: string
  http?: HttpClient
  storage?: Storage
  log?: Logger
}
```

---

## Instagram 模块

### `InstagramExtractor`（abstract）

```typescript
import { InstagramExtractor } from '@chilfish/gallery-dl-instagram'
```

| 成员 | 类型 | 说明 |
|---|---|---|
| `category` | `'instagram'` | 固定 |
| `root` | `'https://www.instagram.com'` | 固定 |
| `api` | `InstagramRestAPI` | `_init()` 中创建 |
| `csrfToken` | `Ref<string>` | CSRF token |
| `wwwClaim` | `Ref<string>` | IG WWW Claim |
| `cursor` | `Ref<string \| null>` | 分页游标 |

```typescript
interface InstagramExtractorOptions extends ExtractorOptions {
  sessionId?: string
  cookies?: Record<string, string>
  csrfToken?: string          // 预置 CSRF（匿名 Cookie Jar 场景）
}

async login(): Promise<void>                            // 当前为 no-op
async metadata(): Promise<Record<string, unknown>>       // 子类钩子，默认 {}
async* items(): MessageIter                              // 基类核心管线
abstract posts(): AsyncGenerator<InstagramPost>          // 子类提供帖子流

// protected（预留钩子，当前无提取器调用）
_initCursor(): string | null
_updateCursor(cursor: string | null): string | null
_assignUser(user: InstagramUser): void
```

`items()` 的管线：读配置 → 构建 `ParserConfig` → 遍历 `posts()` → 选择解析器（`post.items` 存在走 REST，否则看 `__typename`）→ 产出 `directory` 消息 → 逐文件产出 `url` 消息（音频 / 视频 / 图片，`order-files` 可反转顺序）。

### 子提取器

每个都继承 `InstagramExtractor`，带 `static pattern` 与 `static fromURL(url, opts)`。

| 提取器 | `subcategory` | URL 模式 | 数据来源 |
|---|---|---|---|
| `InstagramPostExtractor` | `post` / `reel` | `/p/{code}`、`/tv/{code}`、`/reel(s)/{code}`、`/share/...` | `api.media()` |
| `InstagramUserExtractor` | `user` | `/{username}` | 按 `include` 发 `Queue`，自身不取数 |
| `InstagramPostsExtractor` | `posts` | `/{username}/posts` | `api.userFeed()` |
| `InstagramReelsExtractor` | `reels` | `/{username}/reels` | `api.userClips()` |
| `InstagramTaggedExtractor` | `tagged` | `/{username}/tagged` | `api.userTagged()`（额外产出 `tagged_*` 元数据） |
| `InstagramStoriesExtractor` | `stories` / `highlights` | `/stories/{user}/`、`/stories/highlights/{id}`、`/aGlnaGxpZ2h0…` | 页面内嵌 payload（user: `reels_media`；highlight: `reels_media__connection`）→ `api.reelsMedia()` 回退 |
| `InstagramHighlightsExtractor` | `highlights` | `/{username}/highlights` | `api.highlightsMedia()` |
| `InstagramTagExtractor` | `tag` | `/explore/tags/{tag}` | `api.tagsMedia()` |
| `InstagramInfoExtractor` | `info` | `/{username}/info` | `api.userById()` → 单个 Directory |
| `InstagramAvatarExtractor` | `avatar` | `/{username}/avatar` | HD 头像 |
| `InstagramSavedExtractor` | `saved` | `/{username}/saved[/all-posts]` | `api.userSaved()` |

### `InstagramRestAPI`

由 `InstagramExtractor._init()` 创建，通过 `Ref` 共享状态。

```typescript
class InstagramRestAPI {
  constructor(opts: {
    http: HttpClient
    root: string
    csrfToken: { value: string }
    wwwClaim: { value: string }
    cursor: { value: string | null }
    userStrategies?: () => string[]   // 默认 ['search', 'web']
  })

  // 帖子 / 媒体
  media(shortcode: string): AsyncGenerator<InstagramPost>

  // 用户内容
  userFeed(userId: string): AsyncGenerator<InstagramPost>
  userClips(userId: string): AsyncGenerator<InstagramPost>
  userTagged(userId: string): AsyncGenerator<InstagramPost>
  userSaved(): AsyncGenerator<InstagramPost>
  userCollection(collectionId: string): AsyncGenerator<InstagramPost>

  // Stories / Highlights
  reelsMedia(reelIds: string[]): Promise<InstagramPost[]>
  reelsTray(): Promise<InstagramPost[]>
  highlightsTray(userId: string): Promise<{ id: string }[]>
  highlightsMedia(userId: string, chunkSize?: number): AsyncGenerator<InstagramPost>

  // Hashtag
  tagsMedia(tag: string): AsyncGenerator<InstagramPost>

  // 用户解析
  userById(userId: string): Promise<InstagramUser>
  userByName(username: string): Promise<InstagramUser>      // 解析 { data: { user } }
  userBySearch(username: string): Promise<InstagramUser>
  userByWeb(username: string): Promise<{ id: string }>      // page_id / profile_id
  userByScreenName(screenName: string, strategies?: string[]): Promise<InstagramUser>
  userId(screenName: string, checkPrivate?: boolean, strategies?: string[]): Promise<string>

  // 社交图
  userFollowers(userId: string): AsyncGenerator<InstagramUser>
  userFollowing(userId: string): AsyncGenerator<InstagramUser>
}
```

所有请求经 `_call()` 注入 `Cookie: csrftoken=…`、`X-CSRFToken`、`X-IG-App-ID`、`X-ASBD-ID`、`X-IG-WWW-Claim`、`X-Requested-With`、`Referer`，并在登录/challenge 重定向时抛错。

`_call()` 以文本取回响应后自行解析 JSON：非 2xx 抛出含状态码与 body 摘要的错误，2xx 非 JSON 抛出 `non-JSON response`。`userByScreenName()` 默认策略 `['search', 'web']`（可由 `user-strategy` 配置覆盖），全部失败时汇总每条策略的原因。

### Parsers

```typescript
import { extractAudio, extractTaggedUsers, parsePostGraphql, parsePostRest } from '@chilfish/gallery-dl-instagram'

function parsePostRest(post: InstagramPost, cfg: ParserConfig): ParsedPost
function parsePostGraphql(post: Record<string, unknown>, cfg: ParserConfig): ParsedPost
function extractTaggedUsers(src: Record<string, unknown>, dest: ParsedMedia): void
function extractAudio(
  src: Record<string, unknown>,
  dest: Record<string, unknown>,
  sticker: MusicSticker,
  cfg: ParserConfig,
): ParsedMedia | null
```

### Instagram 类型

导出的类型：`Coauthor`、`ImageCandidate`、`InstagramCarouselItem`、`InstagramLocation`、`InstagramPost`、`InstagramUser`、`ParsedMedia`、`ParsedPost`、`ParserConfig`、`TaggedUser`、`VideoVersion`。

```typescript
interface InstagramUser {
  pk: string; id?: string; username: string; full_name: string
  is_private?: boolean; is_verified?: boolean; followed_by_viewer?: boolean
  profile_pic_url?: string; profile_pic_url_hd?: string
  hd_profile_pic_url_info?: ImageCandidate
  hd_profile_pic_versions?: ImageCandidate[]
  // + edge_* 计数（旧字段）
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
  music_metadata?: MusicMetadata      // { music_info?: MusicSticker }
  items?: InstagramCarouselItem[]     // story / highlight
  // + usertags / reel_mentions / story_*_stickers / expiring_at …
}

interface ImageCandidate { url: string; width: number; height: number }
interface VideoVersion   { url: string; width: number; height: number; type: number }

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

`ParsedPost` / `ParsedMedia` 的完整字段见 [guide/sdk.md#类型系统](../guide/sdk.md#类型系统)。

---

## Utils

### ID Codec

```typescript
import { idFromShortcode, shortcodeFromId } from '@chilfish/gallery-dl-instagram'

function idFromShortcode(shortcode: string): string        // shortcode → 数字 ID
function shortcodeFromId(postId: string | number): string  // 数字 ID → shortcode
```

字母表为 Base64 变体 `A-Za-z0-9-_`。

### Text

```typescript
import {
  ensureHttpScheme, extr, extract, findTags,
  nameExtFromURL, parseInt, parseUnicodeEscapes, unescape, unquote,
} from '@chilfish/gallery-dl-instagram'
```

| 函数 | 说明 |
|---|---|
| `extract(txt, begin, end)` | 取子串，失败返回 `null` |
| `extr(txt, begin, end, default='')` | 同上 + 默认值 |
| `parseUnicodeEscapes(text)` | `\uXXXX` → 字符 |
| `unescape(text)` | HTML 实体解码（内置常用表 + 数字实体） |
| `unquote(text)` | URL 解码，失败时尽力逐段解码 |
| `ensureHttpScheme(url, scheme?)` | 补全 `https://` |
| `nameExtFromURL(url, meta)` | 从 URL 提取 `filename` / `extension` 写入 meta |
| `parseInt(value, default=0)` | 安全整数解析 |
| `findTags(text)` | 返回去重的 `#\w+` 列表 |

---

## CLI Adapter（内部，不导出）

CLI 的 Node.js 绑定仅供 `src/cli/*` 内部使用：

```typescript
// src/cli/adapter.ts
function createHttpClient(sessionId?: string, fullCookies?: string, logger?: Logger): HttpClient
function createWebClient(logger?: Logger): Promise<{ http: HttpClient, csrfToken: string }>
function createLogger(verbose: boolean): Logger

// src/cli/storage.ts
function createStorage(): Storage

// src/cli/cookies.ts
function createCookieJar(): CookieJar
```
