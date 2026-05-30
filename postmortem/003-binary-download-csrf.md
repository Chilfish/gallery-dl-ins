# Postmortem 003 — 二进制下载损坏 & CSRF Cookie 不匹配

**日期**：2026-05-27
**严重程度**：高 — 下载的图片/视频文件损坏无法打开；未登录状态下 API 全部 403
**影响范围**：所有下载功能、CSRF 认证流程

## 根因分析

### 症状

1. 下载的 `.jpg` / `.mp4` 文件被 UTF-8 解码损坏，体积异常，无法打开
2. 有 `sessionid` 但 API 返回 403——CSRF 验证失败
3. Cookie 合并策略错误——后设置的 Cookie 覆盖了前面的，导致 `sessionid` 或 `csrftoken` 丢失

### 根因

**二进制损坏**

axios 默认 `responseType: 'json'`——对二进制响应（图片/视频）自动执行 `JSON.parse(utf8_decode(body))`，二进制数据被强制 UTF-8 解释，产生损坏的输出文件。

```diff
+ const resp = await this.http.request({
+   url: msg.url,
+   method: 'GET',
+   responseType: 'arraybuffer',  // ← 必须显式声明
+ })
```

**CSRF Cookie 双重发送**

Instagram API 要求 `csrftoken` **同时作为 Cookie 和 X-CSRFToken header** 发送，且二者值必须一致。原 Python gallery-dl 实现中 `_init()` 调用 `self.cookies.set("csrftoken", ...)` 同时设置了两处，TypeScript 移植遗漏此细节。

```typescript
// Python 源码 (gallery-dl/extractor/instagram.py):
// self.cookies.set("csrftoken", csrf)  ← Cookie
// headers['X-CSRFToken'] = csrf        ← Header

// 修复后的 TS:
headers['Cookie'] = `csrftoken=${csrf}`     // Cookie
headers['X-CSRFToken'] = csrf               // Header（二者值一致）
```

**Cookie 合并策略**

原始实现中 `Object.assign` 会覆盖同名 header：

```diff
- mergedHeaders = { ...baseHeaders, ...config.headers }  // 后者覆盖前者
+ if (k.toLowerCase() === 'cookie' && mergedHeaders.Cookie) {
+   mergedHeaders.Cookie = \`\${mergedHeaders.Cookie}; \${v}\`  // append
+ }
```

## 修复方案

1. **全部二进制下载必须设置 `responseType: 'arraybuffer'`**
2. **CSRF Cookie 在 `_call()` 中自动注入——同时设 Cookie 和 X-CSRFToken header**
3. **Cookie header 合并使用 `; ` 分隔的 append 策略**
4. **`maxRedirects` 从 5 提升到 20（匹配 Python 版 requests 默认值）**
5. **`validateStatus: () => true` 让 axios 不因非 2xx 抛异常，由 `_call()` 手动检测登录重定向**

## 预防措施

1. **HTTP 客户端契约测试**：验证 `responseType: 'arraybuffer'` 返回正确的 `Uint8Array`（而非 UTF-8 字符串）
2. **CSRF 集成测试**：验证 Cookie 和 X-CSRFToken header 值一致
3. **下载产物完整性检查**：对比下载文件与原始 CDN 文件的 hash
4. **依赖文档化**：所有 HTTP 客户端的"非默认行为"（maxRedirects、validateStatus、cookie merge）必须写进 JSDoc 和 AGENTS.md

## 相关 Commit

- `8cecbb3` fix: CSRF cookie matching, add --cookies flag, fix binary download corruption
