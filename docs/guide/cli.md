# CLI 使用指南

> `dl-ins` — Instagram 媒体下载命令行工具。
> 内部实现见 [engineering/cli-architecture.md](../engineering/cli-architecture.md)。
>
> 注意：npm bin 名为 `dl-ins`，但 `--help` 里 Commander 的 `program.name` 仍是 `gdl-instagram`（源码与 bin 不一致，示例以 bin 名为准）。

## 安装

```bash
# 全局安装后可直接用 bin 名
npm install -g @chilfish/gallery-dl-instagram
dl-ins <url>

# 不安装时通过 npx 调 bin
npx -p @chilfish/gallery-dl-instagram dl-ins <url>
```

开发时直接跑源码：

```bash
bun run cli <url> [options]
```

## 认证

Instagram 的 API 端点需要登录 Cookie。两种传法：

| 方式 | 说明 |
|---|---|
| `--cookies <string>` | 完整 Cookie 头，最省事（默认取 `$INSTAGRAM_COOKIES`） |
| `--sessionid <value>` | 只传 `sessionid` 值（默认取 `$INSTAGRAM_SESSIONID`） |

**从浏览器获取**：

1. 打开 instagram.com 并登录
2. F12 → Application → Cookies → `https://www.instagram.com`
3. 复制 `sessionid` 的值，或复制整行 Cookie 头

两者都不传时，CLI 会先访问 instagram.com 建立匿名 Cookie Jar 再继续——但 `/api/v1/` 端点通常仍要求登录。

## 命令

### `dl-ins <url>` — 默认命令

按 URL 自动选择提取器。这是最常用的入口。

```bash
# 单个帖子
dl-ins https://www.instagram.com/p/CxAbCdEfGh/

# Reel
dl-ins https://www.instagram.com/reel/CxAbCdEfGh/

# 分享链接（自动跟随重定向解析 shortcode）
dl-ins https://www.instagram.com/share/BAEvGtChfT/

# 用户主页（默认只拉 posts）
dl-ins https://www.instagram.com/username/

# 用户全部内容
dl-ins https://www.instagram.com/username/ --include=all

# stories / highlights 同样走默认命令
dl-ins https://www.instagram.com/stories/username/
dl-ins https://www.instagram.com/username/highlights/

# 只打印资料，不下载
dl-ins https://www.instagram.com/username/ -i
```

自动路由顺序：`post` → `stories` → `highlights` → `tag` → `saved` → `user`。未命中会报错并列出支持的 URL 形态。

### `dl-ins tag <hashtag>` — 按标签下载

```bash
dl-ins tag cats
dl-ins tag https://www.instagram.com/explore/tags/cats/
dl-ins tag cats --max-posts=20 --videos=false
```

参数可以是裸标签或完整 URL。

### `dl-ins saved` — 下载收藏夹

```bash
dl-ins saved --cookies="..."
```

必须登录。

## 选项

所有子命令共享以下选项。

### 下载行为

| 选项 | 默认 | 说明 |
|---|---|---|
| `-o, --output <dir>` | `./data` | 输出根目录 |
| `--videos <mode>` | `true` | `true` 下载视频，`false` 不下载；`merged` 仍下载视频但不保存 DASH manifest 数据 |
| `--previews <types>` | — | 只下载预览，逗号分隔：`video`,`audio` |
| `--audio` | `false` | 下载独立音频轨（story 音乐贴纸 / Reels BGM） |
| `--static-videos` | `false` | 下载静态视频封面而非真实视频 |
| `--no-static-videos` | — | 关闭静态封面（默认行为，显式写出） |
| `--max-posts <n>` | 无限制 | 最多处理的帖子数 |
| `--cursor <cursor>` | — | 从上次的游标继续 |
| `--order-files <order>` | 自然序 | `r` / `d` 开头表示反转文件顺序 |

### 范围与输出

