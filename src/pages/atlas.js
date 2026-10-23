/** 地图屏 —— 首屏 */
import { el, esc, mountCounters, qs } from "../lib/dom.js";
import { createMap } from "../components/map.js";
import { ICONS } from "../components/chrome.js";
import { getState, setState } from "../lib/store.js";
import { navigate } from "../lib/router.js";
import { DEMO_CASES } from "../lib/demo.js";
import { cases as casesApi } from "../lib/api.js";

export function atlasSection() {
  return `
    <section id="atlas" class="atlas" aria-labelledby="atlas-title">
      <div class="shell atlas__head">
        <div class="atlas__title-block">
          <div class="atlas__eyebrow">Local Governance Innovation Atlas</div>
          <h1 class="atlas__title" id="atlas-title">
            地方创变，<em>落在地图上</em>
          </h1>
          <p class="atlas__sub">
            每一枚光点，都是一位同学从公开新闻出发、与模型协同检索后写下的案例梗概。
          </p>
        </div>
        <div class="atlas__stats" aria-label="案例统计">
          <div class="stat">
            <div class="stat__num" data-count="0" data-count-node="total">0</div>
            <div class="stat__label">案例</div>
          </div>
          <div class="stat">
            <div class="stat__num" data-count="0" data-count-node="provinces">0</div>
            <div class="stat__label">省级行政区</div>
          </div>
          <div class="stat">
            <div class="stat__num" data-count="0" data-count-node="authors">0</div>
            <div class="stat__label">参与同学</div>
          </div>
        </div>
      </div>

      <div class="atlas__stage">
        <div class="map-canvas" data-pending="1"></div>

        <div class="atlas__legend" aria-hidden="true">
          <div class="legend__row"><span class="legend__dot"></span>单个案例</div>
          <div class="legend__row"><span class="legend__dot legend__dot--lg"></span>多案例同城</div>
          <div class="legend__row"><span class="legend__line"></span>省级边界</div>
        </div>

        <div class="atlas__controls">
          <button class="ctrl" data-map="zoom-in" title="放大" aria-label="放大">
            ${ICONS.zoom}
          </button>
          <button class="ctrl" data-map="zoom-out" title="缩小" aria-label="缩小">
            ${ICONS.zoomOut}
          </button>
          <button class="ctrl" data-map="reset" title="复位视角" aria-label="复位视角">
            ${ICONS.reset}
          </button>
        </div>

        <div class="atlas__hint" data-atlas-hint>
          <span>拖动移动 · Ctrl + 滚轮缩放 · 点击光点展开关联</span>
          ${ICONS.arrowDown}
        </div>

        <div class="map-focus-card" data-focus-card hidden></div>
        <div class="atlas__drawer" hidden></div>
      </div>
    </section>
  `;
}

