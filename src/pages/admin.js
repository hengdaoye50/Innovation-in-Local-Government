/** 教师后台 —— 案例审核、展位管理、文章发布、邀请码 */
import { esc, qs, qsa, toast, timeAgo, zhLength, mountReveal } from "../lib/dom.js";
import { admin as adminApi, cases as casesApi, api } from "../lib/api.js";
import { getState } from "../lib/store.js";

const STATUS_LABEL = {
  pending: { text: "待质检", cls: "tag--warn" },
  published: { text: "已发布", cls: "tag--ok" },
  rejected: { text: "已退回", cls: "tag--quiet" },
  hidden: { text: "已下架", cls: "tag--quiet" },
};

const COURSES = ["地方政府创新", "公共政策分析"];
const TERMS = ["2025 秋", "2025 春", "2024 秋", "2024 春"];

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
        <button class="admin__tab is-on" data-tab="cases" role="tab">案例审核</button>
        <button class="admin__tab" data-tab="slides" role="tab">展位管理</button>
        <button class="admin__tab" data-tab="posts" role="tab">文章管理</button>
        <button class="admin__tab" data-tab="invites" role="tab">邀请码</button>
      </div>

      <section class="admin__panel" data-panel="cases"></section>
      <section class="admin__panel" data-panel="slides" hidden></section>
      <section class="admin__panel" data-panel="posts" hidden></section>
      <section class="admin__panel" data-panel="invites" hidden></section>
    </div>
  `;

  const panels = {
    cases: qs('[data-panel="cases"]', root),
    slides: qs('[data-panel="slides"]', root),
    posts: qs('[data-panel="posts"]', root),
    invites: qs('[data-panel="invites"]', root),
  };

  const loaders = {
    cases: () => renderCases(panels.cases),
    slides: () => renderSlides(panels.slides),
    posts: () => renderPosts(panels.posts),
    invites: () => renderInvites(panels.invites),
  };

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

  loaders.cases();
  mountReveal(root);
}

/* ————————— 案例审核 ————————— */

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
      .map((c) => {
        const st = STATUS_LABEL[c.status] || STATUS_LABEL.pending;
        return `
        <article class="admin__row">
          <div class="admin__row-main">
            <div class="admin__row-meta">
              <span class="tag ${st.cls}">${st.text}</span>
              <span class="meta">${[c.province, c.city, c.district]
                .filter((p, i, arr) => p && arr.indexOf(p) === i)
                .map(esc)
                .join(" · ")}</span>
              <span class="meta mono">${zhLength(c.body || c.summary || "")} 字</span>
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
            <span class="field__label">幻灯片链接（可选）</span>
            <input class="input" name="fileUrl" placeholder="https:// 或站内路径，留空则展位只保留文字" />
          </label>
          <label class="field">
            <span class="field__label">描述</span>
            <textarea class="textarea" name="description" rows="4" placeholder="这次汇报想回答什么问题、用了什么材料、结论是什么。"></textarea>
          </label>
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
          </div>
          <a class="admin__row-title" href="#/slide/${esc(s.id)}">${esc(s.title)}</a>
        </div>
      </article>`
      )
      .join("");
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
      await api.post("/api/slides", payload);
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

async function renderInvites(panel) {
  panel.innerHTML = `
    <div class="admin__split">
      <div class="card">
        <header class="admin__panel-head">
          <h2 class="h3">邀请码</h2>
          <button class="btn btn--gold btn--sm" data-new-invite>生成新邀请码</button>
        </header>
        <div class="admin__invites" data-invite-list>
          <p class="field__hint">一次性使用。学生凭邀请码注册，注册后该码立即作废。</p>
        </div>
      </div>

      <aside class="admin__side">
        <section class="card">
          <h2 class="h3" style="margin-bottom:12px">说明</h2>
          <p class="field__hint" style="line-height:1.8">
            邀请码全局唯一。发给同学后，在注册页填入即可创建账号；
            账号默认是学生角色，不需要你额外审核。
          </p>
        </section>
      </aside>
    </div>
  `;

  qs("[data-new-invite]", panel).addEventListener("click", async () => {
    try {
      const res = await adminApi.createInvite();
      const code = res?.code || "";
      const listEl = qs("[data-invite-list]", panel);
      const row = document.createElement("div");
      row.className = "invite-row";
      row.innerHTML = `<code class="mono">${esc(code)}</code><button class="btn btn--quiet btn--sm" data-copy>复制</button>`;
      row.querySelector("[data-copy]").addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(code);
          toast("已复制");
        } catch {
          toast("复制失败，请手动选中", { type: "error" });
        }
      });
      listEl.prepend(row);
    } catch (err) {
      toast(err.message || "生成失败", { type: "error" });
    }
  });

  try {
    const res = await adminApi.invites();
    const items = Array.isArray(res?.items) ? res.items : [];
    if (items.length) {
      const listEl = qs("[data-invite-list]", panel);
      listEl.innerHTML = items
        .map(
          (i) => `
        <div class="invite-row${i.used ? " is-used" : ""}">
          <code class="mono">${esc(i.code)}</code>
          <span class="meta">${i.used ? `已使用${i.usedBy ? " · " + esc(i.usedBy) : ""}` : "未使用"}</span>
        </div>`
        )
        .join("");
    }
  } catch {
    /* 忽略，保留提示文案 */
  }
}
