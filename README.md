<p align="center">
  <img src="bangumi-trace-s.webp" width="256" alt="Bangumi Trace logo">
</p>

# Bangumi Trace

移动端优先的个人番剧与逐话观看记录 PWA。数据保存在用户自己的 GitHub 私有仓库 `bangumi-trace-data`；独立的 Cloudflare Worker 负责 GitHub App 登录、并发安全的文件更新和 TMDB 元数据搜索（动画罗马字缺失时回退 AniList）。

## 本地开发

```sh
npm ci
npm run dev
```

Astro 构建产物由 `worker/` 中的 Cloudflare Worker 作为 Static Assets 提供，页面、OAuth 和 API 使用同一 origin。

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

校验本地编辑过的 Bangumi Trace 数据文件：

```sh
npm run validate:data -- path/to/bangumi-app.json
```

命令会区分 JSON 语法错误与数据格式错误；格式错误会输出第一个异常字段的 JSONPath。

完整且不包含真实账号信息的部署步骤见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。本地 handoff 和 `data/` 下的个人迁移数据已被忽略，禁止提交或复制到 `public/`。
