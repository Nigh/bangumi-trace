# 部署 Bangumi Trace

本文只使用占位符。不要把账号名、仓库名、域名、应用 ID、安装 ID、token、client secret、私钥或 Cloudflare 资源标识写入仓库、commit message、Issue 或日志。

## 1. 前置条件

- Node.js LTS、npm、GitHub 账号和 Cloudflare 账号。
- 一个保存应用代码并通过 Cloudflare Workers 部署的仓库。每位使用者还需在自己的个人账号下创建名为 `bangumi-trace-data` 的私有仓库。
- 本地执行 `npm ci && npm run check && npm test && npm run build`。
- `BANGUMI_WEB_APP_HANDOFF.md`、`data/bangumi.json`、`data/bangumi-history.json` 只留在本机，确认 `git check-ignore` 能命中它们。

## 2. 创建 GitHub App

1. 在 GitHub 的 Developer settings 中创建 GitHub App。
2. 此时线上地址尚未生成，Homepage URL 先填 `http://localhost:8787`。
3. Redirect URI 先填 `http://localhost:8787/auth/callback`。GitHub 文档和代码有时仍称它为 callback URL；`redirect_uri` 也是授权请求中的对应参数。本项目未显式传该参数，因此 GitHub 会使用配置中的第一个 Redirect URI。不要误填到 Setup URL。
4. Webhook 设为不启用；Repository permissions 仅将 **Contents** 设为 **Read and write**，其余保持无权限。
5. 在 **Where can this GitHub App be installed?** 中选择 **Any account**，让其他 GitHub 用户可以安装。
6. 记录 client ID，并生成 client secret；不要下载或提交私钥，本项目不需要私钥。测试时通过 App 的公开安装页安装，并选择 **Only select repositories**，只授权 `bangumi-trace-data`。

## 3. 本地运行

先构建前端，再由 Wrangler 在同一 origin 提供静态资源和 API：

```sh
npm ci
npm run build
cd worker
npm ci
cp .dev.vars.example .dev.vars
npm run dev
```

在本机编辑 `.dev.vars`，替换全部占位符；不能保留示例中的尖括号值。该文件已被 Git 忽略。

- `GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`：GitHub App 凭据。
- `SESSION_SECRET`：32 个随机字节的 base64；运行 `openssl rand -base64 32` 生成。
- `TMDB_API_TOKEN`：TMDB API Read Access Token。

本地应用与 API 均使用 Wrangler 输出的地址（默认 `http://localhost:8787`）。修改前端后需重新运行根目录的 `npm run build`。

## 4. 部署单 Worker

先登录、构建并检查：

```sh
npm ci
npm run check
npm test
npm run build
cd worker
npm ci
npx wrangler login
npx wrangler whoami
npx wrangler types
npm run check
npm test
npx wrangler deploy --dry-run
```

逐项交互设置运行时 secret；Wrangler 提示后再粘贴真实值：

```sh
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler secret put TMDB_API_TOKEN
```

执行 `npx wrangler secret list`，它只应显示名称。随后执行 `npx wrangler deploy`。`worker/wrangler.jsonc` 会把根目录 `dist/` 作为 Static Assets 上传，并让 `/api/*` 与 `/auth/*` 优先进入 Worker。

生产环境可直接使用 Worker 的公开地址，也可在 Worker 的 Settings → Domains & Routes 中绑定自定义域名。不要再单独部署 GitHub Pages。

## 5. GitHub Actions

仓库的部署工作流会构建前端、检查前后端并发布同一个 Worker。在 GitHub 仓库的 Actions secrets 中配置：

- `CLOUDFLARE_API_TOKEN`：至少允许部署该 Worker。
- `CLOUDFLARE_ACCOUNT_ID`：目标 Cloudflare account ID。

Worker 的 GitHub、会话和 TMDB secrets 仍通过 Wrangler 管理，不写入 Actions。

## 6. 使用与迁移个人数据

1. 使用者在自己的 GitHub 个人账号下创建私有仓库 `bangumi-trace-data`，创建时勾选 README，使默认 `main` 分支立即可用。
2. 从 GitHub App 的公开安装页安装 App，选择 **Only select repositories**，只授权 `bangumi-trace-data`。仓库名称必须完全一致，且 App 的 **Contents** 权限必须为 **Read and write**。
3. 登录应用，打开“设置与导入”。Worker 会使用当前登录用户名定位该用户的 `bangumi-trace-data`，无需配置用户白名单或仓库 owner。
4. 先选择本机 `bangumi.json`，核对预览数量。
5. 再选择 `bangumi-history.json`；历史推导事件的观看时间保持未知。
6. 在界面人工校对标题、状态和候选事件，下载或另存本地备份后再点击“保存到 GitHub”。
7. 在 `bangumi-trace-data` 确认只新增 `data/bangumi-app.json`，应用代码仓库中没有任何迁移文件。

登录后若出现“找不到可用的数据仓库”，请依次确认仓库已创建、仓库位于当前登录账号下、默认 `main` 分支存在，并在 GitHub App 安装设置中重新勾选该仓库。修正后返回应用点击“重试”。

## 7. 验证与回滚

- 未登录请求返回 `401`；错误 Origin 返回 `403`；两个客户端用同一旧 SHA 保存时，第二个返回 `409`。
- 检查 commit 中只包含 `Update bangumi data`，Worker 日志不含数据正文或身份凭据。
- 应用回滚：运行 `npx wrangler versions list`，确认目标版本后执行 `npx wrangler rollback <VERSION_ID>`；静态资源与 Worker 代码会随同一版本回滚。
- 如怀疑泄漏，立即撤销 GitHub App client secret、重新生成 `SESSION_SECRET`、重新设置 Worker secrets，并审查 Git 历史后再恢复服务。
