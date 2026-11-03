import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/map.css";
import "./styles/studio.css";
import "./styles/me.css";
import "./styles/boards.css";
import "./styles/detail.css";
import "./styles/reading.css";
import "./styles/field.css";
import "./styles/layers.css";
import "./styles/auth.css";

import { mountNav, mountFooter, flushPendingSection, SITE } from "./components/chrome.js";
import {
  route,
  setNotFound,
  start,
  navigate,
  currentPath,
  onRouteChange,
  onRouteMounted,
} from "./lib/router.js";
import { getState, setState } from "./lib/store.js";
import { auth as authApi, api } from "./lib/api.js";
import { toast } from "./lib/dom.js";

import { atlasSection, mountAtlas } from "./pages/atlas.js";
import { studioSection, mountStudio } from "./pages/studio.js";
import { slidesSection, mountSlides } from "./pages/slides.js";
import { blogSection, mountBlog } from "./pages/blog.js";
import { fieldSection, mountField } from "./pages/field.js";
import { mountSurveyDetail, mountSurveyForm } from "./pages/survey.js";
import { mountReading } from "./pages/reading.js";
import { mountCaseDetail } from "./pages/case.js";
import { mountSlideDetail, mountPostDetail } from "./pages/detail.js";
import { mountAuth } from "./pages/login.js";
import { mountAdmin } from "./pages/admin.js";
import { mePage, mountMe } from "./pages/me.js";

const app = document.getElementById("app");
const boot = document.getElementById("boot");

let cleanup = [];
let mapInstance = null;

function track(fn) {
  if (typeof fn === "function") cleanup.push(fn);
}

function dispose() {
  cleanup.forEach((fn) => {
    try {
      fn();
    } catch (err) {
      console.warn(err);
    }
  });
  cleanup = [];
  if (mapInstance) {
    mapInstance.destroy();
    mapInstance = null;
  }
}

/* —————————————— 首页 —————————————— */

async function renderHome() {
  app.innerHTML = `
    <main>
      ${atlasSection()}
      ${studioSection()}
      ${slidesSection()}
      ${blogSection()}
      ${fieldSection()}
    </main>
  `;
  mapInstance = await mountAtlas(app);
  mountStudio(app);
  await Promise.all([mountSlides(app), mountBlog(app), mountField(app)]);
}

/* —————————————— 详情与独立页 —————————————— */

async function renderCase({ id }) {
  app.innerHTML = `<main id="detail-root" class="detail-page"></main>`;
  await mountCaseDetail(app.querySelector("#detail-root"), id);
}

async function renderSlide({ id }) {
  app.innerHTML = `<main id="detail-root" class="detail-page"></main>`;
  await mountSlideDetail(app.querySelector("#detail-root"), id);
}

async function renderPost({ id }) {
  app.innerHTML = `<main id="detail-root" class="detail-page"></main>`;
  await mountPostDetail(app.querySelector("#detail-root"), id);
}

async function renderReading({ id }) {
  app.innerHTML = `<main id="detail-root" class="detail-page"></main>`;
  await mountReading(app.querySelector("#detail-root"), id);
}

async function renderSurvey({ id }) {
  app.innerHTML = `<main id="detail-root" class="detail-page"></main>`;
  await mountSurveyDetail(app.querySelector("#detail-root"), id);
}

async function renderSurveyForm() {
  app.innerHTML = `<main id="detail-root" class="detail-page"></main>`;
  await mountSurveyForm(app.querySelector("#detail-root"));
}

async function renderLogin() {
  document.body.classList.add("page-auth");
  app.innerHTML = `<main id="detail-root"></main>`;
  mountAuth(app.querySelector("#detail-root"));
}

async function renderAdmin() {
  app.innerHTML = `<main id="detail-root" class="detail-page"></main>`;
  mountAdmin(app.querySelector("#detail-root"));
}

async function renderMe() {
  app.innerHTML = `<main class="detail-page">${mePage()}</main>`;
  await mountMe(app.querySelector(".me"));
}

