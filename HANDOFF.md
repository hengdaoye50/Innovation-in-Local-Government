# 交接文件 · HANDOFF.md

> 给下一位接手这个仓库的人/agent 看的。目标：读完这一份，能在半小时内把项目跑起来、知道哪些地方碰过、哪些坑别踩第二遍。
> 规范类文档（必须遵守）是 `CLAUDE.md`（工程约定）、`DESIGN.md`（视觉体系）、`PLAN.md`（架构与选型）。本文件只补充「当下状态 + 运行手册 + 踩过的坑 + 下一步」。
>
> 最后更新：2026-11-18 · 对应提交 `0eafef1`

---

## 1. 一页速览

| 项 | 值 |
| --- | --- |
| 线上站点 | <https://innovation.jinhuazhang.top>（Pages 默认域 `innovation-localgov.pages.dev` 同时可用） |
| 仓库 | `hengdaoye50/Innovation-in-Local-Government`，主分支 `main` |
| 当前提交 | `0eafef1`，工作区干净，与 `origin/main` 一致 |
| Cloudflare 账号 | `f759170b06c5d376c6fc3829c1b58cbe` |
| Pages 项目 | `innovation-localgov` |
| 绑定 | D1 `DB` → `innovation-localgov`；KV `SESSIONS`；R2 `FILES` → `innovation-works` |
| 前端 | Vite + 原生 ES 模块（无框架），手写 CSS，单页 hash 路由 |
| 后端 | Cloudflare Pages Functions（`functions/api/**`） |
| 数据 | D1（结构化）+ KV（会话、旧展位 PDF）+ R2（材料附件） |
| 模型 | DeepSeek 官方 API，`LLM_MODEL=deepseek-flash`，检索走同一家 `/v1/tools/search` |
| 部署 | push `main` → GitHub Actions → `wrangler pages deploy dist` |

三条命令（Windows PowerShell，项目根目录下）：

```powershell
npm run build                                                    # 必须通过才算改完
npx wrangler pages dev dist --port 8788 --ip 127.0.0.1           # 本地全栈（带 D1/KV/R2）
git push origin main                                             # 触发部署（需用户同意）
```

> 注意：`functions/` 不会被 `vite build` 打包，**改完后端也要重跑 build 再起 dev**，否则 `wrangler pages dev dist` 用的是旧 dist。本地调试时先 `npm run build`，再起 dev server。

---

## 2. 功能地图

八个学生端入口 + 一个教师后台。导航顺序：案例地图 / 协作工作台 / 课堂展示 / 材料提交 / 文献共读 / 调研足迹。

| 模块 | 路由 | 做什么 | 关键文件 | 主要表 |
| --- | --- | --- | --- | --- |
| 案例地图 | `#/`、`#/case/:id` | 首页首屏。SVG 浮雕中国地图 + 光点，点光点出浮卡，进案例详情 | `pages/atlas.js`、`components/map.js` | `cases` |
| 协作工作台 | `#/`（区块 `#studio`） | 与模型对话检索材料 → 右侧写 1000–1500 字梗概 → 提交（自动质检） | `pages/studio.js`、`api/chat/*`、`lib/review.js` | `cases` |
| 课堂展示 | `#/`（区块 `#slides`）、`#/slide/:id` | 展示墙：教师放上来的材料 + 历史展位，含投影模式与讨论 | `pages/slides.js`、`pages/detail.js` | `works`、`slides`、`comments` |
| 材料提交 | `#/works`、`#/works/new`、`#/works/:id`、`#/works/:id/edit` | 学生交案例报告/课件/读书报告/文献评析；教师批阅三档结论；择优上展示板 | `pages/works.js`、`pages/work-editor.js`、`api/works/*`、`lib/works.js` | `works`、`work_files` |
| 文献共读 | `#/`（区块 `#blog`）、`#/reading/:id` | 方法论文献：划线、边注、脉络图、讨论 | `pages/blog.js`、`pages/reading.js`、`api/readings/*` | `annotations`、`comments` |
| 调研足迹 | `#/`（区块 `#field`）、`#/field/:id`、`#/field/new`、`#/field/:id/edit` | 图文游记：Markdown 双栏编辑、压图上传、点图放大；作者与教师可改稿 | `pages/field.js`、`pages/survey.js`、`pages/survey-editor.js` | `surveys`、`survey_images` |
| 个人页 | `#/me` | 昵称、头像、改密码、我的作品/材料/调研 | `pages/me.js` | `users` |
| 教师后台 | `#/admin` | 数据看板、案例审核、材料批阅、展位管理、拓展材料、邀请码、用户管理 | `pages/admin.js`、`api/admin/*` | 全部 |
| 登录 | `#/login` | 登录 / 邀请码注册 | `pages/login.js`、`api/auth/*` | `users`、`invites` |

