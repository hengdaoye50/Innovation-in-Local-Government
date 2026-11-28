# 协作说明 · DeepSeek Harness 接管版

> 读者：接下来接管本仓库的新 harness（DeepSeek）。目标：读完这一份，知道**项目做到哪、代码长在哪、哪些东西在仓库里哪些只在本地、哪些红线不能碰**。
>
> 与既有文档的分工：`CLAUDE.md` = 工程约定（必须遵守）、`DESIGN.md` = 视觉体系、`PLAN.md` = 架构与选型理由、`HANDOFF.md` = 运行手册 + 踩过的坑（25KB，最详细）、`CHANGELOG.md` = 版本迭代脉络与清理记录。本文件是给新接管者的一页式状态快照与结构地图，**不重复 HANDOFF 的运行细节，只标出该去看哪一节**。
>
> 快照时间：2026-11-26 · 对应提交 `753b015`

---

## 1. 三句话结论

1. **代码、线上、文档三者一致，可以直接开工。** HEAD `753b015`，工作区干净，`npm run build` 通过；线上 `index.html` 引用的 `assets/index-B3rtXov7.js` 与本地构建产物同名，最近一次 Actions（`45806852616`）success，24 秒完成。`753b015` 只删调试脚本、加两份文档，运行时代码与线上那次部署完全相同。
2. **最大的未验证面是 AI 三条链路**（`/api/chat` 对话、`lib/review.js` 案例质检、`/api/readings/:id/mindmap` 脉络图）。本地没有 `DEEPSEEK_API_KEY`，调用一律 503；生产环境里这个密钥是有的（见 §5.3），所以线上大概率是可用的，但**没有任何一次真实跑通的记录**。接手第一件事就是把它验掉。
3. **所有不可逆动作都卡在用户手上**：schema 迁移、`git push`、生产部署、改 CI/密钥、删文件、装全局依赖。单 main 分支，push 即上线，没有 PR 与测试流水线兜底。

---

## 2. 项目在做什么

面向 MPA / 行政管理专业两门课的协作平台（《公共政策分析》《地方政府创新》）。学生从公开新闻里找地方政府创新实践，与大模型协同检索、核对事实，写 1000–1500 字案例梗概，提交后按发生地标在中国地图上。

线上站点 <https://innovation.jinhuazhang.top>（Pages 默认域 `innovation-localgov.pages.dev` 同时可用）。

功能地图与路由（八个学生端入口 + 教师后台）：

| 模块 | 路由 | 做什么 | 主要表 |
| --- | --- | --- | --- |
| 案例地图 | `#/`、`#/case/:id` | SVG 浮雕中国地图 + 光点，点开浮卡进详情 | `cases` |
| 协作工作台 | `#/` 区块 `#studio` | 与模型对话检索 → 右侧写梗概 → 提交并自动质检 | `cases` |
| 课堂展示 | `#/` 区块 `#slides`、`#/slide/:id` | 展位墙 + 投影模式 + 正向不打分的模型评语 | `works`、`slides`、`comments` |
| 材料提交 | `#/works`…`#/works/:id/edit` | 交案例报告/课件/读书报告；教师三档批阅；PDF 内嵌 + Word 转网页预览 | `works`、`work_files` |
| 文献共读 | `#/` 区块 `#blog`、`#/reading/:id` | 方法论文献的划线、边注、脉络图 | `annotations`、`comments` |
| 调研足迹 | `#/field`…`#/field/:id/edit` | 图文游记：Markdown 双栏编辑、压图上传；不跑模型质检 | `surveys`、`survey_images` |
| 个人页 / 强制改密 / 登录 | `#/me`、自动接管、`#/login` | 资料与作品；被重置密码的账号先落改密页 | `users`、`invites` |
| 教师后台 | `#/admin` | 看板、案例审核、材料批阅、展位管理、拓展材料、邀请码、用户管理 | 全部 |

四个角色：`admin` / `teacher` / `student` / `observer`（观察员只读，写接口 403，判定在 `functions/lib/auth.js:250`）。

---

## 3. 当前进度

### 3.1 已完成并端到端验过

登录与邀请码注册（限流按账号）、四角色权限、地图交互与键盘可达、案例详情、学生写作与提交全流程、教师批阅与展出、观察员 403、后台重置密码 + 强制改密闭环、附件 Word/PDF 在线预览、材料全链路（提交→批阅→上墙→学生看评语→归档后改稿 409）、Word 导入（表格还原成 Markdown、插图丢弃并报数）、全站 17 个地址连通性、导航落点、390px 移动端、R2 绑定已挂。

