# SDK 使用指南

> `@chilfish/gallery-dl-instagram` — 不只是 CLI，更是一个可嵌入任何平台的 SDK。

## 快速开始

```bash
npm install @chilfish/gallery-dl-instagram
# 或
bun add @chilfish/gallery-dl-instagram
```

### 一行代码下载

```ts
import { createSDK } from '@chilfish/gallery-dl-instagram/node'

const ig = await createSDK({
  cookies: 'ds_user_id=...; sessionid=...; csrftoken=...; ig_did=...',
})

// 下载一个帖子
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

SDK 提供三层入口，按需选用：

| 入口 | 适用场景 | 复杂度 |
|------|----------|--------|
| `createSDK()` | 一行代码搞定，Node.js 默认适配器 | ★☆☆ |
| `InstagramSDK` | 自定义 HTTP / Storage / Logger | ★★☆ |
| 直接拼装（见下） | 完全控制：自己组装 extractor + job | ★★★ |

---

## 高层 API：`InstagramSDK`

### 创建实例

```ts
// Node.js：一行代码（自动创建 fetch adapter）
import { createSDK } from '@chilfish/gallery-dl-instagram/node'

const ig = await createSDK({
  cookies: 'ds_user_id=...; sessionid=...; csrftoken=...; ig_did=...',
})

// 任意平台：手动传入 adapter
import { InstagramSDK } from '@chilfish/gallery-dl-instagram'
const ig = new InstagramSDK({
  http: myHttpClient,   // 你的 HttpClient 实现（必需）
  storage: myStorage,   // Storage 实现（可选，download() 需要）
  log: myLogger,        // Logger 实现（可选）
})
```

**Cookie 从哪里来**：
1. 浏览器打开 instagram.com（已登录）
2. F12 → Network → 随便点一个请求 → Request Headers
3. 复制 `Cookie:` 后面的完整字符串

### `ig.extract(url)` — 提取元数据

```ts
for await (const msg of ig.extract('https://www.instagram.com/p/ABC123/')) {
  switch (msg.type) {
    case 'directory':
      // 一个帖子开始 — metadata 包含 post_id, username, description, tags...
      console.log(msg.metadata)
      break
    case 'url':
      // 一个文件 — metadata 包含 media_id, display_url, video_url?, dimensions...
      console.log(msg.url, msg.metadata.media_id)
      break
    case 'queue':
      // 子提取器委托（user 命令解析到 posts/reels/stories 时会出现）
      break
  }
}
```

### `ig.download(url, outputDir?)` — 下载文件

```ts
const stats = await ig.download(
  'https://www.instagram.com/p/ABC123/',
  './my-photos',
)
// { posts: 1, files: 9, bytes: 4500000 }

// 第二个参数可选，默认 './data'
await ig.download('https://www.instagram.com/user/')
```

### 支持的 URL 格式

| URL 模式 | 用途 |
|----------|------|
| `/p/{shortcode}/` | 单个帖子 |
| `/reel/{shortcode}/` | Reel |
| `/{username}/` | 用户全部内容 |
| `/stories/{username}/` | Stories |
| `/{username}/highlights/` | Highlights |
| `/explore/tags/{tag}/` | Hashtag |
| `/{username}/saved/` | 收藏夹 |

---

## 中层 API：平台无关核心

如果你在浏览器、Deno、Cloudflare Workers 等非 Node.js 环境运行，你可以直接用底层 extractor + 自定义 adapter：

### 实现三个接口

```ts
import type { HttpClient, HttpResponse, Storage, Logger } from '@chilfish/gallery-dl-instagram'

// ── 1. HttpClient（必须） ──
const http: HttpClient = {
  async request(config) {
    const resp = await fetch(config.url, {
      method: config.method ?? 'GET',
      headers: {
        ...config.headers,
        Cookie: 'ds_user_id=...; sessionid=...',
      },
    })
    const data = await (config.responseType === 'arraybuffer'
      ? resp.arrayBuffer()
      : resp.json())
    return {
      status: resp.status,
      data,
      headers: Object.fromEntries(resp.headers),
      url: resp.url,
    }
  },
}

// ── 2. Storage（download 时需要） ──
const storage: Storage = {
  async exists(path) { /* ... */ return false },
  async write(path, data) { /* 写文件或 blob */ },
  async mkdir(path) { /* 创建目录 */ },
}

