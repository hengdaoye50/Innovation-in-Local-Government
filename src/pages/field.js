/** 调研足迹 —— 第五屏：师生实地调研的见闻记录 */
import { esc, mountReveal, formatMonth } from "../lib/dom.js";
import { surveys as surveysApi } from "../lib/api.js";
import { stripMarkdown } from "../lib/markdown.js";

export function fieldSection() {
  return `
    <section id="field" class="screen field" aria-labelledby="field-title">
      <div class="shell">
        <div class="screen-head reveal">
          <div class="screen-head__text">
            <div class="screen-ordinal">05 / 田野</div>
            <h2 id="field-title">调研足迹</h2>
            <p class="lede">
              实地调研的记录，含地点、时间、见闻与照片。不参与案例质检，作为后续走访的线索保留。
            </p>
          </div>
          <div class="screen-head__aside">
            <a class="btn btn--ghost btn--sm" href="#/field/new">记录一次调研</a>
          </div>
        </div>

        <div class="field-list" data-field-list>
          <div class="skeleton" style="height:140px"></div>
        </div>
      </div>
    </section>
  `;
}

export async function mountField(root) {
  const section = root.querySelector("#field");
  if (!section) return;
  const listEl = section.querySelector("[data-field-list]");

  let items = [];
  try {
    const res = await surveysApi.list();
    items = Array.isArray(res?.items) ? res.items : [];
  } catch {
    items = [];
  }

  if (!items.length) {
    listEl.innerHTML = `<div class="empty">尚无调研记录；走访后可在此补录。</div>`;
    mountReveal(section);
    return;
  }

  listEl.innerHTML = items.map((s, i) => rowHtml(s, i, items.length)).join("");
  listEl.querySelectorAll("[data-survey]").forEach((node) => {
    const go = () => {
      window.location.hash = `/field/${node.dataset.survey}`;
    };
    node.addEventListener("click", go);
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        go();
      }
    });
  });
  mountReveal(section);
}

function rowHtml(survey, index, total) {
  const place = [survey.province, survey.city, survey.district]
    .filter((p, i, arr) => p && arr.indexOf(p) === i)
    .join(" · ");
  const when = formatMonth(survey.visitedAt || (survey.createdAt || "").slice(0, 7));
  // 摘要里不要小标题：把「## 取号机旁边多了一个人」原样拼进摘要，读起来像断裂的句子
  const excerpt = stripMarkdown(
    String(survey.body || "").replace(/^#{1,6}[ \t].*$/gm, ""),
    110
  );
  const photos = survey.imageCount || 0;

  return `
    <article class="field-row${photos ? " field-row--with-photo" : ""} reveal"
      data-survey="${esc(survey.id)}" tabindex="0" role="link"
      aria-label="${esc(survey.title)}">
      <div class="field-row__index mono">${String(index + 1).padStart(2, "0")}<i>/ ${String(
    total
  ).padStart(2, "0")}</i></div>

      <div class="field-row__main">
        <div class="field-row__meta">
          <span class="field-row__place">${esc(place)}</span>
          ${when ? `<span class="meta mono">${esc(when)}</span>` : ""}
          <span class="meta">${esc(survey.author)}</span>
          ${photos ? `<span class="meta mono">${photos} 图</span>` : ""}
        </div>
        <h3 class="field-row__title">${esc(survey.title)}</h3>
        <p class="field-row__excerpt">${esc(excerpt)}</p>
      </div>

      ${
        survey.cover
          ? `<div class="field-row__thumb">
               <img src="${esc(survey.cover)}" alt="" loading="lazy" decoding="async" />
             </div>`
          : `<span class="field-row__go" aria-hidden="true">
               <svg viewBox="0 0 12 8"><path d="M1 4h10M8 1l3 3-3 3" stroke-linecap="round" stroke-linejoin="round"/></svg>
             </span>`
      }
    </article>
  `;
}
