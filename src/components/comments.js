/** 评论区 —— 案例 / 展位 / 文章共用 */
import { esc, el, timeAgo, toast } from "../lib/dom.js";
import { comments as commentsApi } from "../lib/api.js";
import { getState } from "../lib/store.js";

const ROLE_LABEL = {
  teacher: "教师",
  admin: "教师",
  student: "",
  ai: "模型评语",
};

export function createCommentBlock({ targetType, targetId, aiReview, aiScore } = {}) {
  const host = el("section", { class: "comments" });
  let list = [];

  host.innerHTML = `
    <header class="comments__head">
      <h3 class="h3">讨论</h3>
      <span class="meta" data-comment-count></span>
    </header>
    ${renderAi(aiReview, aiScore)}
    <div class="comments__list" data-comments></div>
    <form class="comments__form" data-comment-form>
      <textarea class="textarea" rows="3" placeholder="写下你的判断：哪一步说得通，哪一步还需要证据。" data-comment-input></textarea>
      <div class="comments__form-bar">
        <span class="field__hint" data-comment-hint></span>
        <button class="btn btn--primary btn--sm" type="submit">发表</button>
      </div>
    </form>
  `;

  const listEl = host.querySelector("[data-comments]");
  const form = host.querySelector("[data-comment-form]");
  const input = host.querySelector("[data-comment-input]");
  const hint = host.querySelector("[data-comment-hint]");
  const countEl = host.querySelector("[data-comment-count]");

  function renderList() {
    const human = list.filter((c) => c.authorRole !== "ai");
    countEl.textContent = human.length ? `${human.length} 条` : "";
    if (!human.length) {
      listEl.innerHTML = `<div class="empty">还没有人留言。第一条评论往往决定讨论的方向。</div>`;
      return;
    }
    listEl.innerHTML = human
      .map((c) => {
        const role = ROLE_LABEL[c.authorRole] || "";
        return `
        <article class="comment">
          <div class="comment__head">
            <span class="comment__author">${esc(c.authorName || c.author || "匿名")}</span>
            ${role ? `<span class="tag tag--quiet">${esc(role)}</span>` : ""}
            <span class="meta">${esc(timeAgo(c.createdAt))}</span>
          </div>
          <div class="comment__body">${esc(c.body).replace(/\n/g, "<br>")}</div>
        </article>
      `;
      })
      .join("");
  }

  async function load() {
    try {
      const res = await commentsApi.list(targetType, targetId);
      list = Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : [];
    } catch {
      list = [];
    }
    renderList();
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = input.value.trim();
    if (!body) return;
    const user = getState().user;
    if (!user) {
      toast("登录后才能参与讨论");
      window.location.hash = "/login";
      return;
    }
    if (body.length > 1200) {
      toast("单条留言不超过 1200 字", { type: "error" });
      return;
    }
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    hint.textContent = "发送中…";
    try {
      const created = await commentsApi.create(targetType, targetId, body);
      list.push(created || { body, authorName: user.displayName || user.username, createdAt: new Date().toISOString(), authorRole: user.role });
      input.value = "";
      hint.textContent = "";
      renderList();
    } catch (err) {
      hint.textContent = err.message || "发送失败";
    } finally {
      btn.disabled = false;
    }
  });

  load();
  return host;
}

function renderAi(review, score) {
  if (!review) return "";
  return `
    <div class="ai-review">
      <div class="ai-review__head">
        <span class="ai-review__label">评委 · 模型评语</span>
        ${score ? `<span class="ai-review__score mono">${Number(score)}</span>` : ""}
      </div>
      <p class="ai-review__body">${esc(review)}</p>
      <p class="ai-review__note">模型评语仅供参考，最终判断以教师的课堂讲评为准。</p>
    </div>
  `;
}