// ── 3. Logger（可选，默认 noop） ──
const log: Logger = {
  debug: (...args) => console.debug(...args),
  info: (...args) => console.info(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
}
```

### 手动组装 extractor + job

```ts
import {
  ConfigManager,
  DownloadJob,
  InstagramPostExtractor,
} from '@chilfish/gallery-dl-instagram'

const config = new ConfigManager({
  extractor: {
    instagram: {
      videos: true,
      'max-posts': 50,
    },
  },
})

const match = InstagramPostExtractor.pattern.exec(
  'https://www.instagram.com/p/ABC123/',
)
if (!match) throw new Error('URL not recognized')

const extractor = new InstagramPostExtractor({
  url: 'https://www.instagram.com/p/ABC123/',
  match,
  config,
  http,
  storage,
  log,
})

const job = new DownloadJob(extractor)
job.basePath = './downloads'
await job.run()
```

---

## 类型系统

所有消息类型都是 discriminated union，TypeScript 自动类型收窄：

```ts
import type { Message, DirectoryMsg, UrlMsg, QueueMsg } from '@chilfish/gallery-dl-instagram'

function handle(msg: Message) {
  if (msg.type === 'url') {
    // msg 自动收窄为 UrlMsg
    console.log(msg.url)          // ✅ string
    console.log(msg.metadata.media_id) // ✅ string | undefined
  }
}
```

### `ParsedPost` — 帖子元数据

```ts
interface ParsedPost {
  post_id: string           // 帖子数字 ID
  post_shortcode: string    // URL shortcode
  post_url: string          // 完整 URL
  username: string          // 作者 @
  fullname: string          // 显示名
  description: string       // 帖子描述
  tags?: string[]           // #hashtag 列表
  likes: number
  type: 'post' | 'reel' | 'story' | 'highlight'
  _files: ParsedMedia[]     // 文件列表（每个文件一个）
  // + location_*, coauthors, pinned, sidecar_*...
}
```

### `ParsedMedia` — 文件元数据

```ts
interface ParsedMedia {
  num: number               // 在帖子里的序号
  media_id: string          // 媒体 ID
  shortcode: string
  display_url: string       // 图片 URL
  video_url: string | null  // 视频 URL（如果有）
  width: number
  height: number
  width_original: number    // 原图宽（Instagram 可能缩过）
  height_original: number   // 原图高
  audio_url?: string        // 独立音频（reels 音乐）
  audio_title?: string
  audio_artist?: string
  tagged_users: TaggedUser[]
}
```

> **分辨率说明**：Instagram API 最多返回短边 1080px 的版本，`*_original` 字段记录的是原始分辨率，但 `display_url` / `video_url` 指向的是 CDN 缩略版本。Instagram CDN 的 URL 带有签名参数（`stp=...`），修改会导致 403。

---

## 配置项

通过 `ConfigManager` 控制提取行为：

```ts
const config = new ConfigManager({
  extractor: {
    instagram: {
      videos: true,           // 下载视频（默认 true）
      'max-posts': 50,        // 最大帖子数
      audio: false,           // 下载独立音频
      'order-files': 'r',     // 文件倒序
      'static-videos': false, // false = 下载真视频，true = 只下载封面
      cursor: '上次的cursor',  // 断点续传
    },
  },
})
```

`ConfigManager.interpolate` 支持层级查找：

```ts
config.interpolate(['extractor', 'instagram', 'post'], 'videos')
// 查找顺序：extractor.instagram.post.videos
//         → extractor.instagram.videos     ← 命中这个
//         → extractor.videos
```

---

## 浏览器的 HttpClient 示例

```ts
const browserHttp: HttpClient = {
  async request(config) {
    const resp = await fetch(config.url, {
      method: config.method ?? 'GET',
      headers: {
        ...config.headers,
        // 完整 Cookie 字符串
        Cookie: 'ds_user_id=...; sessionid=...',
      },
      credentials: 'omit', // Instagram CDN 不需要 credentials
    })

    let data: unknown
    if (config.responseType === 'arraybuffer') {
      data = await resp.arrayBuffer()
    } else {
      data = await resp.json()
    }

    return {
      status: resp.status,
      data,
      headers: Object.fromEntries(resp.headers.entries()),
      url: resp.url,
    }
  },
}
```

> **浏览器限制**：Instagram CDN 的 CORS 策略通常允许跨域请求图片/视频。但 `/api/v1/` 等 API 端点可能被 CORS 拦截——你需要通过服务端代理转发。

---

## Deno 示例

```ts
import { InstagramSDK } from 'npm:@chilfish/gallery-dl-instagram'

// Deno 使用 fetch-based HTTP client + Deno storage
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
    // 用 Deno 下载
    const resp = await fetch(msg.url)
    const file = await resp.bytes()
    await Deno.writeFile(`./downloads/${msg.metadata.media_id}.jpg`, file)
  }
}
```

---

## 和 Python gallery-dl 的关系

这个 TypeScript 版是 Python [gallery-dl](https://github.com/mikf/gallery-dl) Instagram 模块的移植，核心提取逻辑保持一致：

- 相同的 `items()` 生成器管线
- 相同的 Message 三元组协议
- 相同的 API 端点选择（REST）

TS 版特有的改进：
- 完整的 TypeScript 类型（discriminated union，不需要 runtime duck typing）
- 平台无关的 adapter 模式（同一个 extractor 跑在 Node.js / Bun / 浏览器 / Deno）
- 高层 SDK 封装（`extract()` / `download()` 一行代码）
- 无阻塞 AsyncGenerator（Python 版是同步生成器）
