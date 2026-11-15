/** 调研足迹：图文阅读页 */
import { esc, toast, zhWords, confirmDialog } from "../lib/dom.js";
import { surveys as surveysApi } from "../lib/api.js";
import { renderProse, stripMarkdown } from "../lib/markdown.js";
import { getState } from "../lib/store.js";
import { SITE } from "../components/chrome.js";

const placeOf = (s) =>
  [s.province, s.city, s.district].filter((p, i, arr) => p && arr.indexOf(p) === i).join(" · ");

const isStaff = () => ["teacher", "admin"].includes(getState().user?.role);

/* ————————— 阅读页 ————————— */

export async function mountSurveyDetail(root, id) {
  root.innerHTML = `<div class="shell shell-narrow detail__loading">
    <div class="skeleton" style="height:44px;width:58%"></div>
    <div class="skeleton" style="height:280px;margin-top:24px"></div>
  </div>`;

  let survey = null;
  try {
    survey = await surveysApi.detail(id);
  } catch {
    survey = null;
  }
  if (!survey) {
    root.innerHTML = `<div class="shell shell-narrow empty">
      <div class="screen-ordinal">未找到</div>
      <h1 class="h2" style="margin:12px 0 16px">这条调研记录不在了</h1>
      <a class="btn btn--ghost btn--sm" href="#field">回到调研足迹</a>
    </div>`;
    return;
  }

  const viewer = getState().user;
  const ownIt = viewer && viewer.id === survey.authorId;
  const canEdit = ownIt || isStaff();
  const canRemove = ownIt || isStaff();

  const bodyHtml = renderProse(survey.body || "");
  const words = zhWords(stripMarkdown(survey.body || "", 100_000));
  const photos = survey.imageCount || 0;
  const headings = pickHeadings(bodyHtml);
  // 保存后立刻会写 updated_at，几秒内的差异不算「改过」
  const wasEdited =
    Boolean(survey.updatedAt) &&
    Math.abs(new Date(survey.updatedAt) - new Date(survey.createdAt || 0)) > 60_000;

  root.innerHTML = `
    <article class="field-read" data-field-read>
      <div class="field-read__progress" aria-hidden="true"><i data-progress-bar></i></div>

      <div class="shell field-read__shell">
        <a class="detail__back" href="#field">回到调研足迹</a>

        <header class="field-read__head">
          <div class="field-read__kicker">
            <span class="field-read__place"><span class="detail__place-dot"></span>${esc(placeOf(survey))}</span>
            ${survey.visitedAt ? `<span class="meta mono">${esc(survey.visitedAt)} 走过</span>` : ""}
            <span class="meta mono">${words} 字</span>
            ${photos ? `<span class="meta mono">${photos} 张照片</span>` : ""}
            ${survey.status !== "published" ? `<span class="tag tag--quiet">已下架，仅自己可见</span>` : ""}
          </div>
          <h1 class="field-read__title">${esc(survey.title)}</h1>
          <div class="field-read__byline">
            <span class="meta">${esc(survey.author)}</span>
            <span class="meta mono">${esc((survey.createdAt || "").slice(0, 10))} 记</span>
            ${
              wasEdited
                ? `<span class="meta mono">${esc(survey.updatedAt.slice(0, 10))} 改过</span>`
                : ""
            }
          </div>
          ${
            canEdit || canRemove
              ? `<div class="field-read__actions">
                  ${canEdit ? `<a class="btn btn--ghost btn--sm" href="#/field/${esc(survey.id)}/edit">编辑这条</a>` : ""}
                  ${canRemove ? `<button class="btn btn--quiet btn--sm" type="button" data-remove>删除</button>` : ""}
                </div>`
              : ""
          }
        </header>

        <div class="field-read__layout">
          <div class="field-read__body md" data-prose>${bodyHtml}</div>

          <aside class="field-read__aside" aria-label="页内信息">
            ${
              headings.length > 1
                ? `<nav class="field-read__toc" data-toc>
                    <div class="eyebrow">写到了</div>
                    ${headings
                      .map(
                        (h) =>
                          `<a class="field-read__toc-item" href="#${esc(h.id)}" data-toc-jump="${esc(h.id)}">${esc(h.text)}</a>`
                      )
                      .join("")}
                  </nav>`
                : ""
            }
            <div class="field-read__stamp">
              <div class="eyebrow">This footprint</div>
              <dl class="field-read__facts">
                <dt>地点</dt><dd>${esc(placeOf(survey))}</dd>
                ${survey.visitedAt ? `<dt>成行</dt><dd class="mono">${esc(survey.visitedAt)}</dd>` : ""}
                <dt>记录</dt><dd class="mono">${esc((survey.createdAt || "").slice(0, 10))}</dd>
                <dt>篇幅</dt><dd class="mono">${words} 字${photos ? ` · ${photos} 图` : ""}</dd>
              </dl>
            </div>
          </aside>
        </div>

        <footer class="field-read__foot">
          <p class="field-read__sign">
            这段路是 ${esc(survey.author)} 在 ${esc(survey.visitedAt || (survey.createdAt || "").slice(0, 7))} 走的，
            留给下一次去的人当线索。
          </p>
          <a class="btn btn--ghost btn--sm" href="#/field/new">我也记一次</a>
        </footer>
      </div>
    </article>
  `;

  root.querySelector("[data-remove]")?.addEventListener("click", async () => {
    const yes = await confirmDialog({
      title: "删除这条记录",
      html: `<p>删除后不再出现在调研足迹里，正文和照片一并下架。</p>`,
      confirmText: "删除",
    });
    if (!yes) return;
    try {
      await surveysApi.remove(survey.id);
      toast("已删除");
      window.location.hash = "/field";
    } catch (err) {
      toast(err.message || "删除失败", { type: "error" });
    }
  });

  mountLightbox(root);
  mountProgress(root);
  mountToc(root);

  document.title = `${survey.title} · 调研足迹 · ${SITE.name}`;
}

