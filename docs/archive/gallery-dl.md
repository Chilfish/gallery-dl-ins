## gallery-dl Instagram 模块 — 核心架构文档

### 1. 总览：从 URL 到文件的完整流水线

整个 gallery-dl 是一个**生成器驱动的管道**。对你输入的一个 URL，流程如下：

```
用户输入 URL
    │
    ▼
Job.run()
    │  1. 用 Extractor.from_url(url) 匹配正则，实例化对应 Extractor
    │  2. 调用 extractor.__iter__() → items() 获取生成器
    │  3. 调用 dispatch() 消费生成器
    ▼
dispatch() — 消息路由循环
    │  for (msg_type, url, metadata) in items():
    │    ├─ Message.Directory → handle_directory()  设定下载目录
    │    ├─ Message.Url       → handle_url()        下载单个文件
    │    └─ Message.Queue     → handle_queue()      递归启动子 Job
    ▼
handle_url() — 下载 + 后处理
    │  1. 格式化文件名、检查 archive 去重
    │  2. HTTP 下载
    │  3. 运行 post-processors（hash、metadata、mtime…）
    │  4. finalize() 将临时文件重命名为最终路径
```

### 2. Extractor 生命周期

以 Instagram 为例，每次提取遵循严格的初始化顺序：

```
Extractor.__init__(match)
    │  保存 URL、正则分组、初始化配置路径 _cfgpath
    ▼
__iter__()  被 Job 调用
    │
    ├─ 1. initialize() — 只执行一次
    │     ├─ _init_options()     读取配置
    │     ├─ _init_session()     创建 HTTP Session（含 TLS、proxy、限流）
    │     ├─ _init_cookies()     加载 cookies 文件
    │     └─ _init()             子类初始化钩子（API 选择、CSRF 等）
    │
    └─ 2. return self.items()    核心提取逻辑
```

**关键设计**：`initialize()` 执行后把自己替换为 `util.noop`（空函数），保证只初始化一次。这让同一个 extractor 实例可以被多次迭代（例如 Queue 重试机制）。

### 3. InstagramExtractor 基类

#### 3.1 类级别配置

```python
category = "instagram"
directory_fmt = ("{category}", "{username}")    # 输出目录模式
filename_fmt = "{sidecar_media_id:?/_/}{media_id}.{extension}"  # 文件名模式
archive_fmt = "{media_id}"                       # 去重键
cookies_domain = ".instagram.com"
cookies_names = ("sessionid",)                   # 需要哪些 cookie
useragent = util.USERAGENT_CHROME                 # 伪装成 Chrome
request_interval = (6.0, 12.0)                    # 请求间隔 6~12 秒
```

#### 3.2 `_init()` — API 后端选择

Instagram 有两个 API 后端概念：

| 后端 | 类 | 端点 | 状态 |
|------|-----|------|------|
| REST（默认） | `InstagramRestAPI` | `instagram.com/api/v1/*` | ✅ 完整 |
| GraphQL（可选） | `InstagramGraphqlAPI` | `instagram.com/graphql/query/` | ⚠️ 部分支持 |

选择逻辑极简：
```python
if self.config("api") == "graphql":
    self.api = InstagramGraphqlAPI(self)
else:
    self.api = InstagramRestAPI(self)
```

`InstagramGraphqlAPI` 在构造函数里把自己不支持的方法统一设为 `_unsupported`（直接抛异常），并提供 `user_by_screen_name` / `user_by_id` / `user_id` 的 fallback，内部会复用 REST API 的对应实现。

#### 3.3 CSRF & 认证流程

Instagram 的 API 调用需要 CSRF token + session cookie：

```python
# _init() 阶段
self.csrf_token = util.generate_token()    # 生成 32-char hex
self.cookies.set("csrftoken", self.csrf_token, domain=".instagram.com")
```

