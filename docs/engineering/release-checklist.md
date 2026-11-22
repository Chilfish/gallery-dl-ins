# Release Checklist

**项目**: `@chilfish/gallery-dl-instagram`（CLI 二进制 `dl-ins`） | **最后更新**: 2026-11-22

> 发布到 npm。目标：每个「里程碑发布」的产物在真实环境验证通过，不留已知回归。
> 本文档覆盖**里程碑发布**（打 tag → CI 发布 npm → 手写 GitHub Release）的完整清单。

## 版本纪律

- **包版本单一来源**：`package.json` `version` 字段（SemVer 2.0.0）
- **tag 必须与包版本一致**：`v<version>`，CI 会硬性校验
- 仅在验证门禁全绿后打 tag；行为修复走 patch，新增能力走 minor，破坏性变更走 major
- 每次发布 version 单调递增，禁止回退
- `CHANGELOG.md` 的版本节在发布前写好，CI 会校验该节存在
- Breaking change 必须：`BREAKING CHANGE` footer + 迁移说明 + 至少一个主版本存续期

## 验证门禁（发布前必过）

- [ ] `bun run typecheck` 通过
- [ ] `bun run lint:check` 通过
- [ ] `bun run test` 全绿（默认离线）
- [ ] `bun run build` 通过（tsdown 双构建）
- [ ] `node dist/dl-ins.mjs --help` 正常执行
- [ ] `dist/dl-ins.mjs` 顶部没有第三方包 import（只允许 `node:*`）
- [ ] `dist/index.js` / `dist/node.js` 不包含 `node:` 实现代码（应是外部 import）
- [ ] pre-commit / pre-push 钩子未跳过
- [ ] `.github/workflows/ci.yml` 在 `main` 上为绿色

## 包身份核验

- [ ] `package.json#name` = `@chilfish/gallery-dl-instagram`
- [ ] `package.json#bin` = `{ "dl-ins": "dist/dl-ins.mjs" }`（npm 11 会把带 `./` 前缀的 bin 判为无效并移除）
- [ ] `package.json#exports` 只有 `.` 与 `./node`
- [ ] `files` 只包含 `LICENSE` / `README.md` / `dist`
- [ ] `bun pm pack --dry-run` 产物不含 `data/`、`.env`、测试与源文件
- [ ] `npm view @chilfish/gallery-dl-instagram version` 与本次版本不重复

## 功能冒烟（真实环境，手动）

> 需要项目根目录 `.env` 中的 `INSTAGRAM_COOKIES`（含 `sessionid` / `csrftoken`）。**不进入 CI**，勾选并记录日期。

- [ ] 单帖提取：`bun run cli <post-url> --info`
- [ ] 用户帖子列表：`bun run cli <user-url> --info`
- [ ] stories 提取：`bun run scripts/probe-stories.ts story <stories-url>`
- [ ] highlights 提取：`bun run scripts/probe-stories.ts highlights <username>`
- [ ] 真实下载一个小文件：`bun run cli <post-url>` 后确认文件可打开
- [ ] 错误可定位：用失效 Cookie 触发一次，确认错误包含状态码或具体策略原因

## 公共导出面核验

- [ ] `src/index.ts` / `src/node.ts` 的导出与 [api-reference.md](../reference/api-reference.md) 一致
- [ ] 新增公开 API 有 JSDoc 与文档条目
- [ ] 类型声明 `dist/index.d.ts` / `.d.cts` 正常生成
- [ ] 下游安装冒烟：临时目录 `npm i @chilfish/gallery-dl-instagram@<version>` 后能 `import` 且 `dl-ins --version` 正确

## 发布步骤

发布由 tag 触发的 GitHub Actions 完成，本地只负责版本收口与推送 tag。

### 发布前（本地）

1. 确认 `main` 已推送且 CI 全绿
2. 更新 `CHANGELOG.md`，补齐本版版本节
3. 需要时跑功能冒烟（见上），勾选并记录日期
4. 更新 `package.json` 的 `version`
5. 提交 `chore(release): v<version>`（footer 写 `Closes #<n>`），打 tag 并推送：

   ```bash
   git commit -am "chore(release): v<version>"
   git tag v<version>
   git push origin main
   git push origin v<version>
   ```

### 发布（CI）

6. `.github/workflows/publish.yml` 由 tag 触发：
   - 校验 tag 与 `package.json` 版本一致
   - 校验 `CHANGELOG.md` 存在对应版本节
   - 复跑 `typecheck` / `lint:check` / `test` / `build`
   - `npm publish --provenance --access public`（Trusted Publisher / OIDC）
   - 流水线不创建 GitHub Release
7. tag 已推送但发布失败：从 GitHub Actions 重跑失败的工作流，不要删除 tag 重打

### 发布后（核验）

8. `npm view @chilfish/gallery-dl-instagram dist-tags` 指向新版本
   - npm 11 发布后先进入 `Validating` 状态数分钟，期间 `npm view <pkg>@<version>` 返回 404。用 `npm stage list @chilfish/gallery-dl-instagram` 确认状态，**不要重复发布**
9. 临时目录安装并从 registry 冒烟：

   ```bash
   npm i --prefix "$env:TEMP/gdl-ins-check" @chilfish/gallery-dl-instagram@<version>
   node "$env:TEMP/gdl-ins-check/node_modules/@chilfish/gallery-dl-instagram/dist/dl-ins.mjs" --version
   ```