/** 正文里的小标题当目录用；只取 h2，太细的层级在侧栏里排不下 */
function pickHeadings(html) {
  if (!html.includes("<h2")) return [];
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  return Array.from(tpl.content.querySelectorAll("h2")).map((node, i) => {
    const text = node.textContent.trim();
    return { id: `sec-${i + 1}`, text: text.length > 18 ? `${text.slice(0, 18)}…` : text };
  });
}

/** 给正文标题补上锚点 id，目录才能跳 */
function mountToc(root) {
  const links = root.querySelectorAll("[data-toc-jump]");
  if (!links.length) return;
  const headings = root.querySelectorAll("[data-prose] h2");
  headings.forEach((node, i) => {
    node.id = `sec-${i + 1}`;
  });
  links.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const target = root.querySelector(`#${link.dataset.tocJump}`);
      if (!target) return;
      target.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
    });
  });
}

/** 顶部细进度条：读到哪儿一目了然，长游记尤其需要 */
function mountProgress(root) {
  const article = root.querySelector("[data-field-read]");
  const bar = root.querySelector("[data-progress-bar]");
  if (!article || !bar) return;

  const update = () => {
    // 页面已被路由换掉，顺手解绑
    if (!document.body.contains(article)) {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      return;
    }
    const rect = article.getBoundingClientRect();
    const total = rect.height - window.innerHeight;
    const passed = Math.min(Math.max(-rect.top, 0), Math.max(total, 1));
    const ratio = total > 0 ? passed / total : 0;
    bar.style.transform = `scaleX(${ratio.toFixed(4)})`;
  };

  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
  update();
}

/** 点图放大：游记里的照片值得看大图 */
function mountLightbox(root) {
  const figures = root.querySelectorAll("[data-prose] img");
  if (!figures.length) return;

  let host = null;

  const close = () => {
    host?.remove();
    host = null;
    document.body.classList.remove("is-lightbox");
    document.removeEventListener("keydown", onKey);
  };

  const onKey = (event) => {
    if (event.key === "Escape") close();
  };

  const open = (img) => {
    close();
    host = document.createElement("div");
    host.className = "lightbox";
    host.setAttribute("role", "dialog");
    host.setAttribute("aria-modal", "true");
    host.innerHTML = `
      <button class="lightbox__close" type="button" aria-label="关闭">×</button>
      <figure class="lightbox__stage">
        <img src="${esc(img.getAttribute("src") || "")}" alt="${esc(img.getAttribute("alt") || "")}" />
        ${img.getAttribute("alt") ? `<figcaption>${esc(img.getAttribute("alt"))}</figcaption>` : ""}
      </figure>
    `;
    host.addEventListener("click", (event) => {
      if (event.target === host || event.target.closest(".lightbox__close")) close();
    });
    document.body.append(host);
    document.body.classList.add("is-lightbox");
    document.addEventListener("keydown", onKey);
    // 页面被路由换掉时也一并收走浮层
    window.setTimeout(() => {
      if (host && !document.body.contains(root)) close();
    }, 3000);
  };

  figures.forEach((img) => {
    img.classList.add("is-zoomable");
    img.setAttribute("tabindex", "0");
    img.setAttribute("role", "button");
    img.addEventListener("click", () => open(img));
    img.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open(img);
      }
    });
  });
}
