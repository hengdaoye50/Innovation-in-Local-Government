/** 课堂展示板 */
import { esc, mountReveal } from "../lib/dom.js";
import { slides as slidesApi } from "../lib/api.js";
import { DEMO_SLIDES } from "../lib/demo.js";

export function slidesSection() {
  return `
    <section id="slides" class="screen boards" aria-labelledby="slides-title">
      <div class="shell">
        <div class="screen-head reveal">
          <div class="screen-head__text">
            <div class="screen-ordinal">03 / 课堂</div>
            <h2 id="slides-title">课堂展示板</h2>
            <p class="lede">
              每个展位是一次课堂汇报。模型评委先读一遍并留下评语，同学和老师可以在下面接着讨论——
              同意、反驳，或者补上它漏掉的那一环。
            </p>
          </div>
          <a class="btn btn--ghost" href="#/admin">教师上传展位</a>
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

  let list = [];
  let demo = false;
  try {
    const res = await slidesApi.list({ limit: 12 });
    list = Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : [];
  } catch {
    list = [];
  }
  if (!list.length) {
    list = DEMO_SLIDES;
    demo = true;
  }

  grid.innerHTML = list.map((s, i) => cardHtml(s, i, demo)).join("");
  grid.querySelectorAll("[data-slide]").forEach((node) => {
    node.addEventListener("click", () => {
      window.location.hash = `/slide/${node.dataset.slide}`;
    });
  });
  mountReveal(section);
}

function cardHtml(slide, index, demo) {
  const score = Number(slide.aiScore) || null;
  return `
    <article class="slide-card reveal" data-slide="${esc(slide.id)}" tabindex="0" role="link"
      aria-label="${esc(slide.title)}">
      <div class="slide-card__cover">
        <span class="slide-card__no mono">${String(index + 1).padStart(2, "0")}</span>
        <span class="slide-card__pages mono">${Number(slide.slides) || 0} 页</span>
        <div class="slide-card__cover-rule"></div>
      </div>
      <div class="slide-card__body">
        <div class="slide-card__meta">
          <span class="tag tag--quiet">${esc(slide.course || "课堂汇报")}</span>
          ${slide.term ? `<span class="meta">${esc(slide.term)}</span>` : ""}
          ${demo ? `<span class="tag tag--quiet">示例</span>` : ""}
        </div>
        <h3 class="slide-card__title">${esc(slide.title)}</h3>
        <p class="slide-card__desc">${esc(slide.description || "")}</p>
      </div>
      <footer class="slide-card__foot">
        <span class="meta">${esc(slide.author || "匿名")}</span>
        ${
          score
            ? `<span class="slide-card__score mono">AI ${score}</span>`
            : `<span class="meta">待评</span>`
        }
      </footer>
    </article>
  `;
}
