# Postmortem 002 — 模块化重构引发循环依赖

**日期**：2026-05-31
**严重程度**：中 — 重构后测试失败，但仅影响内部架构，不涉及用户
**影响范围**：`extractors/` 拆分和 `core/job.ts` 拆分

## 根因分析

### 症状

```
TypeError: Class extends value undefined is not a constructor or null
  at src/core/download-job.ts:12:34 — export class DownloadJob extends Job
  at src/core/job.ts:53:1 — export { DownloadJob } from './download-job'
```

`DownloadJob extends Job` 在运行时拿到 `undefined`——循环引用导致 ESM 模块加载顺序错乱。

### 根因

**情况 1：`core/job.ts` re-export 循环**

拆分前 `job.ts` 是单体文件（487 行），`DownloadJob` / `PrintJob` / `Job` 都在同一文件。拆分后：

```
job.ts → re-exports DownloadJob from './download-job'
download-job.ts → imports Job from './job'
```

形成 A→B→A 的 ESM 循环。当 `download-job.ts` 执行到 `extends Job` 时，`job.ts` 尚未完成执行（因为它在等 `download-job.ts` 先加载），`Job` 为 `undefined`。

**情况 2：`extractors/` UserExtractor 循环**

原始 `extractors.ts` 中 `InstagramUserExtractor` 直接引用其他 7 个提取器 class。拆分后：

```
user.ts → needs InstagramPostsExtractor, InstagramReelsExtractor, ...
posts-list.ts → extends InstagramExtractor (from base.ts)
```

如果 user.ts 通过 barrel import 其他提取器，形成多对多循环。

### 为什么之前没问题

原始单体文件中所有类在同一作用域，JavaScript 的 `class` 声明被 hoist，`extends` 在运行时已全部定义。

## 修复方案

### core/job 循环

砍掉 `job.ts` 中的 re-export 语句，让消费者直接从新模块导入：

```diff
- // job.ts
- export { DownloadJob } from './download-job'
- export { PrintJob } from './print-job'

+ // sdk.ts — 消费者直接从源模块导入
+ import { DownloadJob } from './core/download-job'
+ import { PrintJob } from './core/print-job'
```

### extractors 循环

引入注册表模式（`extractors/registry.ts`）：

```
registry.ts — Map<subcategory, ExtractorClass>
  register(subcategory, cls)  // 每个提取器文件 side-effect 调用
  get(subcategory)             // UserExtractor 运行时查询
```

每个提取器文件底部：
```ts
register(InstagramPostExtractor.subcategory, InstagramPostExtractor as ExtractorClass)
```

UserExtractor 不再直接 import 任何子提取器——只在 `items()` 运行时通过 `get(cat)` 查询注册表。

## 关键教训

1. **re-export + import 同模块形成循环是 JavaScript 模块系统的经典陷阱**。拆分后必须检查 `A exports from B and B imports from A` 的模式。

2. **注册表模式是解耦同层模块的标准方案**：当模块 A 需要"知道"模块 B/C/D 的存在但不需要它们的类型信息时，用字符串 key → class 的映射比直接 import 更安全。

3. **ESM 循环引用在 TypeScript 类型检查中不报错**：`tsc` 只看类型声明（`.d.ts`），不会模拟运行时加载顺序。循环引用只在 vitest / node 运行时暴露。

## 预防措施

1. 拆分单体文件时，先画依赖图再动手——不要机械地按函数/类边界切分
2. 任何 `export { X } from './other-module'` 都必须检查 `other-module` 是否反过来 import 当前模块
3. CI 中添加 ESM 循环检测工具（如 `dpdm` 或 `madge`）

## 相关 Commit

- `4966f8f` refactor: modularize extractors, core/jobs, and CLI
- `2aa6e15` refactor: split parsers into rest/graphql modules（parsers 拆分采用了同样的防循环策略——graphql.ts import rest.ts 是单向的，无 re-export 循环）