10. npm 页面显示 provenance 与 Trusted Publisher 状态
11. 创建 GitHub Release：以 CHANGELOG 版本节为底稿，补 `### 安装` 与末尾 `Closes #<n>`

    ```bash
    gh release create v<version> --repo Chilfish/gallery-dl-ins --notes-file <file>
    ```

12. 确认关联 issue 已关闭；回填本文档的发布记录

## 发布凭据（Trusted Publisher / OIDC）

- npm 包设置里的 Trusted Publisher：GitHub 仓库 `Chilfish/gallery-dl-ins`、工作流文件名 `publish.yml`、权限 publish / stage publish / dist-tag
- workflow 需要 `permissions.id-token: write`（换取 npm OIDC token）；`contents` 保持只读，GitHub Release 由维护者手写
- 不使用 `NPM_TOKEN` / `NODE_AUTH_TOKEN`；`actions/setup-node` 不配置 `registry-url`，避免写入占位 token 的 `.npmrc`
- 首次配置后必须在 npm 要求的期限内成功发布一次，Trusted Publisher 才会从 `Pending validation` 变为生效

## 发布记录

### 0.3.0（2026-11-22）

- 新增 SDK 代理支持：`createSDK({ proxy })`、`/node` 的 `createProxyFetch`，Node 使用可选 peer `undici`
- 发布提交 `chore(release): v0.3.0`，tag `v0.3.0`；`publish.yml` 全步骤通过
- 离线门禁：typecheck / lint / 207 tests / build 全绿；CI run `45037739932` 通过
- 真实环境冒烟：临时目录从 registry 安装 0.3.0，`dl-ins --version` 输出 `0.3.0`，`/node` 导出 `createProxyFetch`
- registry：`latest = 0.3.0`，发布后约 2 分钟处于 `Validating`，随后自动生效
- GitHub Release v0.3.0 已创建

### 0.2.7（2026-11-19）

- 修复用户 feed REST 端点退役：posts / tagged / reels / profile 改为 doc_id GraphQL 主路径，REST 与页面 payload 降级（#4）
- 发布提交 `chore(release): v0.2.7`，tag `v0.2.7`；`publish.yml` 全步骤通过
- 离线门禁：typecheck / lint / 200 tests / build 全绿；CI run `44480583029` 通过
- 真实环境冒烟：`yunoch1` posts 1 条、`instagram` reels 1 条、`instagram` tagged 1 条、`yunoch1 -i` 资料 + 34 条 posts
- registry：`latest = 0.2.7`，从官方 registry 安装后 `dl-ins --version` 输出 `0.2.7`
- 发布后约 6 分钟处于处理中，随后 `dist-tags` 自动指向 0.2.7
- GitHub Release v0.2.7 已创建，issue #4 已关闭

### 0.2.6（2026-11-18）

- 修复 `/stories/highlights/{id}/` 直链提取：页面 payload（含 connection 形状）优先，REST 回退；`post.items` 优先分流（#3）
- 发布提交 `chore(release): v0.2.6`，tag `v0.2.6`；`publish.yml` 全步骤通过
- 离线门禁：typecheck / lint / 175 tests / build 全绿
- 真实环境冒烟：issue 中的 highlight 直链产出 1 个 directory 与 12 条 media
- registry：`latest = 0.2.6`；发布后约 4 分钟处于 `Validating`，随后自动生效；本地 `npm stage list` 因 token 失效无法使用，以 `npm view` 为准
- GitHub Release v0.2.6 已创建，issue #3 已关闭

### 0.2.5（2026-11-14）

- 首个 OIDC 发布，用于验证 Trusted Publisher 配置；发布后由 `Pending validation` 转为生效
- 修复 stories 提取在用户名解析失败或 REST `reels_media` 不可用时不可用（#2）
- 发布提交 `fix(package): 补齐 repository 并修正 bin 路径`，tag `v0.2.5`；`publish.yml` 全步骤通过
- 离线门禁：typecheck / lint / 169 tests / build 全绿
- 真实环境冒烟：stories 页面 payload 路径提取 3 条 story 通过
- registry：`latest = 0.2.5`，`bin = { "dl-ins": "dist/dl-ins.mjs" }`，`repository.url` 指向 GitHub
- 首次发布失败：缺少 `repository.url` 被 provenance 拒绝，`bin` 带 `./` 前缀被 npm 11 移除；修复后重新打 tag 发布
- 发布后约 1 分钟处于 `Validating`，期间 `npm view` 仍为 0.2.4；校验通过后 `dist-tags` 自动指向 0.2.5
- GitHub Release v0.2.5 已创建，issue #2 已关闭

## 参考资料（上游文档）

- [npm Trusted publishing](https://docs.npmjs.com/trusted-publishers) — OIDC 配置与 `publish.yml` 绑定
- [npm provenance statements](https://docs.npmjs.com/generating-provenance-statements) — `npm publish --provenance`
- [npm CLI `publish`](https://docs.npmjs.com/cli/v11/commands/npm-publish) · [`dist-tag`](https://docs.npmjs.com/cli/v11/commands/npm-dist-tag) · [`view`](https://docs.npmjs.com/cli/v11/commands/npm-view)
- [GitHub Actions OIDC](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect) — `id-token: write`
- [actions/setup-node](https://github.com/actions/setup-node) · [oven-sh/setup-bun](https://github.com/oven-sh/setup-bun)
- [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository) · [`gh release create`](https://cli.github.com/manual/gh_release_create)
- [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · [SemVer](https://semver.org/)
