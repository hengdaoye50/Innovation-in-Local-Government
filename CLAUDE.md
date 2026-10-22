# 地方政府创新案例库（Innovation in Local Government）

## 项目定位

面向 MPA 与行政管理专业学生的课程协作平台，服务于《公共政策分析》与《地方政府创新》两门课。
学生从公开新闻中发现地方政府创新实践，与大模型协同检索、撰写 1000–1500 字案例梗概，
提交后按发生地标注在中国地图上；同时提供课堂 PPT 展示板（含 AI 评语与讨论）与博客展板。

- 线上域名：待定（独立 Cloudflare Pages 项目 `innovation-localgov`）
- 代码仓库：`hengdaoye50/Innovation-in-Local-Government`
- 默认工作语言：中文；代码、命令、变量名用英文

## 技术栈

- 前端：Vite + 原生 ES 模块（不引入 React/Vue），d3-geo 投影 + 手写 SVG 浮雕中国地图
- 后端：Cloudflare Pages Functions（`functions/api/**`）
- 数据：Cloudflare D1（结构化数据）+ KV（会话）
- 模型：DeepSeek 官方 API（`deepseek-chat`），密钥 `DEEPSEEK_API_KEY`；
  兼容 Fireworks，用 `LLM_PROVIDER` 切换，`LLM_BASE` / `LLM_MODEL` 可覆盖默认值
- 部署：GitHub Actions → `wrangler pages deploy`

### 为什么地图不用 echarts-gl

`echarts-gl` 在 ESM 打包下会引入第二份 echarts 实例，`registerMap` 落到另一个实例上直接报错，
且官方已长期停更。改用 d3-geo 的 Albers 投影自行绘制 SVG：无 WebGL 依赖、体积从 1.6MB 降到
百 KB 级，浮雕厚度由多层 path 偏移实现，交互完全可控。

## 维护原则

1. 修改前先读本文件、`DESIGN.md`、`git status` 和相关文件引用关系。
2. 不提交 `node_modules/`、`dist/`、`.wrangler/`、`.dev.vars`、编辑器配置。
3. 不把密钥、token、密码写入代码、提交或日志。`DEEPSEEK_API_KEY`、`SEARCH_API_KEY`、
   `AUTH_SECRET`、`CLOUDFLARE_API_TOKEN` 只存在于部署平台 Secrets。
4. 删除文件、修改 CI/CD、安装全局依赖、部署生产、`git push` 前必须取得用户明确确认。
5. 改完至少跑 `npm run build`；涉及 UI 时在本地起服务做页面检查；涉及 API 时验证方法、
   错误响应和鉴权边界。
6. 前端不直接暴露模型密钥；所有模型与检索调用必须经 Functions 代理。

## 目录约定

```text
MPA课程AI辅学项目开发/
├── CLAUDE.md                 # 项目规范（本文件）
├── DESIGN.md                 # 视觉与交互设计规范
├── PLAN.md                   # 架构方案与实施阶段
├── README.md                 # 仓库说明与部署步骤
├── package.json
├── vite.config.js
├── wrangler.toml             # Pages 项目与 D1/KV 绑定
├── index.html                # 单页入口
├── src/
│   ├── main.js               # 路由与页面挂载
│   ├── styles/               # tokens / base / map / studio / boards / detail / auth
│   ├── pages/                # atlas / studio / slides / blog / case / detail / login / admin
│   ├── components/           # map（SVG 浮雕地图）、chrome（顶栏页脚）、comments
│   └── lib/                  # api / router / store / dom / markdown / demo
├── public/
│   ├── data/china.json       # 中国省级 GeoJSON（已修正环绕向，见 scripts/fix-geojson.mjs）
│   ├── data/cities.json      # 省级 + 地级市经纬度索引（用于地点定位）
│   └── fonts/                # 自托管拉丁标题字体
├── scripts/
│   ├── build-cities.mjs      # 一次性工具：从 DataV 生成 cities.json
│   ├── fix-geojson.mjs       # 一次性工具：修正 GeoJSON 环绕向（必须执行过）
│   ├── seed-admin.mjs        # 生成首个教师账号的 SQL（哈希本地计算）
│   └── shot.mjs              # 开发期视觉检查：CDP 截图
├── functions/
│   ├── api/                  # Pages Functions（auth / cases / chat / slides / posts / comments / admin）
│   └── lib/                  # 服务端共享模块（http / auth / db / llm / search / review）
├── migrations/               # D1 schema 与种子数据
└── .github/workflows/deploy.yml
```

