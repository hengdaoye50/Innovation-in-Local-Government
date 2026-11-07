/** 地图屏 —— 首屏 */
import { esc, mountCounters, qs, qsa } from "../lib/dom.js";
import { createMap } from "../components/map.js";
import { mountDust } from "../components/dust.js";
import { ICONS } from "../components/chrome.js";
import { getState, setState } from "../lib/store.js";
import { navigate } from "../lib/router.js";
import { DEMO_CASES } from "../lib/demo.js";
import { cases as casesApi, surveys as surveysApi } from "../lib/api.js";

export function atlasSection() {
  return `
    <section id="atlas" class="atlas" aria-labelledby="atlas-title">
      <div class="shell atlas__head">
        <div class="atlas__title-block">
          <div class="atlas__eyebrow">Local Governance Innovation Atlas</div>
          <h1 class="atlas__title" id="atlas-title">
            地方创变，<em>落在地图上</em>
          </h1>
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

        <div class="atlas__layers" role="group" aria-label="地图图层">
          <button class="layer-btn is-on" type="button" data-layer="case">
            案例<b class="mono" data-layer-count>0</b>
          </button>
          <button class="layer-btn" type="button" data-layer="field">
            调研<b class="mono" data-layer-count-field>0</b>
          </button>
        </div>

        <div class="atlas__legend" aria-hidden="true" data-legend>
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
          <span class="ctrl ctrl--readout mono" data-zoom-readout aria-live="off">×1.0</span>
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
  const focusCardHost = focusCard.parentElement;
  const narrowQuery = window.matchMedia("(max-width: 900px)");

  /**
   * 窄屏下卡片是贴视口底部的抽屉。留在舞台里不行：舞台有 z-index 自己的层叠上下文，
   * 会被后面的分区整个压住（实测卡片有尺寸、opacity 1，却完全不可见）。
   * 所以窄屏时把它挂到 body 上，宽屏放回舞台原位（宽屏定位按舞台坐标算）。
   */
  function placeFocusCard(narrow) {
    const target = narrow ? document.body : focusCardHost;
    if (focusCard.parentElement !== target) target.append(focusCard);
  }
  const hint = qs("[data-atlas-hint]", section);
  const defaultHint = hint?.innerHTML || "";

  let focusNode = null;
  const zoomReadout = qs("[data-zoom-readout]", section);

  /** 当前图层：case（案例） / field（调研足迹） */
  let layer = "case";
  let caseList = [];
  let fieldList = null;

  // 舞台里的浮尘（DESIGN.md 7.6）：只在这一屏、只做极淡的上浮与轻微视差
  const stageEl = section.querySelector(".atlas__stage");
  const dust = mountDust(stageEl);

  const map = createMap(canvasHost, {
    onFocus: (node, info) => {
      focusNode = node;
      // 分析态时光路是主角，浮尘退到 40%
      dust?.setDimmed(!!node);
      if (!node || !info) {
        closeFocusCard();
        return;
      }
      showFocusCard(node, info);
    },
    // 缩放读数：像制图软件那样把当前倍率摆在控制组里
    onView: ({ k }) => {
      if (zoomReadout) zoomReadout.textContent = `×${k.toFixed(1)}`;
    },
  });

  function closeFocusCard() {
    focusCard.classList.remove("is-open");
    focusCard.hidden = true;
    // 收起后放回舞台，别让它留在 body 上跟着路由跑
    placeFocusCard(false);
    if (hint) hint.innerHTML = defaultHint;
  }

  function showFocusCard(node, info) {
    const related = info.related || [];
    // 图上最多连 MAX_LINKS 条光路，剩下的只在文案里交代数量
    const relatedTotal = Math.max(info.relatedTotal || 0, related.length);
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
        relatedTotal
          ? `<div class="map-focus-card__related">同领域另有 <b>${relatedTotal}</b> 个案例${
              relatedTotal > related.length
                ? `，图上连出最近的 ${related.length} 个`
                : "在这张图里"
            }${
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

    // 窄屏上卡片是贴视口底部的抽屉（见 map.css 的 ≤900px 段），位置由样式表决定。
    // 这里不能再写内联 left/top，否则会把抽屉钉回舞台里的旧位置。
    if (narrowQuery.matches) {
      placeFocusCard(true);
      focusCard.style.left = "";
      focusCard.style.top = "";
      requestAnimationFrame(() => focusCard.classList.add("is-open"));
      if (hint) {
        hint.innerHTML = `<span>点卡片进入案例 · 再点同一颗光点或按 Esc 收起</span>`;
      }
      return;
    }

    placeFocusCard(false);

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
      hint.innerHTML = `<span>点下方按钮进入案例 · 再点同一颗光点或按 Esc 收起</span>`;
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
  const stressCount = Number(new URLSearchParams(location.search).get("stress") || 0);
  if (stressCount > 0) {
    // ?stress=N 生成 N 条随机案例，用来检查案例攒多以后光点密度与浮层表现
    list = await stressCases(stressCount);
  } else {
    try {
      const res = await casesApi.list({ status: "published", limit: 400 });
      list = Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : [];
    } catch {
      list = [];
    }
    if (!list.length) list = DEMO_CASES;
  }
  setState({ cases: list, casesLoaded: true });

  caseList = list;
  const caseCountEl = qs("[data-layer-count]", section);
  if (caseCountEl) caseCountEl.textContent = String(list.length);

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

  /* —————— 图层切换：案例 / 调研足迹 —————— */

  const fieldCountEl = qs("[data-layer-count-field]", section);
  const layerButtons = qsa("[data-layer]", section);
  const legendEl = qs("[data-legend]", section);

  // 两层说的是两件事，图例文案要跟着换
  const LEGENDS = {
    case: `
      <div class="legend__row"><span class="legend__dot"></span>单个案例</div>
      <div class="legend__row"><span class="legend__dot legend__dot--lg"></span>多案例同城</div>
      <div class="legend__row"><span class="legend__line"></span>省级边界</div>`,
    field: `
      <div class="legend__row"><span class="legend__dot legend__dot--field"></span>一次调研</div>
      <div class="legend__row"><span class="legend__dot legend__dot--lg legend__dot--field"></span>多次调研同一地</div>
      <div class="legend__row"><span class="legend__line"></span>省级边界</div>`,
  };

  async function switchLayer(next) {
    if (next === layer) return;
    layer = next;
    layerButtons.forEach((btn) => btn.classList.toggle("is-on", btn.dataset.layer === next));
    if (legendEl) legendEl.innerHTML = LEGENDS[next];
    if (hint) hint.innerHTML = defaultHint;
    closeFocusCard();

    if (next === "field") {
      if (!fieldList) {
        try {
          const res = await surveysApi.list(200);
          fieldList = Array.isArray(res?.items) ? res.items : [];
        } catch {
          fieldList = [];
        }
        if (fieldCountEl) fieldCountEl.textContent = String(fieldList.length);
      }
      map.setLayer("field");
      map.setData(fieldList);
    } else {
      map.setLayer("case");
      map.setData(caseList);
    }
  }

  layerButtons.forEach((btn) => {
    btn.addEventListener("click", () => switchLayer(btn.dataset.layer));
  });

  // 浮尘跟着这一屏走：销毁时一并停掉，别留着 raf 在后台转
  const destroyMap = map.destroy.bind(map);
  map.destroy = () => {
    dust?.destroy();
    // 抽屉可能正挂在 body 上，离开首页时清掉，否则会留在文档里
    if (focusCard.parentElement === document.body) focusCard.remove();
    destroyMap();
  };

  return map;
}

/**
 * 压力测试数据：按区县随机撒 N 条案例。
 * 地图光点按「省|市|区县」聚合，所以真正要压的是「大量区县同时有点」的情形，
 * 以及某个区县被堆到几十条后、聚合点半径被拉爆的样子。
 */
async function stressCases(n) {
  const res = await fetch("./data/cities.json");
  const { districts } = await res.json();
  const pool = (districts || []).filter((d) => d.lng && d.lat);
  const domains = [...new Set(DEMO_CASES.flatMap((c) => c.domains || []))];
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const spot = pool[Math.floor(Math.random() * pool.length)];
    out.push({
      id: `stress-${i}`,
      title: `压力测试案例 ${i + 1}`,
      province: spot.province,
      city: spot.city,
      district: spot.name,
      lng: spot.lng,
      lat: spot.lat,
      domains: [domains[i % domains.length] || "数字治理"],
      year: "2024",
      author: "压力测试",
    });
  }
  return out;
}

function updateStats(root, list) {  const totalNode = qs('[data-count-node="total"]', root);
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
