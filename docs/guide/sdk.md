# SDK 使用指南

> `@chilfish/gallery-dl-instagram` — 不只是 CLI，更是一个可嵌入任何平台的 SDK。
> 全量导出面见 [reference/api-reference.md](../reference/api-reference.md)。

## 快速开始

```bash
npm install @chilfish/gallery-dl-instagram
# 或
bun add @chilfish/gallery-dl-instagram
```

### 一行代码下载（Node.js）

```ts
import { createSDK } from '@chilfish/gallery-dl-instagram/node'

const ig = await createSDK({
  cookies: 'ds_user_id=...; sessionid=...; csrftoken=...; ig_did=...',
})

await ig.download('https://www.instagram.com/p/ABC123/', './downloads')
// → 文件写入 ./downloads/instagram/{username}/
```

### 只拿数据，不下文件

```ts
for await (const msg of ig.extract('https://www.instagram.com/p/ABC123/')) {
  if (msg.type === 'directory') {
    console.log('帖子:', msg.metadata.username, msg.metadata.post_shortcode)
  }
  if (msg.type === 'url') {
    console.log('文件:', msg.url, msg.metadata.media_id)
  }
}
```

---

## 入口选择

| 入口 | 适用场景 | 需要提供 |
|---|---|---|
| `createSDK()`（`/node`） | Node.js，一行搞定 | `cookies` 或自定义 `http` |
| `new InstagramSDK()`（`.`） | 任意平台，自定义 HTTP / Storage / Logger | 无（`http` 缺省用内置 fetch 客户端） |
| 手动组装 extractor + job | 完全控制执行流程 | 全套依赖 |

两个公开子路径：`.`（平台无关）与 `./node`（Node.js 便利工厂）。

---

## 高层 API：`InstagramSDK`

```ts
import { createSDK } from '@chilfish/gallery-dl-instagram/node'

// Node.js：自动创建 fetch HttpClient + fs Storage
const ig = await createSDK({
  cookies: 'ds_user_id=...; sessionid=...; csrftoken=...; ig_did=...',
})
```

```ts
import { InstagramSDK } from '@chilfish/gallery-dl-instagram'

// 任意平台：可完全省略选项 —— http 默认使用内置 fetch 客户端
const ig = new InstagramSDK({
  http: myHttpClient,   // 可选：自定义 HTTP 层
  storage: myStorage,   // 可选：download() 需要
  log: myLogger,        // 可选：默认静默
  csrfToken: '...',     // 可选：预置 CSRF
})
```

`createSDK` 的行为：

- 传 `cookies` → 自动 `extractCsrf()` 并注入 Cookie 头；未传 `storage` 时首次下载才动态加载 `fs` 实现。
- 传 `http` → 直接用你的实现，不再创建默认客户端。
- 两者都不传 → `http` 仍是内置 fetch 客户端，但没有 Cookie，只能访问公开内容。

**Cookie 从哪里来**：浏览器打开 instagram.com（已登录）→ F12 → Network → 任一请求 → Request Headers → 复制整行 `Cookie:`。

### `ig.extract(url)` — 提取消息流

返回 `AsyncGenerator<Message>`，不下载。

```ts
for await (const msg of ig.extract('https://www.instagram.com/p/ABC123/')) {
  switch (msg.type) {
    case 'directory':
      // 一个帖子开始：post_id / username / description / tags / ...
      break
    case 'url':
      // 一个文件：media_id / display_url / video_url? / 尺寸 / 音频元数据
      console.log(msg.url, msg.metadata.media_id)
      break
    case 'queue':
      // 委托给子提取器（user URL 分发到 posts/reels/... 时出现）
      break
  }
}
```

### `ig.download(url, outputDir?)` — 下载

```ts
const stats = await ig.download('https://www.instagram.com/p/ABC123/', './my-photos')
// { posts: 1, files: 9, bytes: 4500000 }
```

第二个参数默认 `./data`。内部创建 `DownloadJob`，`basePath` 设为该目录。

### 支持的 URL

