# Python → TypeScript 迁移对照

> 原 Python 实现为 [gallery-dl](https://github.com/mikf/gallery-dl) 的 Instagram 模块。
> 本文档记录 TypeScript 重写中的设计变更和差异点。

## 架构层次对照

| 层次 | Python | TypeScript |
|------|--------|------------|
| 基类 | `Extractor` | `Extractor` (abstract class) |
| Instagram 基类 | `InstagramExtractor` | `InstagramExtractor` |
| API 客户端 | `InstagramRestAPI` / `InstagramGraphqlAPI` | `InstagramRestAPI`（仅 REST） |
| 子提取器 | 16+ 类（含 Followers/Following/Guide 等） | 11 类（核心子集） |
| Job 调度 | `DownloadJob` / `Job` | `DownloadJob` / `Job` |
| 配置 | 全局 dict + `config.interpolate()` | `ConfigManager` |
| 消息 | `Message.Directory` / `.Url` / `.Queue` 枚举 | `{ type: 'directory' | 'url' | 'queue' }` discriminated union |
| 后处理 | post-processor 链 | 未实现（预留 Storage 接口） |

## 核心差异

### 1. 异步模型

**Python**：同步生成器 + `requests`（阻塞 I/O）。

```python
def items(self):
    for post in self.posts():
        yield Message.Url, url, data
```

**TypeScript**：`AsyncGenerator` + native `fetch`（非阻塞 I/O）。

```typescript
async* items(): MessageIter {
  for await (const post of this.posts()) {
    yield url(url, data)
  }
}
```

### 2. 消息协议

**Python**：三元组 — `(Message.Url, url_string, data_dict)`。

```python
from gallery_dl import message

yield message.Url, "https://...", {"media_id": "123"}
```

**TypeScript**：discriminated union — `{ type, url, metadata }`。

```typescript
import { url } from './message'

yield url('https://...', { media_id: '123' })
```

### 3. 状态共享

**Python**：`Extractor` 实例的 `self` 属性直接访问。

```python
self.csrf_token = util.generate_token()
```

**TypeScript**：`Ref<T>` 包装器——跨 `Extractor` ↔ `API` 共享可变引用。

```typescript
// InstagramExtractor
this.csrfToken = new Ref(Extractor.generateToken(16))

// InstagramRestAPI 通过 getter/setter 访问同一个 Ref
this.getCsrf = () => opts.csrfToken.value
this.setCsrf = (v) => { opts.csrfToken.value = v }
```

原因：TypeScript 中对象属性赋值不会自动传播到引用方。`Ref` 提供显式的共享可变状态。

### 4. 初始化

**Python**：`initialize()` 后把自己替换为 `util.noop`：

```python
def initialize(self):
    if self._initialized: return
    self._init()
    self._initialized = True
    self.initialize = util.noop
```

**TypeScript**：`initialize()` 后把自己替换为空 async 函数：

```typescript
async initialize(): Promise<void> {
  if (this._initialized) return
  await this._init()
  this._initialized = true
  this.initialize = async () => {}  // 替换自身
}
```

### 5. Archive

**Python**：SQLite 或文本文件持久化。

```python
# sqlite 或 txt 格式
archive = DownloadArchive(...)
archive.check(kwdict)   # 返回是否已下载
archive.add(kwdict)
```

**TypeScript**：内存 `Map<string, Set<string>>`（每次运行独立）。

```typescript
// DownloadJob
private _isArchived(meta: Metadata): boolean {
  const key = this._interp(fmt, meta)
  return this.archive.get(cat)?.has(key) ?? false
}
```

### 6. 后处理

**Python**：独立 post-processor 链（metadata 写入、mtime 修改、hash 校验等）。

```python
def handle_url(self, url, kwdict):
    pathfmt.set_filename(kwdict)
    self.download(url)
    for pp in self.postprocessors:
        pp.run(pathfmt)
    pathfmt.finalize()
```

**TypeScript**：未实现——当前仅负责下载文件。`Storage` 接口为后处理留了扩展点。

### 7. 登录

**Python**：支持 username/password（已封禁）+ cookie 文件。

```python
# cookies.txt 或浏览器 cookie 导出
self.cookies = _load_cookies()
```

**TypeScript**：仅支持 `--sessionid` 作为 CLI 参数或环境变量。

```typescript
if (sessionId) {
  instance.defaults.headers.Cookie = `sessionid=${sessionId}`
}
```

## 功能对照表

| 功能 | Python | TypeScript | 备注 |
|------|--------|------------|------|
| 单个帖子 | ✅ | ✅ | `InstagramPostExtractor` |
| 用户帖子流 | ✅ | ✅ | `InstagramPostsExtractor` |
| 用户 Reels | ✅ | ✅ | `InstagramReelsExtractor` |
| Tagged 帖子 | ✅ | ✅ | `InstagramTaggedExtractor` |
| Stories | ✅ | ✅ | `InstagramStoriesExtractor` |
| Highlights | ✅ | ✅ | `InstagramHighlightsExtractor` |
| Hashtag | ✅ | ✅ | `InstagramTagExtractor` |
| 收藏夹 | ✅ | ✅ | `InstagramSavedExtractor` |
| 用户信息 | ✅ | ✅ | `InstagramInfoExtractor` |
| 头像 | ✅ | ✅ | `InstagramAvatarExtractor` |
| 粉丝/关注列表 | ✅ | ❌ | 未移植 |
| 登录（密码） | ✅（已封） | ❌ | Instagram 已禁 |
| GraphQL API | ✅ | ❌ | 仅 REST API |
| Post-processor | ✅ | ❌ | 未实现 |
| Archive 持久化 | ✅ | ❌ | 内存 Map |
| 视频合并（yt-dlp） | ✅ | ❌ | 未实现 |
| 用户缓存 | ✅ | ❌ | 未实现 |
| Guide | ✅ | ❌ | 未移植 |
| 视频质量警告 | ✅ | ❌ | 未实现 |

## 类型对照

### 关键类型重命名

| Python | TypeScript |
|--------|------------|
| `dict` | `Metadata = Record<string, unknown>` |
| `str` / `int` / `float` | `string` / `number` |
| `Message.Url` | `UrlMsg = { type: 'url', url, metadata }` |
| `Message.Directory` | `DirectoryMsg = { type: 'directory', metadata }` |
| `Message.Queue` | `QueueMsg = { type: 'queue', url, metadata: { _extractor? } }` |
| `Extractor.config(key)` | `Extractor._cfg(key, default)` |
| `text.extr(txt, begin, end)` | `extr(txt, begin, end)` |

### API 端点对应

| Python 方法 | TypeScript 方法 | 端点 |
|-------------|-----------------|------|
| `InstagramRestAPI.media()` | `InstagramRestAPI.media()` | `/v1/media/{id}/info/` |
| `InstagramRestAPI.user_feed()` | `InstagramRestAPI.userFeed()` | `/v1/feed/user/{id}/` |
| `InstagramRestAPI.user_clips()` | `InstagramRestAPI.userClips()` | `/v1/clips/user/` |
| `InstagramRestAPI.user_tagged()` | `InstagramRestAPI.userTagged()` | `/v1/usertags/{id}/feed/` |
| `InstagramRestAPI.user_saved()` | `InstagramRestAPI.userSaved()` | `/v1/feed/saved/posts/` |
| `InstagramRestAPI.reels_media()` | `InstagramRestAPI.reelsMedia()` | `/v1/feed/reels_media/` |
| `InstagramRestAPI.reels_tray()` | `InstagramRestAPI.reelsTray()` | `/v1/feed/reels_tray/` |
| `InstagramRestAPI.highlights_tray()` | `InstagramRestAPI.highlightsTray()` | `/v1/highlights/{id}/highlights_tray/` |
| `InstagramRestAPI.tags_media()` | `InstagramRestAPI.tagsMedia()` | `/v1/tags/{tag}/sections/` |
| `InstagramRestAPI.user_by_search()` | `InstagramRestAPI.userBySearch()` | `instagram.com/web/search/topsearch/` |
| `InstagramRestAPI.user_by_web()` | `InstagramRestAPI.userByWeb()` | `instagram.com/{username}` |
| `InstagramExtractor._parse_post_rest()` | `parsePostRest()` | 独立导出函数 |
| `InstagramExtractor._parse_post_graphql()` | `parsePostGraphql()` | 独立导出函数 |
