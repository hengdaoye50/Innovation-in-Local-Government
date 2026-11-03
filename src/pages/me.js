/** 个人页：账号信息 + 我提交过的作品（含审核状态与退回理由） */
import { esc, zhWords, timeAgo, mountReveal } from "../lib/dom.js";
import { cases as casesApi } from "../lib/api.js";
import { getState, ROLE_LABEL } from "../lib/store.js";

const STATUS_LABEL = {
  pending: { text: "审核中", cls: "tag--warn" },
  published: { text: "已发布", cls: "tag--ok" },
  rejected: { text: "已退回", cls: "tag--err" },
  hidden: { text: "已下架", cls: "tag--quiet" },
};

export function mePage() {
  const { user } = getState();
  const name = user?.displayName || user?.username || "同学";

  return `
    <article class="me">
      <div class="shell">
        <header class="me__head reveal">
          <p class="eyebrow">个人页</p>
          <h1 class="me__title">${esc(name)}</h1>
          <p class="lede">账号信息，以及你提交过的作品；审核状态与退回理由都在下面这一列。</p>
        </header>

        <div class="me__grid">
          <section class="card me__account reveal">
            <h2 class="h3">账号</h2>
            <dl class="me__facts">
              <div class="me__fact">
                <dt>显示名</dt>
                <dd>${esc(user?.displayName || user?.username || "—")}</dd>
              </div>
              <div class="me__fact">
                <dt>账号</dt>
                <dd class="mono">${esc(user?.username || "—")}</dd>
              </div>
              <div class="me__fact">
                <dt>角色</dt>
                <dd>${esc(ROLE_LABEL[user?.role] || user?.role || "—")}</dd>
              </div>
            </dl>
          </section>

          <section class="me__works reveal">
            <header class="me__works-head">
              <h2 class="h3">我的作品</h2>
              <span class="meta" data-mine-count></span>
            </header>
            <div class="me__list" data-mine-list>
              <div class="skeleton" style="height:56px"></div>
            </div>
          </section>
        </div>
      </div>
    </article>
  `;
}

export async function mountMe(root) {
  mountReveal(root);
  const host = root.querySelector("[data-mine-list]");
  const countEl = root.querySelector("[data-mine-count]");
  if (!host) return;

  let items = [];
  try {
    const res = await casesApi.mine();
    items = Array.isArray(res?.items) ? res.items : [];
  } catch {
    items = [];
  }

  if (countEl) countEl.textContent = items.length ? `共 ${items.length} 篇` : "";

  if (!items.length) {
    host.innerHTML = `<div class="empty">还没有提交过作品。写完一篇并提交后，会出现在这里。</div>`;
    return;
  }

  host.innerHTML = items
    .map((c) => {
      const st = STATUS_LABEL[c.status] || STATUS_LABEL.pending;
      const editable = c.status === "pending" || c.status === "rejected";
      return `
        <article class="mine-row">
          <div class="mine-row__meta">
            <span class="tag ${st.cls}">${st.text}</span>
            <span class="meta mono">${zhWords(c.body || c.summary || "")} 字</span>
            <span class="meta">${timeAgo(c.createdAt)}</span>
            ${
              editable
                ? `<a class="btn btn--quiet btn--sm mine-row__edit" href="#/?edit=${esc(
                    c.id
                  )}">修改</a>`
                : ""
            }
          </div>
          <a class="mine-row__title" href="#/case/${esc(c.id)}">${esc(c.title)}</a>
          ${
            c.status === "rejected" && c.aiReview
              ? `<p class="mine-row__review"><b>退回理由</b>${esc(c.aiReview)}</p>`
              : ""
          }
        </article>`;
    })
    .join("");
}
