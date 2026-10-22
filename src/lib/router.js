/** Hash 路由：主滚动流 + 若干独立视图 */

const routes = [];
let notFound = null;
let onChange = null;

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
    handler(params);
    return;
  }
  onChange?.(path);
  notFound?.(path);
}

export function start() {
  window.addEventListener("hashchange", () => {
    resolve();
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  resolve();
}

/** 平滑滚动到页内区块（主导航用） */
export function scrollToSection(id) {
  const target = document.getElementById(id);
  if (!target) return false;
  const navHeight = 64;
  const top = target.getBoundingClientRect().top + window.scrollY - navHeight;
  window.scrollTo({
    top,
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
  });
  return true;
}
