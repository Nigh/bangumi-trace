<p align="center">
  <img src="bangumi-trace-s.webp" width="256" alt="Bangumi Trace logo">
</p>

# Bangumi Trace

移动端优先的个人番剧与逐话观看记录 PWA。数据保存在用户自己的 GitHub 私有仓库 `bangumi-trace-data`；独立的 Cloudflare Worker 负责 GitHub App 登录、并发安全的文件更新和 Bangumi 元数据搜索。

## 本地开发

```sh
npm ci
npm run dev
```

前端通过本地 `.env` 中的 `PUBLIC_WORKER_ORIGIN` 连接 Worker。Worker 位于 `worker/`，使用独立依赖和 `.dev.vars`。

```sh
cd worker
npm ci
cp .dev.vars.example .dev.vars
npm run dev
```

## 检查

```sh
npm run check
npm test
npm run build
cd worker && npm run check && npm test
```

完整且不包含真实账号信息的部署步骤见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。本地 handoff 和 `data/` 下的个人迁移数据已被忽略，禁止提交或复制到 `public/`。
