# 地方政府创新案例库（Innovation in Local Government）

## 项目定位

面向 MPA 与行政管理专业学生的课程协作平台，服务于《公共政策分析》与《地方政府创新》两门课。
学生从公开新闻中发现地方政府创新实践，与大模型协同检索、撰写 1000–1500 字案例梗概，
提交后按发生地标注在中国地图上；同时提供课堂 PPT 展示板（含 AI 评语与讨论）与拓展材料展板。

- 线上域名：`https://innovation.jinhuazhang.top`（独立 Cloudflare Pages 项目 `innovation-localgov`，
  默认域 `https://innovation-localgov.pages.dev` 同时可用）
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

### 南海诸岛与附图

九段线与南海岛礁不能从地图上删掉——缺了属「问题地图」，违反《地图管理条例》。
`src/components/map.js` 的做法是把它们整体装进右下角附图：九段线是独立的
`100000_JD` feature，而岛礁本身**并进了海南省的 MultiPolygon**，东沙群岛**并进了广东省**，
所以不能按纬度切，也不能只处理海南。

判据是「孤立」：位于南海海域、且与本省主体相距超过 1.5°（约 165 km）的碎块移入附图。
珠江口、雷州、涠洲这些沿海岛屿紧贴主体，会正确留在主图。换 GeoJSON 数据源后必须
重新确认这条判据仍然成立，否则主图的南海海面会重新出现散点。

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
│   ├── styles/               # tokens / base / map / studio / boards / detail / auth / touch
│   ├── pages/                # atlas / studio / slides / blog / field / survey（阅读）/
│   │                         # survey-editor（编写与编辑）/ case / detail / reading / me / login / admin
│   ├── components/           # map（SVG 浮雕地图）、chrome（顶栏页脚）、comments
│   └── lib/                  # api / router / store / dom / markdown / image（前端压图）/ demo
├── public/
│   ├── data/china.json       # 中国省级 GeoJSON（已修正环绕向，见 scripts/fix-geojson.mjs）
│   ├── data/cities.json      # 省 / 地级市 / 区县 三级坐标索引（定位精度到区县）
│   └── fonts/                # 自托管拉丁标题字体
├── scripts/
│   ├── build-cities.mjs      # 一次性工具：从 DataV 生成 cities.json
│   ├── fix-geojson.mjs       # 一次性工具：修正 GeoJSON 环绕向（必须执行过）
│   ├── seed-admin.mjs        # 生成首个教师账号的 SQL（哈希本地计算）
│   └── shot.mjs              # 开发期视觉检查：CDP 截图
├── examples/                 # 示例稿件，仅用于测试导入与演示，不参与构建
│   ├── sample-case.md        # Markdown 版
│   └── sample-case.docx      # Word 版（同内容的转换产物）
├── functions/
│   ├── api/                  # Pages Functions（auth / cases / chat / slides / posts / surveys /
│   │                         # survey-images / readings / comments / views / admin）
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
| 拓展材料 | `/#/blog` | 课程推荐的文章、论文与方法笔记 |
| 调研足迹 | `/#/field` | 首页第五屏：师生实地调研的见闻列表，有图就显示缩略图 |
| 足迹详情 | `/#/field/:id` | 图文阅读：衬线正文、图版与图注、点图放大、页边目录 |
| 足迹编写 | `/#/field/new`、`/#/field/:id/edit` | Markdown 分栏编辑、实时预览、照片上传、本机草稿 |
| 教师后台 | `/#/admin` | 邀请码、作品审核、下架、展位管理 |

## 内容规则

### 案例梗概

- 正文 1000–1500 字，中文，第三人称叙述。
- 「字」的口径与 Word 一致：汉字按字计、连续的拉丁字母与数字按一个词计，标点与空白不计。
  前端 `zhWords`（`src/lib/dom.js`）与服务端 `review.js` 里的同名函数必须保持同一实现，
  否则学生看到的数字和质检判据会对不上。
- 必填字段：标题、发生地（省 + 市/县）、创新领域标签、正文、来源链接。
- 来源链接上限 15 条，提交时校验。
- 提交后进入 `pending`；AI 质检通过自动转 `published`，不通过退回 `rejected` 并给出理由。
- 教师可随时将 `published` 改为 `hidden`（下架），案例保留但不出现在地图。

### 调研足迹

- 与案例分开一套规则：**不跑模型质检**。游记没有「创新点」可判，硬判只会把人逼成汇报腔。
- 必填：标题、发生地（省 + 市/县，区县可选）、正文（≥ 80 字符）。调研月份可选。
- 正文用 Markdown，正文里独占一段的照片自动立成图版，`![图注](…)` 的图注会显示在图下。
- 一篇最多 9 张照片；图片的存储与清理规则见下文「调研足迹的配图」。
- 作者本人与教师 / 管理员可以**改**已发布的记录，改完状态不变——不该因为改稿而退回未发布，
  也不该让被下架的记录借编辑复活。`updated_at` 只在真正编辑过之后才有值。
- 编辑入口：阅读页的「编辑这条」、个人页「我的调研」每行的「编辑」。
- 编写页有本机草稿（`localStorage`，键 `field:draft:<id|new>`），换设备不带走，成功发布即清空。

### 提交与署名

- 提交需登录；作品与作者账号绑定。
- 支持直接粘贴 Markdown 或上传 `.md` / `.docx`，上传文件在前端解析为文本后提交，
  原始文件不入库。

### 留言与评语

- 案例、展示板、博客文章共用一套评论表，用 `target_type` + `target_id` 区分。
- `author_role = 'ai'` 的记录是模型评语，不出现在普通留言流里，单独置顶展示。
- 教师/助教留言带 `role` 标记，视觉上区分。

