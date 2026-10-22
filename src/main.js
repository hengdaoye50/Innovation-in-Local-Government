import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/map.css";
import "./styles/studio.css";
import "./styles/boards.css";
import "./styles/detail.css";
import "./styles/auth.css";

import { mountNav, mountFooter } from "./components/chrome.js";
import { route, setNotFound, start, navigate, currentPath, onRouteChange } from "./lib/router.js";
import { getState, setState } from "./lib/store.js";
import { auth as authApi } from "./lib/api.js";
import { toast } from "./lib/dom.js";

import { atlasSection, mountAtlas } from "./pages/atlas.js";
import { studioSection, mountStudio } from "./pages/studio.js";
import { slidesSection, mountSlides } from "./pages/slides.js";
import { blogSection, mountBlog } from "./pages/blog.js";
import { mountCaseDetail } from "./pages/case.js";
import { mountSlideDetail, mountPostDetail } from "./pages/detail.js";
import { mountAuth } from "./pages/login.js";
import { mountAdmin } from "./pages/admin.js";

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
    </main>
  `;
  mapInstance = await mountAtlas(app);
  mountStudio(app);
  await Promise.all([mountSlides(app), mountBlog(app)]);
  window.dispatchEvent(new CustomEvent("route:mounted", { detail: { page: "home" } }));
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

async function renderLogin() {
  document.body.classList.add("page-auth");
  app.innerHTML = `<main id="detail-root"></main>`;
  mountAuth(app.querySelector("#detail-root"));
}

async function renderAdmin() {
  app.innerHTML = `<main id="detail-root" class="detail-page"></main>`;
  mountAdmin(app.querySelector("#detail-root"));
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
route("/login", renderLogin);
route("/admin", renderAdmin);
setNotFound(renderNotFound);

onRouteChange((path) => {
  dispose();
  if (!path.startsWith("/login")) document.body.classList.remove("page-auth");
});

/* —————————————— 启动 —————————————— */

async function boot0() {
  const nav = mountNav({
    onLogout: async () => {
      try {
        await authApi.logout();
      } catch {
        /* 忽略 */
      }
      setState({ user: null });
      nav.refreshUser();
      toast("已登出");
    },
  });

  // 会话检查：失败视为未登录，不阻塞页面
  try {
    const me = await authApi.me();
    setState({ user: me?.user ?? null, authChecked: true });
  } catch {
    setState({ user: null, authChecked: true });
  }
  nav.refreshUser();

  mountFooter();
  start();

  // 路由切换后刷新导航状态
  window.addEventListener("route:mounted", () => nav.refreshUser());

  // 隐藏启动屏
  if (boot) {
    requestAnimationFrame(() => {
      boot.classList.add("done");
      setTimeout(() => boot.setAttribute("hidden", ""), 460);
    });
  }
}

boot0();

// 调试出口
window.__app = { getState, navigate, currentPath };
