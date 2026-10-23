/** 登录 / 邀请码注册 */
import { el, qs, toast } from "../lib/dom.js";
import { auth as authApi, cases as casesApi } from "../lib/api.js";
import { setState } from "../lib/store.js";
import { SITE } from "../components/chrome.js";

export function mountAuth(root) {
  root.innerHTML = `
    <div class="auth">
      <div class="auth__panel">
        <a class="auth__brand" href="#/">
          <span class="auth__brand-mark">${SITE.name}</span>
          <span class="auth__brand-sub">${SITE.course}</span>
        </a>

        <div class="auth__tabs" role="tablist">
          <button class="auth__tab is-on" data-tab="login" role="tab" aria-selected="true">登录</button>
          <button class="auth__tab" data-tab="register" role="tab" aria-selected="false">用邀请码注册</button>
        </div>

        <form class="auth__form" data-form="login">
          <label class="field">
            <span class="field__label">用户名</span>
            <input class="input" name="username" autocomplete="username" placeholder="学号或自定用户名" />
          </label>
          <label class="field">
            <span class="field__label">密码</span>
            <input class="input" name="password" type="password" autocomplete="current-password" placeholder="请输入密码" />
          </label>
          <button class="btn btn--primary btn--lg" type="submit">登录</button>
          <p class="field__hint">忘记密码请联系课程助教重置，本站不提供自助找回。</p>
        </form>

        <form class="auth__form" data-form="register" hidden>
          <label class="field">
            <span class="field__label">邀请码</span>
            <input class="input" name="invite" placeholder="6 位字母数字，如 A7K2M9" autocomplete="off" maxlength="6" style="letter-spacing:0.14em;text-transform:uppercase" />
          </label>
          <label class="field">
            <span class="field__label">用户名</span>
            <input class="input" name="username" autocomplete="username" placeholder="字母或数字，至少 6 位" />
          </label>
          <label class="field">
            <span class="field__label">密码</span>
            <input class="input" name="password" type="password" autocomplete="new-password" placeholder="8–18 位，含大写、小写与数字" />
          </label>
          <button class="btn btn--primary btn--lg" type="submit">注册并登录</button>
        </form>

        <p class="auth__foot">
          本站为课程内部平台，账号由任课教师发放邀请码开通。
        </p>
      </div>

      <aside class="auth__aside">
        <div class="auth__map" data-auth-map aria-hidden="true"></div>
        <div class="auth__quote">
          <p>「案例写作的第一步不是找答案，<br />而是把问题问准。」</p>
          <div class="auth__quote-rule"></div>
          <span class="meta">公共政策分析 · 课堂讲义</span>
        </div>
      </aside>
    </div>
  `;

  mountAsideMap(root);

  const forms = {
    login: qs('[data-form="login"]', root),
    register: qs('[data-form="register"]', root),
  };

  root.querySelectorAll("[data-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      root.querySelectorAll("[data-tab]").forEach((t) => {
        t.classList.toggle("is-on", t === tab);
        t.setAttribute("aria-selected", String(t === tab));
      });
      Object.entries(forms).forEach(([key, form]) => {
        form.hidden = key !== tab.dataset.tab;
      });
    });
  });

  function fillError(form, message) {
    let node = form.querySelector(".auth__error");
    if (!node) {
      node = el("p", { class: "auth__error" });
      form.querySelector('button[type="submit"]').before(node);
    }
    node.textContent = message;
  }

  function clearError(form) {
    form.querySelector(".auth__error")?.remove();
  }

  forms.login.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearError(forms.login);
    const data = new FormData(forms.login);
    const username = String(data.get("username") || "").trim();
    const password = String(data.get("password") || "");
    if (!username || !password) {
      fillError(forms.login, "请填写用户名与密码");
      return;
    }
    const btn = forms.login.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = "登录中…";
    try {
      const res = await authApi.login(username, password);
      setState({ user: res?.user || res || { username }, authChecked: true });
      // 整页跳转：让服务端中间件拿到新 cookie 后放行
      window.location.href = "/";
    } catch (err) {
      fillError(forms.login, err.message || "登录失败");
    } finally {
      btn.disabled = false;
      btn.textContent = "登录";
    }
  });

  forms.register.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearError(forms.register);
    const data = new FormData(forms.register);
    const invite = String(data.get("invite") || "").trim();
    const username = String(data.get("username") || "").trim();
    const password = String(data.get("password") || "");

    if (!invite) return fillError(forms.register, "请填写邀请码");
    if (!/^[A-Za-z0-9]{6}$/.test(invite))
      return fillError(forms.register, "邀请码为 6 位字母数字，请核对后再试");
    if (!/^[A-Za-z0-9]{6,}$/.test(username))
      return fillError(forms.register, "用户名需为字母或数字，至少 6 位");
    if (password.length < 8 || password.length > 18)
      return fillError(forms.register, "密码长度需为 8–18 位");
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password))
      return fillError(forms.register, "密码需同时包含大写字母、小写字母与数字");

    const btn = forms.register.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = "注册中…";
    try {
      const res = await authApi.register(username, password, invite);
      setState({ user: res?.user || res || { username }, authChecked: true });
      // 整页跳转：让服务端中间件拿到新 cookie 后放行
      window.location.href = "/";
    } catch (err) {
      fillError(forms.register, err.message || "注册失败");
    } finally {
      btn.disabled = false;
      btn.textContent = "注册并登录";
    }
  });
}

/**
 * 登录页右侧的地图门面：只渲染不交互，纯当视觉背景。
 * 未登录时也能看到案例在地图上的分布——这是这个平台最直观的样子。
 */
async function mountAsideMap(root) {
  const host = root.querySelector("[data-auth-map]");
  if (!host) return;
  // 窄屏时右侧面板整个隐藏，不必白下 600KB 的 GeoJSON
  if (!host.offsetWidth) return;

  try {
    const [{ createMap }, { DEMO_CASES }] = await Promise.all([
      import("../components/map.js"),
      import("../lib/demo.js"),
    ]);

    const map = createMap(host, {});
    await map.init();

    let items = [];
    try {
      const res = await casesApi.list({ status: "published", limit: 400 });
      items = Array.isArray(res?.items) ? res.items : [];
    } catch {
      items = [];
    }
    map.setData(items.length ? items : DEMO_CASES);
  } catch {
    /* 地图加载失败不影响登录 */
  }
}