然后每次 API 请求带上 `X-CSRFToken` 头。server 端会通过响应 cookie 更新 csrftoken，这也被自动同步：
```python
def request(self, url, **kwargs):
    response = Extractor.request(self, url, **kwargs)
    if csrf_token := response.cookies.get("csrftoken"):
        self.csrf_token = csrf_token   # 动态更新
    return response
```

`login()` 方法按优先级尝试：
1. 检查 `sessionid` cookie 是否存在 → 已登录，直接返回
2. 尝试从配置文件读取 username/password → ❌ Instagram 已封禁密码登录
3. Fallback：`_logged_in = False`，未登录模式下某些功能不可用

`request()` 还增加了**重定向拦截**：如果被重定向到 `/accounts/login/` 或 `/challenge/` 页面，说明 cookie 失效或被风控，直接抛出 `AbortExtraction`。

### 4. `items()` — 核心生成器

这是所有 Instagram 子提取器的公共入口，是整个模块最关键的流水线方法。

```python
def items(self):
    # ── 阶段 1: 认证 ──
    self.login()

    # ── 阶段 2: 全局元数据 ──
    data = self.metadata()        # 子类提供：tag 名、collection 名等

    # ── 阶段 3: 配置解析 ──
    videos      = self.config("videos", True)       # 是否下载视频
    previews    = self.config("previews", False)     # 是否只下载预览
    audio       = self.config("audio", False)        # 是否下载独立音频
    max_posts   = self.config("max-posts")           # 帖子数上限
    order       = self.config("order-files")         # 文件排序
    reverse     = order[0] in {"r", "d"} if order else False

    # ── 阶段 4: 获取帖子流 ──
    posts = self.posts()          # 子类提供：api.user_feed(uid) 等
    if max_posts:
        posts = itertools.islice(posts, max_posts)  # 截断

    # ── 阶段 5: 逐帖处理 ──
    for post in posts:
        # 5a. 解析：统一化 GraphQL / REST 响应为相同结构
        if "__typename" in post:
            post = self._parse_post_graphql(post)
        else:
            post = self._parse_post_rest(post)

        # 5b. 合并元数据 + 提取文件列表
        post.update(data)
        files = post.pop("_files")
        post["count"] = len(files)

        # 5c. 产出 Directory 消息（设置目标目录）
        yield Message.Directory, "", post

        # 5d. 按序产出 Url 消息（每个文件一个）
        if reverse: files.reverse()

        for file in files:
            file = {**post, **file}    # 文件继承帖子的所有元数据

            if url := file.get("audio_url"):      # 音频文件
                yield Message.Url, url, file
            elif url := file.get("video_url"):     # 视频文件
                yield Message.Url, url, file
            else:                                   # 图片文件
                url = file["display_url"]
                yield Message.Url, url, file
```

**设计要点**：

- **元数据合并**：`post.update(data)` — 子类提供的全局元数据（tag 名、collection 名）被注入到每个帖子里，再通过 `{**post, **file}` 让每个文件都继承这些元数据。
- **配置化开关**：videos / previews / audio / max_posts 全部由用户配置控制，关闭某个类型时直接 `continue` 跳过。
- **限流**：基类设定了 `request_interval = (6.0, 12.0)`，`Extractor.request()` 会自动在请求间随机 sleep。

### 5. `_parse_post_rest()` — REST API 响应归一化

这是最复杂的方法（~150 行），负责把 `/api/v1/` 的原始 JSON 响应转化为统一的数据结构。

#### 5.1 帖子类型分流

```python
def _parse_post_rest(self, post):
    if "items" in post:   # ← story 或 highlight（多 item）
        # ... story/highlight 逻辑
    else:                 # ← 普通帖子（单 media 或 carousel）
        # ... 帖子逻辑
```

**判断依据**：story/highlight 的顶层 JSON 有 `"items"` 数组（多个 story frame）；普通帖子/轮播的顶层就是 media 对象。

#### 5.2 元数据提取

无论什么类型，最终产出统一的 `data` 字典：

