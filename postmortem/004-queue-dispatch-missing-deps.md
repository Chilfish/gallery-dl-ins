# Postmortem 004 — Queue 分发时子提取器缺少父依赖

**日期**：2026-05-28
**严重程度**：高 — User 提取器下所有子提取器静默产出 0 个帖子
**影响范围**：用户主页下载、Tag 下载、Saved 下载等功能

## 根因分析

### 症状

```
$ gdl-instagram https://www.instagram.com/username/ --include=posts,reels
# 输出: "Done — 0 post(s), 0 file(s) downloaded"
```

用户提取器分发出 queue 消息后，子提取器（posts/reels/tagged 等）静默产出 0 个帖子，没有任何报错。

### 根因

`handleQueue()` 通过 `Reflect.construct` 创建子提取器实例时，只传了 `url` 和 `match`，**未传入父提取器的 `http` / `storage` / `log` / `config` 依赖**。

```typescript
// 修复前 — 缺少关键依赖
const childExtr = Reflect.construct(cls, [{
  url: msg.url,
  match,
  // ❌ 没传 http → API 调用全部失败
  // ❌ 没传 storage → 文件无法写入
  // ❌ 没传 log → 日志全部丢失
  // ❌ 没传 config → 配置全部为默认值
}])
```

子提取器创建后调用 `items()` → `posts()` → `this.api.media()`，但 `this.api` 依赖 `this.http`（通过 `InstagramRestAPI` 构造函数传入）。由于 `http` 为 `undefined`，API 调用静默失败（没有 throw，因为 axios 的 `validateStatus: () => true` 不抛异常，但请求根本没发出去）。

### 为什么静默失败

- `validateStatus: () => true` 的设计初衷是"不因非 2xx 抛异常"，但当 `http` 为 `undefined` 时，调用 `undefined.request()` 直接抛 `TypeError`。
- 外层 `handleUrl` 的 `try/catch` 吞掉了错误：`this.extractor.log.error(...)` 只记日志，不中断流程。
- 子提取器的错误没有传播回父 Job，导致用户看到 "0 posts" 但没有错误提示。

## 修复方案

```typescript
// 修复后 — 传递完整的父依赖
const parentExtr = this.extractor
const childExtr = Reflect.construct(cls, [{
  url: msg.url,
  match,
  config: parentExtr.config,     // ✅ 配置
  http: parentExtr.http,         // ✅ HTTP 客户端
  storage: parentExtr.storage,   // ✅ 文件系统
  log: parentExtr.log,           // ✅ 日志
}])
```

同时：
- `core/extractor.ts` 的 `config` 属性改为 `public readonly`，允许外部访问
- 添加 `DownloadJob` 的 queue 集成测试（`tests/integration/user.test.ts`），验证子提取器能实际产出帖子

## 预防措施

1. **Queue dispatch 必须做依赖注入检查**：子提取器构造函数应验证必填字段（http/storage/log/config），缺失时立即 throw，而不是静默失败
2. **静默错误是最大的敌人**：下载流程中的任何异常都应该提升到用户可见层级。`try/catch` 不应吞掉 TypeError
3. **集成测试覆盖 queue 分发链路**：`user.test.ts` 的 3 个测试现在验证 UserExtractor → PostsExtractor → DownloadJob 的完整链路

## 相关 Commit

- `ea9207b` fix: queue dispatch missing parent deps in handleQueue
