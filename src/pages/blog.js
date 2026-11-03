/** 文献共读展板（原拓展材料） */
import { esc, mountReveal } from "../lib/dom.js";

export function blogSection() {
  return `
    <section id="blog" class="screen blog" aria-labelledby="blog-title">
      <div class="shell">
        <div class="screen-head reveal">
          <div class="screen-head__text">
            <div class="screen-ordinal">04 / 文献共读</div>
            <h2 id="blog-title">文献共读</h2>
            <p class="lede">
              课堂上一起读的方法论文献。可以在正文上划线、写边注，文末有整篇的脉络图和讨论区。
            </p>
          </div>
        </div>

        <div class="reading-list" data-reading-list>
          <div class="skeleton" style="height: 140px"></div>
        </div>
      </div>
    </section>
  `;
}

export async function mountBlog(root) {
  const section = root.querySelector("#blog");
  if (!section) return;
  const listEl = section.querySelector("[data-reading-list]");

  let items = [];
  try {
    const res = await fetch("./data/readings/index.json");
    const data = await res.json();
    items = Array.isArray(data?.items) ? data.items : [];
  } catch {
    items = [];
  }

  if (!items.length) {
    listEl.innerHTML = `<div class="empty">还没有入库的文献。</div>`;
    return;
  }

  listEl.innerHTML = items.map((r, i) => rowHtml(r, i, items.length)).join("");
  mountReveal(section);
}

function rowHtml(reading, index, total) {
  return `
    <a class="reading-row reveal" href="#/reading/${esc(reading.id)}"
      aria-label="${esc(reading.titleZh)}">
      <div class="reading-row__index mono">${String(index + 1).padStart(2, "0")}<i>/ ${String(
    total
  ).padStart(2, "0")}</i></div>
      <div class="reading-row__main">
        <div class="reading-row__meta">
          <span class="meta">${reading.author}</span>
          <span class="meta mono">${reading.sections} 节 · ${reading.paragraphs} 段</span>
        </div>
        <h3 class="reading-row__title">${reading.titleZh}</h3>
        <p class="reading-row__origin">${reading.title}</p>
      </div>
      <span class="reading-row__go" aria-hidden="true">
        <svg viewBox="0 0 12 8"><path d="M1 4h10M8 1l3 3-3 3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>
    </a>
  `;
}
