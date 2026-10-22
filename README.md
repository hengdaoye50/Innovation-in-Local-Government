# 地方政府创新案例库

面向 MPA 与行政管理专业学生的课程协作平台，服务于《公共政策分析》与《地方政府创新》两门课。

学生从公开新闻出发，在站内与大模型协同检索、追问、核对事实，写成 1000–1500 字的案例梗概；
提交后按发生地标注在中国地图上，并进入课堂展示板与阅读展板。

- 地图：自绘 SVG 浮雕中国地图（Albers 等积投影），案例按经纬度落点，同城自动聚合
- 工作台：流式对话 + 检索来源（上限 15 条）+ 梗概编辑器 + 提交校验
- 展示板：课堂 PPT 展位，含模型评语与讨论
- 阅读：文章与论文推荐
- 后台：作品审核、下架、邀请码

技术栈：Vite + 原生 ES 模块 / Cloudflare Pages Functions / D1 + KV / Fireworks。

## 本地开发

需要 Node 20+ 与一个现代浏览器。

```bash
npm ci
npm run dev            # 前端 http://127.0.0.1:5183
```

API 需要 Cloudflare 的本地运行时（Miniflare），另开一个终端：

```bash
npm run build
npx wrangler pages dev dist --port 8790
# 首次需要建表
npx wrangler d1 execute DB --local --file=migrations/0001_init.sql
```

`vite.config.js` 已把 `/api` 代理到 `127.0.0.1:8790`，所以开发时只访问 5183 即可。
模型与检索未配置时会降级：对话不可用，但页面、提交校验、地图与列表仍可工作。

## 首次部署

### 1. 创建 D1 与 KV

```bash
npx wrangler d1 create innovation-localgov
npx wrangler kv namespace create SESSIONS
```

把返回的 `database_id` 与 KV `id` 填进 `wrangler.toml`（本地开发时占位值即可）。

### 2. 建表

```bash
npx wrangler d1 execute DB --remote --file=migrations/0001_init.sql
```

### 3. 创建首个教师账号

密码哈希在本地计算，明文不落盘、不进仓库：

```bash
node scripts/seed-admin.mjs teacher01 你的密码 teacher --out=migrations/0002_seed_admin.sql
npx wrangler d1 execute DB --remote --file=migrations/0002_seed_admin.sql
```

`migrations/0002_seed_admin.sql` 已在 `.gitignore` 中，请勿提交。

### 4. 创建 Pages 项目

```bash
npx wrangler pages project create innovation-localgov --production-branch=main
```

### 5. 配置 GitHub Secrets

在仓库 Settings → Secrets and variables → Actions 中配置：

| 名称 | 说明 | 必需 |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | 具备 Pages 与 D1 编辑权限的 Token | 是 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID | 是 |
| `DEEPSEEK_API_KEY` | DeepSeek 官方 API 密钥 | 是 |
| `FIREWORKS_API_KEY` | 备用模型通道（可选，与 DeepSeek 二选一） | 否 |
| `SEARCH_API_KEY` | 检索服务密钥 | 否，缺省时对话不带检索 |
| `AUTH_SECRET` | 预留 | 否 |

模型默认走 DeepSeek 官方 API（`deepseek-chat`）。想换成 Fireworks 或任何 OpenAI 兼容端点，
设置变量 `LLM_PROVIDER=fireworks`，或用 `LLM_BASE` / `LLM_MODEL` 直接指定，代码无需改动。

检索服务通过变量 `SEARCH_PROVIDER` 切换：`tavily` / `serper` / `brave` / `none`（默认）。
未配置时对话仍可用，界面会明示「当前未接入检索」，模型不会编造来源。

### 6. 部署

推送到 `main` 即触发 `.github/workflows/deploy.yml`：
`npm ci` → `npm run build` → 应用 D1 迁移 → 同步 Pages Secrets → `wrangler pages deploy dist`。

首次部署后到 Cloudflare 控制台为 Pages 项目确认 D1（`DB`）与 KV（`SESSIONS`）绑定，
然后即可绑定自定义域名。

## 数据维护

| 文件 | 来源 | 更新方式 |
| --- | --- | --- |
| `public/data/china.json` | 阿里 DataV `areas_v3` | 替换后**必须**执行 `node scripts/fix-geojson.mjs` |
| `public/data/cities.json` | 阿里 DataV 各省市级中心点 | `node scripts/build-cities.mjs` |

`china.json` 原始数据的多边形绕向与 GeoJSON 右手法则相反，d3-geo 会把它理解成
「整个球面减去该省」，导致投影覆盖全球。`fix-geojson.mjs` 会按球面面积检测并反转。

## 视觉

南开紫金纸本体系：紫 `#7E0C6E` + 金 `#C4A265` + 纸 `#FDF8F0`。
完整规范见 `DESIGN.md`，项目维护约定见 `CLAUDE.md`。
