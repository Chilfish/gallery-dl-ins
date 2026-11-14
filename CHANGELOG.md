# Changelog

本文件记录 `@chilfish/gallery-dl-instagram` 的用户可见变化。格式参考 [Keep a Changelog](https://keepachangelog.com/)，版本遵循 [SemVer](https://semver.org/)。

## Unreleased

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
