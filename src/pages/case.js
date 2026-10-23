/** 案例详情页 */
import { esc, qs, formatDate, zhLength, mountReveal } from "../lib/dom.js";
import { cases as casesApi } from "../lib/api.js";
import { renderMarkdown } from "../lib/markdown.js";
import { createCommentBlock } from "../components/comments.js";
import { DEMO_CASES } from "../lib/demo.js";
import { getState } from "../lib/store.js";

export async function mountCaseDetail(root, id) {
  root.innerHTML = `<div class="shell detail__loading"><div class="skeleton" style="height:40px;width:60%"></div></div>`;

  let item = null;
  try {
    item = await casesApi.detail(id);
  } catch {
    item = DEMO_CASES.find((c) => c.id === id) || null;
  }
  if (!item) {
    root.innerHTML = `
      <div class="shell shell-narrow detail__empty">
        <div class="screen-ordinal">未找到</div>
        <h1 class="h2" style="margin:12px 0 16px">这个案例还在地图之外</h1>
        <p class="lede">它可能已被作者撤回，或尚未通过质检。</p>
        <a class="btn btn--ghost" href="#/">回到地图</a>
      </div>
    `;
    return;
  }

  const tags = (item.domains || [])
    .map((d) => `<span class="tag">${esc(d)}</span>`)
    .join("");
  const sources = (item.sources || []).filter((s) => s.url);
  const bodyText = item.body || item.summary || "";
  const words = zhLength(bodyText);
  const related = DEMO_CASES.filter(
    (c) => c.id !== item.id && c.province === item.province
  ).slice(0, 3);

  root.innerHTML = `
    <article class="detail">
      <div class="shell shell-narrow">
        <a class="detail__back" href="#/">
          <svg width="14" height="10" viewBox="0 0 14 10" fill="none" stroke="currentColor" stroke-width="1.2">
            <path d="M5.5 1L1.5 5l4 4M1.5 5H13" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          回到地图
        </a>

        <header class="detail__head">
          <div class="detail__place">
            <span class="detail__place-dot"></span>
            ${[item.province, item.city, item.district]
              .filter((p, i, arr) => p && arr.indexOf(p) === i)
              .map(esc)
              .join(" · ")}
          </div>
          <h1 class="detail__title">${esc(item.title)}</h1>
          <div class="detail__meta">
            ${tags}
            <span class="meta">${esc(item.author || "同学作品")}</span>
            ${item.year ? `<span class="meta">${esc(item.year)}</span>` : ""}
            <span class="meta mono">${words} 字</span>
            ${
              item.status === "pending"
                ? `<span class="tag tag--warn">质检中</span>`
                : ""
            }
          </div>
        </header>

        <div class="detail__body md">
          ${renderMarkdown(bodyText)}
        </div>

        ${
          sources.length
            ? `<section class="detail__sources">
                <div class="eyebrow">Sources · ${sources.length} 条来源</div>
                <ol class="source-list">
                  ${sources
                    .map(
                      (s) => `
                    <li>
                      <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">
                        ${esc(s.title || s.url)}
                      </a>
                    </li>`
                    )
                    .join("")}
                </ol>
              </section>`
            : ""
        }
      </div>

      <div class="shell shell-narrow">
        <div data-comments-slot></div>
      </div>

      ${
        related.length
          ? `<div class="shell"><section class="detail__related">
              <div class="eyebrow">同省案例</div>
              <div class="related-grid">
                ${related
                  .map(
                    (c) => `
                  <a class="related-card" href="#/case/${esc(c.id)}">
                    <div class="related-card__place meta">${esc(c.city || c.province)}</div>
                    <div class="related-card__title">${esc(c.title)}</div>
                  </a>`
                  )
                  .join("")}
              </div>
            </section></div>`
          : ""
      }
    </article>
  `;

  const slot = qs("[data-comments-slot]", root);
  slot.append(
    createCommentBlock({
      targetType: "case",
      targetId: item.id,
      aiReview: item.aiReview,
      aiScore: item.aiScore,
    })
  );

  document.title = `${item.title} · 公共政策分析课程协作平台`;
  mountReveal(root);
}