2026-11-28 新增「师生互联」：学生端 `#/connect`（一对一提问 + office hour 预约申请），教师端并进 `#/admin` 的同一页签。接口 36 项与页面走查在本地全栈通过；迁移 `0014_connect.sql` 本地已跑，**线上要先生效必须先在远端执行这条迁移**。

查验方式与逐项记录在 `HANDOFF.md` §5.1（表格，可直接复用）。

### 3.2 没验到的（接手优先做这几件）

| 优先级 | 事项 | 为什么重要 |
| --- | --- | --- |
| P0 | AI 三条链路真实跑一遍 | 全线唯一的黑盒：对话、案例质检回写 `published` + 地图落点、文献脉络图。任何一环 503 先查 `wrangler pages secret list --project-name innovation-localgov` |
| P1 | 后台批阅队列的「重试」按钮 | 只有代码级改动，没构造失败场景 |
| P1 | 缺列降级路径 | `users.avatar`、`users.must_change_password`、`invites.revoked_at`、`surveys.updated_at`、`slides.visibility` 五处只读代码确认 |
| P1 | 把 QA 脚本落进仓库 | 上一轮的走查脚本全在 `%TEMP%` 的一次性文件里（CDP 直连本机 Chrome）。建议整理成 `scripts/qa/*.mjs` + `run-all`，覆盖四角色登录、六模块主流程、链接连通、导航落点、390px |
| P2 | 320px 最窄屏、skip link、骨架屏圆角 2px | 三处可忽略级瑕疵 |
| P2 | 教师批量操作 / 缺交名单 / 批阅通知 / 学期归档 | 功能缺口，都没有「班级名单」概念，需用户定优先级再动 |

### 3.3 建议的第一步

先只读，不改代码：`npm install` → `npm run build` → 按 `HANDOFF.md` §4.2 造一个 admin 和一个 student → 起本地全栈把六个模块各点一遍 → 再按 §3.2 挑 P0 去线上验 AI。动手改任何东西之前，先读对应页面与 API 的引用关系。

---

## 4. 本地文件结构

### 4.1 被 git 追踪的部分（139 个文件）

```text
MPA课程AI辅学项目开发/
├── CLAUDE.md             19.8K  工程规范：技术选型、内容规则、数据模型、认证、部署、红线
├── DESIGN.md             13.6K  视觉规范：南开紫金纸本体系（紫 #7E0C6E / 金 #C4A265 / 纸 #FDF8F0）
├── PLAN.md                9.6K  架构方案与实施阶段，收录「为什么这么选」
├── HANDOFF.md            25.6K  运行手册、验证状态、踩过的坑、下一步 —— 接手必读
├── README.md              4.6K  对外说明与首次部署步骤（有若干与现状的出入，见 §6）
├── HANDOFF-DEEPSEEK.md          本文件
├── CHANGELOG.md          16K    版本迭代记录：11 个阶段的脉络、迁移对照表、清理与恢复方式
├── index.html             2.7K  单页入口
├── package.json          651   依赖：d3-geo / marked / dompurify / mammoth；dev: vite6 / wrangler4
├── package-lock.json     96.6K
├── vite.config.js        640   打包配置（markdown 单独分包）、dev 端口 5183、/api 代理到 8790
├── wrangler.toml         1.3K  Pages 项目名、D1/KV/R2 绑定、[vars] 里 LLM_MODEL 与 SEARCH_PROVIDER
├── .gitignore            316
├── .github/workflows/deploy.yml   2.2K  push main 即部署的完整流水线
├── src/                  47 个文件
│   ├── main.js           路由表、页面挂载、访问埋点、强制改密分流
│   ├── pages/            16 个页面：atlas / case / detail / studio / slides / blog / reading /
│   │                     field / survey / survey-editor / works / work-editor / me / login /
│   │                     password / admin，外加 connect（师生互联）
│   ├── components/       5 个：map（44.7K，SVG 浮雕地图）/ chrome（顶栏页脚）/ comments /
│   │                     doc-preview（PDF iframe + mammoth 转网页）/ dust（首屏尘粒，CLAUDE.md 未记录）
│   ├── lib/              9 个：api / router / store / dom / markdown / docx / image /
│   │                     avatar / courses（后两个 CLAUDE.md 未记录）
│   └── styles/           14 个：tokens → base → 各模块；connect.css 放师生互联与顶栏入口；touch.css 必须最后加载
├── functions/            34 个文件
│   ├── _middleware.js    全局闸口：强制改密未完成时只放行 me / password / logout
│   ├── api/              24 个：auth / cases / chat / slides / surveys / survey-images / works /
│   │                     readings / comments / views / posts / admin / questions / office-hours /
│   │                     connect（后台角标）
│   └── lib/              10 个：http / auth / db / works / blobstore / review / llm / search / purge /
│                         connect（师生互联的字段校验与时段防撞）
├── migrations/           13 个文件（git 只追踪 12 个，见下）
├── public/               14 个
│   ├── data/china.json   569K  省级 GeoJSON（DataV areas_v3，已修正环绕向）
│   ├── data/cities.json  354K  省/市/区三级坐标索引
│   ├── data/readings/    文献共读的语料与索引（flyvbjerg + index.json）
│   ├── fonts/            自托管拉丁标题字体
│   └── brand/ + favicon* 院徽源文件与全套站点图标
├── scripts/              13 个追踪文件（另有两个本地缓存目录已清理）
└── examples/             11 个：9 个案例样例（.md）+ sample-case.md / .docx
```

