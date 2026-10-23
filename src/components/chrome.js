/** 全站共享外壳：顶栏、页脚、印章图标 */
import { el, esc, qs } from "../lib/dom.js";
import { getState, subscribe } from "../lib/store.js";

const SEAL = `<svg class="nav__seal" viewBox="0 0 24 24" aria-hidden="true">
  <rect x="2.5" y="2.5" width="19" height="19" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.1"/>
  <path d="M6.5 16.5V9.2l5.5 4.1 5.5-4.1v7.3" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M6.5 7.2h11" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" opacity=".55"/>
</svg>`;

const NAV_ITEMS = [
  { label: "案例地图", target: "atlas" },
  { label: "协作工作台", target: "studio" },
  { label: "课堂展示", target: "slides" },
  { label: "拓展材料", target: "blog" },
];

export const SITE = {
  name: "公共政策分析课程协作平台",
  latin: "Local Governance Innovation",
  course: "MPA · 公共政策分析 / 地方政府创新",
};

export function mountNav(actions = {}) {
  const host = el("header", { class: "nav" });
  host.innerHTML = `
    <div class="nav__inner">
      <a class="nav__brand" href="#/" aria-label="${esc(SITE.name)} 首页">
        ${SEAL}
        <span>${esc(SITE.name)}</span>
      </a>
      <nav class="nav__links" aria-label="主导航">
        ${NAV_ITEMS.map(
          (item) =>
            `<a class="nav__link" href="#${item.target}" data-target="${item.target}">${item.label}</a>`
        ).join("")}
        <a class="nav__link nav__link--mobile" href="#/login">登录 / 注册</a>
        <a class="nav__link nav__link--mobile" href="#/admin">教师后台</a>
      </nav>
      <div class="nav__actions">
        <span class="nav__user-slot"></span>
        <a class="btn btn--primary btn--sm" href="#studio">开始撰写</a>
        <button class="nav__toggle" aria-label="展开菜单" aria-expanded="false">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.3">
            <path d="M2 5h14M2 9h14M2 13h14" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  `;
  document.body.prepend(host);

  const toggle = host.querySelector(".nav__toggle");
  const links = host.querySelector(".nav__links");
  toggle.addEventListener("click", () => {
    const open = links.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(open));
  });

  const onScroll = () => {
    host.classList.toggle("is-solid", window.scrollY > 24);
    const atlas = document.getElementById("atlas");
    // 首屏是深色制图台，顶栏需要反色才看得见
    const overDark = !!atlas && window.scrollY < atlas.offsetHeight - 80;
    host.classList.toggle("is-dark", overDark);
    updateActive();
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  host.addEventListener("click", (event) => {
    const link = event.target.closest("[data-target]");
    if (!link) return;
    const id = link.dataset.target;
    const section = document.getElementById(id);
    if (!section) return;
    event.preventDefault();
    links.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
    const top = section.getBoundingClientRect().top + window.scrollY - 64;
    window.scrollTo({
      top,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  });

  function updateActive() {
    let current = "";
    for (const item of NAV_ITEMS) {
      const section = document.getElementById(item.target);
      if (!section) continue;
      const rect = section.getBoundingClientRect();
      if (rect.top <= 140 && rect.bottom > 140) current = item.target;
    }
    host.querySelectorAll(".nav__link").forEach((node) => {
      node.classList.toggle("is-active", node.dataset.target === current);
    });
  }

  renderUser(host, actions);

  return {
    refreshUser: () => renderUser(host, actions),
    updateActive,
  };
}

function renderUser(host, actions) {
  const slot = host.querySelector(".nav__user-slot");
  if (!slot) return;
  const { user } = getState();
  if (!user) {
    slot.innerHTML = `<a class="nav__link" href="#/login">登录</a>`;
    return;
  }
  const initial = (user.displayName || user.username || "?")[0];
  slot.innerHTML = `
    <span class="nav-user" title="${esc(user.username)}">
      <span class="nav-user__badge" data-role="${esc(user.role)}">${esc(initial)}</span>
    </span>
    ${
      user.role === "admin" || user.role === "teacher"
        ? `<a class="nav__link" href="#/admin">管理</a>`
        : ""
    }
    <button class="nav__link" data-action="logout">登出</button>
  `;
  slot.querySelector('[data-action="logout"]')?.addEventListener("click", () => {
    actions.onLogout?.();
  });
}

export function mountFooter() {
  const host = el("footer", { class: "footer" });
  host.innerHTML = `
    <div class="shell">
      <div class="footer__grid">
        <div>
          <div class="footer__brand">${esc(SITE.name)}</div>
          <p class="footer__note">
            由 ${esc(SITE.course)} 课程共建。案例由学生从公开新闻出发、
            经与模型协同检索后独立撰写，版权归作者本人所有，引用请注明来源。
          </p>
        </div>
        <div class="footer__links">
          <a href="#atlas">案例地图</a>
          <a href="#studio">协作工作台</a>
          <a href="#slides">课堂展示</a>
          <a href="#blog">拓展材料</a>
        </div>
      </div>
      <div class="footer__bottom">
        <span>${esc(SITE.latin)} · 课程协作平台</span>
        <span class="mono" data-footer-year></span>
      </div>
    </div>
  `;
  host.querySelector("[data-footer-year]").textContent = String(new Date().getFullYear());
  document.body.append(host);
  return host;
}

/** 通用图标 */
export const ICONS = {
  reset: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 6.2A6 6 0 1 1 2 9.6" stroke-linecap="round"/><path d="M2.2 2.6v3.8h3.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  rotate: `<svg viewBox="0 0 16 16" aria-hidden="true"><ellipse cx="8" cy="8" rx="6" ry="2.6"/><path d="M8 1.8v12.4" stroke-linecap="round" opacity=".45"/><path d="M2.6 5.4c1 1.6 3 2.6 5.4 2.6s4.4-1 5.4-2.6" stroke-linecap="round" opacity=".6"/></svg>`,
  zoom: `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.6"/><path d="M10.4 10.4L14 14" stroke-linecap="round"/><path d="M4.8 7h4.4" stroke-linecap="round"/></svg>`,
  zoomOut: `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.6"/><path d="M10.4 10.4L14 14" stroke-linecap="round"/><path d="M4.8 7h4.4" stroke-linecap="round"/><path d="M7 4.8v4.4" stroke-linecap="round" opacity=".45"/></svg>`,
  arrowDown: `<svg viewBox="0 0 14 6" aria-hidden="true"><path d="M1 1l6 4 6-4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};
