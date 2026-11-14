# Git 开发流程

**项目**: `@chilfish/gallery-dl-instagram`（CLI: `dl-ins`） | **最后更新**: 2026-11-14

> 本文档对齐 weibo-sdk 的 Git Workflow 规范，适配本仓库（TypeScript 库 + Bun + Vitest + tsdown）技术栈。根级硬约束见 [AGENTS.md](../../AGENTS.md)。

## Commit 规范

遵循 [Conventional Commits 1.0.0](https://www.conventionalcommits.org/)。

### 格式

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Type

| Type | 说明 | 示例 |
|---|---|---|
| `feat` | 新功能 | `feat(stories): parse embedded page payload` |
| `fix` | Bug 修复 | `fix(api): preserve HTTP status in errors` |
| `refactor` | 重构（不改变行为） | `refactor(extractors): extract registry helper` |
| `test` | 测试 | `test(stories): cover page payload fallback` |
| `docs` | 文档 | `docs: add git workflow and release checklist` |
| `style` | 格式化 | `style: apply eslint --fix` |
| `chore` | 构建/工具 | `chore(ci): add publish workflow` |
| `perf` | 性能优化 | `perf(api): avoid redundant user lookups` |

### Scope

使用模块名或功能名：

`api`、`stories`、`highlights`、`post`、`user`、`cli`、`sdk`、`fetcher`、`parsers`、`build`、`ci`、`docs`、`test`

### 规则

- **Description 用英文祈使句**：`add`、`fix`、`remove`
- 首字母小写，不加句号，不超过 72 字符
- **Breaking change**：footer 标记 `BREAKING CHANGE: description`
- **关联 issue**：修复类 commit 在 footer 写 `Closes #<n>`，仅引用不关闭时写 `Refs #<n>`；PR 正文用 `Closes #<n>` 关联，让 issue / commit / PR 双向可追溯

### Commit 纪律

1. **写代码前**先用 Conventional Commit 格式确定 commit message
2. 围绕这个 message 的范围编码，超出范围的工作留给下一个 commit
3. **diff >10 文件或 >200 行时主动拆分**
4. 每个 commit 应能独立通过验证（`typecheck` + 相关 `test`）
5. 模块创建、功能实现、配置修改、文档更新分开 commit

典型拆分示例：

```bash
git commit -m "test(stories): add failing page-payload test"
git commit -m "fix(stories): parse embedded payload before REST fallback"
git commit -m "docs: record stories user-resolution postmortem"
```

## 验证门禁

每个 commit / PR 合并前必须通过（离线，不依赖真实 Instagram 网络）：

```bash
bun run typecheck     # tsc --noEmit
bun run lint:check    # eslint .（CI / 提交前）
bun run lint          # eslint . --fix（本地修复）
bun run test          # vitest run
bun run build         # tsdown（SDK + CLI 双构建）
```

- `.github/workflows/ci.yml` 在 push `main` 与 PR 上复跑上述门禁
- pre-commit 对暂存的代码文件跑 `eslint --fix`，pre-push 跑 `build`（`lefthook.yml`）
- **禁止 `--no-verify` 跳过钩子**；钩子失败必须修复根因
- 测试默认离线，`tests/integration/**` 全部使用 `MockHttpClient`，不读取真实 Cookie
- 涉及真实 Instagram 的冒烟只能手动执行（见 [release-checklist.md](./release-checklist.md)），不进入 CI

## 代码审查

### PR 流程

1. 创建 PR → 跑通验证门禁
2. 至少 1 人 Approve；AI 辅助先进行自动化 Code Review
3. 所有检查通过后 Merge（**Squash Merge**，合并后删除分支）
4. PR 正文用 `gh pr create --body-file <file>`，禁止命令行字面量 `\n` 拼 body

### 审查清单

- [ ] 代码逻辑正确，覆盖边界情况（分页 / 空值 / null vs undefined）
- [ ] 新功能 / 纯函数有测试；改动无回归
- [ ] 遵循 [code-style.md](./code-style.md)
- [ ] 平台无关层没有 `node:*` import
- [ ] 新增公开 API 时同步 [api-reference.md](../reference/api-reference.md)
- [ ] 二进制下载显式 `responseType: 'arraybuffer'`
- [ ] 相关文档已更新；新 Bug 模式写 postmortem

### 合并门禁（全部满足）

- [ ] `bun run test` 通过
- [ ] `bun run typecheck` 通过
- [ ] `bun run lint:check` 通过
- [ ] 文档与代码一致（docs-as-truth）
- [ ] 新增功能有对应测试

> 涉及较大重构 / breaking change / 需真实外网验证的 PR，必须先在 PR 中明确风险点并等待确认后再合并。

## 发布流程

`@chilfish/gallery-dl-instagram` 由 tag 触发的 GitHub Actions 发布到 npm，使用 npm Trusted Publisher（OIDC），**不保存长期 token**。

### 一键发布（默认路径）

1. 在 `main` 上把本版变化写进 `CHANGELOG.md`，按下面的「发版文案」小节写
2. 只改版本号与文档，不夹带功能改动：

   ```bash
   # 手动更新 package.json 的 version（SemVer）
   git commit -am "chore(release): v<version>"
   git tag v<version>
   git push origin main
   git push origin v<version>
   ```

3. tag 推送触发 `.github/workflows/publish.yml`：
   - 校验 tag 与 `package.json` 版本一致、`CHANGELOG.md` 有对应版本节
   - 复跑 `typecheck` / `lint:check` / `test` / `build`，验证 `dist/dl-ins.mjs --help`
   - `npm publish --provenance --access public`（OIDC 换取短时 token）
   - 只负责发布 npm，不自动创建 GitHub Release
4. 发布成功后手写 GitHub Release：以 CHANGELOG 版本节为底稿，正文首段引用对应 issue，末尾写 `Closes #<n>`，用 `gh release create v<version> --notes-file <file>` 提交
5. 发布后核验：`npm view @chilfish/gallery-dl-instagram dist-tags`、`npm stage list @chilfish/gallery-dl-instagram`、GitHub Release、npm 页面的 provenance

> npm 11 发布后会先进入 `Validating` 状态数分钟，期间 `npm view <pkg>@<version>` 仍是 404、`dist-tags` 也不会更新。用 `npm stage list <pkg>` 确认状态，**不要因此重复发布**；校验通过后版本自动出现在 registry。

### 发版文案（CHANGELOG 版本节 + GitHub Release）

两份文案是同一份内容：Release 以 CHANGELOG 版本节为底稿，只补 `### 安装` 和末尾的 `Closes`。

结构固定为三段：

1. **首段一句话**：本版做了什么、影响到谁，带上对应 issue 的 `#<n>`；`Closes #<n>` 放在正文最后一行。
2. **分节**：`### 新增` / `### 修复` / `### 变更` / `### 升级提示`（按需出现），每条变化一行，写调用方能观察到的结果——新增的字段 / 方法 / 错误码、行为变化、命令用法。
3. **结尾**：`### 安装` + `npm install @chilfish/gallery-dl-instagram@<version>`。

写法约束：

- 一条变化一行。条目里出现内部类型名、文件路径、阈值、内存数字、判定分支，说明写到了实现层，删掉。
- 用陈述句说结果，避免「不再 / 不会 / 无需」这类否定框架，以及「不是 X，而是 Y」的对比句。
- 同一个事实只写一次，CHANGELOG 和 Release 不各自展开同一段说明。
- 不写历史版本对比与迁移步骤。破坏性变更需要读者改代码时，附一张两列映射表。
- 篇幅以「一屏扫完」为准；写成设计说明、或者把提交逐个罗列出来，都算不合格。
- 不给单个领域起加粗小标题，分节只用 `### 新增 / 修复 / 变更`。

### 发布凭据

- npm Trusted Publisher 绑定 `Chilfish/gallery-dl-ins` + `publish.yml`，权限为 publish / stage publish / dist-tag
- workflow 需要 `permissions.id-token: write`（换取 OIDC token）；`contents` 保持只读，GitHub Release 由维护者手动创建
- 不使用 `NPM_TOKEN` / `NODE_AUTH_TOKEN`；`actions/setup-node` 不配置 `registry-url`，避免写入占位 token 的 `.npmrc`
- 首次配置后必须在 npm 要求的期限内成功发布一次，Trusted Publisher 才会从 `Pending validation` 变为生效

### 硬约束

- 版本号单一来源为 `package.json`（SemVer 2.0.0），tag 必须与它一致
- 只有 CI 门禁全绿才会发布；tag 已推送但发布失败时，从 GitHub Actions 页面重跑失败的工作流，不要删除 tag 重打
- 本地 `npm publish` 只用于排障，不作为正式发布路径
- 发布提交只改 `package.json` / `CHANGELOG.md`，功能与文档改动提前合入

> 手动冒烟与产物核验清单见 [release-checklist.md](./release-checklist.md)。

## AI 协作开发

- 优先使用 `gh` CLI 进行 GitHub 全流程管理
- 新端点先抓包留证据，再写代码与测试（见 [postmortem 006](../postmortem/006-stories-user-resolution.md)）
- 开写前读 [postmortem README](../postmortem/README.md)「高频雷区」自查
- 并行 Agent 协作：文件分配互不重叠；只提交自己这部分的改动

## 参考资料（上游文档）

- [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)
- [Semantic Versioning 2.0.0](https://semver.org/)
- [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
- [npm Trusted publishing](https://docs.npmjs.com/trusted-publishers)
- [npm provenance statements](https://docs.npmjs.com/generating-provenance-statements)
- [GitHub Actions: OpenID Connect](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect)
- [actions/setup-node](https://github.com/actions/setup-node) · [oven-sh/setup-bun](https://github.com/oven-sh/setup-bun)
- [GitHub CLI `gh release`](https://cli.github.com/manual/gh_release_create)
- [Bun CLI `install`](https://bun.sh/docs/cli/install) · [tsdown](https://tsdown.dev/)
