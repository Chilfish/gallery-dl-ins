# 009 — 单帖图片被 REST 端点降级到 1080

**日期**: 2026-11-25
**根因归类**: 端点退化 / 数据形状假设
**影响版本**: ≤ 0.3.0
**状态**: 已修复

## 现象

单帖（`/p/{code}/`）下载到的图片短边只有 1080px，而同一帖在网页里是 1440px（部分横图 3072px）。用户抓包给出的网页 URL：

```
…/718510728_17889051786556726…jpg?stp=dst-jpg_e35_tt6&…
```

没有 `s1080x1080` 缩放参数；下载后实际为 1440×944。

## 排查

对比两个数据源对同一帖的 `image_versions2.candidates`：

| 来源 | 阶梯 |
|---|---|
| REST `GET /api/v1/media/{id}/info/` | `1080x708, 366x240` |
| 帖子页 SSR（登录态） | `1440x944, 1080x708, 720x472, 640x420, 480x315, 320x210, 240x157` + 方形裁剪 |
| `PolarisPostRootQuery` GraphQL | 同页面 SSR |
| 用户 feed（doc_id GraphQL） | 原图（可达 `3072x4096`） |

REST 响应的 `original_width/original_height` 仍是 1440×944，但候选列表里已经没有这个尺寸 —— REST 只返回 it 裁剪后的两档。`parseMediaItem` 取 `candidates[0]`，于是稳定拿到 1080。

## 根因

1. **把 REST 当成全集**：`original_width` 存在时仍假设 `candidates` 覆盖原图尺寸，实际 REST 只给降级候选。
2. **单帖只走 REST**：`api.media()` 是 `InstagramPostExtractor` 的唯一数据路径，页面 SSR 与 GraphQL 已有原图阶梯却未被使用。

## 关键事实（抓包 + 实测）

- 帖子页的候选数据在 `<script type="application/json" data-sjs>` 的 relay preloader 里，DOM 中没有任何 `<img>`（实测 0 个），因此 DOM 解析无收益，必须 `JSON.parse` script 块后遍历。
- 登录态形状：`xdt_api__v1__media__shortcode__web_info.items[0]`。
- 匿名形状：`xig_polaris_media.if_not_gated_logged_out`，**候选只有 `url`、没有 `width/height`**，需用 `original_width/original_height` 给首条候选补尺寸。
- `Sec-Fetch-Site` / `Sec-Fetch-Mode` 缺一会退化成 553 KB 的 JS 壳（无 payload）；现有 `DOCUMENT_HEADERS` 已含这两个头，三次重复请求均稳定拿到 payload。
- 改 `stp` 参数无效：`oh`/`oe` 是对整条路径的签名，去掉或改写 `stp` 均 403。原图分辨率上限取决于作者上传尺寸。
- 匿名页面的 REST `media/info` 返回 404 `not-logged-in`，但页面 payload 仍可取到原图阶梯。

## 修复

- `html-payload.ts` 新增 `extractMediaFromPage()`，按两种形状取帖子节点，并为无尺寸候选补 `original_*`。
- `api.pagePost(shortcode)` 拉取帖子页并返回内嵌节点。
- `media-upgrade.ts` 按 `original_width/height` 判断候选是否被降级；升级时按 `pk` 对齐 carousel 子项，仅在更大时替换 `image_versions2` / `video_versions`。
- `InstagramExtractor.items()` 在解析前按需升级；`original` 配置默认开启，`--no-original` 可关。
- `InstagramPostExtractor` 在 REST 失败（含匿名 404）时回退到页面 payload。
- `parseMediaItem` 由 `candidates[0]` 改为取面积最大的候选。

## 教训

- **同一实体的不同端点返回不同尺寸阶梯**，不要假设主端点是全集；`original_width` 与候选上限不一致是降级信号。
- 图片尺寸这类「静默降级」不会报错，只能靠与网页结果对比发现 —— 新增数据源时先抓包核对形状。