| 字段 | 来源 | 说明 |
|------|------|------|
| `post_id` | `post["pk"]` | 帖子数字 ID |
| `post_shortcode` | `post["code"]` | 短码（URL 里的那串） |
| `post_url` | 拼接 | Story 用 `/stories/.../`，帖子用 `/p/{code}/` |
| `owner_id` | `owner["pk"]` | 作者 ID |
| `username` | `owner["username"]` | 作者用户名 |
| `description` | `caption["text"]` | 帖子描述 |
| `tags` | 正则 `#\w+` | 从描述中提取的 hashtag（去重排序） |
| `location_*` | `post["location"]` | 位置信息 |
| `coauthors` | `post["coauthor_producers"]` | 合作作者 |
| `post_date` | `taken_at` 或 `created_at` | Unix timestamp |
| `likes` | `like_count` | 点赞数 |
| `pinned` | `timeline_pinned_user_ids` | 置顶帖的 pin 者列表 |

#### 5.3 文件（media）提取

```
对于 carousel（carousel_media 非空）:
    items = post["carousel_media"]      # 解包所有子 media
    设置 sidecar_media_id 标记这是轮播

对于单个帖子:
    items = (post,)                     # 包装成单元素可迭代

遍历 items → 每个 item:
    ├─ image = item["image_versions2"]["candidates"][0]   # 选第一个候选（通常是最高分辨率 jpg）
    │
    ├─ 如果有 video_versions:
    │     video = max(video_versions, key=宽×高×类型)      # 选最高质量
    │     如果有 video_dash_manifest: 记录 _ytdl_manifest_data（供 yt-dlp 下载）
    │
    ├─ 如果无 video:
    │     触发 warn_image：如果下载分辨率明显低于原始分辨率 → 提醒用户刷新 cookies
    │
    └─ 产出 media 字典:
        { num, date, media_id, shortcode, display_url, video_url?, 
          width, width_original, height, height_original, 
          tagged_users, owner, audio? }
```

**关键逻辑 — 静态视频**：

`_static_video` 配置控制是否下载真正的视频文件。如果关闭（配置 `static-videos: false`），Instagram 会返回 `original_media_type == 1`（实际是视频）但 `media_type != 1`（标记为图片）的帖子，此时提取器会删除 `video_versions`，强制只下载静态封面图。

**分辨率检测**：
```python
self._warn_image = (
    9 if not (wi := self.config("warn-images", True)) else
    1 if wi in {"all", "both"} else
    0)
```
当 `warn_image` 阈值 ≥ `(宽<原宽*1.1) + (高<原高*1.1)` 时，输出警告。默认阈值 1 意味着只要宽或高有一项差异超过 10% 就警告。

#### 5.4 音频 & 音乐提取

```python
# Story 音乐贴纸
if stickers := item.get("story_music_stickers"):
    audio = self._extract_audio(item, media, stickers[0])

# 帖子级音乐元数据（reels）
if metadata := post.get("music_metadata"):
    audio = self._extract_audio(post, data, metadata.get("music_info"))
```

`_extract_audio()` 从 `music_asset_info` 里提取：`progressive_download_url`（音频流）、`title`、`artist`、`duration_in_ms`、`cover_artwork_uri`。这些也被作为独立文件加入 `_files` 列表。

#### 5.5 用户标签提取

`_extract_tagged_users()` 合并了 **4 种来源**的标签：

| 来源 | 字段路径 | 帖子类型 |
|------|----------|----------|
| 普通标签 | `edge_media_to_tagged_user` | 帖子（GraphQL） |
| usertags | `usertags["in"]` | 帖子（REST） |
| reel mentions | `reel_mentions` | Reels/story |
| story bloks stickers | `story_bloks_stickers` | Story 贴纸 |

每种来源的用户结构略有差异（GraphQL 用 `"id"`，REST 用 `"pk"`），统一归一化输出。

### 6. `_parse_post_graphql()` — GraphQL 响应归一化

