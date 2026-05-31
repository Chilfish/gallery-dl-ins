# CLI 使用指南

> `gdl-instagram` — Instagram 媒体下载命令行工具

## 安装

```bash
# 从 npm
npm install -g @chilfish/gallery-dl-instagram

# 或直接用 bun 跑源码
bun cli/index.ts <command> [options]
```

## 认证

所有涉及私密内容或 API 调用的命令都需要 `sessionid` cookie。

**从浏览器获取**：
1. 打开 Instagram → 登录
2. F12 → Application → Cookies → `www.instagram.com`
3. 复制 `sessionid` 的值

**使用方式**：

```bash
# 命令行参数
gdl-instagram user https://www.instagram.com/user/ --sessionid=abc123...

# 环境变量
export INSTAGRAM_SESSIONID=abc123...
gdl-instagram user https://www.instagram.com/user/
```

没有 sessionid 时只能访问公开帖子（且可能被限流）。

## 命令

### 全局选项

所有子命令共享以下选项：

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `--sessionid <cookie>` | `$INSTAGRAM_SESSIONID` | Instagram sessionid |
| `-o, --output <dir>` | `./gallery-dl` | 输出目录 |
| `--videos <mode>` | `true` | 视频下载模式：`true` / `false` |
| `--previews <types>` | — | 仅下载预览：`video` / `audio` |
| `-i, --info` | `false` | 打印结构化帖子信息到终端（不下载） |
| `--audio` | `false` | 下载独立音频轨道（含音乐元数据） |
| `--max-posts <n>` | 无限制 | 最大帖子数 |
| `--cursor <cursor>` | — | 断点续传游标 |
| `--order-posts <order>` | — | 帖子排序：`asc` / `desc` / `id` / `id_asc` / `id_desc` |
| `--order-files <order>` | — | 文件排序：`r` / `d`（reverse） |
| `--static-videos` | `false` | 下载静态视频封面（而非真实视频） |
| `--no-static-videos` | — | 强制下载真实视频 |
| `--api <backend>` | `rest` | API 后端：`rest` |
| `-v, --verbose` | `false` | 调试输出 |
| `--include <list>` | `posts` | user 命令的子类型（逗号分隔） |
| `--split` | `false` | stories：每个 frame 独立保存 |

---

### `post` — 单个帖子

```bash
gdl-instagram post <url> [options]
```

**示例**：

```bash
# 普通帖子
gdl-instagram post https://www.instagram.com/p/CxAbCdEfGh/

# Reel
gdl-instagram post https://www.instagram.com/reel/CxAbCdEfGh/

# 分享链接（自动跟随重定向）
gdl-instagram post https://www.instagram.com/share/BAEvGtChfT/

# 只下载图片不下载视频
gdl-instagram post https://www.instagram.com/p/CxAbCdEfGh/ --videos=false
```

**输出目录**：`./gallery-dl/instagram/{username}/`

配合 `-i --audio` 打印帖子结构化信息（含音乐元数据）：

```bash
gdl-instagram post https://www.instagram.com/p/DY_RzaiD4_u/ -i --audio
```

`--info` 模式下，含有音乐元数据（封面、歌词、显式标签等）的帖子或 Reels 会显示 `Music:` 区块：

```
 │ Music:
 │   ♪ weekend citron — =LOVE
 │   4:02 · lyrics
 │   Art: https://scontent-.../cover-artwork.jpg
```

---

### `user` — 用户全部内容

```bash
gdl-instagram user <url> [options]
```

默认只下载 posts。通过 `--include` 添加更多类型。

**示例**：

```bash
# 只下载帖子
gdl-instagram user https://www.instagram.com/username/

# 全部内容
gdl-instagram user https://www.instagram.com/username/ --include=all

# 指定组合
gdl-instagram user https://www.instagram.com/username/ --include=posts,reels,stories

# 限制数量
gdl-instagram user https://www.instagram.com/username/ --max-posts=50
```

**`--include` 可选值**：

