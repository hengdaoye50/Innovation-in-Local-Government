/** 教师后台 —— 案例审核、展位管理、文章发布、邀请码 */
import { esc, qs, qsa, toast, timeAgo, formatDate, zhLength, mountReveal } from "../lib/dom.js";
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
        ${user.role === "admin" ? `<button class="admin__tab" data-tab="users" role="tab">用户管理</button>` : ""}
      </div>

      <section class="admin__panel" data-panel="cases"></section>
      <section class="admin__panel" data-panel="slides" hidden></section>
      <section class="admin__panel" data-panel="posts" hidden></section>
      <section class="admin__panel" data-panel="invites" hidden></section>
      ${user.role === "admin" ? `<section class="admin__panel" data-panel="users" hidden></section>` : ""}
    </div>
  `;

  const panels = {
    cases: qs('[data-panel="cases"]', root),
    slides: qs('[data-panel="slides"]', root),
    posts: qs('[data-panel="posts"]', root),
    invites: qs('[data-panel="invites"]', root),
  };
  if (user.role === "admin") panels.users = qs('[data-panel="users"]', root);

  const loaders = {
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
          <div class="invite-maker__actions">
            <button class="btn btn--primary btn--sm" data-new-invite="student">生成学生邀请码</button>
            ${
              isAdmin
                ? `<button class="btn btn--gold btn--sm" data-new-invite="teacher">生成教师邀请码</button>`
                : ""
            }
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
            直接拥有后台权限。<br /><br />
            备注只给你自己看，用来记这个码给了谁。<b>作废</b>会让未使用的码立刻失效，
            已使用的码保留作账号来历，不能作废。
            ${isAdmin ? "" : "<br /><br />你是教师角色，只能签发学生邀请码。"}
          </p>
        </section>
      </aside>
    </div>
  `;

  const listEl = qs("[data-invite-list]", panel);
  const noteInput = qs("[data-invite-note]", panel);

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
          <span class="tag tag--quiet">${i.role === "teacher" ? "教师" : "学生"}</span>
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
      btn.disabled = true;
      try {
        const res = await adminApi.createInvite(role, note);
        toast(`${role === "teacher" ? "教师" : "学生"}邀请码 ${res?.code || ""} 已生成`);
        noteInput.value = "";
        load();
      } catch (err) {
        toast(err.message || "生成失败", { type: "error" });
      } finally {
        btn.disabled = false;
      }
    });
  });

  load();
}

/* ————————— 用户管理（仅 admin） ————————— */

const ROLE_TEXT = { student: "学生", teacher: "教师", admin: "管理员" };

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
    countEl.textContent = `管理员 ${counts.admins || 0} · 教师 ${counts.teachers || 0} · 学生 ${counts.students || 0}`;

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