四个角色：`admin` / `teacher` / `student` / `observer`（观察员只读，写接口一律 403）。

---

## 3. 架构决定（为什么是这样）

细节见 `PLAN.md`，这里只记结论，避免下一个人推翻重来：

- **不上框架**：站点是「长页面 + 几处交互」，手写 DOM 比框架省心，且 Vite 只做打包不做运行时。
- **地图不用 echarts-gl**：ESM 下会引入第二份 echarts 实例，`registerMap` 落到另一个实例上报错，且已停更。改用 `d3-geo` 的 Albers 投影自绘 SVG，浮雕靠多层 path 偏移，体积从 1.6MB 降到百 KB 级。
- **坐标用本地索引**：`public/data/cities.json`（省/市/区三级 + 经纬度），不接地理编码服务，省 key 也省网络。
- **案例走 AI 质检，调研与材料不走**：案例要落地图，需要「是不是地方创新」的判据；游记和课程材料没有创新点可判，硬判只会把人逼成汇报腔。
- **材料附件存 R2、调研配图存 D1**：材料是课件/PDF，单份可到 10MB+，D1 单行上限 2MB 装不下；调研配图在浏览器里压到长边 1600 的 WebP（200–400KB），课程量级几百张，D1 够用且不用多一个绑定。
- **只收 Word 与 PDF（材料）**：站点不做格式转换。PDF 是唯一浏览器能内嵌翻页的格式，课件自己另存 PDF。
- **展位评语正向且不打分**（`lib/review.js` 的 `SLIDE_SYSTEM`）：分数会在班里排出高低，与「公开反馈」的目的相冲。材料批阅的「优秀/通过/退回」是教师给作者的结论，不公开展示。

---

## 4. 运行手册

### 4.1 本地起全栈

```powershell
npm install                       # 首次
npm run build
npx wrangler pages dev dist --port 8788 --ip 127.0.0.1
```

本地会模拟 D1/KV/R2（状态在 `.wrangler/state`，已 gitignore）。