`scripts/` 里剩的都是可复用工具，按用途分三组：

- **数据与账号**：`build-cities.mjs`、`fix-geojson.mjs`、`seed-admin.mjs`、`seed-case.py`、`seed-slide.py`、`build-reading.py`、`repair-migrations-0003-0007.sql`。
- **开发期检查**：`shot.mjs`（CDP 截图）、`adminshot.mjs`（带登录态截后台）、`eval.mjs`（页面内执行 JS 打印结果）、`clicktest.mjs`（完整指针事件序列）、`wheeltest.mjs`（滚轮行为）、`check-fn-imports.mjs`（functions 导入自检）。
- 2026-11-26 已删掉 4 个针对线上 API 的一次性探测（`_fetchtst` / `_samplerun` / `_searchtest` / `_visiontest`），需要时用 `git show 7cdc36d:scripts/<name>.mjs` 取回。

`migrations/` 的坑：**`0002_seed_admin.sql` 在本地存在但被 `.gitignore` 排除**（里面是真实账号的密码哈希）。`git ls-files migrations` 只列 12 条，不要误以为仓库缺一版迁移。编号是 0001、0003…0013，中间那条永远只在本地。

### 4.2 只在本地、不在仓库的部分（可删可重建）

2026-11-26 做过一次清理，`screenshots/`、`scripts/.cache/`、`.wrangler/` 下的一次性调试残留（mock 日志、造数 SQL、测试课件、wrangler 临时打包）已删除，本地占用从 343 MB 降到 215 MB。明细与恢复方式见 `CHANGELOG.md` 第三节。

| 路径 | 大小 | 是什么 | 删除后果 |
| --- | --- | --- | --- |
| `node_modules/` | 194 MB / 2972 文件 | npm 依赖 | `npm ci` 重装 |
| `.wrangler/state/` | 12 MB | 本地 D1/KV/R2 状态与登录凭据 | **本地数据库与测试账号全丢**，需重新建表造号 |
| `dist/` | 2.1 MB / 20 文件 | 构建产物（gitignored） | `npm run build` 再生 |
| `.mimocode/`、`.dev.vars` 等 | 极小 | 各 harness 本地标记 / 密钥文件 | 无 |

本地剩下的 215 MB 里 194 MB 是依赖。**接手时不要把上面这些目录当成项目内容**，也不要提交。

---

## 5. GitHub 仓库结构

### 5.1 仓库本体

- 远程：`https://github.com/hengdaoye50/Innovation-in-Local-Government.git`
- 分支：单 `main`，139 个追踪文件，约 130 个提交（2026-10-22 起）。**没有 PR 流程、没有测试流水线、没有 develop/staging**。
- 追踪文件分布：`src` 45、`functions` 30、`public` 14、`scripts` 13、`migrations` 12、`examples` 11，其余是根目录文档、配置与 `index.html`。
- `.gitignore` 排除：`node_modules/`、`dist/`、`.wrangler/`、`.dev.vars`、`.env*`、`screenshots/`、`scripts/.cache/`、`migrations/0002_seed_admin.sql`、`*.log`、`.playwright-mcp/`、编辑器配置。
- 文件换行：仓库内是 LF，Windows checkout 转 CRLF，`git diff` 会警告，属正常现象。

提交信息风格（沿用，中文一句话说清做了什么）：`fix: …` / `change: …` / `docs: …`。例如 `fix: 登录限流改按账号、停用清理认材料、附件归属校验、归档不可复活`。

### 5.2 CI/CD

`.github/workflows/deploy.yml`，push `main` 或手动 dispatch 触发，Node 22：

```text
checkout → npm ci → npm run build → Sync Pages secrets → wrangler pages deploy dist
```

