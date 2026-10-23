/**
 * 中国地图 —— SVG 浮雕 + 图谱分析态
 *
 * 两个状态：
 *   explore  常规态。省份带侧壁厚度与投影，光点贴在地面上。
 *   atlas    分析态。点击光点后进入：侧壁与投影淡出、地图摊平成平面，
 *            所有光点升起并放大，与选中点共享领域标签的案例连出流动光路，
 *            再点一次进详情，点空白或按 Esc 返回。
 *
 * 性能要点（改动前先看这里）：
 * 1. path 用 digits(1) 降精度，d 体积约减半；
 * 2. 侧壁层数压到 4，每层都完整复制轮廓，层数即数据量倍数；
 * 3. 不用 feGaussianBlur —— 每帧重算模糊是拖动卡顿主因；
 * 4. 平移缩放用 rAF 合并，拖动期间挂 .is-dragging 关过渡并屏蔽悬停。
 */
import { geoConicEqualArea, geoPath } from "d3-geo";
import { esc } from "../lib/dom.js";

const NS = "http://www.w3.org/2000/svg";
// viewBox 宽度贴近地图实际宽高比：留太宽会让 SVG 按宽度适配时
// 地图只占中间一小块（移动端尤其明显，两侧全是空白）
const VIEW_W = 680;
const VIEW_H = 720;

const DEPTH = 4;
const SIDE_STEP = 5;
// 分析态下光点浮起的高度（用户单位）
const LIFT = 20;

const SIDE_COLORS = ["#0c070c", "#150b14", "#1f101d", "#2b1426"];

const PAD_X = 24;
const PAD_TOP = 8;
const PAD_BOTTOM = 30;

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

