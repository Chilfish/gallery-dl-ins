# gallery-dl-instagram

> TypeScript 移植版 Instagram 媒体提取器 — 平台无关核心 + Node.js adapter + CLI。
> 原 Python 实现为 [gallery-dl](https://github.com/mikf/gallery-dl)。

## 特性

- **平台无关** — 核心库只依赖 `HttpClient` / `Storage` / `Logger` 三个接口，浏览器 / Deno / Edge 换一套 adapter 即可
- **AsyncGenerator 管线** — 提取器产出 `Message` 流（directory / url / queue），由 Job 消费
- **11 个子提取器** — post / reel / user / stories / highlights / tagged / saved / tag / avatar / info / posts
- **CSRF 认证** — 自动从 Cookie 提取 csrftoken，同时作为 Cookie 和 X-CSRFToken header 发送
- **CLI 工具** — 8 个子命令，支持 Cookie 字符串或 sessionid 登录
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
# 下载单个帖子
npx gallery-dl-instagram https://www.instagram.com/p/ABC123/ --cookies="..."

# 下载用户全部帖子
npx gallery-dl-instagram https://www.instagram.com/username/ --cookies="..."

# 按标签搜索
npx gallery-dl-instagram tag cats --cookies="..."

# 下载收藏
npx gallery-dl-instagram saved --cookies="..."

# 仅输出元数据（不下载）
npx gallery-dl-instagram https://www.instagram.com/p/ABC123/ --cookies="..." --info
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

## API 文档

- [架构文档](docs/architecture.md) — 流水线 / 生命周期 / 消息协议 / 配置系统
- [SDK 指南](docs/sdk.md) — 快速开始 / 三层 API / 浏览器 & Deno 适配
- [API 参考](docs/api-reference.md) — 全量 API 参考（类 / 方法 / 类型签名）
- [CLI 指南](docs/cli.md) — CLI 使用指南（8 个子命令 + 选项）
- [迁移对照](docs/migration-from-python.md) — Python → TS 差异 / 功能矩阵

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