**坑：不要同时开两个 `wrangler pages dev`。** 两个实例抢 8788 端口与同一个 state 目录时，服务会「Ready 但不响应」，表现为所有请求超时。排查与恢复：

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like "*wrangler*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Get-Process workerd -ErrorAction SilentlyContinue | Stop-Process -Force
```

### 4.2 造测试账号

`scripts/seed-admin.mjs` 只支持 admin/teacher 角色，密码哈希在本地算，明文不落盘：

```powershell
node scripts/seed-admin.mjs e2eadmin E2ePass1234 admin --out=.wrangler\seed.sql
npx wrangler d1 execute innovation-localgov --local --file=.wrangler\seed.sql
Remove-Item .wrangler\seed.sql
```

要 student / observer，复制已有账号的 `password_hash`（这样密码相同）再改角色：

```sql
INSERT INTO users (username, password_hash, display_name, role, status, created_at)
SELECT 'e2estudent', password_hash, '李小明', 'student', 'active', datetime('now')
FROM users WHERE username='e2eadmin';
```

**造数据时必须给 `cases.lng/lat` 赋值**，否则地图上不会出现光点（`renderNodes` 会跳过无坐标的节点），很容易误判成「地图坏了」。

### 4.3 写 SQL 文件的两个硬约束

1. **用 UTF-8 无 BOM 写文件**。PowerShell 5.1 的 `Out-File -Encoding UTF8` 会带 BOM，`wrangler d1 execute --file` 读到就报错：

```powershell
[System.IO.File]::WriteAllText("$PWD\.wrangler\seed.sql", $sql, (New-Object System.Text.UTF8Encoding($false)))
```

2. **SQL 里的换行要用 `char(10)` 拼**，别指望在 PowerShell 双引号里写 `\n`：

```sql
'第一段'||char(10)||char(10)||'第二段'
```

### 4.4 数据库迁移

迁移目录 `migrations/0001…0012`。**上线前必须先核对线下记账与线上真实结构**，这个坑已经踩过一次，详见 `CLAUDE.md`「数据库迁移」：

```powershell
npx wrangler d1 execute innovation-localgov --remote --command "SELECT name FROM d1_migrations ORDER BY name"
npx wrangler d1 execute innovation-localgov --remote --command "PRAGMA table_info(surveys)"
npx wrangler d1 migrations list innovation-localgov --remote
```

铁律：

- `ALTER TABLE ADD COLUMN` 在 SQLite 没有 `IF NOT EXISTS`，**重跑必炸**。记账缺失时不要盲目 `migrations apply`，按 `scripts/repair-migrations-0003-0007.sql` 的做法手工补表/补列，再 `INSERT OR IGNORE` 版本号。
- 凡是 `ALTER TABLE` 新增的列，代码里都要留**缺列降级**（现在 `users.avatar`、`invites.revoked_at`、`surveys.updated_at`、`slides.visibility` 都有降级）。
- 新增「挂在用户名下的表」时，同步把这张表加进 `functions/lib/purge.js` 的 owner 判据，否则停用账号会被硬删、记录成孤儿。

### 4.5 部署

push `main` 即触发 `.github/workflows/deploy.yml`（Node 22 → `npm ci` → build → 同步 Pages secrets → `pages deploy dist`）。

- **schema 变更不在 CI 里执行**，需要人工在本地跑 `--remote` 迁移，再 push 代码。
- Secrets（只在平台侧）：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`DEEPSEEK_API_KEY`、`AUTH_SECRET`、`SEARCH_API_KEY`，可选 `FIREWORKS_API_KEY`；变量 `LLM_PROVIDER`、`SEARCH_PROVIDER`。密钥不进代码、不进日志。
- 改 CI/CD、部署生产、`git push` 前必须拿到用户明确同意（`CLAUDE.md` 列为红线）。

### 4.6 核对线上绑定（不碰凭据）

CLI 不提供「查看 Pages 项目绑定」的命令，可以只读查 API。脚本读本机 wrangler 的登录凭据，token 不打印：

```python
# 见 git 历史或按需重写：GET /accounts/{account_id}/pages/projects/innovation-localgov
# 取 result.deployment_configs.production，看 r2_buckets / d1_databases / kv_namespaces
```

2026-11-18 实测结果：`r2_buckets = {"FILES": {"name": "innovation-works"}}`，D1/KV 均在。也就是说线上附件确实写 R2，不会退到 KV。

---

## 5. 验证状态

### 5.1 已经端到端走过（有实测记录）

| 范围 | 怎么验的 | 结论 |
| --- | --- | --- |
| 登录 / 邀请码注册 | API + 浏览器 | 正常；错误密码 401、限流按账号（第 11 次 429，别的账号仍可登录） |
| 地图交互 | 无头 Chrome 点击 / 键盘 | 点光点出浮卡 →「阅读完整案例」→ 详情；Enter 键同样可用；图层计数正确 |
| 案例详情 | 浏览器 | 正文 Markdown、来源、AI 评语、讨论区 |
| 学生写流程 | 浏览器 | 留言、改昵称（顶栏实时同步）、提交材料（PDF 上传→R2）、调研编辑器（省市区联动、双栏预览） |
| 教师流程 | 浏览器 + API | 批阅（PATCH → `reviewed` + 展出）、案例通过/下架、展位上传 PDF 并内嵌、邀请码批量生成 |
| 观察员 | API | 提交 / 留言均 403，顶栏显示「观察员」标记 |
| 材料全链路 | 浏览器 | 提交 → 待批阅 → 教师批阅 → 上展示板 → 学生看到评语；归档后改稿被拒（409） |
| Word 导入 | 浏览器 | 表格还原成 Markdown 表（含单元格内 `|` 转义）、图片丢弃并提示张数、标题自动填 |
| 全站链接 | 无头 Chrome 扫 17 个地址 | 区块锚点（`#studio` 等）、`#/xxx` 路由、404、空态都正常 |
| 导航跳转 | 无头 Chrome 轨迹采样 | 落点稳定 64px；重叠点击不再互相拉扯；用户中途接管不被拽回 |
| 手机 390px | 无头 Chrome | 登出可用、菜单点后收起、调研编辑器无横向溢出、触控热区 44px |
| R2 绑定 | Cloudflare API 只读查询 | `FILES → innovation-works` 已挂 |

