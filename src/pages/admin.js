/** 教师后台 —— 审核、下架、邀请码 */
import { esc, qs, toast, timeAgo, zhLength, mountReveal } from "../lib/dom.js";
import { admin as adminApi, cases as casesApi } from "../lib/api.js";
import { getState } from "../lib/store.js";

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
          <p class="lede">审核同学提交的案例，管理展位与邀请码。</p>
        </div>
      </header>

      <div class="admin__grid">
        <section class="admin__panel card">
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
        </section>

        <aside class="admin__side">
          <section class="card">
            <header class="admin__panel-head">
              <h2 class="h3">邀请码</h2>
              <button class="btn btn--gold btn--sm" data-new-invite>生成</button>
            </header>
            <div class="admin__invites" data-invite-list>
              <p class="field__hint">生成后可发给同学，一次性使用。</p>
            </div>
          </section>

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
    </div>
  `;

  let currentFilter = "pending";
  let caseCache = [];

  async function loadCases(filter = currentFilter) {
    const listEl = qs("[data-case-list]", root);
    listEl.innerHTML = `<div class="skeleton" style="height:80px"></div>`;
    try {
      const res = await casesApi.list({ status: filter, limit: 100 });
      caseCache = Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : [];
    } catch {
      caseCache = [];
    }
    if (!caseCache.length) {
      listEl.innerHTML = `<div class="empty">这个队列是空的。</div>`;
      return;
    }
    listEl.innerHTML = caseCache
      .map((c) => {
        const st = STATUS_LABEL[c.status] || STATUS_LABEL.pending;
        return `
        <article class="admin__row">
          <div class="admin__row-main">
            <div class="admin__row-meta">
              <span class="tag ${st.cls}">${st.text}</span>
              <span class="meta">${esc(c.province || "")}${c.city ? ` · ${esc(c.city)}` : ""}</span>
              <span class="meta mono">${zhLength(c.body || c.summary || "")} 字</span>
              <span class="meta">${esc(timeAgo(c.createdAt))}</span>
            </div>
            <a class="admin__row-title" href="#/case/${esc(c.id)}">${esc(c.title)}</a>
            ${
              c.aiReview
                ? `<p class="admin__row-review">${esc(c.aiReview)}</p>`
                : ""
            }
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
        </article>
      `;
      })
      .join("");
    listEl.querySelectorAll("[data-act]").forEach((btn) => {
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

  root.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      root.querySelectorAll("[data-filter]").forEach((b) => b.classList.toggle("is-on", b === btn));
      currentFilter = btn.dataset.filter;
      loadCases();
    });
  });

  qs("[data-new-invite]", root).addEventListener("click", async () => {
    try {
      const res = await adminApi.createInvite();
      const code = res?.code || res?.invite || "";
      const listEl = qs("[data-invite-list]", root);
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

  loadCases();

  // 概况统计
  Promise.allSettled([
    casesApi.list({ status: "published", limit: 500 }),
    casesApi.list({ status: "pending", limit: 500 }),
  ]).then(([pub, pen]) => {
    const pubList = Array.isArray(pub.value?.items) ? pub.value.items : [];
    const penList = Array.isArray(pen.value?.items) ? pen.value.items : [];
    const set = (key, value) => {
      const node = qs(`[data-stat="${key}"]`, root);
      if (node) node.textContent = String(value);
    };
    set("published", pubList.length);
    set("pending", penList.length);
    set("provinces", new Set(pubList.map((c) => c.province)).size);
  });

  mountReveal(root);
}
