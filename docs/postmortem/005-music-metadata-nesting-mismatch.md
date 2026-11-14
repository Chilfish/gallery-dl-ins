# Postmortem 005 — MusicMetadata 类型与实际 API 响应不匹配

**日期**：2026-05-31
**严重程度**：中 — 音乐元数据静默丢弃，不报错但功能全废
**影响范围**：所有含音乐元数据的 carousel/Rest 帖子（post + reel）

## 根因分析

### 症状

帖子 `DY_RzaiD4_u` 在手机端显示背景音乐（`weekend citron` by `=LOVE`），SDK 也能成功获取帖子，但所有 `ParsedMedia.audio_*` 字段均为空。

### 两层 Bug

**Bug 1 — 类型定义错误**

`MusicMetadata` 类型的 `music_info` 被声明为 `MusicAssetInfo`，但 Instagram REST API 实际返回：

```json
{
  "music_metadata": {
    "music_info": {
      "music_canonical_id": "18346927792046620",
      "music_asset_info": { ... },      // ← 真正的 MusicAssetInfo
      "music_consumption_info": { ... }
    }
  }
}
```

`music_info` 是一个容器对象（即 `MusicSticker` 的形状），不是 `MusicAssetInfo` 本身。

**Bug 2 — 解析器二次包裹**

`parsePostRest` 的代码尝试把 `music_info` 塞进 `MusicSticker`：

```typescript
// 修复前
const info = post.music_metadata.music_info  // ← 这本来就是 MusicSticker 形状
const audio = extractAudio(
  post, data,
  { music_asset_info: info },  // ← 又包了一层！
  cfg,
)
```

由于 `info` 已经有 `{ music_asset_info, music_consumption_info }`，再包一层 `{ music_asset_info: info }` 导致：

- `sticker.music_asset_info` → `{ music_canonical_id, music_asset_info, music_consumption_info }` （整个容器对象）
- `extractAudio` 里 `sticker.music_asset_info.progressive_download_url` → `undefined`
- `info.progressive_download_url` 为 falsy → `extractAudio` 直接返回 `null`

**为什么静默失败**

`extractAudio` 返回 `null` 时，调用方 `parsePostRest` 的后续代码只是跳过 `data._files.push(audio)`，不抛异常。数据静默丢弃，用户无感知。

## 修复方案

### 类型修正 — `src/instagram/types.ts`

```diff
 export interface MusicMetadata {
-  music_info?: MusicAssetInfo
+  music_info?: MusicSticker
 }
```

### 解析器修正 — `src/instagram/parsers/rest.ts`

去掉冗余包裹，直接将 `info` 作为 `MusicSticker` 传入：

```diff
   const audio = extractAudio(
     post as unknown as Record<string, unknown>,
     data as unknown as Record<string, unknown>,
-    { music_asset_info: info },
+    info,
     cfg,
   )
```

### 附加增强 — 同 PR

- `MusicAssetInfo` 补全字段：`subtitle`、`sanitized_title`、`ig_username`、`cover_artwork_thumbnail_uri`、`has_lyrics`、`is_explicit`
- `ParsedMedia` 补全：`audio_subtitle`、`audio_cover_artwork_uri`、`audio_cover_artwork_thumbnail_uri`、`audio_has_lyrics`、`audio_is_explicit`
- `extractAudio` 填充上述字段
- `PrintJob` 添加 `Music:` 区块（在 `--info` 模式下显示歌曲、艺人、时长、歌词标签、专辑封面 URL）
- 文档更新：`docs/guide/sdk.md`、`docs/reference/api-reference.md`、`docs/guide/cli.md`

## 防范措施

1. 当 JSON→TypeScript 类型不对齐时，应该在解析入口加 `console.warn` 而非静默跳过
2. 单元测试应覆盖 `music_metadata` 解析路径（目前 `tests/unit/parsers.test.ts` 没有音乐元数据 case）
3. 集成测试应验证 carousel + music 的端到端提取（需要 cookie，但可以 mock API 返回）
