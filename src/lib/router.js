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

/** 用户自己动了滚轮/手指就不要再纠正——那是他在夺回控制权 */
function watchUserScroll(cancel) {
  const stop = () => {
    cancel();
    remove();
  };
  const remove = () => {
    window.removeEventListener("wheel", stop);
    window.removeEventListener("touchstart", stop);
    window.removeEventListener("keydown", onKey);
  };
  const onKey = (event) => {
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) {
      stop();
    }
  };
  window.addEventListener("wheel", stop, { passive: true });
  window.addEventListener("touchstart", stop, { passive: true });
  window.addEventListener("keydown", onKey);
  return remove;
}

/**
 * 平滑滚动到页内区块（主导航用）。
 *
 * 只在出发时量一次是量不准的：图片、字体、延迟渲染的列表都会在滚动途中改变页面高度，
 * 落点于是漂到别处——表现就是「点了导航，页面跳到一个不三不四的位置」。
 * 所以这里滚完再量一次，偏差超过 8px 就纠一次，最多两轮。
 */
export function scrollToSection(id) {
  const target = document.getElementById(id);
  if (!target) return false;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const toTarget = () => {
    const top = target.getBoundingClientRect().top + window.scrollY - NAV_HEIGHT;
    window.scrollTo({ top, behavior: reduceMotion ? "auto" : "smooth" });
  };

  toTarget();

  let attempts = 0;
  let cancelled = false;
  let unwatch = () => {};
  const stop = () => {
    cancelled = true;
    clearTimeout(timer);
    unwatch();
  };
  const settle = () => {
    if (cancelled) return;
    attempts += 1;
    // 区块顶部相对视口的偏差：小于 8px 就当对齐了，肉眼看不出来
    const drift = Math.round(target.getBoundingClientRect().top - NAV_HEIGHT);
    if (Math.abs(drift) > 8 && attempts <= 2) {
      toTarget();
      timer = setTimeout(settle, reduceMotion ? 120 : 480);
      return;
    }
    unwatch();
  };
  let timer = setTimeout(settle, reduceMotion ? 80 : 560);
  unwatch = watchUserScroll(stop);
  return true;
}
