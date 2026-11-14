# 测试

## 分层

| 层 | 位置 | 依赖 | 说明 |
|---|---|---|---|
| 单元 | `tests/unit/` | 无 IO | 纯函数、配置插值、正则匹配 |
| 集成 | `tests/integration/` | `MockHttpClient` | 提取器 → Message 流全链路，不触网 |

默认 `bun run test` 全部离线运行，不依赖网络或真实 Cookie。

## 命令

```bash
bun run test            # 全部
bun run test:unit       # 仅单元
bun run test:integration
bun run test:watch
bun run test:coverage
```

## 现有覆盖

| 文件 | 覆盖内容 |
|---|---|
| `unit/id-codec.test.ts` | shortcode ↔ 数字 ID 往返 |
| `unit/text.test.ts` | `extract` / `unescape` / `unquote` / 标签解析 |
| `unit/message.test.ts` | Message 工厂 |
| `unit/config.test.ts` | `ConfigManager` 的 get/set/interpolate 层级插值 |
| `unit/extractor-patterns.test.ts` | **11 个提取器的 URL 正则与分组下标（回归保护）** |
| `unit/sdk-resolve.test.ts` | `InstagramSDK._resolve` 的 URL → 提取器路由顺序 |
| `unit/parsers.test.ts` | REST / GraphQL → `ParsedPost` 归一化 |
| `integration/post.test.ts` | 单帖：directory + url 消息、登录重定向抛错 |
| `integration/reel.test.ts` | Reel：`videos=true` 只产出视频 URL |
| `integration/stories.test.ts` | Story / Highlight |
| `integration/user.test.ts` | User 提取器 → Queue → 子提取器 全链路 |

## Mock 设施

`tests/helpers/mock-http.ts` 提供 `MockHttpClient`：按 URL 子串匹配返回预设数据，未命中返回 `{}` 并 `console.warn`。

```typescript
const http = new MockHttpClient().add('/api/v1/media/', mockPost)
```

Storage 用 `tests/helpers/` 里的内存实现（`exists: false`、`write`/`mkdir` 空实现）。

## Cookie 与 `.env`

集成测试默认不需要 Cookie。需要真实凭据的手工验证走 `scripts/`：

1. 复制 `.env.example` → `.env`
2. 从 DevTools → Application → Cookies 复制完整 Cookie 字符串
3. 填入 `INSTAGRAM_COOKIES=...`

`.env` 由 `tests/setup.ts` 通过 `dotenv` 加载，不进版本库。

## 加测试的要求

- 新增提取器 → 在 `extractor-patterns.test.ts` 补 pattern 与分组下标用例。
- 修解析器 bug → 在 `parsers.test.ts` 补对应响应形状的用例。
- 改 `Message` 协议 → 同步 `message.test.ts` 与受影响的集成用例。