| 值 | 对应 Extractor | 说明 |
|----|---------------|------|
| `posts` | InstagramPostsExtractor | 用户帖子流 |
| `reels` | InstagramReelsExtractor | 用户 Reels |
| `tagged` | InstagramTaggedExtractor | 被标记的帖子 |
| `stories` | InstagramStoriesExtractor | 当前 stories |
| `highlights` | InstagramHighlightsExtractor | 所有 highlights |
| `info` | InstagramInfoExtractor | 用户资料元数据（不下载文件） |
| `avatar` | InstagramAvatarExtractor | HD 头像 |
| `all` | 以上全部 | — |

---

### `stories` — Stories

```bash
gdl-instagram stories <url> [options]
```

**示例**：

```bash
# 用户 stories
gdl-instagram stories https://www.instagram.com/stories/username/

# 单个 highlight
gdl-instagram stories https://www.instagram.com/stories/highlights/12345/

# 拆分每个 frame 为独立文件
gdl-instagram stories --split https://www.instagram.com/stories/username/
```

---

### `highlights` — 全部 Highlights

```bash
gdl-instagram highlights <url> [options]
```

**示例**：

```bash
gdl-instagram highlights https://www.instagram.com/username/highlights/
```

拉取所有 highlights tray 并批量下载。

---

### `tag` — Hashtag 帖子

```bash
gdl-instagram tag <hashtag> [options]
```

**示例**：

```bash
# 直接输入标签
gdl-instagram tag cats

# 完整 URL
gdl-instagram tag https://www.instagram.com/explore/tags/cats/

# 限制数量和只下载图片
gdl-instagram tag cats --max-posts=20 --videos=false
```

---

### `saved` — 收藏夹

```bash
gdl-instagram saved [options]
```

**示例**：

```bash
# 需要认证
gdl-instagram saved --sessionid=abc123

# 限制数量
gdl-instagram saved --sessionid=abc123 --max-posts=100
```

---

### `info` — 用户资料

```bash
gdl-instagram info <url>
```

**示例**：

```bash
gdl-instagram info https://www.instagram.com/username/
```

输出 JSON 格式的用户元数据（不下载文件）。

---

### `avatar` — 头像下载

```bash
gdl-instagram avatar <url> [options]
```

**示例**：

```bash
gdl-instagram avatar https://www.instagram.com/username/
gdl-instagram avatar https://www.instagram.com/username/ -o ./avatars
```

下载最高可用的头像分辨率（HD）。

---

## 输出结构

```
{gallery-dl}/
└── instagram/
    └── {username}/
        ├── 1234567890_123456789.jpg       # 帖子 ID
        ├── 1234567890_123456789_2.jpg      # 轮播第 2 张
        ├── 1234567890_123456789.mp4        # 视频
        └── 1234567890_123456789.m4a        # 音频（--audio）
```

## 断点续传

每次运行在结束时输出 cursor 值：

```
[info] Use '-o cursor=AbCdEfGhIjKlMnOpQrStUvWxYz...' to continue
```

下次运行加上即可从断点继续：

```bash
gdl-instagram user https://www.instagram.com/user/ --cursor=AbCdEfGh...
```

## 限流

每个请求之间自动间隔 6~12 秒（随机），模拟正常浏览行为。遇到 429 时会自动等待更长时间。**不提供 `--no-throttle` 选项**——调快速度会被 Instagram 封号。

## 故障排查

| 问题 | 原因 | 解决 |
|------|------|------|
| `redirect to login page` | sessionid 过期或无效 | 重新从浏览器导出 cookie |
| `redirect to challenge page` | 账号被风控 | 在浏览器中完成验证后再试 |
| `Auth required` | 访问了需要登录的内容 | 添加 `--sessionid` |
| 视频画质低 | 非 Chrome UA | adapter 已固定 Chrome 131 UA |
| 图片分辨率低于预期 | 限制未登录用户 | 添加 `--sessionid` |
| 下载慢 | 限流 6~12s/请求 | 正常现象，不可调快 |
