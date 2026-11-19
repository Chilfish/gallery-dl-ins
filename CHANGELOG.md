# Changelog

本文件记录 `@chilfish/gallery-dl-instagram` 的用户可见变化。格式参考 [Keep a Changelog](https://keepachangelog.com/)，版本遵循 [SemVer](https://semver.org/)。

## Unreleased

修复用户 feed REST 端点退役导致帖子 / Reels / tagged 全部取不到的问题（#4）。

### 修复

- 用户帖子、Reels、tagged、资料改为 doc_id GraphQL 主路径，REST 与页面内嵌 payload 作为降级。
- 用户名解析默认策略改为 `web,info`；`web` 命中后经 GraphQL 补全资料。
- 识别 200 HTML 的 `not-logged-in` / `challenge_required` / `feedback_required` 与 JSON `status:"fail"`，错误带端点与状态码。
- API 调用接入 6–12s 限流；POST 改为 `application/x-www-form-urlencoded`。
- Cookie 合并按名去重；子提取器继承父级 CSRF / WWW Claim / lsd token。
- 分页兼容 `edges` / `profile_grid_items`，游标不前进时停止。
- `download()` 使用 `DownloadJob.stats`，未提供 Storage 时给出明确错误。

### 变更

- `--api` 生效：`auto`（默认，GraphQL 优先）/ `rest`（REST 优先），两者都保留降级。

Closes #4

## 0.2.6 (2026-11-18)

修复 `/stories/highlights/{id}/` 直链提取失败的问题（#3）。

### 修复

- 精选集直链改为解析页面内嵌数据，REST `reels_media` 不可用时仍能产出目录与逐条媒体。
- 精选集目录带上 `username` 与 `highlight_title`。
- 精选集数据不再被当作 GraphQL 帖子解析导致崩溃。
- `/stories/highlights/{id}/` 稳定归属 stories 提取器。

### 安装

```bash
npm install @chilfish/gallery-dl-instagram@0.2.6
```

Closes #3

## 0.2.5 (2026-11-14)

修复 stories 提取在用户名解析失败或 REST `reels_media` 返回 500 时不可用的问题（#2）。

### 修复

- stories 优先解析页面内嵌的 story 数据，REST `reels_media` 不可用时仍能提取。
- 用户名解析失败时，错误信息包含每条策略的状态码与原因，不再是统一的 `User not found`。
- `web_profile_info` 响应的用户字段正确取自 `data.user`。
- `web` 策略支持 `page_id":"profilePage_<id>` 页面特征，并按文本读取 HTML。

### 变更

- 用户名解析策略链可通过 `user-strategy` 配置覆盖，默认 `search,web`。

### 安装

```bash
npm install @chilfish/gallery-dl-instagram@0.2.5
```

Closes #2