**展位评语（`functions/lib/review.js` 的 `SLIDE_SYSTEM`）是公开反馈，口径固定为正向：**
开口说这份汇报最值得看的地方且必须具体；顺着选题递一个「可以接着……」的延展方向；
不写负面评价、不用「但是/然而/不足/欠缺」；**不打分**——分数会在班里排出高低，
与这段评语的目的相冲（`ai_score` 对展位恒为 NULL，案例质检仍保留分数）。

## 数据模型（D1）

```text
users      id, username, password_hash, role, status, created_at
invites    code, created_by, used_by, used_at, created_at
sessions   已在 KV，键 auth:session:*
cases      id, title, province, city, district, lng, lat, domain_tags, summary, body,
           sources_json, author_id, status, ai_review, created_at, updated_at
slides     id, title, course, term, author_id, cover_url, file_url, description,
           status, created_at
comments   id, target_type, target_id, author_id, author_role, body, created_at
posts      id, title, author, source_url, tags, body, cover_url, published_at
surveys    id, title, province, city, district, lng, lat, body, author_id, author_name,
           visited_at, status, created_at, updated_at
survey_images  id, survey_id, owner_id, mime, width, height, bytes(BLOB), created_at
```

### 调研足迹的配图

图片直接存 D1，不另接 R2：课程量级（几百张）、无需额外绑定与费用。代价与约定：

- 上传前在浏览器里压缩到长边 1600 的 WebP（`src/lib/image.js`），服务端再卡 1.5MB 硬上限。
  D1 单行上限 2MB，原图不压缩会直接写不进去。
- 只收 JPG / PNG / WebP，按文件头判类型，**不收 SVG**（能带脚本）。取图走
  `/api/survey-images/:id`，内容不可变，长缓存。
- 正文里用 `![图注](/api/survey-images/<id>)` 引用；保存时 `syncSurveyImages`
  把被引用的图挂到这条记录，已从正文删掉的图连带删除；传了却没保存的图，
  一天后由 `pruneOrphanImages` 清掉。

## 认证

- 复用 `polihot` 的邀请码体系：`PH-XXXX-XXXX` 风格改为本站前缀，全局唯一、一次性。
- 密码 PBKDF2 校验；会话存 KV，Cookie `HttpOnly` + `SameSite=Lax`。
- 用户名：字母数字，长度 ≥ 6。密码：8–18 位，含大写、小写、数字。
- 角色：`admin` / `teacher` / `student`。

### 邀请码与账号清理

- 邀请码只有活着的：未使用的可以删除（**硬删除**，库里不留行），已使用的保留作账号来历，
  删不了。早期版本的 `revoked_at` 软删除已经被废弃，`GET /api/admin/invites` 会顺手清掉残行。
- 批量生成前必须过一道确认窗（角色、数量、备注、是否导出），导出的是**这一批**的码表，
  不是整张列表——导出逻辑在 `src/pages/admin.js` 的 `exportInviteCsv`，只吃生成接口的返回值。
- 停用的账号在打开「用户管理」时自动清理，条件是**名下零内容**（没有案例、展位、留言、调研、
  批注，也没签发过邀请码）。有内容的停用账号永不自动删除，只在界面报数，
  清理规则集中在 `functions/lib/purge.js`。停用这个动作本身会连带出「可能被自动清理」的后果，
  所以停用按钮带确认窗，别把确认去掉。

## 部署

- GitHub Actions 在 `main` push 时触发：`npm ci` → `npm run build` → `wrangler pages deploy dist`。
- Pages 项目名 `innovation-localgov`，Functions 目录为仓库根 `functions/`。
- D1 绑定名 `DB`；KV 绑定名 `SESSIONS`。
- 必需 Secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`DEEPSEEK_API_KEY`、
  `AUTH_SECRET`、`SEARCH_API_KEY`（接入检索后）。

### 数据库迁移

跑 `wrangler d1 migrations apply --remote` 前先确认 `d1_migrations` 表和库里实际结构一致：

```bash
npx wrangler d1 execute innovation-localgov --remote --command "SELECT name FROM d1_migrations"
npx wrangler d1 execute innovation-localgov --remote --command "PRAGMA table_info(<表名>)"
```

**踩过的坑**：线上表结构是早先手工建的，`d1_migrations` 却是空的，于是 `migrations apply` 认为七条全没跑过，
从 `0001` 重头开始——前两条无害（`IF NOT EXISTS`、`ON CONFLICT`），到 `0003` 加 `district` 列时撞
`duplicate column name` 中断。更隐蔽的后果是 `0002_seed_admin.sql` 里有
`ON CONFLICT DO UPDATE SET password_hash = excluded.password_hash`，会把人已有账号的密码重置掉。

排查和补齐见 `scripts/repair-migrations-0003-0007.sql`：用 `CREATE TABLE IF NOT EXISTS` 补表、
手动 `ALTER TABLE` 补列，再把遗漏的版本号 `INSERT OR IGNORE` 进 `d1_migrations`。
新增迁移时，凡是 `ALTER TABLE ADD COLUMN`（SQLite 没有 IF NOT EXISTS），代码里都要留缺列降级，
并且**绝不能把「仅自己可见」这类隐私选项静默降级成公开**。
- 所有部署与 CI/CD 修改都需要用户先确认。

## 视觉

南开紫金纸本体系，与 `jinhuazhang.top` 保持一致：紫 `#7E0C6E` + 金 `#C4A265` + 纸 `#FDF8F0`。
完整规范见 `DESIGN.md`。
