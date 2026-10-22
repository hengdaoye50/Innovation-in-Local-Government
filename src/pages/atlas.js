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
            每一枚光点都是一位同学从公开新闻出发、与大模型协同检索后写下的案例梗概。
            点开它，看到的不只是做法，还有它发生在哪里、由谁推动、留下了什么问题。
          </p>
        </div>
        <div class="atlas__stats" aria-label="案例统计">
          <div class="stat">
            <div class="stat__num" data-count="0" data-count-node="total">0</div>
            <div class="stat__label">案例</div>
          </div>
          <div class="stat">
            <div class="stat__num" data-count="0" data-count-node="provinces">0</div>
            <div class="stat__label">覆盖省级行政区</div>
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

        <div class="atlas__hint">
          <span>拖动旋转 · 滚轮缩放 · 点击光点查看案例</span>
          ${ICONS.arrowDown}
        </div>

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

  const map = createMap(canvasHost, {
    onSelect: (item, extra) => {
      if (extra?.list?.length) {
        openDrawer(extra.list, extra.node || item);
        return;
      }
      if (item?.id) navigate(`/case/${item.id}`);
    },
  });

  function openDrawer(list, node) {
    drawer.innerHTML = `
      <div class="drawer__head">
        <span class="drawer__place">${esc(node.province)}${
      node.city ? ` · ${esc(node.city)}` : ""
    }</span>
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
