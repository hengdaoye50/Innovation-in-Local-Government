/** 教师后台 —— 案例审核、展位管理、文章发布、邀请码 */
import { esc, qs, qsa, toast, timeAgo, formatDate, zhWords, mountReveal, confirmDialog } from "../lib/dom.js";
import { admin as adminApi, cases as casesApi, api, works as worksApi, workFiles } from "../lib/api.js";
import { getState, ROLE_LABEL } from "../lib/store.js";
import { COURSES, TERMS, WORK_KINDS } from "../lib/courses.js";

const STATUS_LABEL = {
  pending: { text: "待质检", cls: "tag--warn" },
  published: { text: "已发布", cls: "tag--ok" },
  rejected: { text: "已退回", cls: "tag--quiet" },
  hidden: { text: "已下架", cls: "tag--quiet" },
};

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
        <button class="admin__tab" data-tab="works" role="tab">材料批阅</button>
        <button class="admin__tab" data-tab="slides" role="tab">展位管理</button>
        <button class="admin__tab" data-tab="posts" role="tab">拓展材料</button>
        <button class="admin__tab" data-tab="invites" role="tab">邀请码</button>
        ${user.role === "admin" ? `<button class="admin__tab" data-tab="users" role="tab">用户管理</button>` : ""}
      </div>

      <section class="admin__panel" data-panel="stats"></section>
      <section class="admin__panel" data-panel="cases" hidden></section>
      <section class="admin__panel" data-panel="works" hidden></section>
      <section class="admin__panel" data-panel="slides" hidden></section>
      <section class="admin__panel" data-panel="posts" hidden></section>
      <section class="admin__panel" data-panel="invites" hidden></section>
      ${user.role === "admin" ? `<section class="admin__panel" data-panel="users" hidden></section>` : ""}
    </div>
  `;

  const panels = {
    stats: qs('[data-panel="stats"]', root),
    cases: qs('[data-panel="cases"]', root),
    works: qs('[data-panel="works"]', root),
    slides: qs('[data-panel="slides"]', root),
    posts: qs('[data-panel="posts"]', root),
    invites: qs('[data-panel="invites"]', root),
  };
  if (user.role === "admin") panels.users = qs('[data-panel="users"]', root);

  const loaders = {
    stats: () => renderStats(panels.stats),
    cases: () => renderCases(panels.cases),
    works: () => renderWorksQueue(panels.works),
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
            只收 <b>PDF</b>。PPT 需先在 PowerPoint 里另存为 PDF 再上传：浏览器无法内嵌预览 pptx，
            转为 PDF 才能翻页。单份不超过 20MB。
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
          ${
            isAdmin
              ? `<button class="btn btn--quiet btn--sm" data-purge type="button">清理停用账号</button>`
              : ""
          }
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
            <label class="invite-export">
              <input type="checkbox" data-invite-export checked />
              <span>生成后导出这一批表格</span>
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
                  ? `<button class="btn btn--gold btn--sm" data-new-invite="teacher">生成教师邀请码</button>
                     <button class="btn btn--gold btn--sm" data-new-invite="admin">生成管理员邀请码</button>`
                  : ""
              }
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
            直接拥有后台权限；<b>管理员</b>邀请码开出的账号权限最高，可以管理账号、签发教师码；
            <b>观察员</b>邀请码注册出来的账号只能浏览案例、展位与材料，
            不能提交作品、参与讨论，也不能用工作台。<br /><br />
            备注只给你自己看，用来记这个码给了谁。生成前会弹一次确认，
            里面写清角色、数量与备注，点错了可以取消。<b>删除</b>会让未使用的码立刻消失，
            已使用的码保留作账号来历，不能删。<br /><br />
            给一个班发码时把<b>数量</b>改成人头数（一次最多 200），
            勾上<b>生成后导出这一批表格</b>，生成完直接下载这一次的码表，CSV 用 Excel 直接打开。<br /><br />
            列表里只留还能用的码和已用的码；<b>停用的空账号</b>（名下没有案例、展位、留言）
            会在打开这一页或「用户管理」时自动清掉，有作品的停用账号会保留。
            ${isAdmin ? "" : "<br /><br />你是教师角色，可以签发学生与观察员邀请码。"}
          </p>
        </section>
      </aside>
    </div>
  `;

  const listEl = qs("[data-invite-list]", panel);
  const noteInput = qs("[data-invite-note]", panel);
  const countInput = qs("[data-invite-count]", panel);
  const exportInput = qs("[data-invite-export]", panel);

  function statusOf(i) {
    if (i.used) return { text: `已使用${i.usedBy ? " · " + i.usedBy : ""}`, cls: "tag--ok" };
    return { text: "未使用", cls: "" };
  }

  async function load() {
    let items = [];
    try {
      const res = await adminApi.invites();
      items = Array.isArray(res?.items) ? res.items : [];
      if (res?.purged?.invites) {
        toast(`已清理 ${res.purged.invites} 个历史作废邀请码`);
      }
    } catch (err) {
      listEl.innerHTML = `<div class="empty">${esc(err.message || "读取失败")}</div>`;
      return;
    }

    if (!items.length) {
      listEl.innerHTML = `<div class="empty">还没有生成邀请码。学生需要凭邀请码才能注册。</div>`;
      return;
    }

    listEl.innerHTML = items
      .map((i) => {
        const st = statusOf(i);
        const locked = i.used;
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
              : `<button class="btn btn--quiet btn--sm" data-revoke>删除</button>`
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

    // 删除：直接把这个码从库里去掉，列表里不留「已作废」的残行
    qsa("[data-revoke]", listEl).forEach((btn) => {
      btn.addEventListener("click", async () => {
        const row = btn.closest("[data-code]");
        const code = row.dataset.code;
        const confirmed = await confirmDialog({
          title: `删除邀请码 ${code}？`,
          html: `<p>删除后学生无法再用它注册，这个码也不会再出现在这张列表里。
                 已经用掉的码不会出现在这里——它已经是某个账号的来历，不能删。</p>`,
          confirmText: "删除",
          danger: true,
        });
        if (!confirmed) return;
        btn.disabled = true;
        try {
          await adminApi.deleteInvite(code);
          toast(`邀请码 ${code} 已删除`);
          load();
        } catch (err) {
          toast(err.message || "删除失败", { type: "error" });
          btn.disabled = false;
        }
      });
    });
  }

  // 生成：先弹确认窗，把角色 / 数量 / 备注 / 是否导出摆清楚，避免手滑点成另一种码
  qsa("[data-new-invite]", panel).forEach((btn) => {
    btn.addEventListener("click", async () => {
      const role = btn.dataset.newInvite;
      const label = ROLE_LABEL[role] || "学生";
      const note = noteInput.value.trim();
      const count = Math.min(200, Math.max(1, Number(countInput?.value) || 1));
      const withExport = Boolean(exportInput?.checked);

      const confirmed = await confirmDialog({
        title: `生成 ${count} 个${label}邀请码？`,
        html: `
          <dl class="dialog__facts">
            <div><dt>角色</dt><dd>${esc(label)}${
              role === "teacher"
                ? " · 注册即拥有后台权限"
                : role === "admin"
                  ? " · 注册即拥有全部后台权限"
                  : ""
            }</dd></div>
            <div><dt>数量</dt><dd>${count} 个</dd></div>
            <div><dt>备注</dt><dd>${note ? esc(note) : "（未填）"}</dd></div>
            <div><dt>导出</dt><dd>${
              withExport ? `生成后导出这 ${count} 个码的表格` : "不导出表格"
            }</dd></div>
          </dl>
          ${role === "teacher" ? `<p style="margin-top:12px">教师邀请码会直接开出后台账号，请确认要发给谁。</p>` : ""}
          ${role === "admin" ? `<p style="margin-top:12px">管理员邀请码开出的账号能改别人的角色、签发教师码，权限最高。只发给你完全信任的人。</p>` : ""}
        `,
        confirmText: `确认生成 ${count} 个`,
        cancelText: "取消",
      });
      if (!confirmed) return;

      btn.disabled = true;
      try {
        const res = await adminApi.createInvite(role, note, count);
        const items = Array.isArray(res?.items) && res.items.length
          ? res.items
          : res?.code
            ? [{ code: res.code, role, note, createdAt: res.createdAt }]
            : [];

        if (withExport && items.length) {
          exportInviteCsv(items);
          toast(`已生成 ${items.length} 个${label}邀请码，表格已下载`);
        } else {
          toast(
            count > 1
              ? `已生成 ${res?.count || count} 个${label}邀请码`
              : `${label}邀请码 ${res?.code || ""} 已生成`
          );
        }
        noteInput.value = "";
        load();
      } catch (err) {
        toast(err.message || "生成失败", { type: "error" });
      } finally {
        btn.disabled = false;
      }
    });
  });

  // 清理：作废码早已即删，这里主要收拾停用的空账号 + 早期软删除留下的残行
  qs("[data-purge]", panel)?.addEventListener("click", async () => {
    const confirmed = await confirmDialog({
      title: "清理停用账号？",
      html: `<p>会删除<b>已停用、且名下没有任何内容</b>的账号（没有案例、展位、留言、调研、批注），
             顺手清掉历史作废的邀请码。</p>
             <p style="margin-top:10px">名下有作品的停用账号会保留。删掉的账号无法恢复，
             想留着以后启用的账号请先别停用。</p>`,
      confirmText: "清理",
      danger: true,
    });
    if (!confirmed) return;
    try {
      const res = await adminApi.purge();
      const parts = [];
      if (res?.users) parts.push(`${res.users} 个停用账号`);
      if (res?.invites) parts.push(`${res.invites} 个作废邀请码`);
      toast(parts.length ? `已清理 ${parts.join("、")}` : "没有需要清理的记录");
      if (res?.skipped) {
        toast(`另有 ${res.skipped} 个停用账号名下有作品，已保留`);
      }
      load();
    } catch (err) {
      toast(err.message || "清理失败", { type: "error" });
    }
  });

  load();
}

/** 这一批邀请码的表格：CSV 带 BOM，Excel 双击打开不乱码；字段全部加引号，备注里有逗号也不会串列 */
function exportInviteCsv(items) {
  const rows = [["序号", "邀请码", "角色", "备注", "生成时间"]];
  items.forEach((item, index) => {
    rows.push([
      index + 1,
      item.code,
      ROLE_LABEL[item.role] || "学生",
      item.note || "",
      String(item.createdAt || "").replace("T", " ").slice(0, 16),
    ]);
  });
  const csv =
    "\uFEFF" +
    rows
      .map((row) => row.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  const role = ROLE_LABEL[items[0]?.role] || "邀请码";
  link.href = url;
  link.download = `邀请码-${stamp}-${role}${items.length}个.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
      <p class="field__hint" data-user-hint hidden style="padding:0 22px"></p>
      <div class="admin__list" data-user-list>
        <div class="skeleton" style="height:80px"></div>
      </div>
    </div>
  `;

  async function load() {
    const listEl = qs("[data-user-list]", panel);
    const countEl = qs("[data-user-counts]", panel);
    const hintEl = qs("[data-user-hint]", panel);
    let data;
    try {
      data = await api.get("/api/admin/users");
    } catch (err) {
      listEl.innerHTML = `<div class="empty">${esc(err.message || "读取失败")}</div>`;
      return;
    }

    const items = data?.items || [];
    const counts = data?.counts || {};
    const purged = data?.purged || {};
    countEl.textContent = `管理员 ${counts.admins || 0} · 教师 ${counts.teachers || 0} · 学生 ${
      counts.students || 0
    } · 观察员 ${counts.observers || 0}`;

    if (purged.users) toast(`已自动清理 ${purged.users} 个停用的空账号`);

    if (purged.skipped) {
      hintEl.hidden = false;
      hintEl.textContent = `另有 ${purged.skipped} 个停用账号名下有作品（案例、展位或留言），为了不连带删掉内容，它们没有自动清理。`;
    } else {
      hintEl.hidden = true;
    }

    if (!items.length) {
      listEl.innerHTML = `<div class="empty">还没有账号。</div>`;
      return;
    }

    listEl.innerHTML = items
      .map(
        (u) => `
      <article class="admin__row" data-user="${u.id}" data-username="${esc(u.username)}">
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
        const row = btn.closest("[data-user]");
        const id = row.dataset.user;
        const username = row.dataset.username || "该账号";
        const status = btn.dataset.status;

        if (status === "disabled") {
          // 停用会让账号立刻失效；名下没内容的账号还会在下次打开本页时被自动清掉，
          // 这两个后果都写进确认窗，别让人以为停用只是「临时藏一下」
          const confirmed = await confirmDialog({
            title: `停用账号 ${username}？`,
            html: `<p>停用后该账号立刻无法登录。</p>
                   <p style="margin-top:10px">如果它名下<b>没有任何内容</b>（没有案例、展位、留言、调研、批注），
                   下次打开这一页时会被自动清理，删掉就找不回来了。</p>`,
            confirmText: "停用",
            danger: true,
          });
          if (!confirmed) return;
        }

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

/* ————————— 材料批阅 ————————— */

const WORK_STATUS = {
  submitted: { text: "待批阅", cls: "tag--warn" },
  returned: { text: "已退回", cls: "tag--err" },
  reviewed: { text: "已批阅", cls: "tag--ok" },
  archived: { text: "已归档", cls: "tag--quiet" },
};

const WORK_VERDICT = {
  excellent: { text: "优秀", cls: "tag--ok" },
  pass: { text: "通过", cls: "tag--ok" },
  return: { text: "退回", cls: "tag--err" },
};

function fileSizeText(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

async function renderWorksQueue(panel) {
  const filters = { course: "", term: "", kind: "", status: "submitted" };

  panel.innerHTML = `
    <div class="card works-queue">
      <header class="admin__section-head">
        <h3 class="h3">材料批阅</h3>
        <p class="field__hint">
          学生交上来的材料在这里审。三档结论（优秀 / 通过 / 退回）+ 一句评语；
          勾「放上展示板」后作品出现在课堂展示板上；评语是否一同公开由下方开关决定。
        </p>
      </header>

      <div class="works-queue__filters">
        <select class="select" data-f-course>
          <option value="">全部课程</option>
          ${COURSES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}
        </select>
        <select class="select" data-f-term>
          <option value="">全部学期</option>
          ${TERMS.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("")}
        </select>
        <select class="select" data-f-kind>
          <option value="">全部类型</option>
          ${WORK_KINDS.map((k) => `<option value="${k.value}">${k.label}</option>`).join("")}
        </select>
        <select class="select" data-f-status>
          <option value="">全部状态</option>
          <option value="submitted" selected>待批阅</option>
          <option value="returned">已退回</option>
          <option value="reviewed">已批阅</option>
          <option value="archived">已归档</option>
        </select>
      </div>

      <div class="works-queue__list" data-queue-list>
        <div class="skeleton" style="height:120px"></div>
      </div>
    </div>
  `;

  const listHost = qs("[data-queue-list]", panel);

  const load = async () => {
    listHost.innerHTML = `<div class="skeleton" style="height:120px"></div>`;
    let items = [];
    try {
      const res = await worksApi.queue({
        course: filters.course,
        term: filters.term,
        kind: filters.kind,
        status: filters.status,
        limit: 100,
      });
      items = Array.isArray(res?.items) ? res.items : [];
      if (res?.storage === "kv") {
        listHost.dataset.storage = "kv";
      }
    } catch (err) {
      listHost.innerHTML = `<div class="empty">${esc(err.message || "读取失败")}</div>`;
      return;
    }

    if (!items.length) {
      listHost.innerHTML = `<div class="empty">这个筛选下没有材料。</div>`;
      return;
    }

    listHost.innerHTML = `
      ${listHost.dataset.storage === "kv" ? `<div class="works-queue__banner">附件目前暂存在 KV（总量约 1GB，还要和登录会话共用）。R2 开通并配上 FILES 绑定后会自动改存 R2，代码不用动。</div>` : ""}
      <div class="works-queue__count meta">${items.length} 份</div>
      ${items
        .map((w) => {
          const status = WORK_STATUS[w.status] || WORK_STATUS.submitted;
          const verdict = WORK_VERDICT[w.verdict];
          return `
          <article class="works-queue__row" data-work-row="${esc(w.id)}">
            <div class="works-queue__row-main">
              <div class="works-queue__row-meta">
                <span class="tag tag--quiet">${esc(w.kindLabel || "材料")}</span>
                ${w.course ? `<span class="meta">${esc(w.course)}</span>` : ""}
                ${w.term ? `<span class="meta mono">${esc(w.term)}</span>` : ""}
                <span class="tag ${status.cls}">${status.text}</span>
                ${verdict ? `<span class="tag ${verdict.cls}">${esc(verdict.text)}</span>` : ""}
                ${w.featured ? `<span class="tag tag--warn">已展出</span>` : ""}
              </div>
              <button class="works-queue__row-title" type="button" data-open="${esc(w.id)}">
                ${esc(w.title)}
              </button>
              <div class="meta">
                ${esc(w.author)}${w.groupName ? ` · ${esc(w.groupName)}` : ""} ·
                ${(w.files || []).length} 个附件 ·
                ${esc((w.createdAt || "").slice(0, 10))}
              </div>
            </div>
            <div class="works-queue__row-side">
              <a class="btn btn--quiet btn--sm" href="#/works/${esc(w.id)}">打开</a>
            </div>
          </article>`;
        })
        .join("")}
    `;

    listHost.querySelectorAll("[data-open]").forEach((btn) => {
      btn.addEventListener("click", () => openReview(btn.dataset.open));
    });
  };

  const openReview = async (id) => {
    listHost.innerHTML = `<div class="skeleton" style="height:200px"></div>`;
    let work = null;
    try {
      work = await worksApi.detail(id);
    } catch (err) {
      listHost.innerHTML = `<div class="empty">${esc(err.message || "读不出来")}</div>`;
      return;
    }

    const files = work.files || [];
    const pdf = files.find((f) => /^application\/pdf$/i.test(f.mime));
    const verdict = work.verdict || "pass";

    listHost.innerHTML = `
      <button class="btn btn--quiet btn--sm" type="button" data-back>← 回到队列</button>

      <article class="work-review">
        <header class="work-review__head">
          <div class="meta">
            <span class="tag tag--quiet">${esc(work.kindLabel || "材料")}</span>
            ${work.course ? `<span class="meta">${esc(work.course)}</span>` : ""}
            ${work.term ? `<span class="meta mono">${esc(work.term)}</span>` : ""}
          </div>
          <h4 class="work-review__title">${esc(work.title)}</h4>
          <div class="meta">
            ${esc(work.author)}${work.groupName ? ` · ${esc(work.groupName)}` : ""}
            ${work.members ? ` · ${esc(work.members)}` : ""}
            · ${esc((work.createdAt || "").slice(0, 10))} 交
          </div>
        </header>

        ${work.summary ? `<div class="work-review__summary">${esc(work.summary)}</div>` : ""}

        <div class="work-review__files">
          ${files
            .map(
              (f) => `<a href="${workFiles.url(f.id)}" target="_blank" rel="noopener noreferrer">
                ${esc(f.name)} <span class="mono">${fileSizeText(f.size)}</span>
              </a>`
            )
            .join("")}
          ${(work.links || [])
            .map(
              (l) =>
                `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(
                  l.title || l.url
                )}</a>`
            )
            .join("")}
          ${!files.length && !(work.links || []).length ? `<span class="meta">没有附件</span>` : ""}
        </div>

        ${
          pdf
            ? `<iframe class="work-review__preview" src="${workFiles.url(pdf.id)}"
                 title="${esc(pdf.name)}" loading="lazy"></iframe>`
            : `<p class="field__hint">这份材料没有 PDF，点上面的文件名下载后查看。</p>`
        }

        <form class="work-review__form" data-review-form>
          <div class="work-review__verdicts">
            ${["excellent", "pass", "return"]
              .map(
                (v) => `
              <label class="work-review__verdict">
                <input type="radio" name="verdict" value="${v}" ${v === verdict ? "checked" : ""} />
                <span>${WORK_VERDICT[v].text}</span>
              </label>`
              )
              .join("")}
          </div>

          <label class="field">
            <span class="field__label">评语</span>
            <textarea class="textarea" name="comment" rows="4"
              placeholder="说说好在哪、哪里还可以往前走一步。退回时写清要改什么。">${esc(
                work.comment || ""
              )}</textarea>
          </label>

          <div class="work-review__toggles">
            <label class="admin__choice-item">
              <input type="checkbox" name="featured" ${work.featured ? "checked" : ""} />
              <span>放上课堂展示板</span>
            </label>
            <label class="admin__choice-item">
              <input type="checkbox" name="commentPublic" ${work.commentPublic ? "checked" : ""} />
              <span>评语随作品一起公开</span>
            </label>
          </div>

          <div class="work-review__actions">
            <span class="field__hint" data-review-status></span>
            <button class="btn btn--primary btn--sm" type="submit">保存批阅</button>
          </div>
        </form>
      </article>
    `;

    listHost.querySelector("[data-back]").addEventListener("click", load);

    const form = qs("[data-review-form]", listHost);
    const statusText = qs("[data-review-status]", listHost);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(form);
      const payload = {
        verdict: String(fd.get("verdict") || ""),
        comment: String(fd.get("comment") || "").trim(),
        featured: fd.get("featured") === "on",
        commentPublic: fd.get("commentPublic") === "on",
      };
      if (!payload.comment) {
        statusText.textContent = "批阅要留一句评语";
        statusText.dataset.state = "err";
        return;
      }
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      statusText.textContent = "保存中…";
      statusText.dataset.state = "";
      try {
        await worksApi.review(id, payload);
        toast(
          payload.verdict === "return"
            ? "已退回，学生那边会看到评语"
            : payload.featured
              ? "已批阅并展出"
              : "已批阅"
        );
        load();
      } catch (err) {
        statusText.textContent = err.message || "保存失败";
        statusText.dataset.state = "err";
        btn.disabled = false;
      }
    });
  };

  panel.querySelectorAll("[data-f-course]").forEach((node) =>
    node.addEventListener("change", () => {
      filters.course = node.value;
      load();
    })
  );
  panel.querySelectorAll("[data-f-term]").forEach((node) =>
    node.addEventListener("change", () => {
      filters.term = node.value;
      load();
    })
  );
  panel.querySelectorAll("[data-f-kind]").forEach((node) =>
    node.addEventListener("change", () => {
      filters.kind = node.value;
      load();
    })
  );
  panel.querySelectorAll("[data-f-status]").forEach((node) =>
    node.addEventListener("change", () => {
      filters.status = node.value;
      load();
    })
  );

  load();
}
