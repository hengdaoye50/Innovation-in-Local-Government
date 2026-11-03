/** 教师后台 —— 案例审核、展位管理、文章发布、邀请码 */

// 角色在界面与导出表格里的中文名，邀请码与用户列表共用
const ROLE_LABEL = { student: "学生", teacher: "教师", observer: "观察员", admin: "管理员" };
import { esc, qs, qsa, toast, timeAgo, formatDate, zhWords, mountReveal } from "../lib/dom.js";
import { admin as adminApi, cases as casesApi, api } from "../lib/api.js";
import { getState } from "../lib/store.js";

const STATUS_LABEL = {
  pending: { text: "待质检", cls: "tag--warn" },
  published: { text: "已发布", cls: "tag--ok" },
  rejected: { text: "已退回", cls: "tag--quiet" },
  hidden: { text: "已下架", cls: "tag--quiet" },
};

const COURSES = ["地方政府创新", "公共政策分析"];
const TERMS = ["2026 秋", "2026 春", "2025 秋", "2025 春", "2024 秋", "2024 春"];

export function mountAdmin(root) {
  const { user, authChecked } = getState();

  if (!authChecked) {
    root.innerHTML = `<div class="shell detail__loading"><div class="skeleton" style="height:40px;width:40%"></div></div>`;
    setTimeout(() => mountAdmin(root), 280);
    return;
  }

  if (!user || (user.role !== "admin" && user.role !== "teacher")) {
    root.innerHTML = `
      <div class="shell shell-narrow admin-gate">
        <div class="screen-ordinal">受限</div>
        <h1 class="h2" style="margin:12px 0 16px">这里只对任课教师开放</h1>
        <p class="lede">请用教师账号登录后再进入。</p>
        <a class="btn btn--primary" href="#/login">去登录</a>
      </div>
    `;
    return;
  }

  root.innerHTML = `
    <div class="shell admin">
      <header class="admin__head">
        <div>
          <div class="screen-ordinal">05 / 管理</div>
          <h1 class="h2">教师后台</h1>
          <p class="lede">审核同学提交的案例，上传课堂展位与拓展材料，管理邀请码。</p>
        </div>
      </header>

      <div class="admin__tabs" role="tablist">
        <button class="admin__tab is-on" data-tab="stats" role="tab">数据</button>
        <button class="admin__tab" data-tab="cases" role="tab">案例审核</button>
        <button class="admin__tab" data-tab="slides" role="tab">展位管理</button>
        <button class="admin__tab" data-tab="posts" role="tab">拓展材料</button>
        <button class="admin__tab" data-tab="invites" role="tab">邀请码</button>
        ${user.role === "admin" ? `<button class="admin__tab" data-tab="users" role="tab">用户管理</button>` : ""}
      </div>

      <section class="admin__panel" data-panel="stats"></section>
      <section class="admin__panel" data-panel="cases" hidden></section>
      <section class="admin__panel" data-panel="slides" hidden></section>
      <section class="admin__panel" data-panel="posts" hidden></section>
      <section class="admin__panel" data-panel="invites" hidden></section>
      ${user.role === "admin" ? `<section class="admin__panel" data-panel="users" hidden></section>` : ""}
    </div>
  `;

  const panels = {
    stats: qs('[data-panel="stats"]', root),
    cases: qs('[data-panel="cases"]', root),
    slides: qs('[data-panel="slides"]', root),
    posts: qs('[data-panel="posts"]', root),
    invites: qs('[data-panel="invites"]', root),
  };
  if (user.role === "admin") panels.users = qs('[data-panel="users"]', root);

  const loaders = {
    stats: () => renderStats(panels.stats),
    cases: () => renderCases(panels.cases),
    slides: () => renderSlides(panels.slides),
    posts: () => renderPosts(panels.posts),
    invites: () => renderInvites(panels.invites, user),
  };
  if (panels.users) loaders.users = () => renderUsers(panels.users);

  qsa("[data-tab]", root).forEach((tab) => {
    tab.addEventListener("click", () => {
      const key = tab.dataset.tab;
      qsa("[data-tab]", root).forEach((t) => t.classList.toggle("is-on", t === tab));
      Object.entries(panels).forEach(([k, el]) => {
        el.hidden = k !== key;
      });
      loaders[key]?.();
    });
  });

  // 默认停在「数据」这一栏，先把它加载出来
  loaders.stats();
  mountReveal(root);
}

/* ————————— 案例审核 ————————— */

/* ————————— 数据面板 ————————— */