与 REST 版本功能对等，但结构更简单（GraphQL 已经扁平化）。

差异点：
- 帖子/轮播分离直接在顶层：`edge_sidecar_to_children` 存在 → 轮播
- 需要二次请求补全：`is_video` 为 True 但无 `video_url` 时，调用 `self.api.media(post["id"])` 重新获取
- 描述文本需要 `parse_unicode_escapes` 解码 unicode 转义

### 7. API 层 — `InstagramRestAPI`

#### 7.1 `_call()` — 统一 HTTP 调用

```python
def _call(self, endpoint, **kwargs):
    url = "https://www.instagram.com/api" + endpoint  # 自动拼接前缀
    headers = {
        "X-CSRFToken":      extr.csrf_token,
        "X-IG-App-ID":      "936619743392459",    # 硬编码 App ID
        "X-ASBD-ID":        "129477",             # 硬编码 ASBD ID
        "X-IG-WWW-Claim":   extr.www_claim,       # 动态更新的 claim
        "X-Requested-With": "XMLHttpRequest",     # XHR 标记
        "Referer":          extr.root + "/",
        ...
    }
    return extr.request_json(url, **kwargs)
```

所有这些 header（App ID、ASBD ID、WWW Claim）是 **Instagram 要求的反爬校验**。缺任意一个都会导致 403 或空响应。

`www_claim` 在每个响应里都可能更新（`x-ig-set-www-claim` 头），由基类的 `request()` 方法自动同步。

#### 7.2 用户查找策略链

`user_by_screen_name()` 不是单一调用，而是**多条策略 fallback**：

```python
_strategy_uid = ("search", "web")

for strategy in self._strategy_uid:
    try:
        if strategy == "search":    return self.user_by_search(username)
        elif strategy == "info":    return self.user_by_name(username)
        elif strategy == "web":     return self.user_by_web(username)
    except: continue
raise NotFoundError("user")
```

| 策略 | 方法 | 端点 |
|------|------|------|
| `search` | `user_by_search()` | `instagram.com/web/search/topsearch/` |
| `info` | `user_by_name()` | `/api/v1/users/web_profile_info/` |
| `web` | `user_by_web()` | 直接请求 `instagram.com/{username}`，正则提取 `profile_id` |

每种方法都带 `@extractor.cache` 装饰器，结果会被缓存（内存或磁盘取决于 `user-cache` 配置）。

#### 7.3 分页模式

所有列表型 API 都遵循游标分页（cursor-based pagination）：

```python
def _pagination(self, endpoint, params=None, media=False):
    params["max_id"] = extr._init_cursor()    # 读取或重置 cursor

    while True:
        data = self._call(endpoint, params=params)
        
        if media:                              # 有些端点包裹了 media 层
            for item in data["items"]:
                yield item["media"]
        else:
            yield from data["items"]

        if not data.get("more_available"):      # 没有更多了
            return extr._update_cursor(None)
        params["max_id"] = extr._update_cursor(data["next_max_id"])
```

**Cursor 持久化**：

```python
def _init_cursor(self):
    cursor = self.config("cursor", True)
    if cursor is True:  return None         # 从头开始
    elif not cursor:    self._update_cursor = util.identity  # 不跟踪 cursor
    return cursor                           # 从指定位置继续

def finalize(self, status):
    if status and self._cursor:
        self.log.info("Use '-o cursor=%s' to continue...", self._cursor)
```

用户在命令行加上 `-o cursor=上次的值` 即可断点续传。

#### 7.4 API 方法速览

