/** 博客 / 阅读展板 */
import { esc, mountReveal, formatDate } from "../lib/dom.js";
import { posts as postsApi } from "../lib/api.js";
import { DEMO_POSTS } from "../lib/demo.js";

export function blogSection() {
  return `
    <section id="blog" class="screen blog" aria-labelledby="blog-title">
      <div class="shell">
        <div class="screen-head reveal">
          <div class="screen-head__text">
            <div class="screen-ordinal">04 / 阅读</div>
            <h2 id="blog-title">阅读</h2>
            <p class="lede">
              课程推荐的文章、论文与方法笔记。写案例之前先读几篇，
              会更容易分辨「做法」与「说辞」的差别。
            </p>
          </div>
        </div>

        <div class="blog-list" data-blog-list>
          <div class="skeleton" style="height: 140px"></div>
          <div class="skeleton" style="height: 140px"></div>
        </div>
      </div>
    </section>
  `;
}

export async function mountBlog(root) {
  const section = root.querySelector("#blog");
  if (!section) return;
  const listEl = section.querySelector("[data-blog-list]");

  let list = [];
  let demo = false;
  try {
    const res = await postsApi.list({ limit: 20 });
    list = Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : [];
  } catch {
    list = [];
  }
  if (!list.length) {
    list = DEMO_POSTS;
    demo = true;
  }

  listEl.innerHTML = list.map((post, i) => rowHtml(post, i, demo)).join("");
  listEl.querySelectorAll("[data-post]").forEach((node) => {
    node.addEventListener("click", () => {
      window.location.hash = `/post/${node.dataset.post}`;
    });
  });
  mountReveal(section);
}

function rowHtml(post, index, demo) {
  const tags = (post.tags || [])
    .map((t) => `<span class="tag tag--quiet">${esc(t)}</span>`)
    .join("");
  return `
    <article class="blog-row reveal" data-post="${esc(post.id)}" tabindex="0" role="link"
      aria-label="${esc(post.title)}">
      <div class="blog-row__index mono">${String(index + 1).padStart(2, "0")}</div>
      <div class="blog-row__main">
        <div class="blog-row__meta">
          ${tags}
          ${demo ? `<span class="tag tag--quiet">示例</span>` : ""}
          <span class="meta">${formatDate(post.publishedAt)}</span>
        </div>
        <h3 class="blog-row__title">${esc(post.title)}</h3>
        <p class="blog-row__excerpt">${esc(post.excerpt || "")}</p>
      </div>
      <div class="blog-row__author meta">${esc(post.author || "")}</div>
    </article>
  `;
}
