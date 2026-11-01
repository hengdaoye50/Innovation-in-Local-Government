/** 文献共读页 —— 正文、脉络图、讨论 */
import { esc } from "../lib/dom.js";
import { api } from "../lib/api.js";
import { createCommentBlock } from "../components/comments.js";

const shell = (inner) => `<div class="shell shell-narrow">${inner}</div>`;

export async function mountReading(root, id) {
  root.innerHTML = shell(`<div class="detail__loading"><div class="skeleton" style="height:40px;width:50%"></div></div>`);

  let reading = null;
  try {
    const res = await fetch(`./data/readings/${encodeURIComponent(id)}.json`);
    if (!res.ok) throw new Error("没有这篇文献");
    reading = await res.json();
  } catch {
    root.innerHTML = `<div class="shell shell-narrow empty">
      <div class="screen-ordinal">未找到</div>
      <h1 class="h2" style="margin:12px 0 16px">这篇文献还没有入库</h1>
      <a class="btn btn--ghost btn--sm" href="#blog">回到文献共读</a>
    </div>`;
    return;
  }

  const totalChars = reading.sections.reduce(
    (sum, s) => sum + s.paragraphs.reduce((n, p) => n + p.length, 0),
    0
  );

  root.innerHTML = `
    <article class="detail detail--reading">
      <div class="shell shell-narrow">
        <a class="detail__back" href="#blog">回到文献共读</a>
        <header class="detail__head">
          <div class="detail__place">
            <span class="detail__place-dot"></span>
            ${esc(reading.author)} · ${esc(reading.reference.match(/Qualitative Inquiry[^,]*/)?.[0] || "文献共读")}
          </div>
          <h1 class="detail__title">${esc(reading.titleZh)}</h1>
          <p class="reading__origin">${esc(reading.title)}</p>
          <div class="detail__meta">
            <span class="meta mono">${reading.sections.length} 节</span>
            <span class="meta mono">${Math.round(totalChars / 1000)}k 字符</span>
            <a class="meta" href="${esc(reading.link)}" target="_blank" rel="noopener noreferrer">原文地址</a>
          </div>
        </header>

        <div class="detail__layout reading__layout">
          <div class="reading__body" data-reading-body>
            ${reading.sections.map((s, si) => sectionHtml(s, si)).join("")}
          </div>

          <aside class="detail__margin reading__toc" aria-label="章节">
            <div class="detail__margin-block">
              <div class="eyebrow">Sections</div>
              <ol class="reading__toc-list">
                ${reading.sections
                  .map(
                    (s, si) =>
                      `<li><a href="#" data-toc="${si}"><span class="mono">${String(
                        si + 1
                      ).padStart(2, "0")}</span>${esc(s.titleZh)}</a></li>`
                  )
                  .join("")}
              </ol>
            </div>
          </aside>
        </div>

        <section class="reading__mindmap" data-mindmap>
          <div class="reading__mindmap-head">
            <div class="eyebrow">Mindmap</div>
            <h2 class="h3">整篇的脉络</h2>
            <p class="field__hint">由模型通读全文后整理，只梳理论证结构，不复述原文。</p>
          </div>
          <div class="reading__mindmap-body" data-mindmap-body>
            <div class="skeleton" style="height:220px"></div>
          </div>
        </section>

        <div class="reading__discuss" data-discuss></div>
      </div>
    </article>
  `;

  // 章节导航：点一下滚到对应小节
  root.querySelectorAll("[data-toc]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const target = root.querySelector(`[data-section="${link.dataset.toc}"]`);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  qs(root, "[data-discuss]").append(
    createCommentBlock({ targetType: "reading", targetId: reading.id })
  );

  document.title = `${reading.titleZh} · 文献共读`;
  loadMindmap(root, reading.id);
}

function qs(root, selector) {
  return root.querySelector(selector);
}

function sectionHtml(section, sectionIndex) {
  return `
    <section class="reading__section" data-section="${sectionIndex}" id="sec-${sectionIndex}">
      <h2 class="reading__section-title">
        <span class="reading__section-no mono">${String(sectionIndex + 1).padStart(2, "0")}</span>
        ${esc(section.titleZh)}
        <span class="reading__section-origin">${esc(section.title)}</span>
      </h2>
      ${section.paragraphs
        .map(
          (p, pi) =>
            `<p class="reading__para" data-para="${sectionIndex}-${pi}">${esc(p)}</p>`
        )
        .join("")}
    </section>
  `;
}

async function loadMindmap(root, id) {
  const host = qs(root, "[data-mindmap-body]");
  if (!host) return;
  try {
    const data = await api.get(`/api/readings/${encodeURIComponent(id)}/mindmap`);
    const map = data?.mindmap;
    if (!map) throw new Error("没有返回导图");
    host.innerHTML = mindmapHtml(map);
  } catch (err) {
    host.innerHTML = `<p class="field__hint">脉络图暂时没有生成出来：${esc(
      err.message || "请稍后刷新"
    )}</p>`;
  }
}

function mindmapHtml(map) {
  return `
    <div class="mindmap">
      <div class="mindmap__root">${esc(map.root)}</div>
      <ul class="mindmap__branches">
        ${map.branches
          .map(
            (b) => `
          <li class="mindmap__branch">
            <h4 class="mindmap__branch-title">${esc(b.title)}</h4>
            <ul class="mindmap__points">
              ${b.points.map((p) => `<li>${esc(p)}</li>`).join("")}
            </ul>
          </li>`
          )
          .join("")}
      </ul>
    </div>
  `;
}