// 文献标题在本地 JSON 里，接口只回 id，这里补一下用于显示
const READING_TITLES = { "flyvbjerg-case-study": "案例研究的五个误解" };

async function renderStats(panel) {
  panel.innerHTML = `<div class="card"><div class="skeleton" style="height:120px"></div></div>`;

  let data = null;
  try {
    data = await api.get("/api/admin/stats");
  } catch (err) {
    panel.innerHTML = `<div class="card"><div class="empty">${esc(
      err.message || "读取失败"
    )}</div></div>`;
    return;
  }

  const { active, totals, trend, ranking, hasData } = data || {};
  // 趋势只补有访问的日子会只剩一两根柱，看着像图没画完。
  // 这里按最后一笔数据的日期往前铺满 14 天，没有访问的那天留空柱位。
  const trendMap = new Map((trend || []).map((d) => [d.day, d]));
  const anchor = (trend || []).length
    ? new Date(`${trend[trend.length - 1].day}T00:00:00`)
    : new Date();
  const trendDays = Array.from({ length: 14 }, (_, i) => {
    const day = new Date(anchor);
    day.setDate(anchor.getDate() - (13 - i));
    const key = formatDate(day);
    const hit = trendMap.get(key);
    return { day: key, views: hit?.views || 0, users: hit?.users || 0 };
  });
  const maxViews = Math.max(1, ...trendDays.map((d) => d.views));

  const rankBlock = (title, rows, type) => `
    <section class="card stats__rank">
      <header class="admin__panel-head">
        <h2 class="h3">${title}</h2>
        <span class="meta">按读过人数</span>
      </header>
      ${
        rows && rows.length
          ? `<ol class="stats__list">
              ${rows
                .map(
                  (r, i) => `
                <li>
                  <span class="stats__no mono">${String(i + 1).padStart(2, "0")}</span>
                  <span class="stats__name">${esc(
                    r.title ||
                      (type === "reading" ? READING_TITLES[r.id] || r.id : r.id)
                  )}</span>
                  <span class="stats__nums mono"><b>${r.views}</b> 人 · ${r.comments} 评</span>
                </li>`
                )
                .join("")}
            </ol>`
          : `<p class="empty">还没有浏览记录。</p>`
      }
    </section>`;

  panel.innerHTML = `
    ${
      hasData
        ? ""
        : `<div class="card stats__notice">
             <p class="field__hint" style="margin:0;line-height:1.8">
               访问记录从这次上线开始统计，所以现在还没有数据。等同学用起来，
               这里的活跃度和排行会自动出现。
             </p>
           </div>`
    }

    <div class="stats__grid">
      <section class="card stats__metrics">
        <div class="stats__metric">
          <span class="stats__value">${active?.today ?? 0}</span>
          <span class="stats__label">今日活跃</span>
        </div>
        <div class="stats__metric">
          <span class="stats__value">${active?.week ?? 0}</span>
          <span class="stats__label">近 7 天活跃</span>
        </div>
        <div class="stats__metric">
          <span class="stats__value">${active?.month ?? 0}</span>
          <span class="stats__label">近 30 天活跃</span>
        </div>
      </section>

      <section class="card stats__metrics">
        <div class="stats__metric">
          <span class="stats__value">${totals?.views ?? 0}</span>
          <span class="stats__label">累计浏览</span>
        </div>
        <div class="stats__metric">
          <span class="stats__value">${totals?.users ?? 0}</span>
          <span class="stats__label">账号</span>
        </div>
        <div class="stats__metric">
          <span class="stats__value">${totals?.cases ?? 0}</span>
          <span class="stats__label">已发布案例</span>
        </div>
        <div class="stats__metric">
          <span class="stats__value">${totals?.comments ?? 0}</span>
          <span class="stats__label">留言</span>
        </div>
      </section>
    </div>

    <section class="card stats__trend">
      <header class="admin__panel-head">
        <h2 class="h3">近两周</h2>
        <span class="meta">柱高为当日浏览，数字为当日活跃人数</span>
      </header>
      ${
        trendDays.length
          ? `<div class="stats__bars">
              ${trendDays
                .map(
                  (d, i) => `
                <div class="stats__bar-item" style="--i:${i}" title="${d.day}">
                  <span class="stats__bar-users mono">${d.users || ""}</span>
                  <div class="stats__bar" style="height:${
                    d.views ? Math.max(4, Math.round((d.views / maxViews) * 96)) : 0
                  }px"></div>
                  <span class="stats__bar-day mono">${d.day.slice(5)}</span>
                </div>`
                )
                .join("")}
            </div>`
          : `<p class="empty">近两周还没有访问。</p>`
      }
    </section>

    <div class="stats__ranks">
      ${rankBlock("案例", ranking?.case, "case")}
      ${rankBlock("课堂展位", ranking?.slide, "slide")}
      ${rankBlock("文献共读", ranking?.reading, "reading")}
    </div>
  `;
}

