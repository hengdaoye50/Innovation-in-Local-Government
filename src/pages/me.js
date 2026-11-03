/** 个人页：账号信息 + 我的作品（含审核状态与退回理由）+ 账户设置 */
import { esc, zhWords, timeAgo, mountReveal, toast } from "../lib/dom.js";
import { cases as casesApi, auth as authApi } from "../lib/api.js";
import { getState, setState, ROLE_LABEL } from "../lib/store.js";
import { AVATAR_MARKS, AVATAR_TINTS, avatarSvg, parseAvatar } from "../lib/avatar.js";

const STATUS_LABEL = {
  pending: { text: "审核中", cls: "tag--warn" },
  published: { text: "已发布", cls: "tag--ok" },
  rejected: { text: "已退回", cls: "tag--err" },
  hidden: { text: "已下架", cls: "tag--quiet" },
};

export function mePage() {
  const { user } = getState();
  const name = user?.displayName || user?.username || "同学";

  return `
    <article class="me">
      <div class="shell">
        <header class="me__head reveal">
          <p class="eyebrow">个人页</p>
          <h1 class="me__title" data-me-name>${esc(name)}</h1>
          <p class="lede">账号信息，以及你提交过的作品；审核状态与退回理由都在下面这一列。</p>
        </header>

        <div class="me__grid">
          <section class="card me__account reveal">
            <h2 class="h3">账号</h2>
            <dl class="me__facts">
              <div class="me__fact">
                <dt>显示名</dt>
                <dd data-me-name>${esc(user?.displayName || user?.username || "—")}</dd>
              </div>
              <div class="me__fact">
                <dt>账号</dt>
                <dd class="mono">${esc(user?.username || "—")}</dd>
              </div>
              <div class="me__fact">
                <dt>角色</dt>
                <dd>${esc(ROLE_LABEL[user?.role] || user?.role || "—")}</dd>
              </div>
            </dl>
          </section>

          <section class="me__works reveal">
            <header class="me__works-head">
              <h2 class="h3">我的作品</h2>
              <span class="meta" data-mine-count></span>
            </header>
            <div class="me__list" data-mine-list>
              <div class="skeleton" style="height:56px"></div>
            </div>
          </section>
        </div>

        <section class="card me__settings reveal" aria-labelledby="settings-title">
          <header class="me__settings-head">
            <h2 class="h3" id="settings-title">账户设置</h2>
            <span class="meta">改完立即生效</span>
          </header>

          <div class="me__settings-grid">
            <form class="me__setting" data-profile-form>
              <label class="field">
                <span class="field__label">昵称</span>
                <input
                  class="input"
                  name="displayName"
                  maxlength="20"
                  autocomplete="nickname"
                  value="${esc(user?.displayName || "")}"
                />
              </label>
              <p class="field__hint">
                2–4 个汉字的名字，在公开页面仍会按现有规则显示成「姓 + 同学」。
              </p>
              <button class="btn btn--quiet btn--sm" type="submit">保存昵称</button>
            </form>

            <div class="me__setting">
              <span class="field__label">头像</span>
              <div class="avatar-picker" data-avatar-picker></div>
              <div class="avatar-tints" data-avatar-tints></div>
              <p class="field__hint">顶栏与个人页共用这一枚，选完即保存。</p>
            </div>
          </div>

          <form class="me__setting me__setting--password" data-password-form>
            <span class="field__label">修改密码</span>
            <div class="me__pwd-row">
              <label class="field">
                <span class="field__label">当前密码</span>
                <input class="input" name="currentPassword" type="password"
                  autocomplete="current-password" />
              </label>
              <label class="field">
                <span class="field__label">新密码</span>
                <input class="input" name="newPassword" type="password"
                  autocomplete="new-password" placeholder="8–18 位，含大写、小写与数字" />
              </label>
              <label class="field">
                <span class="field__label">再输一次</span>
                <input class="input" name="confirmPassword" type="password"
                  autocomplete="new-password" />
              </label>
            </div>
            <p class="field__hint" data-password-hint>
              改完之后，其它设备上的登录会失效，需要重新登录。
            </p>
            <button class="btn btn--quiet btn--sm" type="submit">修改密码</button>
          </form>
        </section>
      </div>
    </article>
  `;
}

export async function mountMe(root) {
  mountReveal(root);
  await Promise.all([mountWorks(root), mountSettings(root)]);
}

/* —————————— 我的作品 —————————— */

