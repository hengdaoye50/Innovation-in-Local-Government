/** 文献共读页 —— 正文、划词标注与边注、脉络图、讨论 */
import { esc } from "../lib/dom.js";
import { api } from "../lib/api.js";
import { getState } from "../lib/store.js";
import { toast } from "../lib/dom.js";
import { createCommentBlock } from "../components/comments.js";

const COLORS = { gold: "金色", plum: "紫色", green: "绿色" };

/** 一段里可能落着多条标注，按偏移切开再包 <mark>，避免嵌套错位 */
function inlineHtml(text, marks) {
  if (!marks.length) return esc(text);
  const sorted = [...marks].sort((a, b) => a.start - b.start);
  let html = "";
  let cursor = 0;
  for (const m of sorted) {
    if (m.start < cursor || m.end > text.length) continue;
    html += esc(text.slice(cursor, m.start));
    html += `<mark class="hl hl--${esc(m.color)}" data-annotation="${m.id}">${esc(
      text.slice(m.start, m.end)
    )}</mark>`;
    cursor = m.end;
  }
  html += esc(text.slice(cursor));
  return html;
}

export async function mountReading(root, id) {
  root.innerHTML = `<div class="shell shell-narrow"><div class="skeleton" style="height:40px;width:50%"></div></div>`;

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
  const viewer = getState().user;
  // 未登录与观察员都不能标注；观察员是「只读」，未登录是「先登录再说」
  const canAnnotate = Boolean(viewer) && viewer.role !== "observer";

  root.innerHTML = `
    <article class="detail detail--reading">
      <div class="shell shell-narrow">
        <a class="detail__back" href="#blog">回到文献共读</a>
        <header class="detail__head">
          <div class="detail__place">
            <span class="detail__place-dot"></span>
            ${esc(reading.author)} · Qualitative Inquiry
          </div>
          <h1 class="detail__title">${esc(reading.titleZh)}</h1>
          <p class="reading__origin">${esc(reading.title)}</p>
          <div class="detail__meta">
            <span class="meta mono">${reading.sections.length} 节</span>
            <span class="meta mono">${Math.round(totalChars / 1000)}k 字符</span>
            <a class="meta" href="${esc(reading.link)}" target="_blank" rel="noopener noreferrer">原文地址</a>
            ${canAnnotate ? `<span class="meta">选中正文可以划线或写边注</span>` : ""}
          </div>
        </header>

        <div class="detail__layout reading__layout">
          <div class="reading__body" data-reading-body>
            ${reading.sections.map((s, si) => sectionHtml(s, si)).join("")}
          </div>

          <aside class="detail__margin reading__side" aria-label="章节与批注">
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
            <div class="detail__margin-block reading__notes-block">
              <div class="eyebrow">Notes</div>
              <div class="reading__notes" data-notes>
                <p class="detail__margin-note">还没有批注。</p>
              </div>
            </div>
          </aside>
        </div>

        <section class="reading__mindmap">
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
      <div class="hl-bar" data-hl-bar hidden>
        <div class="hl-bar__row" data-hl-actions>
          <button class="hl-bar__btn" type="button" data-hl-color="gold">划线</button>
          <button class="hl-bar__btn" type="button" data-hl-note>写边注</button>
        </div>
        <div class="hl-bar__compose" data-hl-compose hidden>
          <textarea class="hl-bar__input" rows="2" placeholder="这段为什么值得标出来？" data-hl-input></textarea>
          <div class="hl-bar__compose-bar">
            <div class="hl-bar__colors">
              ${Object.entries(COLORS)
                .map(
                  ([key, label]) =>
                    `<button type="button" class="hl-dot hl-dot--${key}${
                      key === "gold" ? " is-on" : ""
                    }" data-hl-pick="${key}" aria-label="${label}"></button>`
                )
                .join("")}
            </div>
            <button class="btn btn--primary btn--sm" type="button" data-hl-save>保存</button>
          </div>
        </div>
      </div>
    </article>
  `;

  const body = root.querySelector("[data-reading-body]");
  const bar = root.querySelector("[data-hl-bar]");
  const notesHost = root.querySelector("[data-notes]");

  /** @type {Array} */
  let annotations = [];
  let pending = null; // 待保存的选区
  let pickColor = "gold";

  root.querySelectorAll("[data-toc]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      root
        .querySelector(`[data-section="${link.dataset.toc}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  root.querySelector("[data-discuss]").append(
    createCommentBlock({ targetType: "reading", targetId: reading.id })
  );

  document.title = `${reading.titleZh} · 文献共读`;

  /* —— 标注：加载与渲染 —— */

  function byParagraph() {
    const map = new Map();
    for (const a of annotations) {
      if (!map.has(a.paragraphKey)) map.set(a.paragraphKey, []);
      map.get(a.paragraphKey).push(a);
    }
    return map;
  }

  function paint() {
    const grouped = byParagraph();
    reading.sections.forEach((section, si) => {
      section.paragraphs.forEach((text, pi) => {
        const node = body.querySelector(`[data-para="${si}-${pi}"]`);
        if (!node) return;
        node.innerHTML = inlineHtml(text, grouped.get(`${si}-${pi}`) || []);
      });
    });
    paintNotes();
  }

  function paintNotes() {
    const withNote = annotations.filter((a) => a.note);
    if (!withNote.length) {
      notesHost.innerHTML = `<p class="detail__margin-note">还没有批注。</p>`;
      return;
    }
    notesHost.innerHTML = withNote
      .map(
        (a) => `
        <div class="reading__note" data-note-for="${a.id}">
          <div class="reading__note-head">
            <span class="mono">¶${String(Number(a.paragraphKey.split("-")[1]) + 1).padStart(
              2,
              "0"
            )}</span>
            <span class="reading__note-author">${esc(a.authorName)}</span>
          </div>
          <p class="reading__note-quote">${esc(a.quote.slice(0, 40))}${
          a.quote.length > 40 ? "…" : ""
        }</p>
        <p class="reading__note-body">${esc(a.note)}</p>
        </div>`
      )
      .join("");

    notesHost.querySelectorAll("[data-note-for]").forEach((node) => {
      node.addEventListener("click", () => {
        const mark = body.querySelector(`[data-annotation="${node.dataset.noteFor}"]`);
        mark?.scrollIntoView({ behavior: "smooth", block: "center" });
        mark?.classList.add("is-flash");
        setTimeout(() => mark?.classList.remove("is-flash"), 1200);
      });
    });
  }

  async function loadAnnotations() {
    try {
      const data = await api.get(`/api/readings/${encodeURIComponent(reading.id)}/annotations`);
      annotations = Array.isArray(data?.items) ? data.items : [];
    } catch {
      annotations = [];
    }
    paint();
  }

  /* —— 划词 —— */

  const paraOf = (node) =>
    node?.nodeType === 1 ? node.closest("[data-para]") : node?.parentElement?.closest("[data-para]");

  function offsetInPara(para, node, offset) {
    const range = document.createRange();
    range.selectNodeContents(para);
    range.setEnd(node, offset);
    return range.toString().length;
  }

  function hideBar() {
    bar.hidden = true;
    bar.querySelector("[data-hl-actions]").hidden = false;
    bar.querySelector("[data-hl-compose]").hidden = true;
    bar.querySelector("[data-hl-input]").value = "";
    pending = null;
  }

  function placeBar(rect) {
    bar.hidden = false;
    bar.querySelector("[data-hl-actions]").hidden = false;
    bar.querySelector("[data-hl-compose]").hidden = true;
    const width = bar.offsetWidth || 160;
    const left = Math.min(
      Math.max(rect.left + rect.width / 2 - width / 2, 12),
      window.innerWidth - width - 12
    );
    bar.style.left = `${left}px`;
    bar.style.top = `${Math.max(rect.top - 48, 12)}px`;
  }

  document.addEventListener("mouseup", (event) => {
    if (!canAnnotate) return;
    if (bar.contains(event.target)) return;
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      const startPara = paraOf(range.startContainer);
      const endPara = paraOf(range.endContainer);
      if (!startPara || startPara !== endPara) return;
      const start = offsetInPara(startPara, range.startContainer, range.startOffset);
      const end = offsetInPara(startPara, range.endContainer, range.endOffset);
      if (end - start < 2) return;
      pending = {
        paragraphKey: startPara.dataset.para,
        start,
        end,
        quote: range.toString(),
      };
      placeBar(range.getBoundingClientRect());
    }, 0);
  });

  bar.querySelector("[data-hl-note]").addEventListener("click", () => {
    bar.querySelector("[data-hl-actions]").hidden = true;
    const compose = bar.querySelector("[data-hl-compose]");
    compose.hidden = false;
    bar.querySelector("[data-hl-input]").focus();
  });

  bar.querySelectorAll("[data-hl-pick]").forEach((dot) => {
    dot.addEventListener("click", () => {
      pickColor = dot.dataset.hlPick;
      bar.querySelectorAll("[data-hl-pick]").forEach((d) => d.classList.toggle("is-on", d === dot));
    });
  });

  bar.querySelectorAll("[data-hl-color]").forEach((btn) => {
    btn.addEventListener("click", () => saveAnnotation(false));
  });
  bar.querySelector("[data-hl-save]").addEventListener("click", () => saveAnnotation(true));

  async function saveAnnotation(withNote) {
    if (!pending) return;
    const note = withNote ? bar.querySelector("[data-hl-input]").value.trim() : "";
    try {
      await api.post(`/api/readings/${encodeURIComponent(reading.id)}/annotations`, {
        paragraph_key: pending.paragraphKey,
        start_offset: pending.start,
        end_offset: pending.end,
        quote: pending.quote,
        color: pickColor,
        note,
      });
      window.getSelection()?.removeAllRanges();
      hideBar();
      await loadAnnotations();
      toast(withNote ? "边注已保存" : "已划线");
    } catch (err) {
      toast(err.message || "保存失败", { type: "error" });
    }
  }

  // 点已有的标注：本人或教师可以删除
  body.addEventListener("click", async (event) => {
    const mark = event.target.closest("[data-annotation]");
    if (!mark) return;
    const id = Number(mark.dataset.annotation);
    const target = annotations.find((a) => a.id === id);
    if (!target) return;
    const me = getState().user;
    const canDelete = me && (me.id === target.authorId || me.role === "teacher" || me.role === "admin");
    if (!canDelete) {
      if (target.note) toast(target.note);
      return;
    }
    if (!window.confirm("删除这条标注？")) return;
    try {
      await api.del(`/api/readings/${encodeURIComponent(reading.id)}/annotations/${id}`);
      await loadAnnotations();
    } catch (err) {
      toast(err.message || "删除失败", { type: "error" });
    }
  });

  document.addEventListener("click", (event) => {
    if (!bar.hidden && !bar.contains(event.target)) hideBar();
  });

  // 工具条用 fixed 定位贴着选区，一旦滚动就会和文字错开，直接收起
  window.addEventListener("scroll", () => {
    if (!bar.hidden) hideBar();
  }, { passive: true });

  loadAnnotations();
  loadMindmap(root, reading.id);
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
  const host = root.querySelector("[data-mindmap-body]");
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