### 5.2 没有验到的（下一位优先补）

- **AI 三条链路**：对话（`/api/chat`）、案例质检（`lib/review.js`）、文献脉络图（`/api/readings/:id/mindmap`）。本地没有 `DEEPSEEK_API_KEY`，接口会 503。线上 CI 会同步 secret，但需要用一个真实案例真跑一次才算验证。**这是目前最大的未验证面。**
- **后台批阅队列的「重试」按钮**：错误态 `errorBlock` 只做了代码级改动，没有构造失败场景实测。
- **缺列降级**：`users.avatar` / `invites.revoked_at` 的降级路径只读代码确认，没有真的删列试。
- **320px 最窄屏**：只测了 390px；320 下展位网格可能偏挤（实测未复现溢出）。
- **多个教师同时批阅、同一材料并发改稿**：没有做并发测试。

---

## 6. 踩过的坑（已修，但容易复发）

### 6.1 前端路由

- **裸锚点不是路由**。`#studio` / `#blog` 指首页区块而不是页面，直接让 `<a href="#studio">` 生效会把 hash 改成 `studio`，路由匹配不到就 404。所有这类链接必须带 `data-target`，由 `chrome.js` 的 document 级代理接管；`main.js` 里另注册了五个区块的兜底路由（`route("studio")` 与 `route("/studio")`）。
- 新增导航项若是**独立页面**，用 `data-route`（如「材料提交」→ `#/works`），不要用 `data-target`。

### 6.2 页内滚动

`lib/router.js` 的 `scrollToSection` 有三层保护，删任一层都会退回到「点了导航跳不准」：

1. 新的跳转先掐掉上一条（`activeJump`）——否则前一次的 280/640ms 定时器会把页面拽回旧目标，表现为连点两下页面来回抽。
2. 滚完用 `ResizeObserver` 跟随文档高度变化贴回目标。
3. 有位移的滚轮 / 触摸 / 翻页键立刻撒手，不跟用户抢。

### 6.3 移动端

- **账号槽位是隐藏的，登出别只放在里面**。`.nav__user-slot` 在 ≤1080px `display:none`，「登出」现在同时出现在手机菜单（`data-action="logout"`）。
- 菜单收起要三条路：hashchange、Esc、点外部。少一条就会出现「跳过去了但菜单还盖着新页面」。
- 固定顶栏 64px：所有吸顶元素（草稿面板、进度条、页内目录）都要避开它，`scroll-margin-top` 统一 88px。

### 6.4 数据与鉴权

- **凡是客户端回传 id 做回填的 UPDATE 都要带 owner 过滤**（`work_files`、`survey_images`）。附件 id 会随公开的 `?featured=1` 列表下发，不校验就等于谁都能把别人的附件挂到自己材料上。
- `purge.js` 的 owner 判据必须包含所有「挂在用户名下的表」，漏一张就是「停用即删人」。
- 非 `published` 的案例只给作者与教师看，其余一律 404（不要用 410，会泄露存在性）。
- 留言读写都要先校验目标可见性（`canTouchTarget`），否则私有展位能靠留言流反查。
- 状态机 `works`：`archived` 是终态，作者改稿不能复活；重交时撤结论与展出标记，但**保留评语**（学生正照着它改），前端标成「上一轮批阅意见」。
- 限流按**账号**，不按 IP——教室/校园网同出口 IP，按 IP 卡会把整班挡在门外。

### 6.5 工具链（踩过的哑巴亏）