| 方法 | 端点 | 用途 |
|------|------|------|
| `media(shortcode)` | `/v1/media/{id}/info/` | 单个帖子 |
| `user_feed(user_id)` | `/v1/feed/user/{id}/` | 用户帖子流 |
| `user_clips(user_id)` | `/v1/clips/user/` | 用户 Reels（POST） |
| `user_tagged(user_id)` | `/v1/usertags/{id}/feed/` | 用户被标记 |
| `user_saved()` | `/v1/feed/saved/posts/` | 收藏夹（media=True） |
| `user_collection(cid)` | `/v1/feed/collection/{cid}/posts/` | 单个收藏集 |
| `reels_media(reel_ids)` | `/v1/feed/reels_media/` | Story 媒体（批量） |
| `reels_tray()` | `/v1/feed/reels_tray/` | Story 托盘 |
| `highlights_tray(uid)` | `/v1/highlights/{uid}/highlights_tray/` | Highlight 列表 |
| `highlights_media(uid)` | 批处理 `reels_media` | 所有 Highlight 的媒体 |
| `tags_media(tag)` | `/v1/tags/{tag}/sections/` | Hashtag 帖子 |
| `user_followers(uid)` | `/v1/friendships/{uid}/followers/` | 粉丝列表 |
| `user_following(uid)` | `/v1/friendships/{uid}/following/` | 关注列表 |
| `guide(guide_id)` | `/v1/guides/web_info/` | Guide 信息 |
| `guide_media(guide_id)` | `/v1/guides/guide/{id}/` | Guide 内媒体 |
| `user_by_id(uid)` | `/v1/users/{id}/info/` | 按 ID 查用户 |
| `user_by_name(name)` | `/v1/users/web_profile_info/` | 按用户名查用户 |
| `user_by_search(name)` | `instagram.com/web/search/topsearch/` | 搜索用户 |
| `user_by_web(name)` | `instagram.com/{username}` | 网页爬取用户 ID |

### 8. Message 三元组协议

```python
# Message.Url  — 下载一个文件
yield (Message.Url,  "https://...jpg",  {"media_id": "123", "width": 1080})

# Message.Directory  — 切换目标目录 + 传播元数据
yield (Message.Directory,  "",  {"username": "chilfish", "post_id": "456"})

# Message.Queue  — 递归交给另一个 extractor 处理
yield (Message.Queue,  "https://instagram.com/user2/",  {"_extractor": InstagramUserExtractor})
```

**Directory 的作用**：`handle_directory()` 根据 `directory_fmt` 格式化路径并创建目录。之后的所有 `Message.Url` 都写入此目录，直到下一个 `Message.Directory`。

**Queue 的作用**：`handle_queue()` 用 `_extractor` 类重新调用 `Job.run()`，形成递归。这让复合提取器（如 User → Posts → Post）可以逐层展开。

### 9. 子提取器全景

```
InstagramUserExtractor (Dispatch)
    │  负责把用户页拆分为多个子任务
    │  _dispatch_extractors() 通过 Message.Queue 分发
    │
    ├── InstagramPostsExtractor      → api.user_feed(uid)
    ├── InstagramReelsExtractor      → api.user_clips(uid)
    ├── InstagramTaggedExtractor     → api.user_tagged(uid)
    ├── InstagramStoriesExtractor    → api.reels_media(uid)
    ├── InstagramHighlightsExtractor → api.highlights_media(uid)
    ├── InstagramInfoExtractor       → api.user_by_screen_name(name)
    └── InstagramAvatarExtractor     → api.user_by_id(uid)

InstagramPostExtractor
    ├── share 链接 → 先 302 重定向获取真实 shortcode
    └── api.media(shortcode) → 返回单个帖子

InstagramTagExtractor
    └── api.tags_media(tag)

InstagramSavedExtractor
    └── api.user_saved()

InstagramCollectionExtractor
    └── api.user_collection(collection_id)

InstagramFollowersExtractor
    └── api.user_followers(uid) → 每个结果 yield Message.Queue

InstagramFollowingExtractor
    └── api.user_following(uid) → 每个结果 yield Message.Queue

InstagramStoriesTrayExtractor
    └── api.reels_tray() → 每个 story yield Message.Queue → InstagramStoriesExtractor
```

### 10. 后处理流程（Post-Processing Pipeline）