export function createMap(container, { onSelect, onHover, onFocus } = {}) {
  let svg = null;
  let gRoot = null;
  let gNodes = null;
  let gLinks = null;
  let gFocus = null;
  let gAtlas = null;
  let projection = null;
  let pathGen = null;
  let cases = [];
  let lastNodes = [];
  let tooltip = null;
  let destroyed = false;

  /** 当前分析态选中的节点 key；空串表示处于 explore 态 */
  let atlasKey = "";
  let atlasNode = null;

  const view = { x: 0, y: 0, k: 1 };
  let viewRaf = 0;
  let zoomSettleTimer = 0;

  const nodeKey = (node) =>
    `${node.province}|${node.city}|${node.district || ""}|${node.count}`;

  /** 地点显示：省 · 市 · 区县，逐级省略重复项 */
  function placeLabel(node, sep = " · ") {
    const parts = [node.province, node.city, node.district].filter(
      (p, i, arr) => p && arr.indexOf(p) === i
    );
    return parts.join(sep);
  }

  /* ————————— 视角 ————————— */

  function applyView() {
    if (!gRoot) return;
    gRoot.setAttribute(
      "transform",
      `translate(${view.x.toFixed(1)} ${view.y.toFixed(1)}) scale(${view.k.toFixed(3)})`
    );
    // 光点尺寸不随缩放变化（标准地图行为）：反向缩放抵消。
    // 缩放过程中关掉过渡，否则点会慢半拍地追着画布跑
    if (gNodes) {
      gNodes.classList.add("is-zooming");
      gNodes.style.setProperty("--node-scale", (1 / view.k).toFixed(4));
      clearTimeout(zoomSettleTimer);
      zoomSettleTimer = setTimeout(() => gNodes?.classList.remove("is-zooming"), 180);
    }
  }

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
    // 上限放到 8 倍：案例密集时需要能一直放大到区县一级
    const next = Math.min(8, Math.max(0.6, view.k * factor));
    if (Math.abs(next - view.k) < 1e-4) return;
    const ratio = next / view.k;
    view.x = svgX - (svgX - view.x) * ratio;
    view.y = svgY - (svgY - view.y) * ratio;
    view.k = next;
    scheduleView();
  }

  /**
   * 屏幕坐标 → SVG 用户坐标。
   * 地图外层套了 CSS 3D 倾斜，getBoundingClientRect 拿到的只是变换后的外框，
   * 用它做线性换算会偏。必须走 getScreenCTM 的逆矩阵。
   */
  function clientToSvg(clientX, clientY) {
    if (!svg) return [0, 0];
    const ctm = svg.getScreenCTM();
    if (!ctm) return [0, 0];
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return [p.x, p.y];
  }

  /** 把 SVG 用户坐标换算成容器内的像素坐标（含视角变换与 3D 倾斜） */
  function toScreen(x, y) {
    const rect = container.getBoundingClientRect();
    const ctm = svg?.getScreenCTM();
    if (!ctm) return { x: 0, y: 0, scale: 1, rect };

    const pt = svg.createSVGPoint();
    pt.x = x;
    pt.y = y;
    const screen = pt.matrixTransform(ctm);
    return {
      x: screen.x - rect.left,
      y: screen.y - rect.top,
      scale: ctm.a,
      rect,
    };
  }

  function bindPanZoom() {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let moved = false;
    let scaleX = 1;
    let scaleY = 1;

    // 不用 setPointerCapture：一旦捕获，pointerup 之后的 click 会被重定向到
    // svg 上，节点自己的 click 处理器就永远收不到事件（点击光点毫无反应）。
    function onMove(event) {
      if (!dragging) return;
      const dx = (event.clientX - lastX) / scaleX;
      const dy = (event.clientY - lastY) / scaleY;
      lastX = event.clientX;
      lastY = event.clientY;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        if (!moved) {
          // 只有真正开始移动才挂 is-dragging。
          // 这个类会把节点的 pointer-events 设为 none，若在 pointerdown 就加上，
          // pointerup 与 click 会落到地图底图，节点永远收不到点击。
          moved = true;
          svg?.classList.add("is-dragging");
        }
      }
      view.x += dx * view.k;
      view.y += dy * view.k;
      scheduleView();
    }

    function onUp() {
      if (!dragging) return;
      dragging = false;
      svg?.classList.remove("is-dragging");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    }

    svg.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      // 触屏单指留给页面滚动（配合 CSS 的 touch-action: pan-y），
      // 否则手指一碰地图就滑不动页面
      if (event.pointerType !== "mouse") return;
      // 分析态下不接管拖动：既不能移动底图（连线会错位），
      // 也不能在这里退出——否则第二次点击会被 pointerdown 关掉、
      // 紧接着的 click 又把它打开，看起来就是"点了没反应"。
      if (atlasKey) return;

      dragging = true;
      moved = false;
      lastX = event.clientX;
      lastY = event.clientY;
      // 取一次屏幕变换矩阵：a 是水平缩放、d 是垂直缩放（含 3D 倾斜的压缩）
      const ctm = svg.getScreenCTM();
      scaleX = ctm?.a || 1;
      scaleY = ctm?.d || 1;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });

    // 捕获阶段先处理：拖动结束时吞掉这次 click，点空白处退出分析态
    svg.addEventListener(
      "click",
      (event) => {
        if (moved) {
          event.stopPropagation();
          event.preventDefault();
          moved = false;
          return;
        }
        if (atlasKey && !event.target.closest(".node")) exitAtlas();
      },
      true
    );

    // 滚轮默认交给页面滚动；按住 Ctrl / ⌘ 才缩放地图。
    // 无条件 preventDefault 会让鼠标停在地图上时整页滚不动。
    svg.addEventListener(
      "wheel",
      (event) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        if (atlasKey) return;
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
      svgEl(
        "linearGradient",
        { id: "linkGrad", x1: "0", y1: "0", x2: "1", y2: "0" },
        stops([
          ["0%", "#D4AF37", 0.1],
          ["50%", "#F0D48A", 0.75],
          ["100%", "#D4AF37", 0.1],
        ])
      ),
      svgEl("radialGradient", { id: "nodeGlow" }, [
        svgEl("stop", { offset: "0%", "stop-color": "#D4AF37", "stop-opacity": 0.5 }),
        svgEl("stop", { offset: "55%", "stop-color": "#D4AF37", "stop-opacity": 0.14 }),
        svgEl("stop", { offset: "100%", "stop-color": "#D4AF37", "stop-opacity": 0 }),
      ]),
      svgEl("radialGradient", { id: "nodeGlowStrong" }, [
        svgEl("stop", { offset: "0%", "stop-color": "#FFE9A8", "stop-opacity": 0.85 }),
        svgEl("stop", { offset: "45%", "stop-color": "#D4AF37", "stop-opacity": 0.3 }),
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
    pathGen = geoPath(projection).digits(1);

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

    // 投影：两层无滤镜偏移色块（feGaussianBlur 每帧重算太贵）
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
        if (atlasKey) return;
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

    gLinks = svgEl("g", { class: "map-links" });
    gNodes = svgEl("g", { class: "map-nodes" });
    gFocus = svgEl("g", { class: "map-focus" });
    gAtlas = svgEl("g", { class: "map-atlas" });

    gLand.append(gShadow, gSides, gTops);
    gRoot.append(gLand, gIslands, gLinks, gNodes, gAtlas, gFocus);
  }

  /* ————————— 节点 ————————— */

  function aggregate(list) {
    const groups = new Map();
    for (const item of list) {
      if (!item || !item.lng || !item.lat) continue;
      // 按区县聚合：同城不同区的案例落点不同，放大后能分开；
      // 只有同一区县内的多条案例才合并成一个点
      const key = `${item.province}|${item.city || ""}|${item.district || ""}`;
      if (!groups.has(key)) {
        groups.set(key, {
          province: item.province,
          city: item.city || "",
          district: item.district || "",
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
    lastNodes = aggregate(cases);

    for (const node of lastNodes) {
      const point = projection([node.lng, node.lat]);
      if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
      const [x, y] = point;
      node.x = x;
      node.y = y - DEPTH * SIDE_STEP;

      const group = svgEl("g", {
        class: "node",
        transform: `translate(${node.x.toFixed(1)} ${node.y.toFixed(1)})`,
        tabindex: "0",
        role: "button",
        "data-key": nodeKey(node),
        "aria-label": `${placeLabel(node, " ")}：${node.title}`,
      });

      // 内层承担浮起动画，最内层承担尺寸补偿，三者互不干扰
      const lift = svgEl("g", { class: "node__lift" });
      const body = svgEl("g", { class: "node__body" });
      body.append(
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
      lift.append(body);

      // 贴在地面的落影：光点升起时影子放大变淡，悬浮感靠它立起来
      group.append(
        // 透明热区：光点浮起后原位置会变成空白，补一个热区让第二次点击仍能命中
        svgEl("circle", {
          class: "node__hit",
          r: (node.r * 2.2).toFixed(1),
          fill: "transparent",
        }),
        svgEl("ellipse", {
          class: "node__shadow",
          rx: (node.r * 1.6).toFixed(1),
          ry: (node.r * 0.62).toFixed(1),
          cy: "1",
        }),
        lift
      );

      const select = () => {
        if (node.count === 1) onSelect?.(node.primary);
        else onSelect?.(node.primary, { list: node.items, node });
      };

      group.addEventListener("click", (event) => {
        event.stopPropagation();
        if (atlasKey) {
          // 分析态下的第二次点击：进详情（聚合点先弹列表）
          select();
          return;
        }
        enterAtlas(node);
      });
      group.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        if (atlasKey) select();
        else enterAtlas(node);
      });
      group.addEventListener("pointerenter", (event) => {
        if (atlasKey) return;
        group.classList.add("is-hover");
        showTip(node, event);
        onHover?.(node);
      });
      group.addEventListener("pointermove", (event) => {
        if (atlasKey) return;
        positionTip(event);
      });
      group.addEventListener("pointerleave", () => {
        group.classList.remove("is-hover");
        hideTip();
        onHover?.(null);
      });

      gNodes.append(group);
    }
  }

  /* ————————— 分析态 ————————— */

  function relatedOf(target) {
    return lastNodes
      .filter((n) => nodeKey(n) !== nodeKey(target))
      .map((n) => ({
        node: n,
        shared: n.domains.filter((d) => target.domains.includes(d)),
      }))
      .filter((x) => x.shared.length > 0)
      .sort((a, b) => b.shared.length - a.shared.length);
  }

  function enterAtlas(node) {
    if (!gAtlas || !node) return;
    atlasKey = nodeKey(node);
    atlasNode = node;

    hideTip();
    svg.classList.add("is-atlas");
    gAtlas.replaceChildren();

    const related = relatedOf(node);
    const relatedKeys = new Set(related.map((r) => nodeKey(r.node)));

    // 光路：从选中点连向共享领域的光点，二次曲线避免直线穿过地图中央
    const linkGroup = svgEl("g", { class: "atlas-links" });
    for (const { node: other, shared } of related) {
      if (!Number.isFinite(other.x) || !Number.isFinite(other.y)) continue;
      const fx = node.x;
      const fy = node.y - LIFT;
      const tx = other.x;
      const ty = other.y - LIFT;
      const mx = (fx + tx) / 2 + (ty - fy) * 0.12;
      const my = (fy + ty) / 2 - (tx - fx) * 0.12;
      const d = `M${fx.toFixed(1)},${fy.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(
        1
      )} ${tx.toFixed(1)},${ty.toFixed(1)}`;

      linkGroup.append(
        svgEl("path", { d, class: "atlas-link", stroke: "url(#linkGrad)" }),
        svgEl("path", {
          d,
          class: "atlas-link atlas-link--flow",
          "stroke-width": shared.length > 1 ? 1.4 : 0.9,
        })
      );
    }
    gAtlas.append(linkGroup);

    // 关联光点标记：加一圈细环，说明它们被选中点拉进了同一张图
    const ringGroup = svgEl("g", { class: "atlas-rings" });
    for (const { node: other } of related) {
      if (!Number.isFinite(other.x) || !Number.isFinite(other.y)) continue;
      ringGroup.append(
        svgEl("circle", {
          class: "atlas-ring",
          cx: other.x.toFixed(1),
          cy: (other.y - LIFT).toFixed(1),
          r: (other.r * 2.2).toFixed(1),
          fill: "none",
        })
      );
    }
    gAtlas.append(ringGroup);

    // 选中点：多层光环 + 扩散脉冲
    const px = node.x;
    const py = node.y - LIFT;
    gAtlas.append(
      svgEl("circle", {
        class: "atlas-pulse",
        cx: px.toFixed(1),
        cy: py.toFixed(1),
        r: (node.r * 2).toFixed(1),
        fill: "none",
      }),
      svgEl("circle", {
        class: "atlas-halo",
        cx: px.toFixed(1),
        cy: py.toFixed(1),
        r: (node.r * 5).toFixed(1),
        fill: "url(#nodeGlowStrong)",
      })
    );

    // DOM 图层同步状态：非关联点压暗
    gNodes.querySelectorAll(".node").forEach((el) => {
      const key = el.getAttribute("data-key");
      el.classList.toggle("is-dimmed", key !== atlasKey && !relatedKeys.has(key));
      el.classList.toggle("is-related", relatedKeys.has(key));
      el.classList.toggle("is-atlas-target", key === atlasKey);
    });

    const screen = toScreen(px, py);
    onFocus?.(node, { ...screen, related: related.map((r) => r.node) });
  }

  function exitAtlas() {
    if (!atlasKey) return;
    atlasKey = "";
    atlasNode = null;
    svg?.classList.remove("is-atlas");
    gAtlas?.replaceChildren();
    gNodes?.querySelectorAll(".node").forEach((el) => {
      el.classList.remove("is-dimmed", "is-related", "is-atlas-target");
    });
    onFocus?.(null);
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
      <div class="map-tip__place">${esc(placeLabel(node))}</div>
      <div class="map-tip__title">${esc(node.title)}</div>
      ${tags ? `<div class="map-tip__tags">${tags}</div>` : ""}
      <div class="map-tip__meta">${
        node.count > 1 ? `点击展开 ${node.count} 个案例` : esc(node.author || "同学作品")
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

    // 单独一层承载 3D 倾斜，svg 自己只负责加载动画与缩放，
    // 两者的 transform 才不会互相覆盖
    const stage = document.createElement("div");
    stage.className = "map-stage";

    svg = svgEl("svg", {
      viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
      preserveAspectRatio: "xMidYMid meet",
      class: "map-svg",
      role: "img",
      "aria-label": "中国地方政府创新案例分布地图",
    });

    gRoot = svgEl("g", { class: "map-root" });
    svg.append(buildDefs(), gRoot);
    stage.append(svg);
    container.append(stage);

    buildLand(geo);
    renderNodes();
    bindPanZoom();
    applyView();

    const onKey = (event) => {
      if (event.key === "Escape" && atlasKey) exitAtlas();
    };
    document.addEventListener("keydown", onKey);
    container._keyHandler = onKey;

    container.dataset.ready = "1";
    requestAnimationFrame(() => svg?.classList.add("is-in"));
  }

  return {
    init,
    setData(list) {
      cases = Array.isArray(list) ? list : [];
      if (atlasKey) exitAtlas();
      renderNodes();
    },
    resetView,
    zoomIn() {
      if (atlasKey) exitAtlas();
      zoomAt(VIEW_W / 2, VIEW_H / 2, 1.2);
    },
    zoomOut() {
      if (atlasKey) exitAtlas();
      zoomAt(VIEW_W / 2, VIEW_H / 2, 0.833);
    },
    exitAtlas,
    get atlasActive() {
      return Boolean(atlasKey);
    },
    destroy() {
      destroyed = true;
      if (viewRaf) cancelAnimationFrame(viewRaf);
      if (zoomSettleTimer) clearTimeout(zoomSettleTimer);
      if (container._keyHandler) {
        document.removeEventListener("keydown", container._keyHandler);
        container._keyHandler = null;
      }
      hideTip();
      svg?.remove();
      svg = null;
      gRoot = null;
      gNodes = null;
      gLinks = null;
      gFocus = null;
      gAtlas = null;
      lastNodes = [];
      atlasKey = "";
      atlasNode = null;
    },
  };
}