- **PowerShell here-string 会吞掉 JS 模板字面量**。用 `@"…"@` 传含 `${esc(...)}` 的字符串给 `python -c` / `node -e` 时，`${}` 会被 PowerShell 当变量展开，写进文件就变成空。**含 `${}` 的脚本一律用 write 工具落成文件再执行**，不要 inline 传。
- 同样地，`content: "";` 这类 CSS 经过 `python -c` 也曾被截断成 `content: ";`，导致 esbuild 报 `Unterminated string token`。现在构建是干净的，若再出现这个警告，先搜 `content: ";`。
- Windows 换行：仓库里文件是 LF（Git 会在 checkout 时转 CRLF，`git diff` 会警告，属正常）。用字节级脚本改文件时注意别混入 CRLF。
- `gh` 偶发 TLS 握手超时（网络问题），重试即可；判断部署是否生效更可靠的办法是对比线上 bundle 哈希（`assets/index-*.js`）。

### 6.6 数据边界

- D1 单行上限 2MB → 调研配图必须在前端压到长边 1600 的 WebP，服务端再卡 1.5MB。
- 材料附件上限 20MB，只收 `.pdf` / `.docx` / `.doc`，**扩展名 + 文件头双检**（`verifyFileBytes`）。
- 坐标只收中国范围内（lng 73–136、lat 3–54），越界置 null。

---

## 7. 下一步（建议顺序）

1. **线上验一次 AI 全链路**（P0）：注册/借一个账号，在工作台提交一条真实案例，确认质检回写、状态自动转 `published`、地图出现光点；再打开一篇文献看脉络图是否生成。任何一环 503，先查 Pages secrets 是否同步（`wrangler pages secret list --project-name innovation-localgov`）。
2. **把 QA 脚本落进仓库**（P1）：这一轮的走查脚本都是临时写在 `%TEMP%` 的一次性文件（用 CDP 直连本机 Chrome，无 Playwright 依赖）。建议整理成 `scripts/qa/*.mjs` + 一个 `run-all`，覆盖：登录四角色、六个模块主流程、链接连通性、导航落点、390px 关键页。这样下一轮改动能一条命令回归。
3. **三条可忽略级小项**（P2）：320px 展位网格、缺 skip link、骨架屏圆角 2px 与圆角阶梯不一致。
4. **可能的功能缺口**（需要和用户确认优先级）：
   - 教师端批量操作（批量退回/批量上墙）与按学期导出成绩/提交名单——现在只能逐个点。
   - 缺交名单：系统没有「班级名单」概念，教师无法知道谁没交。
   - 批阅后的通知：现在没有邮件/站内提醒，学生只能自己回来看。
   - 学期归档：把上一学期的材料冻结成只读视图。

---

## 8. 新 harness 上手清单（照做即可）

1. 读 `CLAUDE.md` → `DESIGN.md` → `PLAN.md` → 本文件。
2. `git status` 确认干净，`git log -1` 对得上本文件顶部的提交号。
3. `npm install && npm run build`，起本地 dev server（4.1）。
4. 造一个 admin + 一个 student 账号（4.2），把六个模块各点一遍，确认本地能跑通。
5. 核对线上：`gh run list --limit 1` 应最近一次 success；对比线上 `assets/index-*.js` 与本地 `dist/` 的哈希前缀。
6. 核对绑定与 secrets（4.6）。
7. 读第 5.2 节，从「没验到的」里挑一件补掉——优先 AI 全链路。
8. 动任何东西之前：先读相关页面与 API 的引用关系，改完 `npm run build` + 本地实测，涉及 UI 的按 390px 也看一眼，再谈部署。

---

## 9. 附录

### 9.1 关键接口契约

统一响应：成功 `{ ok: true, data }`；失败 `{ ok: false, error, detail? }`，HTTP 状态码对语义。