下载完成后不是直接结束，而是经过 post-processor 链：

```python
# job.py — handle_url() 中的关键顺序
handle_url(url, kwdict):
    1. pathfmt.set_filename(kwdict)        # 根据 filename_fmt 和元数据生成路径
    2. [hook: prepare]                      # 用户自定义预处理钩子
    3. archive.check(kwdict)               # 查重：已下载过 → skip
    4. pathfmt.build_path() → exists()     # 文件已存在 → skip
    5. self.download(url)                  # 实际 HTTP 下载
    6. [hook: file]                        # 文件处理器链：
       ├─ postprocessor/directory.py       # 创建目录
       ├─ postprocessor/metadata.py        # 写入 JSON/SQLite 元数据
       ├─ postprocessor/mtime.py           # 修改文件时间戳
       └─ ... (可扩展)
    7. pathfmt.finalize()                  # 临时文件 → 最终文件名
    8. archive.add(kwdict)                 # 记录到去重数据库
```

### 11. 限流与反爬

| 机制 | 实现位置 | 说明 |
|------|----------|------|
| 请求间隔 | `request_interval = (6.0, 12.0)` | 每次请求后随机 sleep 6~12s |
| 429 退避 | `request_interval_429 = 60.0` | 遇到限流后等 60s |
| User-Agent | `USERAGENT_CHROME` | 伪装 Chrome |
| CSRF Token | 自动生成 + 动态更新 | 每次请求带 `X-CSRFToken` |
| App ID 头 | 硬编码 `X-IG-App-ID: 936619743392459` | 模拟官方 App |
| WWW Claim | 从响应 `x-ig-set-www-claim` 头更新 | 请求间自动同步 |
| Referer | 始终设为 `instagram.com/` | 模拟正常浏览 |
| Cookies | `sessionid` 从浏览器导出 | 不支持密码登录 |
| Video 质量警告 | 非 Chrome UA 时警告 | 视频可能降至低分辨率 |

### 12. 配置键一览（Instagram 特有）

| 配置键 | 默认 | 含义 |
|--------|------|------|
| `api` | `"rest"` | API 后端（rest / graphql） |
| `videos` | `true` | 是否下载视频（false / true / "merged"） |
| `previews` | `false` | 是否只下载预览 |
| `audio` | `false` | 是否下载独立音频 |
| `max-posts` | 无 | 最大帖子数 |
| `cursor` | `true` | 分页游标（断点续传） |
| `order-posts` | 无 | 帖子排序（asc/desc/id/id_asc/id_desc） |
| `order-files` | 无 | 文件排序（r*/d* = reverse） |
| `static-videos` | `true` | 下载视频文件（false = 只下载封面图） |
| `warn-videos` | `true` | 非 Chrome UA 时警告视频质量 |
| `warn-images` | `true` | 分辨率不一致时警告 |
| `user-cache` | `true` | 用户信息缓存（true / false / "memory"） |
| `user-strategy` | `"search,web"` | 用户查找策略链 |
| `include` | `("posts",)` | UserExtractor 包含的子类型 |
| `split` | `false` | Story 是否拆分每个 frame 为独立帖子 |
| `parent-directory` | — | 子 Job 是否继承父目录 |
| `parent-metadata` | — | 子 Job 是否继承父元数据 |
| `parent-session` | — | 子 Job 是否复用 HTTP Session |
| `parent-skip` | — | 子 Job 是否继承 skip 计数 |
| `follow` | — | Post 结束后自动追踪的链接模式 |
| `sleep-extractor` | — | Extractor 开始前的延迟 |

---

这就是整个 Instagram 模块的骨架。核心思想很清晰：**Extractor 产生结构化元数据 + 文件 URL → Job 消费消息并协调下载 → Post-Processor 链做后处理**。Instagram 的特殊复杂度集中在认证头和分页游标上，其余的帖子解析、轮播拆解、标签提取都是纯粹的 JSON 变换。
