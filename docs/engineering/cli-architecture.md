# CLI 架构

## 入口

```
src/cli/index.ts     Commander program 定义（命令树）
src/cli/options.ts   共享选项声明 + buildConfig()：选项 → ConfigManager
src/cli/runner.ts    resolveExtractor() + runExtractor()：装配 adapter 并执行
src/cli/adapter.ts   createHttpClient / createWebClient / createLogger
src/cli/storage.ts   fs/promises 的 Storage 实现
src/cli/cookies.ts   内存 Cookie Jar（匿名模式）
```

bin 名 `dl-ins`，构建产物 `dist/dl-ins.mjs`（`package.json` 的 `bin` 字段）。

## 命令树

```
dl-ins <url> [options]     默认命令（isDefault），按 URL 自动选择提取器
dl-ins tag <hashtag>       → InstagramTagExtractor
dl-ins saved               → InstagramSavedExtractor（需登录）
```

`runner.resolveExtractor(url)` 按固定顺序尝试 pattern：Post → Stories → Highlights → Tag → Saved → User。未命中抛错并提示支持的 URL 形态。

## 选项 → 配置的映射

`options.ts` 的 `addSharedOptions()` 声明所有选项；`buildConfig()` 把它们写进 `extractor.instagram.{key}`。**只有 `_cfg()` 实际读取的键才生效**：

| CLI 选项 | 配置键 | 消费方 |
|---|---|---|
| `--videos <mode>` | `videos` | `InstagramExtractor.items()` |
| `--previews <types>` | `previews` | 同上 |
| `--audio` | `audio` | 同上 |
| `--max-posts <n>` | `max-posts` | 同上 |
| `--order-files <order>` | `order-files` | 同上 |
| `--static-videos` / `--no-static-videos` | `static-videos` | 同上（`ParserConfig.staticVideo`） |
| `--no-original` | `original` | `InstagramExtractor.items()`（默认开启，缺省即升级） |
| `--cursor <cursor>` | `cursor` | `_initCursor()` |
| `--include <list>` | `include` | `InstagramUserExtractor.items()` |
| `--split` | `split` | `InstagramStoriesExtractor.posts()` |

**死选项**：`--order-posts` 会被 `buildConfig()` 写入配置，但没有任何 `_cfg()` 读取它。新增选项前先确认消费方存在，否则不要写进文档。`--api` 已生效：`InstagramExtractor._init()` 读取 `extractor.instagram.api` 并传给 `InstagramRestAPI.apiBackend`。

其他选项：

| 选项 | 作用 |
|---|---|
| `--sessionid <cookie>` | 单 `sessionid` 值（默认取 `$INSTAGRAM_SESSIONID`） |
| `--cookies <string>` | 完整 Cookie 头（默认取 `$INSTAGRAM_COOKIES`） |
| `-o, --output <dir>` | 输出根目录，默认 `./data` |
| `-i, --info` | 用 `PrintJob` 替代 `DownloadJob`，只打印不下载 |
| `-v, --verbose` | `createLogger` 打开 debug 输出 |

## 认证装配

```
--cookies     → createHttpClient(undefined, cookies) + extractCsrf(cookies)
--sessionid   → createHttpClient(sessionid)
两者都没有     → createWebClient()：先访问 instagram.com 播种 Cookie Jar
```

`--info` 作用在 user URL 上时，`runExtractor` 会自动把 `info` 加进 `include`，保证至少输出 profile 信息。

## 新增命令的步骤

1. 在 `src/instagram/extractors/` 新建提取器（含 `pattern` 与 `static fromURL`）。
2. 在 `extractors/index.ts` 与 `instagram/index.ts` 导出；文件底部 `register(subcategory, Cls)`。
3. 需要独立命令时，在 `src/cli/index.ts` 添加 `program.command(...)` 并复用 `addSharedOptions` + `runExtractor`。
4. 在 `runner.resolveExtractor()` 的候选列表里加入（若应参与 URL 自动路由）。
5. 补 `tests/unit/extractor-patterns.test.ts` 用例并更新 [guide/cli.md](../guide/cli.md)。