async function mountWorks(root) {
  const host = root.querySelector("[data-mine-list]");
  const countEl = root.querySelector("[data-mine-count]");
  if (!host) return;

  let items = [];
  try {
    const res = await casesApi.mine();
    items = Array.isArray(res?.items) ? res.items : [];
  } catch {
    items = [];
  }

  if (countEl) countEl.textContent = items.length ? `共 ${items.length} 篇` : "";

  if (!items.length) {
    host.innerHTML = `<div class="empty">还没有提交过作品。写完一篇并提交后，会出现在这里。</div>`;
    return;
  }

  host.innerHTML = items
    .map((c) => {
      const st = STATUS_LABEL[c.status] || STATUS_LABEL.pending;
      const editable = c.status === "pending" || c.status === "rejected";
      return `
        <article class="mine-row">
          <div class="mine-row__meta">
            <span class="tag ${st.cls}">${st.text}</span>
            <span class="meta mono">${zhWords(c.body || c.summary || "")} 字</span>
            <span class="meta">${timeAgo(c.createdAt)}</span>
            ${
              editable
                ? `<a class="btn btn--quiet btn--sm mine-row__edit" href="#/?edit=${esc(
                    c.id
                  )}">修改</a>`
                : ""
            }
          </div>
          <a class="mine-row__title" href="#/case/${esc(c.id)}">${esc(c.title)}</a>
          ${
            c.status === "rejected" && c.aiReview
              ? `<p class="mine-row__review"><b>退回理由</b>${esc(c.aiReview)}</p>`
              : ""
          }
        </article>`;
    })
    .join("");
}

/* —————————— 账户设置 —————————— */

async function mountSettings(root) {
  const picker = root.querySelector("[data-avatar-picker]");
  const tintRow = root.querySelector("[data-avatar-tints]");
  const profileForm = root.querySelector("[data-profile-form]");
  const passwordForm = root.querySelector("[data-password-form]");
  if (!picker || !profileForm) return;

  const { user } = getState();
  // 当前选择：没设过头像就落在「首字母」上
  const current = parseAvatar(user?.avatar);
  let markId = current ? current.mark.id : 0;
  let tintId = current ? current.tint.id : 1;

  function renderPicker() {
    const initial = [...(user?.displayName || user?.username || "?")][0] || "?";
    picker.innerHTML = [
      `<button type="button" class="avatar-opt ${markId === 0 ? "is-on" : ""}"
        data-mark="0" aria-label="用首字母" aria-pressed="${markId === 0}">
        <span class="avatar-opt__letter">${esc(initial)}</span>
      </button>`,
      ...AVATAR_MARKS.map((m) => {
        const on = markId === m.id;
        return `<button type="button" class="avatar-opt ${on ? "is-on" : ""}"
          data-mark="${m.id}" aria-label="${m.name}" aria-pressed="${on}">
          ${avatarSvg(`m${m.id}:${tintId}`, 18)}
        </button>`;
      }),
    ].join("");

    if (tintRow) {
      tintRow.innerHTML = AVATAR_TINTS.map(
        (t) => `<button type="button" class="avatar-tint ${tintId === t.id ? "is-on" : ""}"
          data-tint="${t.id}" style="--tint:${t.color}" aria-label="${t.name}"
          aria-pressed="${tintId === t.id}"></button>`
      ).join("");
      tintRow.hidden = markId === 0;
    }
  }

  async function saveAvatar() {
    const value = markId === 0 ? "" : `m${markId}:${tintId}`;
    return saveProfile({ avatar: value });
  }

  async function saveProfile(patch) {
    const nameInput = profileForm.querySelector("[name=displayName]");
    // 换头像时用当前的昵称，不要顺手把输入框里改了一半的名字一起提交
    const displayName =
      patch.displayName ??
      (patch.avatar !== undefined ? getState().user?.displayName : nameInput.value);
    const avatar = patch.avatar ?? (markId === 0 ? "" : `m${markId}:${tintId}`);
    try {
      const res = await authApi.updateProfile(displayName, avatar);
      setState({ user: { ...getState().user, ...res.user } });
      // 页面标题与「显示名」是渲染时写死的，改完就地换掉，不必等刷新
      root.querySelectorAll("[data-me-name]").forEach((node) => {
        node.textContent = res.user.displayName;
      });
      if (nameInput) nameInput.value = res.user.displayName;
      toast(patch.avatar !== undefined ? "头像已更新" : "昵称已保存");
      return true;
    } catch (err) {
      toast(err.message || "保存失败", { type: "error" });
      return false;
    }
  }

  picker.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-mark]");
    if (!btn) return;
    markId = Number(btn.dataset.mark);
    renderPicker();
    saveAvatar();
  });

  tintRow?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-tint]");
    if (!btn) return;
    tintId = Number(btn.dataset.tint);
    renderPicker();
    saveAvatar();
  });

  profileForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveProfile({});
  });

  passwordForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(passwordForm);
    const currentPassword = String(data.get("currentPassword") || "");
    const newPassword = String(data.get("newPassword") || "");
    const confirmPassword = String(data.get("confirmPassword") || "");
    const hint = passwordForm.querySelector("[data-password-hint]");
    const btn = passwordForm.querySelector('button[type="submit"]');

    if (!currentPassword) return toast("请填写当前密码", { type: "error" });
    if (newPassword !== confirmPassword) return toast("两次输入的新密码不一致", { type: "error" });

    btn.disabled = true;
    try {
      await authApi.changePassword(currentPassword, newPassword);
      passwordForm.reset();
      if (hint) hint.textContent = "密码已修改，其它设备需要重新登录。";
      toast("密码已修改");
    } catch (err) {
      toast(err.message || "修改失败", { type: "error" });
    } finally {
      btn.disabled = false;
    }
  });

  renderPicker();
}
