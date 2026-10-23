/** 展位详情 / 文章详情 */
import { esc, qs, formatDate, mountReveal } from "../lib/dom.js";
import { slides as slidesApi, posts as postsApi } from "../lib/api.js";
import { renderMarkdown } from "../lib/markdown.js";
import { createCommentBlock } from "../components/comments.js";
import { DEMO_SLIDES, DEMO_POSTS } from "../lib/demo.js";

export async function mountSlideDetail(root, id) {
  root.innerHTML = `<div class="shell detail__loading"><div class="skeleton" style="height:40px;width:50%"></div></div>`;

  let slide = null;
  try {
    slide = await slidesApi.detail(id);
  } catch {
    slide = DEMO_SLIDES.find((s) => s.id === id) || null;
  }
  if (!slide) {
    root.innerHTML = emptyHtml("展位不存在", "它可能已被撤下。");
    return;
  }

  root.innerHTML = `
    <article class="detail">
      <div class="shell shell-narrow">
        <a class="detail__back" href="#slides">回到展示板</a>
        <header class="detail__head">
          <div class="detail__place">
            <span class="detail__place-dot"></span>
            ${esc(slide.course || "课堂汇报")}${slide.term ? ` · ${esc(slide.term)}` : ""}
          </div>
          <h1 class="detail__title">${esc(slide.title)}</h1>
          <div class="detail__meta">
            <span class="meta">${esc(slide.author || "匿名")}</span>
            ${slide.slides ? `<span class="meta mono">${Number(slide.slides)} 页</span>` : ""}
          </div>
        </header>

        ${
          slide.fileUrl
            ? `<div class="slide-embed">
                <iframe src="${esc(slide.fileUrl)}" title="${esc(slide.title)}" loading="lazy"></iframe>
              </div>`
            : `<div class="slide-placeholder">
                <div class="slide-placeholder__no mono">SLIDES</div>
                <p>本次汇报的幻灯片暂以现场演示为主，展位保留题目与评语。</p>
              </div>`
        }

        <div class="detail__body md">
          ${renderMarkdown(slide.description || "")}
        </div>
      </div>

      <div class="shell shell-narrow"><div data-comments-slot></div></div>
    </article>
  `;

  qs("[data-comments-slot]", root).append(
    createCommentBlock({
      targetType: "slide",
      targetId: slide.id,
      aiReview: slide.aiReview,
      aiScore: slide.aiScore,
    })
  );
  document.title = `${slide.title} · 课堂展示板`;
  mountReveal(root);
}

export async function mountPostDetail(root, id) {
  root.innerHTML = `<div class="shell detail__loading"><div class="skeleton" style="height:40px;width:50%"></div></div>`;

  let post = null;
  try {
    post = await postsApi.detail(id);
  } catch {
    post = DEMO_POSTS.find((p) => p.id === id) || null;
  }
  if (!post) {
    root.innerHTML = emptyHtml("文章不存在", "它可能已被移除。");
    return;
  }

  const tags = (post.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("");

  root.innerHTML = `
    <article class="detail detail--reading">
      <div class="shell shell-narrow">
        <a class="detail__back" href="#blog">回到拓展材料</a>
        <header class="detail__head">
          <div class="detail__meta">${tags}</div>
          <h1 class="detail__title">${esc(post.title)}</h1>
          <div class="detail__meta">
            <span class="meta">${esc(post.author || "")}</span>
            <span class="meta mono">${formatDate(post.publishedAt)}</span>
            ${
              post.sourceUrl
                ? `<a class="meta" href="${esc(post.sourceUrl)}" target="_blank" rel="noopener noreferrer">原文链接</a>`
                : ""
            }
          </div>
        </header>
        <div class="detail__body md">
          ${renderMarkdown(post.body || post.excerpt || "")}
        </div>
      </div>
      <div class="shell shell-narrow"><div data-comments-slot></div></div>
    </article>
  `;

  qs("[data-comments-slot]", root).append(
    createCommentBlock({ targetType: "post", targetId: post.id })
  );
  document.title = `${post.title} · 拓展材料`;
  mountReveal(root);
}

function emptyHtml(title, desc) {
  return `
    <div class="shell shell-narrow detail__empty">
      <div class="screen-ordinal">未找到</div>
      <h1 class="h2" style="margin:12px 0 16px">${esc(title)}</h1>
      <p class="lede">${esc(desc)}</p>
      <a class="btn btn--ghost" href="#/">回到首页</a>
    </div>
  `;
}