| URL 模式 | 提取器 |
|---|---|
| `/p/{shortcode}/`、`/reel/{shortcode}/`、`/share/...` | `InstagramPostExtractor` |
| `/{username}/` | `InstagramUserExtractor`（按 `include` 分发） |
| `/{username}/posts/`、`/reels/`、`/tagged/` | 对应列表提取器 |
| `/stories/{username}/`、`/stories/highlights/{id}/` | `InstagramStoriesExtractor` |
| `/{username}/highlights/` | `InstagramHighlightsExtractor` |
| `/explore/tags/{tag}/` | `InstagramTagExtractor` |
| `/{username}/saved/` | `InstagramSavedExtractor` |
| `/{username}/info/`、`/{username}/avatar/` | 资料 / 头像 |

`_resolve()` 按固定顺序试 pattern，未命中抛 `No extractor matched URL: …`。

---

## 中层 API：平台无关核心

非 Node.js 环境（浏览器 / Deno / Workers）自己实现三个接口即可。

```ts
import type { HttpClient, HttpResponse, Storage, Logger } from '@chilfish/gallery-dl-instagram'

// 1. HttpClient（download/extract 都必需）
const http: HttpClient = {
  async request(config) {
    const resp = await fetch(config.url, {
      method: config.method ?? 'GET',
      headers: { ...config.headers, Cookie: 'ds_user_id=...; sessionid=...' },
    })
    const data = config.responseType === 'arraybuffer'
      ? await resp.arrayBuffer()
      : await resp.json()
    return { status: resp.status, data, headers: Object.fromEntries(resp.headers), url: resp.url }
  },
}

// 2. Storage（仅 download 需要）
const storage: Storage = {
  async exists(path) { return false },
  async write(path, data) { /* 写文件或 blob */ },
  async mkdir(path) { /* 创建目录 */ },
}

// 3. Logger（可选，默认 noop）
const log: Logger = {
  debug: (...a) => console.debug(...a),
  info: (...a) => console.info(...a),
  warn: (...a) => console.warn(...a),
  error: (...a) => console.error(...a),
}
```

> 二进制下载必须在 `HttpClient` 里支持 `responseType: 'arraybuffer'`，否则文件会被文本解码损坏。见 [postmortem 003](../postmortem/003-binary-download-csrf.md)。

### 手动组装 extractor + job

```ts
import { ConfigManager, DownloadJob, InstagramPostExtractor } from '@chilfish/gallery-dl-instagram'

const config = new ConfigManager({
  extractor: { instagram: { videos: true, 'max-posts': 50 } },
})

const url = 'https://www.instagram.com/p/ABC123/'
const match = InstagramPostExtractor.pattern.exec(url)
if (!match) throw new Error('URL not recognized')

const extractor = new InstagramPostExtractor({ url, match, config, http, storage, log })

const job = new DownloadJob(extractor)
job.basePath = './downloads'
await job.run()
```

---

## 类型系统

消息是 discriminated union，`msg.type` 自动收窄：

```ts
import type { Message, DirectoryMsg, UrlMsg, QueueMsg } from '@chilfish/gallery-dl-instagram'

function handle(msg: Message) {
  if (msg.type === 'url') {
    msg.url                    // string
    msg.metadata.media_id      // unknown
  }
}
```

> `metadata` 的类型是 `Record<string, unknown>`。要拿到强类型字段，用导出的 `ParsedPost` / `ParsedMedia` 做断言或类型收窄。

### `ParsedPost` — 帖子元数据

```ts
interface ParsedPost {
  post_id: string
  post_shortcode: string
  post_url: string
  owner_id: string
  username: string
  fullname: string
  post_date: string          // ISO-8601
  date: string               // 同 post_date
  description: string
  tags?: string[]
  location_id?: string
  location_slug?: string
  location_url?: string
  likes: number
  liked: boolean
  pinned: string[]
  coauthors?: Coauthor[]
  sidecar_media_id?: string
  sidecar_shortcode?: string
  type: 'post' | 'reel' | 'story' | 'highlight'
  count: number              // 文件数
  _files: ParsedMedia[]
  // + expires / highlight_title / tagged_* / subscription / typename
}
```

### `ParsedMedia` — 文件元数据