- **不含数据库迁移**（工作流注释里写明了原因：`ALTER TABLE` 不幂等，改表要人工确认）。schema 变更必须在本地 `--remote` 跑完再 push 代码。
- **不含任何测试**。唯一的自动闸口是 `npm run build` 能不能过。
- `Sync Pages secrets` 用 `put()` 判空跳过：值为空就跳过，**不会把生产上已配的密钥覆盖成空**。

### 5.3 线上资源与凭据现状（2026-11-26 实测）

| 项 | 值 |
| --- | --- |
| Cloudflare 账号 | `f759170b06c5d376c6fc3829c1b58cbe` |
| Pages 项目 | `innovation-localgov`，默认域 `innovation-localgov.pages.dev` |
| 自定义域 | `innovation.jinhuazhang.top` |
| D1 | 绑定 `DB` → `innovation-localgov`（`e2d2dffd-33f5-4c0f-b03f-917bbc234f8f`），12 张表 |
| KV | 绑定 `SESSIONS`（`5d5ae80ea4944ab7b54988ebf1cc850f`） |
| R2 | 绑定 `FILES` → `innovation-works`（缺失时 `blobstore.js` 自动退回 KV，总量 1GB 只够过渡） |
| 生产 Pages secrets | **只有 `DEEPSEEK_API_KEY` 一项** |
| GitHub Actions secrets | **只有 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`** |
| GitHub Actions variables | 空 |

由此可以推出三件事，接手时别误会：

1. **线上 AI 有密钥，但没被验过**。`DEEPSEEK_API_KEY` 是手工设在 Pages 上的；GitHub 里没有同名 secret，CI 的空值跳过逻辑保证它不会被冲掉。而 `AUTH_SECRET`、`SEARCH_API_KEY` 两地都没有——这没问题，`AUTH_SECRET` 在全仓代码里**没有任何引用**（只出现在 CI 的同步步骤与文档里，README 标为「预留」），会话靠 KV 里的随机 id；检索走 `SEARCH_PROVIDER=deepseek`（写在 `wrangler.toml` 的 `[vars]`），`search.js:34` 会用 `DEEPSEEK_API_KEY` 兜底，所以不需要单独的 `SEARCH_API_KEY`。
2. **模型锁定在 `deepseek-flash`**（`wrangler.toml` 的 `LLM_MODEL`）。API 的 model id 是 `deepseek-flash`，`DeepSeek-V4.1-Flash-1017` 只是版本名，填进 model 字段会报错。
3. **判断部署是否生效靠比对产物哈希**：本地 `dist/assets/index-*.js` 的文件名应与线上 `index.html` 里引用的一致。当前两边都是 `index-B3rtXov7.js`。

### 5.4 数据模型（12 张表，`migrations/` 为准）

`users`、`invites`、`cases`、`slides`、`posts`、`comments`、`annotations`、`views`、`surveys`、`survey_images`、`works`、`work_files`。

状态机与易错字段见 `HANDOFF.md` §9.2。两条最容易踩的：`works.archived` 是终态（作者改稿不能复活，只能新建）；`users.must_change_password=1` 时除认证三件套外全部接口 403。

> 注意 `CLAUDE.md` 的「数据模型」小节没列 `annotations`、`views`，也没提 `readings` 不是表（语料在 `public/data/readings/`，`annotations` 只存划线边注）。以迁移文件为准。

---

## 6. 已知的文档与现状出入（别被带偏）

| 位置 | 文档怎么说 | 实际是什么 |
| --- | --- | --- |
| `README.md` §6 | CI「应用 D1 迁移」 | CI **不跑迁移**，见 `deploy.yml` 注释；迁移人工 `--remote` 执行 |
| `README.md` / `vite.config.js` | 全栈端口 8790，dev 代理指向 8790 | `HANDOFF.md` 用 8788。两者都能用，但**只有 8790 能让 `npm run dev` 的 `/api` 代理通**；用 8788 时直接访问 wrangler 端口 |
| `README.md` / `PLAN.md` | 提到 Fireworks 与 `deepseek-chat` | 实际 `LLM_MODEL=deepseek-flash`，`llm.js` 有 preset 兜底，`LLM_PROVIDER` 可切换但非必需 |
| `CLAUDE.md` 认证节 | 角色三个 | 实际四个，含 `observer` |
| `CLAUDE.md` 目录约定 | 未记录 `src/components/dust.js`、`src/lib/avatar.js`、`src/lib/courses.js` | 三个文件都在用 |
| `HANDOFF.md` 抬头 | 「对应提交 `ea17ccf`」 | 略落后一个提交：`7cdc36d` 只改文档，代码与 `ea17ccf` 相同 |

改动这些文档不需要额外授权（属正常维护），但**改规范（`CLAUDE.md` / `DESIGN.md`）要先改文档再改实践**，别反过来。

---

## 7. 协作契约

### 7.1 红线：必须先问用户

- 删除文件、目录或 git 历史
- 修改 `.env`、密钥、token、CI/CD 配置
- 数据库 schema 变更或数据迁移
- `git push`、`git rebase`、`git reset --hard`、强制推送
- 安装全局依赖或修改系统配置
- 生产部署、公开发布

单 main 分支意味着**一次 push 就是一次上线**，没有回退演练的余地。用户的确认只对当次动作有效，不延续到下一次。

### 7.2 改完必须自证（当前步骤无法验证时，如实说「只做了代码级确认」）

1. `npm run build` 必须通过。当前基线：503 个模块，约 19 秒，**只有 3 条**「同时被动态与静态导入」的提示，没有警告级别的错误。
2. `functions/` 不进 `vite build` 的产物，**改后端也要重跑 build 再起 dev**，否则 `wrangler pages dev dist` 用的是旧 dist。
3. 涉及 UI 的改动在本地起全栈实测，并按 390px 看一眼（不要同时开两个 `wrangler pages dev`，两个实例抢端口会让服务「Ready 但不响应」，恢复命令见 `HANDOFF.md` §4.1）。
4. 涉及 API 的改动验证方法、错误响应与鉴权边界（403 / 404 / 409 的语义要分开）。

### 7.3 沟通与文案口径

- 结论先行，先给判断再给理由，不铺垫、不夸想法好、不用「这是个好问题」开头。方案有问题直接说。
- 改动前说清要动哪里；不可逆或影响他人的动作先确认。
- 站点文案：名词性标题 + 陈述句导语，不用第二人称劝服、不用破折号补语、不让模型自称「我」。改文案时全站口径一起看（参考提交 `8463a7a`）。
- 不提交 `node_modules/`、`dist/`、`.wrangler/`、`.dev.vars`、编辑器配置；密钥不进代码、不进 commit、不进日志。

### 7.4 前端/后端的架构约定（别推翻重来）

不引入 React/Vue；地图用 `d3-geo` 自绘 SVG 而不是 echarts-gl；案例跑 AI 质检、调研与材料不跑；材料附件存 R2、调研配图压成 WebP 存 D1；材料只收 Word 与 PDF。每条的理由都在 `HANDOFF.md` §3。

---

## 8. 上手清单（照做即可）

1. 读 `CLAUDE.md` → `DESIGN.md` → `PLAN.md` → `HANDOFF.md` → 本文件；想知道「每一轮改了什么」再读 `CHANGELOG.md`。
2. `git status` 应干净，`git log -1` 不应早于交接清理提交 `753b015`。
3. `npm install && npm run build`；起全栈：`npx wrangler pages dev dist --port 8790 --ip 127.0.0.1`。
4. 造 admin + student（`HANDOFF.md` §4.2；注意 `cases.lng/lat` 必须赋值，否则地图上不出光点），六模块各点一遍。
5. 核对线上：`gh run list --limit 1` 应为 success；比对 `dist/assets/index-*.js` 与线上引用；`npx wrangler pages secret list --project-name innovation-localgov` 应至少看到 `DEEPSEEK_API_KEY`。
6. 从 §3.2 挑 P0（AI 全链路）补掉，再谈下一步功能。

---

## 9. 给新 harness 的两条工具链提醒

- **PowerShell 5.1 的 here-string 会吞掉 JS 模板字面量**。用 `@"…"@` 把含 `${esc(...)}` 的字符串传给 `node -e` / `python -c` 时，`${}` 会被当变量展开，写进文件就变空；同理 `content: "";` 曾被截断成 `content: ";` 导致 esbuild 报 `Unterminated string token`。**含 `${}` 的脚本一律落成文件再执行**，不要 inline 传。
- **写 SQL 文件**：必须 UTF-8 无 BOM（PowerShell 的 `Out-File -Encoding UTF8` 会带 BOM，`wrangler d1 execute --file` 直接报错）；SQL 里的换行用 `char(10)` 拼，别指望双引号里写 `\n`。两段的完整写法在 `HANDOFF.md` §4.3。

> 若新 harness 按约定读 `AGENTS.md` 而非 `CLAUDE.md`，建议加一个只含一行指向 `CLAUDE.md` 的 `AGENTS.md`，避免规范被两处维护。
