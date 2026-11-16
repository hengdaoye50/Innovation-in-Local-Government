/** 课堂展示板：教师展出到这里的材料 + 历史展位并排 */
import { esc, mountReveal } from "../lib/dom.js";
import { slides as slidesApi, works as worksApi } from "../lib/api.js";
import { DEMO_SLIDES } from "../lib/demo.js";

export function slidesSection() {
  return `
    <section id="slides" class="screen boards" aria-labelledby="slides-title">
      <div class="shell">
        <div class="screen-head reveal">
          <div class="screen-head__text">
            <div class="screen-ordinal">03 / 课堂</div>
            <h2 id="slides-title">课堂展示</h2>
            <p class="lede">
              教师选出的课程作品，含课件、报告与案例分析。课件可直接翻页，作品下方设有讨论。
            </p>
          </div>
          <div class="screen-head__aside">
            <button class="btn btn--ghost btn--sm" data-podium type="button" aria-pressed="false">
              投影模式
            </button>
            <a class="btn btn--ghost" href="#/works/new">提交材料</a>
          </div>
        </div>

        <div class="slides-grid" data-slides-grid>
          <div class="skeleton" style="height: 260px"></div>
          <div class="skeleton" style="height: 260px"></div>
          <div class="skeleton" style="height: 260px"></div>
        </div>
      </div>
    </section>
  `;
}

export async function mountSlides(root) {
  const section = root.querySelector("#slides");
  if (!section) return;
  const grid = section.querySelector("[data-slides-grid]");

  // 两块来源：教师放上展示板的 materials（新通道）+ 历史上教师直接上传的展位
  const [worksRes, slidesRes] = await Promise.allSettled([
    worksApi.featured(12),
    slidesApi.list({ limit: 12 }),
  ]);

  const works = worksRes.status === "fulfilled" && Array.isArray(worksRes.value?.items)
    ? worksRes.value.items
    : [];
  const slides = slidesRes.status === "fulfilled" && Array.isArray(slidesRes.value?.items)
    ? slidesRes.value.items
    : [];

  let demo = false;
  if (!works.length && !slides.length) {
    demo = true;
  }

  const cards = [
    ...works.map((w) => ({ type: "work", data: w })),
    ...slides.map((s) => ({ type: "slide", data: s })),
  ];

  grid.innerHTML = demo
    ? DEMO_SLIDES.map((s, i) => legacyCardHtml(s, i, true, DEMO_SLIDES.length)).join("")
    : cards
        .map((card, i) =>
          card.type === "work"
            ? workCardHtml(card.data, i, cards.length)
            : legacyCardHtml(card.data, i, false, cards.length)
        )
        .join("");

  grid.querySelectorAll("[data-work]").forEach((node) => {
    const go = () => {
      window.location.hash = `/works/${node.dataset.work}`;
    };
    node.addEventListener("click", go);
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        go();
      }
    });
  });
  grid.querySelectorAll("[data-slide]").forEach((node) => {
    node.addEventListener("click", () => {
      window.location.hash = `/slide/${node.dataset.slide}`;
    });
  });

  const podiumBtn = section.querySelector("[data-podium]");
  podiumBtn?.addEventListener("click", () => {
    const on = section.classList.toggle("is-podium");
    podiumBtn.setAttribute("aria-pressed", String(on));
    podiumBtn.classList.toggle("is-on", on);
    podiumBtn.textContent = on ? "退出投影" : "投影模式";
  });

  mountReveal(section);
}

/** 展示板上的材料卡片：露出材料类型、附件数与教师结论 */
function workCardHtml(work, index, total) {
  const files = work.files || [];
  const preview = files.find((f) => /^application\/pdf$/i.test(f.mime));
  return `
    <article class="slide-card reveal slide-card--work" data-work="${esc(work.id)}" tabindex="0"
      role="link" aria-label="${esc(work.title)}">
      <div class="slide-card__cover${preview ? " slide-card__cover--file" : ""}">
        <span class="slide-card__no mono">${String(index + 1).padStart(2, "0")}<i>/ ${String(
          total || 0
        ).padStart(2, "0")}</i></span>
        <span class="slide-card__pages mono">${
          preview ? "PDF" : files.length ? `${files.length} 个附件` : "在线文档"
        }</span>
        <div class="slide-card__cover-rule"></div>
        <span class="slide-card__plate" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span>
      </div>
      <div class="slide-card__body">
        <div class="slide-card__meta">
          <span class="tag tag--quiet">${esc(work.kindLabel || "材料")}</span>
          ${work.course ? `<span class="meta">${esc(work.course)}</span>` : ""}
          ${work.term ? `<span class="meta mono">${esc(work.term)}</span>` : ""}
        </div>
        <h3 class="slide-card__title">${esc(work.title)}</h3>
        <p class="slide-card__desc">${esc((work.summary || "").replace(/\s+/g, " ").slice(0, 90))}</p>
      </div>
      <footer class="slide-card__foot">
        <span class="meta">${esc(work.groupName || work.author || "匿名")}</span>
        <span class="meta">${work.verdict === "excellent" ? "教师评：优秀" : "已批阅"}</span>
      </footer>
    </article>
  `;
}

/** 历史上的教师上传展位，保持原样 */
function legacyCardHtml(slide, index, demo, total) {
  return `
    <article class="slide-card reveal" data-slide="${esc(slide.id)}" tabindex="0" role="link"
      aria-label="${esc(slide.title)}">
      <div class="slide-card__cover">
        <span class="slide-card__no mono">${String(index + 1).padStart(2, "0")}<i>/ ${String(
          total || 0
        ).padStart(2, "0")}</i></span>
        <span class="slide-card__pages mono">${Number(slide.slides) || 0} 页</span>
        <div class="slide-card__cover-rule"></div>
        <span class="slide-card__plate" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span>
      </div>
      <div class="slide-card__body">
        <div class="slide-card__meta">
          <span class="tag tag--quiet">${esc(slide.course || "课堂汇报")}</span>
          ${slide.term ? `<span class="meta">${esc(slide.term)}</span>` : ""}
          ${
            slide.visibility === "private"
              ? `<span class="tag tag--warn">仅自己可见</span>`
              : ""
          }
          ${demo ? `<span class="tag tag--quiet">示例</span>` : ""}
        </div>
        <h3 class="slide-card__title">${esc(slide.title)}</h3>
        <p class="slide-card__desc">${esc(slide.description || "")}</p>
      </div>
      <footer class="slide-card__foot">
        <span class="meta">${esc(slide.author || "匿名")}</span>
        <span class="meta">${slide.aiReview ? "有评语" : "待评"}</span>
      </footer>
    </article>
  `;
}