function renderNotFound() {
  app.innerHTML = `
    <main class="detail-page">
      <div class="shell shell-narrow" style="padding:140px 24px 180px;text-align:center">
        <div class="screen-ordinal">404</div>
        <h1 class="h1" style="margin:12px 0 16px">这一页还没有被写下来</h1>
        <p class="lede" style="margin:0 auto 32px">链接可能已经改变，或者这个案例还没有提交。</p>
        <a class="btn btn--primary" href="#/">回到地图</a>
      </div>
    </main>
  `;
}

/* —————————————— 路由表 —————————————— */

route("/", renderHome);
route("/case/:id", renderCase);
route("/slide/:id", renderSlide);
route("/post/:id", renderPost);
route("/reading/:id", renderReading);
route("/field/new", renderSurveyForm);
route("/field/:id", renderSurvey);
route("/login", renderLogin);
route("/admin", renderAdmin);
route("/me", renderMe);
setNotFound(renderNotFound);

/** 各路由的浏览器标题；详情页拿到数据后会自己覆盖成具体标题 */
const PAGE_TITLES = {
  "/": "案例地图",
  "/login": "登录",
  "/admin": "教师后台",
  "/me": "个人页",
  "/field/new": "记录一次调研",
};

onRouteChange((path) => {
  dispose();
  if (!path.startsWith("/login")) document.body.classList.remove("page-auth");
  document.title = PAGE_TITLES[path]
    ? `${PAGE_TITLES[path]} · ${SITE.name}`
    : SITE.name;
  reportView(path);
});

/**
 * 访问上报：后台的日活/浏览排行靠它。
 * 只报登录用户，登录页不算；失败静默，埋点不该影响页面。
 */
function reportView(path) {
  if (!getState().user) return;
  const targets = [
    [/^\/case\/(.+)$/, "case"],
    [/^\/slide\/(.+)$/, "slide"],
    [/^\/reading\/(.+)$/, "reading"],
  ];
  for (const [re, type] of targets) {
    const hit = path.match(re);
    if (hit) {
      api.post("/api/views", { targetType: type, targetId: hit[1] }).catch(() => {});
      return;
    }
  }
  const page = { "/": "atlas", "/admin": "admin" }[path];
  if (page) api.post("/api/views", { targetType: "page", targetId: page }).catch(() => {});
}

/* —————————————— 启动 —————————————— */

async function boot0() {
  // 先查会话：未登录时只渲染登录页，不挂导航、不请求任何内容数据。
  // 服务端 _middleware.js 也会把页面入口带上 gate 标记，两层一起生效。
  let user = null;
  try {
    const me = await authApi.me();
    user = me?.user ?? null;
  } catch {
    user = null;
  }
  setState({ user, authChecked: true });

  const hideBoot = () => {
    if (!boot) return;
    requestAnimationFrame(() => {
      boot.classList.add("done");
      setTimeout(() => boot.setAttribute("hidden", ""), 460);
    });
  };

  if (!user) {
    document.body.classList.add("page-auth");
    app.innerHTML = `<main id="auth-root"></main>`;
    mountAuth(app.querySelector("#auth-root"));
    hideBoot();
    return;
  }

  const nav = mountNav({
    onLogout: async () => {
      try {
        await authApi.logout();
      } catch {
        /* 忽略 */
      }
      setState({ user: null });
      // 整页跳转：让服务端中间件重新判定，回到登录页
      window.location.href = "/";
    },
  });
  nav.refreshUser();

  mountFooter();
  start();

  // 路由挂载完成后刷新导航状态（含深色首屏的反色判断），
  // 并兑现「从别的页面点导航跳区块」时暂存的目标
  onRouteMounted(() => {
    nav.refreshUser();
    nav.sync();
    flushPendingSection();
  });

  hideBoot();
}

boot0();

// 调试出口
window.__app = { getState, navigate, currentPath };