export async function mountAtlas(root) {
  const section = qs("#atlas", root);
  if (!section) return null;

  const canvasHost = qs(".map-canvas", section);
  const drawer = qs(".atlas__drawer", section);
  const focusCard = qs("[data-focus-card]", section);
  const hint = qs("[data-atlas-hint]", section);
  const defaultHint = hint?.innerHTML || "";

  let focusNode = null;

  const map = createMap(canvasHost, {
    onSelect: (item, extra) => {
      if (extra?.list?.length) {
        openDrawer(extra.list, extra.node || item);
        return;
      }
      if (item?.id) navigate(`/case/${item.id}`);
    },
    onFocus: (node, info) => {
      focusNode = node;
      if (!node || !info) {
        closeFocusCard();
        return;
      }
      showFocusCard(node, info);
    },
  });

  function closeFocusCard() {
    focusCard.classList.remove("is-open");
    focusCard.hidden = true;
    if (hint) hint.innerHTML = defaultHint;
  }

  function showFocusCard(node, info) {
    const related = info.related || [];
    const tags = (node.domains || [])
      .slice(0, 3)
      .map((d) => `<span class="tag tag--quiet">${esc(d)}</span>`)
      .join("");

    focusCard.innerHTML = `
      <div class="map-focus-card__top">
        <span class="map-focus-card__place">${[node.province, node.city, node.district]
          .filter((p, i, arr) => p && arr.indexOf(p) === i)
          .map(esc)
          .join(" · ")}</span>
        <button class="map-focus-card__close" data-focus-close aria-label="关闭">
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" stroke-width="1.3">
            <path d="M1 1l8 8M9 1L1 9" stroke-linecap="round" />
          </svg>
        </button>
      </div>
      <h3 class="map-focus-card__title">${esc(node.title)}</h3>
      ${tags ? `<div class="map-focus-card__tags">${tags}</div>` : ""}
      ${
        related.length
          ? `<div class="map-focus-card__related">同领域另有 <b>${related.length}</b> 个案例在这张图里${
              related.length > 3
                ? `，如 ${related.slice(0, 2).map((r) => esc(r.city || r.province)).join("、")} 等`
                : related.map((r) => ` · ${esc(r.city || r.province)}`).join("")
            }</div>`
          : `<div class="map-focus-card__related">暂无同领域的其他案例</div>`
      }
      <button class="map-focus-card__go" data-focus-go>
        ${node.count > 1 ? `查看这 ${node.count} 个案例` : "阅读完整案例"}
        <svg viewBox="0 0 12 8" aria-hidden="true"><path d="M1 4h10M8 1l3 3-3 3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    `;

    focusCard.hidden = false;

    // 先量出真实尺寸再定位，避免贴边溢出
    const cardW = focusCard.offsetWidth || 320;
    const cardH = focusCard.offsetHeight || 200;
    const stageW = info.rect.width;
    const stageH = info.rect.height;

    let left = info.x + 52;
    if (left + cardW > stageW - 16) left = info.x - cardW - 52;
    if (left < 16) left = Math.min(16, stageW - cardW - 16);

    let top = info.y - cardH / 2;
    top = Math.max(16, Math.min(top, stageH - cardH - 16));

    focusCard.style.left = `${Math.round(left)}px`;
    focusCard.style.top = `${Math.round(top)}px`;

    // 下一帧再加 is-open，让过渡动画生效
    requestAnimationFrame(() => focusCard.classList.add("is-open"));

    if (hint) {
      hint.innerHTML = `<span>再点光点或下方按钮进入案例 · 按 Esc 返回</span>`;
    }
  }

  focusCard.addEventListener("click", (event) => {
    if (event.target.closest("[data-focus-close]")) {
      map.exitAtlas();
      return;
    }
    if (!focusNode) return;
    if (focusNode.count > 1) {
      openDrawer(focusNode.items, focusNode);
      return;
    }
    if (focusNode.primary?.id) navigate(`/case/${focusNode.primary.id}`);
  });

  function openDrawer(list, node) {
    // 抽屉与悬浮卡都在右侧，先退出分析态免得叠在一起
    map?.exitAtlas();
    closeFocusCard();

    const place = [node.province, node.city, node.district]
      .filter((p, i, arr) => p && arr.indexOf(p) === i)
      .map(esc)
      .join(" · ");

    drawer.innerHTML = `
      <div class="drawer__head">
        <span class="drawer__place">${place}</span>
        <button class="btn btn--quiet btn--sm" data-close>关闭</button>
      </div>
      ${list
        .map(
          (item) => `
        <button class="drawer__item" data-id="${esc(item.id)}">
          <div class="drawer__item-title">${esc(item.title)}</div>
          <div class="drawer__item-meta">${esc(item.author || "同学作品")}${
            item.year ? ` · ${esc(item.year)}` : ""
          }</div>
        </button>
      `
        )
        .join("")}
    `;
    drawer.hidden = false;
    drawer.querySelector("[data-close]").addEventListener("click", () => {
      drawer.hidden = true;
    });
    drawer.querySelectorAll("[data-id]").forEach((btn) => {
      btn.addEventListener("click", () => navigate(`/case/${btn.dataset.id}`));
    });
  }

  section.querySelector('[data-map="reset"]').addEventListener("click", () => map.resetView());
  section.querySelector('[data-map="zoom-in"]').addEventListener("click", () => map.zoomIn());
  section.querySelector('[data-map="zoom-out"]').addEventListener("click", () => map.zoomOut());

  // 数据：优先真实 API，失败回落示例数据
  let list = [];
  let isDemo = false;
  try {
    const res = await casesApi.list({ status: "published", limit: 400 });
    list = Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : [];
  } catch {
    list = [];
  }
  if (!list.length) {
    list = DEMO_CASES;
    isDemo = true;
  }
  setState({ cases: list, casesLoaded: true });

  updateStats(root, list);
  mountCounters(section);

  try {
    await map.init();
    canvasHost.removeAttribute("data-pending");
    map.setData(list);
  } catch (err) {
    console.warn("地图初始化失败", err);
    canvasHost.removeAttribute("data-pending");
    canvasHost.innerHTML = `<div class="map-fallback">地图资源加载失败：${String(
      err && err.stack ? err.stack : err
    ).slice(0, 700)}</div>`;
  }

  if (isDemo) {
    const note = el("div", {
      class: "atlas__demo-note",
      html: "当前展示为课程示例案例，真实作品将在同学提交后出现在地图上。",
    });
    section.querySelector(".atlas__stage").append(note);
  }

  return map;
}

function updateStats(root, list) {
  const totalNode = qs('[data-count-node="total"]', root);
  const provNode = qs('[data-count-node="provinces"]', root);
  const authorNode = qs('[data-count-node="authors"]', root);
  const provinces = new Set(list.map((c) => c.province).filter(Boolean));
  const authors = new Set(list.map((c) => c.author).filter((a) => a && a !== "示例"));

  if (totalNode) {
    totalNode.dataset.count = String(list.length);
    totalNode.textContent = "0";
  }
  if (provNode) {
    provNode.dataset.count = String(provinces.size);
    provNode.textContent = "0";
  }
  if (authorNode) {
    authorNode.dataset.count = String(authors.size || (list.length ? 1 : 0));
    authorNode.textContent = "0";
  }
  setState({
    stats: {
      total: list.length,
      provinces: provinces.size,
      contributors: authors.size,
    },
  });
}

export function refreshAtlasStats(root) {
  const { cases } = getState();
  updateStats(root, cases || []);
}