`scripts/` 只放一次性构建与数据生成工具，产物写入 `public/data/` 或 `dist/`，脚本本身不参与运行时。
`public/data/` 存放前端直接 fetch 的地理数据，更新时整体替换并记录数据源。

`public/data/china.json` 来自阿里 DataV `areas_v3`，但其多边形绕向与 GeoJSON 右手法则相反，
直接给 d3-geo 用会被理解成「整个球面减去该省」，投影范围覆盖全球。**替换该文件后必须重跑
`node scripts/fix-geojson.mjs`。**

新增目录必须先在「目录约定」里说明用途和命名规则，再创建使用。

## 功能模块

| 模块 | 路径 | 说明 |
| --- | --- | --- |
| 地图首页 | `/` | 3D 中国地图 + 案例节点，点击进入案例详情 |
| 案例详情 | `/#/case/:id` | 梗概正文、来源链接、留言 |
| 协作工作台 | `/#/studio` | AI 对话检索 + 梗概撰写 + 提交 |
| 展示板 | `/#/slides` | 课堂 PPT 展位，每个展位含 AI 评语与讨论 |
| 博客展板 | `/#/blog` | 优质文章与论文推荐 |
| 教师后台 | `/#/admin` | 邀请码、作品审核、下架、展位管理 |

## 内容规则

### 案例梗概

- 正文 1000–1500 字，中文，第三人称叙述。
- 必填字段：标题、发生地（省 + 市/县）、创新领域标签、正文、来源链接。
- 来源链接上限 15 条，提交时校验。
- 提交后进入 `pending`；AI 质检通过自动转 `published`，不通过退回 `rejected` 并给出理由。
- 教师可随时将 `published` 改为 `hidden`（下架），案例保留但不出现在地图。

### 提交与署名

- 提交需登录；作品与作者账号绑定。
- 支持直接粘贴 Markdown 或上传 `.md` / `.docx`，上传文件在前端解析为文本后提交，
  原始文件不入库。

### 留言与评语

- 案例、展示板、博客文章共用一套评论表，用 `target_type` + `target_id` 区分。
- `author_role = 'ai'` 的记录是模型评语，不出现在普通留言流里，单独置顶展示。
- 教师/助教留言带 `role` 标记，视觉上区分。

## 数据模型（D1）

```text
users      id, username, password_hash, role, status, created_at
invites    code, created_by, used_by, used_at, created_at
sessions   已在 KV，键 auth:session:*
cases      id, title, province, city, lng, lat, domain_tags, summary, body,
           sources_json, author_id, status, ai_review, created_at, updated_at
slides     id, title, course, term, author_id, cover_url, file_url, description,
           status, created_at
comments   id, target_type, target_id, author_id, author_role, body, created_at
posts      id, title, author, source_url, tags, body, cover_url, published_at
```

## 认证

- 复用 `polihot` 的邀请码体系：`PH-XXXX-XXXX` 风格改为本站前缀，全局唯一、一次性。
- 密码 PBKDF2 校验；会话存 KV，Cookie `HttpOnly` + `SameSite=Lax`。
- 用户名：字母数字，长度 ≥ 6。密码：8–18 位，含大写、小写、数字。
- 角色：`admin` / `teacher` / `student`。

## 部署

- GitHub Actions 在 `main` push 时触发：`npm ci` → `npm run build` → `wrangler pages deploy dist`。
- Pages 项目名 `innovation-localgov`，Functions 目录为仓库根 `functions/`。
- D1 绑定名 `DB`；KV 绑定名 `SESSIONS`。
- 必需 Secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`FIREWORKS_API_KEY`、
  `AUTH_SECRET`、`SEARCH_API_KEY`（接入检索后）。
- 所有部署与 CI/CD 修改都需要用户先确认。

## 视觉

南开紫金纸本体系，与 `jinhuazhang.top` 保持一致：紫 `#7E0C6E` + 金 `#C4A265` + 纸 `#FDF8F0`。
完整规范见 `DESIGN.md`。