```ts
interface ParsedMedia {
  num: number
  date: string
  media_id: string
  shortcode: string
  display_url: string
  video_url: string | null
  width: number
  height: number
  width_original: number
  height_original: number
  tagged_users: TaggedUser[]
  // 音频 / BGM（story music sticker · reels 音乐 · 帖子 BGM）
  audio_url?: string
  audio_title?: string
  audio_subtitle?: string
  audio_artist?: string
  audio_duration?: number           // 秒
  audio_timestamps?: number[]       // 高潮点（ms）
  audio_cover_artwork_uri?: string
  audio_cover_artwork_thumbnail_uri?: string
  audio_has_lyrics?: boolean
  audio_is_explicit?: boolean
  music_attribution?: string
  music_display_type?: string
  // Story 链接贴纸
  story_link_url?: string
  story_link_display?: string
  story_link_title?: string
  story_link_type?: string
  // 其他
  owner?: InstagramUser
  author?: InstagramUser
  expires?: string
  subscription?: string
  audience?: string
  _ytdl_manifest_data?: string
  sidecar_media_id?: string
  sidecar_shortcode?: string
}
```

> **分辨率**：API 最多返回短边 1080px。`*_original` 记录原始分辨率，但 URL 指向缩略版本；CDN 的 `stp=` 签名参数改动即 403。

---

## 配置项

`ConfigManager` 控制提取行为，键为连字符命名：

```ts
const config = new ConfigManager({
  extractor: {
    instagram: {
      videos: true,           // 下载视频（默认 true）
      previews: ['video'],    // 只下载预览：video / audio
      audio: false,           // 下载独立音频轨
      'max-posts': 50,        // 最大帖子数
      'order-files': 'r',     // r / d 开头 = 反转文件顺序
      'static-videos': false, // true = 只下载封面
      cursor: '上次的cursor',
      include: 'all',         // user 提取器分发哪些子类型
      split: false,           // stories 每帧独立输出
      'user-strategy': 'web,info',   // 用户名解析策略链（topsearch 已失效）
      api: 'auto',                   // auto = doc_id GraphQL 优先；rest = REST 优先
    },
  },
})
```

`interpolate` 的层级查找（`_cfg()` 自动使用 `['extractor', category, subcategory]`）：

```ts
config.interpolate(['extractor', 'instagram', 'post'], 'videos')
// extractor.instagram.post.videos → extractor.instagram.videos ✓ → extractor.videos
```

> **未生效的键**：`api`、`order-posts` 会被 CLI 写入配置，但没有任何提取器读取。

---

## 浏览器示例

```ts
const browserHttp: HttpClient = {
  async request(config) {
    const resp = await fetch(config.url, {
      method: config.method ?? 'GET',
      headers: { ...config.headers, Cookie: 'ds_user_id=...; sessionid=...' },
      credentials: 'omit',
    })
    const data = config.responseType === 'arraybuffer'
      ? await resp.arrayBuffer()
      : await resp.json()
    return { status: resp.status, data, headers: Object.fromEntries(resp.headers), url: resp.url }
  },
}
```

> **浏览器限制**：CDN 图片/视频通常允许跨域；`/api/v1/` 端点可能被 CORS 拦截，需要服务端代理。

## Deno 示例

```ts
import { InstagramSDK } from 'npm:@chilfish/gallery-dl-instagram'

const ig = new InstagramSDK({
  http: {
    request: async ({ url, headers }) => {
      const resp = await fetch(url, { headers })
      return { status: resp.status, data: await resp.json(), headers: Object.fromEntries(resp.headers), url: resp.url }
    },
  },
})

for await (const msg of ig.extract('https://www.instagram.com/p/ABC123/')) {
  if (msg.type === 'url') {
    const bytes = new Uint8Array(await (await fetch(msg.url)).arrayBuffer())
    await Deno.writeFile(`./downloads/${msg.metadata.media_id}.jpg`, bytes)
  }
}
```

---

## 和 Python gallery-dl 的关系

同一套提取逻辑的 TypeScript 移植：`items()` 管线、`Directory`/`Url`/`Queue` 三种消息、REST 端点选择都保持一致。

TS 版的差异：

- **消息协议是 discriminated union**（Python 是 `(Message.Type, url, dict)` 三元组）
- **`Ref<T>` 共享可变状态**（Python 直接改 `self` 属性）
- 完整静态类型，无运行时 duck typing
- 平台无关 adapter，同一 extractor 跑在 Node.js / Bun / 浏览器 / Deno
- 高层封装 `extract()` / `download()`
- 未实现：视频合并（yt-dlp）、post-processor 链、archive 持久化、粉丝/关注列表

完整对照见 [reference/python-parity.md](../reference/python-parity.md)。
