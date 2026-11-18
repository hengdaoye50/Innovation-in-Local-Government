/** DOM 构造与转义工具 */

const ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function esc(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "html") node.innerHTML = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "dataset") {
      Object.assign(node.dataset, value);
    } else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function qs(selector, root = document) {
  return root.querySelector(selector);
}

export function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

/** 观察进入视口的 .reveal 元素，只触发一次 */
export function mountReveal(root = document) {
  const targets = qsa(".reveal:not(.is-in)", root);
  if (!targets.length) return;
  if (!("IntersectionObserver" in window)) {
    targets.forEach((node) => node.classList.add("is-in"));
    return;
  }
  // 同组错峰：同一父容器里连续的 .reveal 按顺序拿一个序号，最多算到 6。
  // 序号写进 --i，间隔由 CSS 的 --reveal-step 统一控制。
  for (const node of targets) {
    const siblings = [...(node.parentElement?.children || [])].filter((n) =>
      n.classList.contains("reveal")
    );
    const order = siblings.indexOf(node);
    if (order > 0) node.style.setProperty("--i", String(Math.min(order, 6)));
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-in");
        io.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
  );
  targets.forEach((node) => io.observe(node));
}

/** 数字从 0 计数到目标值 */
export function countUp(node, target, { duration = 400, suffix = "" } = {}) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    node.textContent = target + suffix;
    return;
  }
  const start = performance.now();
  const from = 0;
  const step = (now) => {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    node.textContent = Math.round(from + (target - from) * eased) + suffix;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** 挂载进入视口才计数的元素（data-count="128"） */
export function mountCounters(root = document) {
  const nodes = qsa("[data-count]", root);
  if (!nodes.length) return;
  const run = (node) => {
    if (node.dataset.counted) return;
    node.dataset.counted = "1";
    countUp(node, Number(node.dataset.count) || 0, {
      suffix: node.dataset.countSuffix || "",
    });
  };
  if (!("IntersectionObserver" in window)) {
    nodes.forEach(run);
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        run(entry.target);
        io.unobserve(entry.target);
      }
    },
    { threshold: 0.4 }
  );
  nodes.forEach((node) => io.observe(node));
}

let toastHost = null;

export function toast(message, { type = "info", duration = 2600 } = {}) {
  if (!toastHost) {
    toastHost = el("div", { class: "toast-host", role: "status", "aria-live": "polite" });
    document.body.append(toastHost);
  }
  const node = el("div", {
    class: `toast${type === "error" ? " toast--err" : ""}`,
    text: message,
  });
  toastHost.append(node);
  setTimeout(() => {
    node.style.opacity = "0";
    node.style.transform = "translateY(6px)";
    node.style.transition = "opacity .2s ease, transform .2s ease";
    setTimeout(() => node.remove(), 220);
  }, duration);
}

let openDialog = null;

/**
 * 确认对话框：正文用 HTML 片段说明「将要发生什么」，所以重要操作能把
 * 类型、数量、不可逆的后果摆在同一屏里，而不是一句「确定吗」。
 * 返回 Promise<boolean>：确认 true；取消、Esc、点遮罩都是 false。
 */
export function confirmDialog({
  title = "确认操作",
  html = "",
  confirmText = "确认",
  cancelText = "取消",
  danger = false,
} = {}) {
  // 同一时刻只留一个对话框，避免连点按钮叠出两层
  openDialog?.(false);

  return new Promise((resolve) => {
    const previous = document.activeElement;
    const titleId = `dialog-title-${Date.now().toString(36)}`;
    const root = el("div", {
      class: "dialog",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": titleId,
    });
    root.innerHTML = `
      <div class="dialog__veil" data-close></div>
      <div class="dialog__panel" role="document">
        <h2 class="dialog__title" id="${titleId}">${esc(title)}</h2>
        <div class="dialog__body">${html}</div>
        <div class="dialog__actions">
          <button class="btn btn--quiet btn--sm" type="button" data-close>${esc(cancelText)}</button>
          <button class="btn btn--primary btn--sm${danger ? " btn--danger" : ""}" type="button" data-ok>
            ${esc(confirmText)}
          </button>
        </div>
      </div>
    `;

    // Tab 只在对话框内循环：不加这一层，键盘焦点会跑到遮罩后面的顶栏与表单里
    const focusables = () => Array.from(root.querySelectorAll("button")).filter((n) => !n.disabled);
    const onKeydown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(false);
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    function close(result) {
      openDialog = null;
      document.removeEventListener("keydown", onKeydown);
      root.remove();
      if (previous instanceof HTMLElement && document.contains(previous)) previous.focus();
      resolve(result);
    }

    openDialog = close;
    root.querySelectorAll("[data-close]").forEach((node) => {
      node.addEventListener("click", () => close(false));
    });
    root.querySelector("[data-ok]").addEventListener("click", () => close(true));
    document.addEventListener("keydown", onKeydown);

    document.body.append(root);
    root.querySelector("[data-ok]").focus();
  });
}

export function debounce(fn, wait = 240) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/** 相对时间，中文 */
export function timeAgo(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  const d = new Date(then);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/**
 * 调研月份：库里存的是 2026-04，但中文句子里写「2026-04 走的」很生硬。
 * 统一成「2026 年 4 月」，解析不了就原样返回，别把用户输入吃掉。
 */
export function formatMonth(value) {
  const text = String(value || "").trim();
  const m = text.match(/^(\d{4})-(\d{2})$/);
  if (!m) return text;
  return `${m[1]} 年 ${Number(m[2])} 月`;
}

export function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/**
 * 中文字数：与 Word 的「字数」口径一致——汉字按字计，连续的拉丁字母或数字按一个词计，
 * 标点与空白不计。原来的实现把标点也算进去，同一篇稿子的读数会比学生和老师
 * 在 Word 里看到的偏高一两成，正好压在 1500 上限附近时会误判为超长。
 */
export function zhWords(text) {
  const s = String(text || "");
  const cjk = (s.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) || []).length;
  const latin = (s.match(/[A-Za-z0-9]+(?:[.'’-][A-Za-z0-9]+)*/g) || []).length;
  return cjk + latin;
}