async function renderCases(panel) {
  panel.innerHTML = `
    <div class="admin__split">
      <div class="card admin__list-card">
        <header class="admin__panel-head">
          <h2 class="h3">案例队列</h2>
          <div class="admin__filters">
            ${["pending", "published", "rejected"]
              .map(
                (s) =>
                  `<button class="chip${s === "pending" ? " is-on" : ""}" data-filter="${s}">${
                    STATUS_LABEL[s].text
                  }</button>`
              )
              .join("")}
          </div>
        </header>
        <div class="admin__list" data-case-list>
          <div class="skeleton" style="height:80px"></div>
        </div>
      </div>

      <aside class="admin__side">
        <section class="card">
          <h2 class="h3" style="margin-bottom:12px">平台概况</h2>
          <dl class="admin__stats">
            <div><dt>已发布案例</dt><dd class="mono" data-stat="published">—</dd></div>
            <div><dt>待审核</dt><dd class="mono" data-stat="pending">—</dd></div>
            <div><dt>覆盖省份</dt><dd class="mono" data-stat="provinces">—</dd></div>
          </dl>
        </section>
      </aside>
    </div>
  `;

  let currentFilter = "pending";

  async function loadCases(filter = currentFilter) {
    const listEl = qs("[data-case-list]", panel);
    listEl.innerHTML = `<div class="skeleton" style="height:80px"></div>`;
    let items = [];
    try {
      const res = await casesApi.list({ status: filter, limit: 100 });
      items = Array.isArray(res?.items) ? res.items : [];
    } catch {
      items = [];
    }

    if (!items.length) {
      listEl.innerHTML = `<div class="empty">这个队列是空的。</div>`;
      return;
    }

    listEl.innerHTML = items
      .map((c, i) => {
        const st = STATUS_LABEL[c.status] || STATUS_LABEL.pending;
        return `
        <article class="admin__row">
          <span class="admin__row-no mono" aria-hidden="true">${String(i + 1).padStart(
            2,
            "0"
          )}</span>
          <div class="admin__row-main">
            <div class="admin__row-meta">
              <span class="tag ${st.cls}">${st.text}</span>
              <span class="meta">${[c.province, c.city, c.district]
                .filter((p, i, arr) => p && arr.indexOf(p) === i)
                .map(esc)
                .join(" · ")}</span>
              <span class="meta mono">${zhWords(c.body || c.summary || "")} 字</span>
              <span class="meta">${esc(timeAgo(c.createdAt))}</span>
            </div>
            <a class="admin__row-title" href="#/case/${esc(c.id)}">${esc(c.title)}</a>
            ${c.aiReview ? `<p class="admin__row-review">${esc(c.aiReview)}</p>` : ""}
          </div>
          <div class="admin__row-actions">
            ${
              c.status !== "published"
                ? `<button class="btn btn--ghost btn--sm" data-act="published" data-id="${esc(
                    c.id
                  )}">通过</button>`
                : ""
            }
            ${
              c.status !== "hidden"
                ? `<button class="btn btn--quiet btn--sm" data-act="hidden" data-id="${esc(
                    c.id
                  )}">下架</button>`
                : ""
            }
          </div>
        </article>`;
      })
      .join("");

    qsa("[data-act]", listEl).forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await casesApi.setStatus(btn.dataset.id, btn.dataset.act);
          toast(btn.dataset.act === "published" ? "已通过" : "已下架");
          loadCases();
        } catch (err) {
          toast(err.message || "操作失败", { type: "error" });
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  qsa("[data-filter]", panel).forEach((btn) => {
    btn.addEventListener("click", () => {
      qsa("[data-filter]", panel).forEach((b) => b.classList.toggle("is-on", b === btn));
      currentFilter = btn.dataset.filter;
      loadCases();
    });
  });

  loadCases();

  Promise.allSettled([
    casesApi.list({ status: "published", limit: 500 }),
    casesApi.list({ status: "pending", limit: 500 }),
  ]).then(([pub, pen]) => {
    const pubList = Array.isArray(pub.value?.items) ? pub.value.items : [];
    const penList = Array.isArray(pen.value?.items) ? pen.value.items : [];
    const set = (key, value) => {
      const node = qs(`[data-stat="${key}"]`, panel);
      if (node) node.textContent = String(value);
    };
    set("published", pubList.length);
    set("pending", penList.length);
    set("provinces", new Set(pubList.map((c) => c.province)).size);
  });
}

/* ————————— 展位管理 ————————— */

async function renderSlides(panel) {
  panel.innerHTML = `
    <div class="admin__split">
      <div class="card admin__form-card">
        <header class="admin__panel-head">
          <h2 class="h3">新增展位</h2>
        </header>
        <form class="admin__form" data-slide-form>
          <label class="field">
            <span class="field__label">展位标题</span>
            <input class="input" name="title" maxlength="80" placeholder="例如：『接诉即办』中的注意力分配" />
          </label>
          <div class="admin__form-row">
            <label class="field">
              <span class="field__label">课程</span>
              <select class="select" name="course">
                ${COURSES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}
              </select>
            </label>
            <label class="field">
              <span class="field__label">学期</span>
              <select class="select" name="term">
                ${TERMS.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("")}
              </select>
            </label>
          </div>
          <div class="admin__form-row">
            <label class="field">
              <span class="field__label">汇报小组 / 作者</span>
              <input class="input" name="author" maxlength="40" placeholder="第 3 组" />
            </label>
            <label class="field">
              <span class="field__label">页数</span>
              <input class="input" name="slides" type="number" min="0" max="200" placeholder="18" />
            </label>
          </div>
          <label class="field">
            <span class="field__label">演示文件（可选）</span>
            <input class="input admin__file" name="file" type="file" accept="application/pdf,.pdf" />
            <span class="field__hint">
              只收 <b>PDF</b>。PPT 请先在 PowerPoint 里「另存为 PDF」再上传——
              浏览器没法内嵌预览 pptx，转成 PDF 才能直接在展位里翻页。单份不超过 20MB。
            </span>
          </label>
          <label class="field">
            <span class="field__label">外部链接（可选）</span>
            <input class="input" name="fileUrl" placeholder="已经有在线文档链接时填这里，比如腾讯文档、飞书文档" />
          </label>
          <label class="field">
            <span class="field__label">描述</span>
            <textarea class="textarea" name="description" rows="4" placeholder="这次汇报想回答什么问题、用了什么材料、结论是什么。"></textarea>
          </label>
          <div class="field">
            <span class="field__label">可见范围</span>
            <div class="admin__choice">
              <label class="admin__choice-item">
                <input type="radio" name="visibility" value="public" checked />
                <span>
                  <b>所有人可见</b>
                  <i>展板、幻灯片、模型评语与教师纪要都对选课同学开放</i>
                </span>
              </label>
              <label class="admin__choice-item">
                <input type="radio" name="visibility" value="private" />
                <span>
                  <b>仅自己与管理员可见</b>
                  <i>不出现在展板上，只有上传者账号和管理员能打开</i>
                </span>
              </label>
            </div>
          </div>
          <div class="admin__form-actions">
            <span class="field__hint" data-slide-status></span>
            <button class="btn btn--primary" type="submit">发布展位</button>
          </div>
        </form>
      </div>

      <aside class="admin__side">
        <section class="card admin__list-card">
          <header class="admin__panel-head">
            <h2 class="h3">已有展位</h2>
          </header>
          <div class="admin__list" data-slide-list>
            <div class="skeleton" style="height:60px"></div>
          </div>
        </section>
      </aside>
    </div>
  `;

  const form = qs("[data-slide-form]", panel);
  const status = qs("[data-slide-status]", panel);

  async function loadList() {
    const listEl = qs("[data-slide-list]", panel);
    let items = [];
    try {
      const res = await api.get("/api/slides?limit=50");
      items = Array.isArray(res?.items) ? res.items : [];
    } catch {
      items = [];
    }
    if (!items.length) {
      listEl.innerHTML = `<div class="empty">还没有展位。</div>`;
      return;
    }
    listEl.innerHTML = items
      .map(
        (s) => `
      <article class="admin__row admin__row--tight">
        <div class="admin__row-main">
          <div class="admin__row-meta">
            <span class="tag tag--quiet">${esc(s.course || "课程汇报")}</span>
            <span class="meta">${esc(s.term || "")}</span>
            <span class="meta">${esc(s.author || "")}</span>
            ${
              s.visibility === "private"
                ? `<span class="tag tag--warn">仅自己可见</span>`
                : ""
            }
          </div>
          <a class="admin__row-title" href="#/slide/${esc(s.id)}">${esc(s.title)}</a>
        </div>
        <div class="admin__row-actions">
          <button class="btn btn--quiet btn--sm" type="button" data-review="${esc(s.id)}">
            ${s.aiReview ? "重新评语" : "生成评语"}
          </button>
        </div>
      </article>`
      )
      .join("");

    // 评语是异步生成的，直接写库建出来的展位会一直「待评」，这里给个手动补的入口
    listEl.querySelectorAll("[data-review]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "生成中…";
        try {
          await api.post(`/api/slides/${encodeURIComponent(btn.dataset.review)}/review`, {});
          toast("评语已生成");
          loadList();
        } catch (err) {
          toast(err.message || "生成失败", { type: "error" });
          btn.disabled = false;
          btn.textContent = "生成评语";
        }
      });
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fd = new FormData(form);
    const payload = {
      title: String(fd.get("title") || "").trim(),
      course: String(fd.get("course") || ""),
      term: String(fd.get("term") || ""),
      author: String(fd.get("author") || "").trim(),
      slides: Number(fd.get("slides")) || 0,
      fileUrl: String(fd.get("fileUrl") || "").trim(),
      description: String(fd.get("description") || "").trim(),
      visibility: fd.get("visibility") === "private" ? "private" : "public",
    };
    if (!payload.title) {
      status.textContent = "请填写展位标题";
      status.dataset.state = "err";
      return;
    }
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    status.textContent = "发布中…";
    status.dataset.state = "";
    try {
      const created = await api.post("/api/slides", payload);

      // 有文件就先建记录拿 id，再把 PDF 传上去；上传失败不影响展位本身
      const file = fd.get("file");
      if (file && file.size) {
        if (file.type && !file.type.includes("pdf")) {
          throw new Error("只收 PDF，请把 PPT 另存为 PDF 再上传");
        }
        status.textContent = "上传演示文件…";
        const res = await fetch(`/api/slides/${encodeURIComponent(created.id)}/file`, {
          method: "PUT",
          headers: { "Content-Type": "application/pdf" },
          credentials: "same-origin",
          body: file,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(
            `展位已发布，但文件没传上去：${data?.error?.message || data?.message || res.status}`
          );
        }
      }

      status.textContent = "已发布";
      status.dataset.state = "ok";
      form.reset();
      toast("展位已发布");
      loadList();
    } catch (err) {
      status.textContent = err.message || "发布失败";
      status.dataset.state = "err";
    } finally {
      btn.disabled = false;
    }
  });

  loadList();
}

/* ————————— 文章管理 ————————— */

async function renderPosts(panel) {
  panel.innerHTML = `
    <div class="admin__split">
      <div class="card admin__form-card">
        <header class="admin__panel-head">
          <h2 class="h3">发布拓展材料</h2>
        </header>
        <form class="admin__form" data-post-form>
          <label class="field">
            <span class="field__label">标题</span>
            <input class="input" name="title" maxlength="120" placeholder="文章或论文标题" />
          </label>
          <div class="admin__form-row">
            <label class="field">
              <span class="field__label">作者 / 来源</span>
              <input class="input" name="author" maxlength="40" placeholder="课程组" />
            </label>
            <label class="field">
              <span class="field__label">标签（逗号分隔，最多 5 个）</span>
              <input class="input" name="tags" placeholder="理论, 政策扩散" />
            </label>
          </div>
          <label class="field">
            <span class="field__label">原文链接（可选）</span>
            <input class="input" name="sourceUrl" placeholder="https://" />
          </label>
          <label class="field">
            <span class="field__label">摘要</span>
            <textarea class="textarea" name="excerpt" rows="2" placeholder="一两句话说明这篇材料解决什么问题，不填则自动截取正文。"></textarea>
          </label>
          <label class="field">
            <span class="field__label">正文（支持 Markdown）</span>
            <textarea class="textarea admin__md" name="body" rows="14" placeholder="## 小标题&#10;&#10;正文内容…"></textarea>
          </label>
          <div class="admin__form-actions">
            <span class="field__hint" data-post-status></span>
            <button class="btn btn--primary" type="submit">发布</button>
          </div>
        </form>
      </div>

      <aside class="admin__side">
        <section class="card admin__list-card">
          <header class="admin__panel-head">
            <h2 class="h3">已发布</h2>
          </header>
          <div class="admin__list" data-post-list>
            <div class="skeleton" style="height:60px"></div>
          </div>
        </section>
      </aside>
    </div>
  `;

  const form = qs("[data-post-form]", panel);
  const status = qs("[data-post-status]", panel);

  async function loadList() {
    const listEl = qs("[data-post-list]", panel);
    let items = [];
    try {
      const res = await api.get("/api/posts?limit=50");
      items = Array.isArray(res?.items) ? res.items : [];
    } catch {
      items = [];
    }
    if (!items.length) {
      listEl.innerHTML = `<div class="empty">还没有发布任何材料。</div>`;
      return;
    }
    listEl.innerHTML = items
      .map(
        (p) => `
      <article class="admin__row admin__row--tight">
        <div class="admin__row-main">
          <div class="admin__row-meta">
            ${(p.tags || []).map((t) => `<span class="tag tag--quiet">${esc(t)}</span>`).join("")}
            <span class="meta">${esc(timeAgo(p.publishedAt))}</span>
          </div>
          <a class="admin__row-title" href="#/post/${esc(p.id)}">${esc(p.title)}</a>
        </div>
      </article>`
      )
      .join("");
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fd = new FormData(form);
    const title = String(fd.get("title") || "").trim();
    const body = String(fd.get("body") || "").trim();
    if (!title) {
      status.textContent = "请填写标题";
      status.dataset.state = "err";
      return;
    }
    if (!body) {
      status.textContent = "正文不能为空";
      status.dataset.state = "err";
      return;
    }
    const tags = String(fd.get("tags") || "")
      .split(/[,，、\s]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 5);

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    status.textContent = "发布中…";
    status.dataset.state = "";
    try {
      await api.post("/api/posts", {
        title,
        author: String(fd.get("author") || "").trim(),
        tags,
        sourceUrl: String(fd.get("sourceUrl") || "").trim(),
        excerpt: String(fd.get("excerpt") || "").trim(),
        body,
      });
      status.textContent = "已发布";
      status.dataset.state = "ok";
      form.reset();
      toast("已发布到拓展材料");
      loadList();
    } catch (err) {
      status.textContent = err.message || "发布失败";
      status.dataset.state = "err";
    } finally {
      btn.disabled = false;
    }
  });

  loadList();
}

/* ————————— 邀请码 ————————— */

async function renderInvites(panel, me) {
  const isAdmin = me?.role === "admin";

  panel.innerHTML = `
    <div class="admin__split">
      <div class="card">
        <header class="admin__panel-head">
          <h2 class="h3">邀请码</h2>
        </header>

        <div class="invite-maker">
          <input
            class="input"
            data-invite-note
            maxlength="60"
            placeholder="备注（可选），比如「第 3 组」「行管 2201 班」"
          />
          <div class="invite-maker__row">
            <label class="invite-maker__count">
              <span class="field__label">数量</span>
              <input
                class="input"
                type="number"
                min="1"
                max="200"
                step="1"
                value="1"
                inputmode="numeric"
                data-invite-count
              />
            </label>
            <div class="invite-maker__actions">
              <button class="btn btn--primary btn--sm" data-new-invite="student">
                生成学生邀请码
              </button>
              <button class="btn btn--quiet btn--sm" data-new-invite="observer">
                生成观察员邀请码
              </button>
              ${
                isAdmin
                  ? `<button class="btn btn--gold btn--sm" data-new-invite="teacher">生成教师邀请码</button>`
                  : ""
              }
              <button class="btn btn--ghost btn--sm" data-export-invites type="button">
                导出表格
              </button>
            </div>
          </div>
        </div>

        <div class="admin__invites" data-invite-list>
          <div class="skeleton" style="height:60px"></div>
        </div>
      </div>

      <aside class="admin__side">
        <section class="card">
          <h2 class="h3" style="margin-bottom:12px">说明</h2>
          <p class="field__hint" style="line-height:1.8">
            邀请码 6 位、一次性。角色由邀请码决定——教师邀请码注册出来的账号
            直接拥有后台权限；<b>观察员</b>邀请码注册出来的账号只能浏览案例、展位与材料，
            不能提交作品、参与讨论，也不能用工作台。<br /><br />
            备注只给你自己看，用来记这个码给了谁。<b>作废</b>会让未使用的码立刻失效，
            已使用的码保留作账号来历，不能作废。<br /><br />
            给一个班发码时把<b>数量</b>改成人头数（一次最多 200），生成后点<b>导出表格</b>，
            导出的是当前这张列表，CSV 用 Excel 直接打开，备注列可以填班级或学号段。
            ${isAdmin ? "" : "<br /><br />你是教师角色，可以签发学生与观察员邀请码。"}
          </p>
        </section>
      </aside>
    </div>
  `;

  const listEl = qs("[data-invite-list]", panel);
  const noteInput = qs("[data-invite-note]", panel);
  const countInput = qs("[data-invite-count]", panel);
  /** 当前列表快照，导出表格时直接用它，不再请求一次 */
  let currentInvites = [];

  function statusOf(i) {
    if (i.revoked) return { text: "已作废", cls: "tag--quiet" };
    if (i.used) return { text: `已使用${i.usedBy ? " · " + i.usedBy : ""}`, cls: "tag--ok" };
    return { text: "未使用", cls: "" };
  }

  async function load() {
    let items = [];
    try {
      const res = await adminApi.invites();
      items = Array.isArray(res?.items) ? res.items : [];
    } catch (err) {
      listEl.innerHTML = `<div class="empty">${esc(err.message || "读取失败")}</div>`;
      return;
    }
    currentInvites = items;

    if (!items.length) {
      listEl.innerHTML = `<div class="empty">还没有生成邀请码。学生需要凭邀请码才能注册。</div>`;
      return;
    }

    listEl.innerHTML = items
      .map((i) => {
        const st = statusOf(i);
        const locked = i.used || i.revoked;
        return `
      <div class="invite-row${locked ? " is-locked" : ""}" data-code="${esc(i.code)}">
        <div class="invite-row__main">
          <code class="mono invite-row__code">${esc(i.code)}</code>
          <span class="tag tag--quiet">${ROLE_LABEL[i.role] || "学生"}</span>
          ${
            locked
              ? `<span class="meta">${esc(i.note || "无备注")}</span>`
              : `<input class="invite-note-input" data-note value="${esc(i.note || "")}"
                   maxlength="60" placeholder="加备注" />`
          }
        </div>
        <div class="invite-row__side">
          <span class="tag ${st.cls}">${st.text}</span>
          ${
            locked
              ? ""
              : `<button class="btn btn--quiet btn--sm" data-revoke>作废</button>`
          }
        </div>
      </div>`;
      })
      .join("");

    // 备注：失焦或回车时保存
    qsa("[data-note]", listEl).forEach((input) => {
      const save = async () => {
        const row = input.closest("[data-code]");
        const code = row.dataset.code;
        const note = input.value.trim();
        if (note === (input.dataset.saved || "")) return;
        try {
          await adminApi.setInviteNote(code, note);
          input.dataset.saved = note;
          toast("备注已保存");
        } catch (err) {
          toast(err.message || "保存失败", { type: "error" });
        }
      };
      input.dataset.saved = input.value;
      input.addEventListener("blur", save);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          input.blur();
        }
      });
    });

    // 作废
    qsa("[data-revoke]", listEl).forEach((btn) => {
      btn.addEventListener("click", async () => {
        const row = btn.closest("[data-code]");
        const code = row.dataset.code;
        if (!window.confirm(`作废邀请码 ${code}？作废后学生无法再用它注册。`)) return;
        btn.disabled = true;
        try {
          await adminApi.revokeInvite(code);
          toast("已作废");
          load();
        } catch (err) {
          toast(err.message || "作废失败", { type: "error" });
          btn.disabled = false;
        }
      });
    });
  }

  qsa("[data-new-invite]", panel).forEach((btn) => {
    btn.addEventListener("click", async () => {
      const role = btn.dataset.newInvite;
      const note = noteInput.value.trim();
      const count = Math.min(200, Math.max(1, Number(countInput?.value) || 1));
      btn.disabled = true;
      try {
        const res = await adminApi.createInvite(role, note, count);
        const label = ROLE_LABEL[role] || "学生";
        toast(
          count > 1
            ? `已生成 ${res?.count || count} 个${label}邀请码，记得导出表格`
            : `${label}邀请码 ${res?.code || ""} 已生成`
        );
        noteInput.value = "";
        load();
      } catch (err) {
        toast(err.message || "生成失败", { type: "error" });
      } finally {
        btn.disabled = false;
      }
    });
  });

  // 导出：CSV 带 BOM，Excel 双击打开不乱码；字段全部加引号，备注里有逗号也不会串列
  qs("[data-export-invites]", panel)?.addEventListener("click", () => {
    if (!currentInvites.length) {
      toast("还没有邀请码可以导出", { type: "error" });
      return;
    }
    const rows = [["邀请码", "角色", "备注", "状态", "使用者", "生成时间"]];
    for (const i of currentInvites) {
      const status = i.revoked ? "已作废" : i.used ? "已使用" : "未使用";
      rows.push([
        i.code,
        ROLE_LABEL[i.role] || "学生",
        i.note || "",
        status,
        i.usedBy || "",
        (i.createdAt || "").slice(0, 10),
      ]);
    }
    const csv =
      "\uFEFF" +
      rows
        .map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
        .join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `邀请码-${stamp}-${currentInvites.length}个.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`已导出 ${currentInvites.length} 个邀请码`);
  });

  load();
}

