/** 调研足迹 —— 第五屏：师生实地调研的见闻记录 */
import { esc, mountReveal } from "../lib/dom.js";
import { surveys as surveysApi } from "../lib/api.js";

export function fieldSection() {
  return `
    <section id="field" class="screen field" aria-labelledby="field-title">
      <div class="shell">
        <div class="screen-head reveal">
          <div class="screen-head__text">
            <div class="screen-ordinal">05 / 田野</div>
            <h2 id="field-title">调研足迹</h2>
            <p class="lede">
              课上真正走出去看过的地方。游记、见闻、随手记都行，不必写成案例——
              留着给下一次去的人当线索。
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
    listEl.innerHTML = `<div class="empty">还没有调研记录。第一次走出去之后，把见闻记在这里。</div>`;
    mountReveal(section);
    return;
  }

  listEl.innerHTML = items.map((s, i) => rowHtml(s, i, items.length)).join("");
  listEl.querySelectorAll("[data-survey]").forEach((node) => {
    node.addEventListener("click", () => {
      window.location.hash = `/field/${node.dataset.survey}`;
    });
  });
  mountReveal(section);
}

function rowHtml(survey, index, total) {
  const place = [survey.province, survey.city, survey.district]
    .filter((p, i, arr) => p && arr.indexOf(p) === i)
    .join(" · ");
  const when = survey.visitedAt || (survey.createdAt || "").slice(0, 7);
  const excerpt = (survey.body || "").replace(/\s+/g, " ").slice(0, 96);

  return `
    <article class="field-row reveal" data-survey="${esc(survey.id)}" tabindex="0" role="link"
      aria-label="${esc(survey.title)}">
      <div class="field-row__index mono">${String(index + 1).padStart(2, "0")}<i>/ ${String(
    total
  ).padStart(2, "0")}</i></div>
      <div class="field-row__main">
        <div class="field-row__meta">
          <span class="field-row__place">${esc(place)}</span>
          ${when ? `<span class="meta mono">${esc(when)}</span>` : ""}
          <span class="meta">${esc(survey.author)}</span>
        </div>
        <h3 class="field-row__title">${esc(survey.title)}</h3>
        <p class="field-row__excerpt">${esc(excerpt)}${survey.body.length > 96 ? "…" : ""}</p>
      </div>
      <span class="field-row__go" aria-hidden="true">
        <svg viewBox="0 0 12 8"><path d="M1 4h10M8 1l3 3-3 3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>
    </article>
  `;
}