```text
POST   /api/auth/login|register|logout        PATCH /api/auth/me
GET    /api/cases?limit=                      GET /api/cases/:id
POST   /api/cases                             PUT /api/cases/:id     PATCH /api/cases/:id（教师改状态）
POST   /api/chat                               POST /api/chat/extract
GET    /api/slides?limit=  /api/slides/mine   GET /api/slides/:id
POST   /api/slides（教师）                      PUT /api/slides/:id/file（PDF）
GET    /api/surveys?limit=|?mine=1            GET /api/surveys/:id
POST   /api/surveys                            PUT /api/surveys/:id    DELETE /api/surveys/:id
POST   /api/survey-images                      GET /api/survey-images/:id
GET    /api/works?mine=1|?queue=1|?featured=1 GET /api/works/:id
POST   /api/works                              PUT /api/works/:id      PATCH /api/works/:id（教师批阅）
DELETE /api/works/:id（撤回/归档）              POST /api/works/files   GET /api/works/files/:id
GET    /api/readings/:id/mindmap               GET|POST /api/readings/:id/annotations
GET|POST /api/comments                         POST /api/views
GET    /api/posts?limit=                       GET /api/posts/:id
GET    /api/admin/stats|users|invites          POST /api/admin/invites  DELETE /api/admin/invites/:code
```

### 9.2 数据模型要点

完整定义看 `migrations/`。容易出错的地方：

- `cases`：`status` ∈ pending / published / rejected / hidden；`ai_review`、`ai_score` 由质检写入。
- `surveys`：不跑质检；`updated_at` 只在真正编辑过之后才有值；`status` ∈ published / hidden。
- `works`：`status` ∈ submitted / returned / reviewed / archived；`verdict` ∈ excellent / pass / return；`comment_public` 控制评语是否随作品公开；`featured` 决定是否上展示板。
- `work_files`：`storage` 记 `r2` / `kv`（历史附件可能落在 KV，按此字段取），`work_id` 为空表示还没挂到材料上（24 小时后由 `pruneOrphanWorkFiles` 清理）。
- `survey_images`：BLOB 直接存 D1，`survey_id` 为空表示草稿图（一天后由 `pruneOrphanImages` 清理）。
- `comments`：`target_type` ∈ case / slide / post / reading / work；`author_role='ai'` 是模型评语，不进普通留言流。

### 9.3 前端代码地图

```text
src/main.js              路由表、页面挂载、访问埋点、启动流程
src/lib/router.js        hash 路由 + scrollToSection（含三层落点保护）
src/lib/dom.js           esc / el / toast / confirmDialog（焦点环 + aria）/ zhWords / 日期
src/lib/markdown.js      marked + DOMPurify；renderProse 把独占段落的图立成 figure
src/lib/docx.js          Word → Markdown（表格还原、图片丢弃计数）
src/lib/image.js         上传前压图（长边 1600，WebP 优先）
src/lib/api.js           所有请求都走这里；surveys / works / workFiles 等业务域
src/components/chrome.js 顶栏（含移动菜单、登出、区块跳转代理）与页脚
src/components/map.js    SVG 浮雕地图、光点、分析态、附图
src/styles/*.css         tokens → base → 各模块；touch.css 必须最后加载
```

### 9.4 服务端代码地图

```text
functions/api/**         每个目录一个资源；[[path]].js 是 catch-all 路由
functions/lib/http.js    ok / fail / readJson（带上限）/ rateLimit（内存桶）/ randomId
functions/lib/auth.js    会话（KV）、PBKDF2、角色判定、缺列降级
functions/lib/db.js      D1 访问层（cases / surveys / slides / posts / comments / 调研配图）
functions/lib/works.js   材料提交（works / work_files / 归属校验 / 孤儿清理）
functions/lib/blobstore.js R2 优先、KV 兜底；扩展名 + 文件头双检
functions/lib/review.js  案例质检与展位评语的提示词与解析
functions/lib/llm.js     DeepSeek / Fireworks 适配
functions/lib/purge.js   停用账号的「零内容」判据与清理
```

---

## 10. 与用户协作的方式（这一轮形成的习惯，建议沿用）

- **结论先行**，先给判断再给理由；不做铺垫，不夸想法好。
- 改动前说清要动哪里；**部署、迁移、推远端**这类不可逆或影响他人的动作必须先确认。
- 红线（必须问）：删文件、改密钥/CI、schema 变更、`git push`、生产部署、装全局依赖。
- 改完必须自证：`npm run build`、本地起服务实测、涉及 UI 的看 390px；只读代码没实测的，要在汇报里明说是代码级确认。
- 文案口吻：名词性标题 + 陈述句导语，不用第二人称劝服、不用破折号补语、不让模型自称「我」。改动文案时全站口径一起看（见提交 `8463a7a`）。
