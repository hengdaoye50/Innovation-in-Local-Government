/** Hash 路由：主滚动流 + 若干独立视图 */

const routes = [];
let notFound = null;
let onChange = null;
let afterMount = null;

export function route(pattern, handler) {
  const keys = [];
  const regex = new RegExp(
    "^" +
      pattern
        .replace(/\/$/, "")
        .replace(/:(\w+)/g, (_, key) => {
          keys.push(key);
          return "([^/]+)";
        })
        .replace(/\*/g, ".*") +
      "/?$"
  );
  routes.push({ regex, keys, handler });
}

export function setNotFound(handler) {
  notFound = handler;
}

export function onRouteChange(fn) {
  onChange = fn;
}

/**
 * 页面挂载完成后回调。页面渲染是异步的（要等数据与地图），
 * 所以这里等 handler 返回的 promise 落定再回调，和 onChange 的「切换前」区分开。
 */
export function onRouteMounted(fn) {
  afterMount = fn;
}

export function currentPath() {
  const hash = window.location.hash.replace(/^#/, "");
  return hash || "/";
}

export function navigate(path, { replace = false } = {}) {
  const target = `#${path}`;
  if (replace) window.history.replaceState(null, "", target);
  else window.location.hash = path;
  if (replace) resolve();
}

export function resolve() {
  const path = currentPath().split("?")[0];
  for (const { regex, keys, handler } of routes) {
    const match = path.match(regex);
    if (!match) continue;
    const params = {};
    keys.forEach((key, i) => {
      params[key] = decodeURIComponent(match[i + 1] || "");
    });
    onChange?.(path);
    Promise.resolve(handler(params))
      .catch((err) => console.warn(err))
      .then(() => afterMount?.(path));
    return;
  }
  onChange?.(path);
  notFound?.(path);
  Promise.resolve().then(() => afterMount?.(path));
}

export function start() {
  window.addEventListener("hashchange", () => {
    resolve();
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  resolve();
}

const NAV_HEIGHT = 64;
const MOTION_KEYS = ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "];

/**
 * 上一次还没落定的跳转。
 * 每次新的跳转先把它掐掉——否则前一次的定时器会在 280/640ms 时把页面重新拽回旧目标，
 * 表现就是「连着点两下导航，页面来回抽两下」。这是之前抽风的真正原因。
 */
let activeJump = null;

/**
 * 平滑滚动到页内区块（主导航与「回到某区块」共用）。
 *
 * 落点算不准的根源不在算术，而在页面高度会变：字体替换、图片解码、异步渲染的列表，
 * 都会在滚动这一两秒里把目标往下推。只量一次、或只在滚完纠一次，都不够稳。
 *
 * 这里的做法是「跟着目标走，到稳为止」：
 *   1. 先平滑滚过去；
 *   2. 途中页面若变高变矮，重新对准新位置（仍是平滑，不打断观感）；
 *   3. 落定后用 ResizeObserver 盯住文档，一有变化就贴回去，窗口约 1.2 秒；
 *   4. 任何真实手势（有位移的滚轮、触摸、翻页键）立刻放手——那时是人在接管。
 */
export function scrollToSection(id) {
  const target = document.getElementById(id);
  if (!target) return false;

  // 新的跳转接管：上一条（若还在跑）立刻收手，避免两套定时器互相拉扯
  activeJump?.();
  activeJump = null;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const timers = [];
  let observer = null;
  let released = false;

  const targetTop = () => target.getBoundingClientRect().top + window.scrollY - NAV_HEIGHT;

  const glideTo = () => {
    window.scrollTo({ top: targetTop(), behavior: reduceMotion ? "auto" : "smooth" });
  };

  /** 落定阶段的微调：偏差在两三像素内就不动，免得看到抖动 */
  const snapTo = () => {
    const drift = target.getBoundingClientRect().top - NAV_HEIGHT;
    if (Math.abs(drift) > 3) window.scrollTo({ top: targetTop(), behavior: "auto" });
  };

  const release = () => {
    if (released) return;
    released = true;
    timers.forEach(clearTimeout);
    observer?.disconnect();
    observer = null;
    window.removeEventListener("wheel", onWheel);
    window.removeEventListener("touchstart", onGesture);
    window.removeEventListener("keydown", onKey);
    if (activeJump === release) activeJump = null;
  };
  activeJump = release;

  function onWheel(event) {
    if (Math.abs(event.deltaY) > 0) release();
  }
  function onGesture() {
    release();
  }
  function onKey(event) {
    if (MOTION_KEYS.includes(event.key)) release();
  }

  window.addEventListener("wheel", onWheel, { passive: true });
  window.addEventListener("touchstart", onGesture, { passive: true });
  window.addEventListener("keydown", onKey);

  glideTo();

  // 途中对准：字体替换与懒加载常在 300–600ms 之间落地
  timers.push(setTimeout(() => !released && glideTo(), 280));
  timers.push(setTimeout(() => !released && glideTo(), 640));

  // 落定：先贴一次，再用 ResizeObserver 守住这一小段时间
  timers.push(
    setTimeout(() => {
      if (released) return;
      snapTo();
      if (!("ResizeObserver" in window)) return;
      observer = new ResizeObserver(() => {
        if (!released) snapTo();
      });
      observer.observe(document.body);
      observer.observe(document.documentElement);
    }, 1000)
  );
  timers.push(setTimeout(() => !released && snapTo(), 1700));
  // 窗口结束就撒手，不留长驻观察者跟人抢滚动
  timers.push(setTimeout(release, 2400));

  return true;
}
