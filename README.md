# gallery-dl-instagram

> TypeScript 移植版 Instagram 媒体提取器 — 平台无关核心 + Node.js adapter + CLI。
> 原 Python 实现为 [gallery-dl](https://github.com/mikf/gallery-dl)。

## 特性

- **平台无关** — 核心库只依赖 `HttpClient` / `Storage` / `Logger` 三个接口，浏览器 / Deno / Edge 换一套 adapter 即可
- **AsyncGenerator 管线** — 提取器产出 `Message` 流（directory / url / queue），由 Job 消费
- **11 个子提取器** — post / reel / user / stories / highlights / tagged / saved / tag / avatar / info / posts
- **CSRF 认证** — 自动从 Cookie 提取 csrftoken，同时作为 Cookie 和 X-CSRFToken header 发送
- **CLI 工具** — `dl-ins` 命令，按 URL 自动路由，支持完整 Cookie 头或 sessionid 登录
- **类型安全** — TypeScript strict mode，完整的类型导出

## 快速开始

### 安装

```bash
npm install @chilfish/gallery-dl-instagram
```

### SDK 使用

```ts
import { createSDK } from '@chilfish/gallery-dl-instagram/node'

const ig = await createSDK({
  cookies: 'ds_user_id=...; sessionid=...; csrftoken=...',
})

// 提取元数据（不下载）
for await (const msg of ig.extract('https://www.instagram.com/p/ABC123/')) {
  if (msg.type === 'url') console.log(msg.url)
}

// 下载到磁盘
const stats = await ig.download('https://www.instagram.com/p/ABC123/', './downloads')
// → { posts: 1, files: 9, bytes: 4500000 }
```

### 自定义 Adapter（非 Node.js 环境）

```ts
import { InstagramSDK } from '@chilfish/gallery-dl-instagram'

const ig = new InstagramSDK({
  http: myHttpClient,   // 浏览器 fetch / Deno / Edge
  storage: myStorage,   // 可选，download() 需要
  log: myLogger,        // 可选，默认静默
})
```

### CLI

```bash
# 全局安装后使用 bin 名 `dl-ins`（或 npx -p @chilfish/gallery-dl-instagram dl-ins ...）
# 下载单个帖子
dl-ins https://www.instagram.com/p/ABC123/ --cookies="..."

# 下载用户全部帖子
dl-ins https://www.instagram.com/username/ --cookies="..."

# 按标签搜索
dl-ins tag cats --cookies="..."

# 下载收藏
dl-ins saved --cookies="..."

# 仅输出元数据（不下载）
dl-ins https://www.instagram.com/p/ABC123/ --cookies="..." --info
```

## 示例

`examples/` 目录包含可运行的示例脚本：

| 文件 | 说明 |
|------|------|
| `basic-extract.ts` | 提取单个帖子的所有媒体 URL 和元数据 |
| `download.ts` | 下载帖子媒体到本地目录 |
| `extract-user.ts` | 提取用户主页的最近帖子 |
| `extract-tag.ts` | 按 hashtag 搜索并提取帖子 |
| `custom-adapter.ts` | 自定义 fetch-based adapter（浏览器/Deno 兼容） |

运行示例：

```bash
# 先在 .env 中设置 INSTAGRAM_COOKIES
cp .env.example .env

# 运行示例
bun examples/basic-extract.ts
bun examples/download.ts
bun examples/custom-adapter.ts
```

## Cookie 获取

1. 浏览器打开 instagram.com（已登录）
2. F12 → Application → Cookies → instagram.com
3. 复制完整 Cookie 字符串，或至少包含 `sessionid` + `csrftoken`

## 文档

完整索引见 [docs/README.md](docs/README.md)。

- [SDK 指南](docs/guide/sdk.md) — 快速开始 / 三层 API / 浏览器 & Deno 适配
- [CLI 指南](docs/guide/cli.md) — 命令、生效选项、输出结构与排障
- [架构](docs/engineering/architecture.md) — 流水线 / 生命周期 / 消息协议 / 配置系统
- [API 参考](docs/reference/api-reference.md) — 全量导出面
- [Python 对照](docs/reference/python-parity.md) — 与原版 gallery-dl 的差异与功能矩阵

## 开发

```bash
# 安装依赖
bun install

# 类型检查
bun run typecheck

# Lint
bun run lint

# 测试
bun run test          # 全部
bun run test:unit     # 仅单元测试
bun run test:watch    # 监听模式

# 构建
bun run build
```

## License

GPL-2.0-only — 基于 [gallery-dl](https://github.com/mikf/gallery-dl) (GPL-2.0) 移植。详见 [LICENSE](LICENSE)。