| 选项 | 默认 | 说明 |
|---|---|---|
| `--include <list>` | `posts` | user 命令的子提取器，逗号分隔：`posts,reels,tagged,stories,highlights,info,avatar`，或 `all` |
| `--split` | `false` | stories：每个 frame 单独输出 |
| `-i, --info` | `false` | 打印结构化信息到终端，不下载 |
| `-v, --verbose` | `false` | debug 输出 |

### 认证

| 选项 | 环境变量 | 说明 |
|---|---|---|
| `--cookies <string>` | `INSTAGRAM_COOKIES` | 完整 Cookie 头 |
| `--sessionid <value>` | `INSTAGRAM_SESSIONID` | 单个 sessionid |

> **已声明但未生效的选项**：`--api`（`rest` / `graphql`）和 `--order-posts` 会被接受并写入配置，但当前没有任何提取器读取它们。详见 [cli-architecture.md](../engineering/cli-architecture.md#选项--配置的映射)。

## `--include` 对应关系

| 值 | 提取器 | 说明 |
|---|---|---|
| `posts` | `InstagramPostsExtractor` | 用户帖子流（默认） |
| `reels` | `InstagramReelsExtractor` | 用户 Reels |
| `tagged` | `InstagramTaggedExtractor` | 被该用户标记的帖子 |
| `stories` | `InstagramStoriesExtractor` | 当前 stories |
| `highlights` | `InstagramHighlightsExtractor` | 所有 highlights |
| `info` | `InstagramInfoExtractor` | 资料元数据（不下载文件） |
| `avatar` | `InstagramAvatarExtractor` | HD 头像 |
| `all` | 以上全部 | — |

## `-i` 输出

`--info` 用 `PrintJob` 替代下载，在终端画框展示帖子/资料：

```
 Post #1: DY_RzaiD4_u
 │ Author: someone (Display)
 │ Date: 2025-05-01T12:00:00.000Z
 │ Likes: 1,234  |  Liked: no
 │ Type: post  (2 files)
 │ ...
 │ Music:
 │   ♪ weekend citron — =LOVE
 │   4:02 · lyrics
```

（实际输出带 ANSI 边框与颜色。）

在 user URL 上使用 `-i` 会自动追加 `info` 到 `--include`，因此即使该用户没有帖子也会输出资料。

## 输出结构

```
{output}/
└── instagram/
    └── {username}/
        ├── {media_id}.jpg          # 单图
        ├── {media_id}_2.jpg        # 轮播第 2 张
        ├── {media_id}.mp4          # 视频
        └── {media_id}.m4a          # 音频（--audio）
```

分类目录取自提取器的 `category`（固定 `instagram`）与元数据里的 `username`。

## 断点续传

分页游标在 `-v` 日志中以 debug 级别输出。加上上次的游标继续：

```bash
dl-ins https://www.instagram.com/user/ --cursor=<value>
```

## 限流

请求间隔固定 6–12 秒随机，模拟正常浏览。**没有关闭开关**——提速会导致 Instagram 风控。遇到 429 时请求会失败，等一段时间再重试。

## 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| `redirect to login page` | Cookie 失效或未登录 | 重新导出 Cookie |
| `redirect to challenge page` | 账号被风控 | 浏览器完成验证后再试 |
| `Auth required` | 端点需要登录 | 加 `--cookies` 或 `--sessionid` |
| 下载 0 个文件 | 子提取器拿到空配置 | 见 [postmortem 004](../postmortem/004-queue-dispatch-missing-deps.md) |
| 图片被截断/体积异常 | 二进制被当文本解码 | 见 [postmortem 003](../postmortem/003-binary-download-csrf.md) |
| 图片分辨率低于预期 | 未登录限制 | 加登录 Cookie（上限短边 1080px，CDN 签名不可改参） |
| `ERR_MODULE_NOT_FOUND`（npx） | CLI 产物不自包含 | 见 [postmortem 001](../postmortem/001-axios-to-native-fetch.md) |