/* ————————— 用户管理（仅 admin） ————————— */

const ROLE_TEXT = ROLE_LABEL;

async function renderUsers(panel) {
  panel.innerHTML = `
    <div class="card">
      <header class="admin__panel-head">
        <h2 class="h3">账号</h2>
        <span class="meta" data-user-counts></span>
      </header>
      <div class="admin__list" data-user-list>
        <div class="skeleton" style="height:80px"></div>
      </div>
    </div>
  `;

  async function load() {
    const listEl = qs("[data-user-list]", panel);
    const countEl = qs("[data-user-counts]", panel);
    let data;
    try {
      data = await api.get("/api/admin/users");
    } catch (err) {
      listEl.innerHTML = `<div class="empty">${esc(err.message || "读取失败")}</div>`;
      return;
    }

    const items = data?.items || [];
    const counts = data?.counts || {};
    countEl.textContent = `管理员 ${counts.admins || 0} · 教师 ${counts.teachers || 0} · 学生 ${
      counts.students || 0
    } · 观察员 ${counts.observers || 0}`;

    if (!items.length) {
      listEl.innerHTML = `<div class="empty">还没有账号。</div>`;
      return;
    }

    listEl.innerHTML = items
      .map(
        (u) => `
      <article class="admin__row" data-user="${u.id}">
        <div class="admin__row-main">
          <div class="admin__row-meta">
            <span class="user-badge" data-role="${esc(u.role)}">${ROLE_TEXT[u.role] || u.role}</span>
            ${u.isSelf ? `<span class="tag tag--quiet">当前账号</span>` : ""}
            ${u.status === "disabled" ? `<span class="tag tag--warn">已停用</span>` : ""}
          </div>
          <div class="admin__row-title" style="cursor:default">${esc(u.displayName)}</div>
          <div class="meta">
            ${esc(u.username)} · 注册于 ${esc(formatDate(u.createdAt))}
            ${u.lastLoginAt ? ` · 最近登录 ${esc(timeAgo(u.lastLoginAt))}` : " · 从未登录"}
          </div>
        </div>
        <div class="admin__row-actions">
          <select class="select admin__role-select" data-role-select ${u.isSelf ? "disabled" : ""}>
            ${["student", "teacher", "admin"]
              .map(
                (r) =>
                  `<option value="${r}"${r === u.role ? " selected" : ""}>${ROLE_TEXT[r]}</option>`
              )
              .join("")}
          </select>
          ${
            u.isSelf
              ? ""
              : `<button class="btn ${u.status === "disabled" ? "btn--ghost" : "btn--quiet"} btn--sm" data-toggle-status data-status="${
                  u.status === "disabled" ? "active" : "disabled"
                }">${u.status === "disabled" ? "启用" : "停用"}</button>`
          }
        </div>
      </article>`
      )
      .join("");

    qsa("[data-role-select]", listEl).forEach((sel) => {
      sel.addEventListener("change", async () => {
        const row = sel.closest("[data-user]");
        const id = row.dataset.user;
        const role = sel.value;
        sel.disabled = true;
        try {
          await api.patch(`/api/admin/users/${id}`, { role });
          toast(`已改为${ROLE_TEXT[role]}`);
          load();
        } catch (err) {
          toast(err.message || "修改失败", { type: "error" });
          load();
        }
      });
    });

    qsa("[data-toggle-status]", listEl).forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.closest("[data-user]").dataset.user;
        const status = btn.dataset.status;
        btn.disabled = true;
        try {
          await api.patch(`/api/admin/users/${id}`, { status });
          toast(status === "disabled" ? "账号已停用" : "账号已启用");
          load();
        } catch (err) {
          toast(err.message || "操作失败", { type: "error" });
          btn.disabled = false;
        }
      });
    });
  }

  load();
}
