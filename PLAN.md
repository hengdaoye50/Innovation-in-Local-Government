# 实施方案 · PLAN.md

## 1. 架构总览

```text
浏览器（Vite 构建的静态前端）
  ├─ 地图屏    ECharts + echarts-gl 3D 中国地图
  ├─ 工作台    对话流 + 梗概编辑器
  ├─ 展示板    PPT 展位 + AI 评语 + 讨论
  └─ 博客屏    文章卡片流 + 阅读页
        │  fetch
        ▼
Cloudflare Pages Functions（functions/api/**）
  ├─ /api/auth      邀请码注册、登录、会话
  ├─ /api/chat      对话（模型 + 检索编排）
  ├─ /api/cases     案例列表 / 详情 / 提交 / 质检
  ├─ /api/slides    展位列表 / 详情
  ├─ /api/comments  留言与 AI 评语
  ├─ /api/posts     博客文章
  └─ /api/admin     审核、下架、邀请码、展位管理
        │
        ├─ D1（DB）        结构化数据
        ├─ KV（SESSIONS）  会话
        ├─ Fireworks       模型推理
        └─ 检索服务        SEARCH_API_KEY（待接入）
```

前端不持有任何密钥。所有模型与检索调用都在 Functions 内完成，前端只拿最终文本。

## 2. 关键选型与理由

### 2.1 前端不用框架

地图、对话、列表页的交互复杂度中等，但状态几乎不跨屏共享。用原生 ES 模块 + 手写路由（hash 路由）能少一层抽象，代码对学生也更可读；Vite 只负责打包 ECharts、marked、mammoth 这几个依赖和产物压缩。

### 2.2 中国地图用 echarts-gl 的 map3D

`map3D` 提供真正的立体挤出（省份面按 `regionHeight` 抬起）、可旋转缩放视角、内置光照，比「SVG 多层偏移伪造厚度」的观感高一个档次，且事件体系（region 点击、tooltip）成熟。代价是包体积：ECharts + echarts-gl 压缩后约 400KB，用懒加载只在首屏地图初始化时引入，其余页面不受影响。

地图数据本地化为 `public/data/china.json`（省级 GeoJSON），不依赖任何 CDN，避免境内加载失败。

### 2.3 坐标定位用本地城市索引，不调用地理编码服务

`public/data/cities.json` 收录省 + 地级市的经纬度。AI 在对话收敛时输出结构化字段（省、市、区县），前端查表得到 `lng/lat`；查不到时退化为省级中心点并在地图上以「省域级」样式标注。省掉一个外部依赖和一类失败模式。

### 2.4 数据用 D1 而不是 KV

作品要按省份分组、按时间排序、按领域筛选、按标题搜索，并统计覆盖省份数——这些都是关系查询。polihot 用 KV 是因为它只存整块 JSON；本站的数据形态不适合。会话仍放 KV（读写频繁、结构简单、无查询需求）。

### 2.5 检索留给可插拔接口

模型本身不联网。检索走独立服务，在 `functions/lib/search.js` 里做一层适配：

```js
// provider: 'tavily' | 'serper' | 'brave' | 'none'
export async function search(env, query, { limit = 15 }) { ... }
```

- 统一返回 `[{ title, url, snippet, published_at }]`，`limit` 硬上限 15。
- 结果先去重（同域名 + 相似标题）再截断，避免 15 条链接全是同一篇稿子的转载。
- `provider = 'none'` 时对话照常工作，只用模型知识 + 用户粘贴的原文，并在界面明示「当前未接入检索」。
- 拿到 `SEARCH_API_KEY` 后只改环境变量，不动业务代码。

### 2.6 提交后自动质检

提交 → `pending` → 一次模型调用做结构化检查（字数区间、是否含明确地点与主体、是否为第三人称叙述、链接数与可达性、是否为照搬新闻的复制粘贴）→ 通过则 `published`，不通过则 `rejected` 并回传具体缺失项，学生可改后重提。教师可推翻任一结果。

## 3. API 契约

```text
POST   /api/auth/register      { username, password, invite }        → 会话
POST   /api/auth/login         { username, password }                → 会话
POST   /api/auth/logout
GET    /api/auth/me

POST   /api/chat               { messages, mode, depth }             → SSE 流式文本
POST   /api/chat/extract       { transcript }                        → 结构化案例字段

GET    /api/cases              ?province=&domain=&q=&page=           → 列表
GET    /api/cases/:id                                                → 详情
POST   /api/cases              { title, province, city, body, sources, tags }
PATCH  /api/cases/:id          { status }                            （教师）

GET    /api/slides             ?course=&term=
GET    /api/slides/:id
POST   /api/slides                                                   （教师/助教）

GET    /api/comments           ?target_type=&target_id=
POST   /api/comments           { target_type, target_id, body }

GET    /api/posts              ?tag=&page=
GET    /api/posts/:id

POST   /api/admin/invites      → 新邀请码
PATCH  /api/admin/cases/:id    { status }
```

统一响应：成功 `{ ok: true, data }`；失败 `{ ok: false, error, detail? }`，HTTP 状态码对语义。
所有写接口校验会话、角色和请求体大小；`/api/chat` 按 IP 做速率限制。

## 4. 实施阶段

| 阶段 | 内容 | 产出 |
| --- | --- | --- |
| P0 | 规范与骨架 | `CLAUDE.md`、`DESIGN.md`、`PLAN.md`、Vite 工程、设计令牌、通用组件 |
| P1 | 地图屏 | 示例数据驱动的地图 + 节点 + 详情页，先跑通视觉与交互 |
| P2 | 数据层与 API | D1 schema、auth、cases 读写、本地起 `wrangler pages dev` |
| P3 | 工作台 | 对话流、检索适配、梗概编辑器、结构化抽取、提交 |
| P4 | 展示板与博客 | PPT 展位、AI 评语、讨论、文章流 |
| P5 | 后台与质检 | 邀请码、审核/下架、自动质检 |
| P6 | 联调与验收 | 全流程走查、移动端、错误态、空态 |
| P7 | 上线 | Cloudflare Pages 项目、D1、Secrets、GitHub Actions、仓库推送 |

P1 用本地示例数据先把视觉做对，再接真实数据——避免数据层问题掩盖设计问题。

## 5. 待确认项

1. **线上域名**：需要确定独立域名或子域名（例如 `innovation.jinhuazhang.top`）。在 P7 之前给到即可。
2. **检索服务**：确定用哪家（Tavily / Serper / Brave / 其他），拿到 key 后接入。未接入前以 `provider = 'none'` 运行。
3. **站点名称**：当前文档用「地方政府创新案例库」，可改。
4. **初始教师账号**：需要设定一个管理员用户名，首次访问时种子写入。
5. **PPT 存储**：展位是存 PPT 文件本身（需 R2 或外链），还是只存封面图 + 外部链接？默认按「封面图 + 外链或 PDF 首屏」处理，若需完整 PPT 播放则加 R2。

## 6. 风险与对应

| 风险 | 对应 |
| --- | --- |
| echarts-gl 体积影响首屏 | 地图模块动态 `import()`，独立 chunk；先渲染骨架屏 |
| 地图 GeoJSON 精度过高导致卡顿 | 用简化版省级数据（目标 < 400KB），必要时按需加载市级 |
| 模型把新闻稿原样复述 | 质检环节做重复度检查；提示词约束第三人称与要素提炼 |
| 学生刷提交 | 每账号每日提交上限，AI 质检 + 教师下架双保险 |
| 检索结果质量差 | 域名白名单优先（政府网站、央媒、学界），去重要在截断之前 |
