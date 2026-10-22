/**
 * 中国地图 —— SVG 浮雕
 * Albers 等积投影 + 少量偏移层模拟厚度，无 WebGL 依赖。
 *
 * 性能要点（改动前请先看这里）：
 * 1. path 用 digits(1) 降精度，d 体积约减半，1px 精度下视觉无差别；
 * 2. 侧壁层数刻意压到 4 层，每层仍完整复制轮廓，层数即数据量倍数；
 * 3. 不用 feGaussianBlur 做投影 —— 每帧重算模糊是拖动卡顿的主因，
 *    改为两层无滤镜的半透明偏移；
 * 4. 平移/缩放用 requestAnimationFrame 合并，拖动期间挂 .is-dragging
 *    关掉所有 transition。
 */
import { geoConicEqualArea, geoPath } from "d3-geo";
import { esc } from "../lib/dom.js";

const NS = "http://www.w3.org/2000/svg";
const VIEW_W = 1000;
const VIEW_H = 720;

// 侧壁：层数 × 每层下移量决定厚度。层数直接乘到路径数据量上，别随意调大
const DEPTH = 4;
const SIDE_STEP = 5;

const SIDE_COLORS = ["#0c070c", "#150b14", "#1f101d", "#2b1426"];

const PAD_X = 34;
const PAD_TOP = 14;
const PAD_BOTTOM = 46;

/** 创建 SVG 元素（必须走命名空间，否则渐变与图形不生效） */
function svgEl(tag, attrs = {}, children = []) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "text") node.textContent = value;
    else node.setAttribute(key, String(value));
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child);
  }
  return node;
}

export function createMap(container, { onSelect, onHover } = {}) {
  let svg = null;
  let gRoot = null;
  let gNodes = null;
  let projection = null;
  let pathGen = null;
  let cases = [];
  let tooltip = null;
  let destroyed = false;

  const view = { x: 0, y: 0, k: 1 };
  let viewRaf = 0;

  /* ————————— 视角 ————————— */

  function applyView() {
    if (!gRoot) return;
    gRoot.setAttribute(
      "transform",
      `translate(${view.x.toFixed(1)} ${view.y.toFixed(1)}) scale(${view.k.toFixed(3)})`
    );
  }

  /** 合并同一帧内的多次视角变化 */
  function scheduleView() {
    if (viewRaf) return;
    viewRaf = requestAnimationFrame(() => {
      viewRaf = 0;
      applyView();
    });
  }

  function resetView() {
    view.x = 0;
    view.y = 0;
    view.k = 1;
    applyView();
  }

  function zoomAt(svgX, svgY, factor) {
    const next = Math.min(4.2, Math.max(0.7, view.k * factor));
    if (Math.abs(next - view.k) < 1e-4) return;
    const ratio = next / view.k;
    view.x = svgX - (svgX - view.x) * ratio;
    view.y = svgY - (svgY - view.y) * ratio;
    view.k = next;
    scheduleView();
  }

  /** viewBox 到屏幕的缩放比例；只在拖动开始时取一次，避免每帧强制布局 */
  let screenScale = 1;

  function clientToSvg(clientX, clientY) {
    const rect = container.getBoundingClientRect();
    const scale = Math.min(rect.width / VIEW_W, rect.height / VIEW_H);
    const offsetX = (rect.width - VIEW_W * scale) / 2;
    const offsetY = (rect.height - VIEW_H * scale) / 2;
    return [(clientX - rect.left - offsetX) / scale, (clientY - rect.top - offsetY) / scale];
  }

  function bindPanZoom() {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let moved = false;

    svg.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      dragging = true;
      moved = false;
      lastX = event.clientX;
      lastY = event.clientY;
      // 取一次就缓存：pointermove 里再调 getBoundingClientRect 会强制重排
      const rect = container.getBoundingClientRect();
      screenScale = Math.min(rect.width / VIEW_W, rect.height / VIEW_H) || 1;
      svg.setPointerCapture(event.pointerId);
      svg.classList.add("is-dragging");
    });

    svg.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      // 直接用屏幕坐标算位移，省掉逐帧坐标反投影
      const dx = (event.clientX - lastX) / screenScale;
      const dy = (event.clientY - lastY) / screenScale;
      lastX = event.clientX;
      lastY = event.clientY;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) moved = true;
      view.x += dx * view.k;
      view.y += dy * view.k;
      scheduleView();
    });

    const stop = (event) => {
      if (!dragging) return;
      dragging = false;
      svg.classList.remove("is-dragging");
      if (svg.hasPointerCapture?.(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    };
    svg.addEventListener("pointerup", stop);
    svg.addEventListener("pointercancel", stop);
    svg.addEventListener("pointerleave", stop);

    // 拖动结束后吞掉那次 click，避免误跳详情
    svg.addEventListener(
      "click",
      (event) => {
        if (!moved) return;
        event.stopPropagation();
        moved = false;
      },
      true
    );

    // 滚轮缩放同样走 rAF，高频 wheel 事件只在下一帧应用一次
    svg.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const [x, y] = clientToSvg(event.clientX, event.clientY);
        zoomAt(x, y, event.deltaY < 0 ? 1.14 : 0.877);
      },
      { passive: false }
    );
  }

  /* ————————— 静态结构 ————————— */

  function buildDefs() {
    const stops = (items) =>
      items.map(([offset, color, opacity]) =>
        svgEl("stop", { offset, "stop-color": color, "stop-opacity": opacity })
      );

    return svgEl("defs", {}, [
      svgEl(
        "linearGradient",
        { id: "provFill", x1: "0.15", y1: "0", x2: "0.6", y2: "1" },
        stops([
          ["0%", "#a0328e", 0.68],
          ["42%", "#7e0c6e", 0.56],
          ["100%", "#4d0b45", 0.62],
        ])
      ),
      svgEl(
        "linearGradient",
        { id: "provFillHover", x1: "0.15", y1: "0", x2: "0.6", y2: "1" },
        stops([
          ["0%", "#cf5cb8", 0.9],
          ["45%", "#a83296", 0.82],
          ["100%", "#7a1169", 0.86],
        ])
      ),
      svgEl("radialGradient", { id: "nodeGlow" }, [
        svgEl("stop", { offset: "0%", "stop-color": "#D4AF37", "stop-opacity": 0.5 }),
        svgEl("stop", { offset: "55%", "stop-color": "#D4AF37", "stop-opacity": 0.14 }),
        svgEl("stop", { offset: "100%", "stop-color": "#D4AF37", "stop-opacity": 0 }),
      ]),
    ]);
  }

  /**
   * 手动适配视口。
   * 不用 d3 的 fitExtent：它对这份数据的 bounds 计算不可靠，
   * 直接用单位比例尺遍历坐标求包围盒更稳。
   */
  function fitProjection(base, land) {
    const unit = base.scale(1).translate([0, 0]);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;

    for (const feature of land) {
      const geom = feature.geometry;
      if (!geom) continue;
      const polys =
        geom.type === "MultiPolygon"
          ? geom.coordinates
          : geom.type === "Polygon"
            ? [geom.coordinates]
            : [];
      for (const poly of polys) {
        for (const ring of poly) {
          for (const point of ring) {
            const projected = unit([point[0], point[1]]);
            if (!projected || !Number.isFinite(projected[0])) continue;
            if (projected[0] < x0) x0 = projected[0];
            if (projected[0] > x1) x1 = projected[0];
            if (projected[1] < y0) y0 = projected[1];
            if (projected[1] > y1) y1 = projected[1];
          }
        }
      }
    }

    if (!Number.isFinite(x0) || !Number.isFinite(x1)) return base;

    const k = Math.min(
      (VIEW_W - PAD_X * 2) / (x1 - x0),
      (VIEW_H - PAD_TOP - PAD_BOTTOM) / (y1 - y0)
    );
    return base
      .scale(k)
      .translate([
        (VIEW_W - k * (x1 + x0)) / 2,
        (VIEW_H + PAD_TOP - PAD_BOTTOM - k * (y1 + y0)) / 2,
      ]);
  }

  function buildLand(geo) {
    const land = geo.features.filter(
      (f) => f.properties?.adcode && !String(f.properties.adcode).includes("_JD")
    );
    const islands = geo.features.filter((f) =>
      String(f.properties?.adcode || "").includes("_JD")
    );

    const base = geoConicEqualArea().parallels([25, 47]).rotate([-105, 0]);
    projection = fitProjection(base, land);
    // digits(1)：坐标保留一位小数，路径数据减半，1px 精度肉眼无差
    pathGen = geoPath(projection).digits(1);

    // 纵向排序：南侧省份后画，侧壁才会压在北侧之上
    const shapes = land
      .map((feature) => {
        const c = pathGen.centroid(feature);
        return { feature, name: feature.properties.name, cy: c[1] };
      })
      .filter((s) => s.name && Number.isFinite(s.cy))
      .sort((a, b) => a.cy - b.cy);

    const gLand = svgEl("g", { class: "map-land" });
    const gShadow = svgEl("g", { class: "map-shadow" });
    const gSides = svgEl("g", { class: "map-sides" });
    const gTops = svgEl("g", { class: "map-tops" });

    const drawn = [];
    for (const { feature, name } of shapes) {
      const d = pathGen(feature);
      if (d) drawn.push({ d, name });
    }

    // 投影：两层无滤镜的偏移色块模拟柔和阴影（feGaussianBlur 每帧重算太贵）
    if (drawn.length) {
      const merged = drawn.map((x) => x.d).join(" ");
      gShadow.append(
        svgEl("path", {
          d: merged,
          fill: "#0a050a",
          opacity: "0.28",
          transform: "translate(0 34)",
        }),
        svgEl("path", {
          d: merged,
          fill: "#0a050a",
          opacity: "0.3",
          transform: "translate(0 24)",
        })
      );
    }

    // 先把所有侧壁画完，再统一画顶面：
    // 否则相邻省份的侧壁会压住邻省的顶面，缝隙看起来像碎块拼图
    for (const { d, name } of drawn) {
      for (let i = DEPTH; i >= 1; i -= 1) {
        gSides.append(
          svgEl("path", {
            d,
            class: "prov__side",
            fill: SIDE_COLORS[DEPTH - i] || SIDE_COLORS[0],
            transform: `translate(0 ${i * SIDE_STEP})`,
          })
        );
      }
      gSides.lastChild.setAttribute("data-name", name);
    }

    for (const { d, name } of drawn) {
      const top = svgEl("path", { d, class: "prov__top", fill: "url(#provFill)" });
      top.setAttribute("data-name", name);

      top.addEventListener("pointerenter", () => {
        top.classList.add("is-hover");
        top.setAttribute("fill", "url(#provFillHover)");
      });
      top.addEventListener("pointerleave", () => {
        top.classList.remove("is-hover");
        top.setAttribute("fill", "url(#provFill)");
      });

      gTops.append(top);
    }

    const gIslands = svgEl("g", { class: "map-islands" });
    for (const feature of islands) {
      const d = pathGen(feature);
      if (d) gIslands.append(svgEl("path", { d, class: "island-line" }));
    }

    gNodes = svgEl("g", { class: "map-nodes" });
    gLand.append(gShadow, gSides, gTops);
    gRoot.append(gLand, gIslands, gNodes);
  }

  /* ————————— 节点 ————————— */

  function aggregate(list) {
    const groups = new Map();
    for (const item of list) {
      if (!item || !item.lng || !item.lat) continue;
      const key = `${item.province}|${item.city || ""}`;
      if (!groups.has(key)) {
        groups.set(key, {
          province: item.province,
          city: item.city || "",
          lng: item.lng,
          lat: item.lat,
          items: [],
          domains: [],
        });
      }
      const g = groups.get(key);
      g.items.push(item);
      for (const d of item.domains || []) if (!g.domains.includes(d)) g.domains.push(d);
    }
    const max = Math.max(1, ...[...groups.values()].map((g) => g.items.length));
    return [...groups.values()].map((g) => ({
      ...g,
      count: g.items.length,
      r: 4.4 + Math.min(5, (g.items.length / max) * 5),
      title: g.items.length === 1 ? g.items[0].title : `${g.items.length} 个案例`,
      author: g.items.length === 1 ? g.items[0].author : "",
      year: g.items.length === 1 ? g.items[0].year : "",
      primary: g.items[0],
    }));
  }

  function renderNodes() {
    if (!gNodes || !projection) return;
    gNodes.replaceChildren();

    for (const node of aggregate(cases)) {
      const point = projection([node.lng, node.lat]);
      if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
      const [x, y] = point;

      const group = svgEl("g", {
        class: "node",
        transform: `translate(${x.toFixed(1)} ${(y - DEPTH * SIDE_STEP).toFixed(1)})`,
        tabindex: "0",
        role: "button",
        "aria-label": `${node.province}${node.city ? " " + node.city : ""}：${node.title}`,
      });

      group.append(
        svgEl("circle", {
          class: "node__halo",
          r: (node.r * 2.8).toFixed(1),
          fill: "url(#nodeGlow)",
        }),
        svgEl("circle", { class: "node__dot", r: node.r.toFixed(1), fill: "#d4af37" }),
        svgEl("circle", {
          class: "node__core",
          r: (node.r * 0.42).toFixed(1),
          fill: "#fff6dc",
        })
      );

      const select = () => {
        if (node.count === 1) onSelect?.(node.primary);
        else onSelect?.(node.primary, { list: node.items, node });
      };

      group.addEventListener("click", (event) => {
        event.stopPropagation();
        select();
      });
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          select();
        }
      });
      group.addEventListener("pointerenter", (event) => {
        group.classList.add("is-hover");
        showTip(node, event);
        onHover?.(node);
      });
      group.addEventListener("pointermove", (event) => positionTip(event));
      group.addEventListener("pointerleave", () => {
        group.classList.remove("is-hover");
        hideTip();
        onHover?.(null);
      });

      gNodes.append(group);
    }
  }

  /* ————————— 浮层 ————————— */

  function showTip(node, event) {
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.className = "map-tip";
      tooltip.setAttribute("role", "tooltip");
    }
    const tags = (node.domains || [])
      .slice(0, 3)
      .map((d) => `<span class="tag tag--quiet">${esc(d)}</span>`)
      .join("");
    tooltip.innerHTML = `
      <div class="map-tip__place">${esc(node.province)}${
      node.city ? ` · ${esc(node.city)}` : ""
    }</div>
      <div class="map-tip__title">${esc(node.title)}</div>
      ${tags ? `<div class="map-tip__tags">${tags}</div>` : ""}
      <div class="map-tip__meta">${
        node.count > 1 ? `点击查看 ${node.count} 个案例` : esc(node.author || "同学作品")
      }</div>
    `;
    container.append(tooltip);
    positionTip(event);
  }

  function positionTip(event) {
    if (!tooltip) return;
    const rect = container.getBoundingClientRect();
    const x = event.clientX - rect.left + 16;
    const y = event.clientY - rect.top + 16;
    tooltip.style.left = `${Math.max(10, Math.min(x, rect.width - tooltip.offsetWidth - 10))}px`;
    tooltip.style.top = `${Math.max(10, Math.min(y, rect.height - tooltip.offsetHeight - 10))}px`;
  }

  function hideTip() {
    tooltip?.remove();
    tooltip = null;
  }

  /* ————————— 生命周期 ————————— */

  async function init() {
    const geo = await fetch("/data/china.json").then((res) => {
      if (!res.ok) throw new Error(`地图数据加载失败（${res.status}）`);
      return res.json();
    });
    if (destroyed) return;

    container.replaceChildren();

    svg = svgEl("svg", {
      viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
      preserveAspectRatio: "xMidYMid meet",
      class: "map-svg",
      role: "img",
      "aria-label": "中国地方政府创新案例分布地图",
    });

    gRoot = svgEl("g", { class: "map-root" });
    svg.append(buildDefs(), gRoot);
    container.append(svg);

    buildLand(geo);
    renderNodes();
    bindPanZoom();
    applyView();

    container.dataset.ready = "1";
    requestAnimationFrame(() => svg?.classList.add("is-in"));
  }

  return {
    init,
    setData(list) {
      cases = Array.isArray(list) ? list : [];
      renderNodes();
    },
    resetView,
    zoomIn() {
      zoomAt(VIEW_W / 2, VIEW_H / 2, 1.2);
    },
    zoomOut() {
      zoomAt(VIEW_W / 2, VIEW_H / 2, 0.833);
    },
    destroy() {
      destroyed = true;
      if (viewRaf) cancelAnimationFrame(viewRaf);
      hideTip();
      svg?.remove();
      svg = null;
      gRoot = null;
      gNodes = null;
    },
  };
}
