/**
 * 强制改密界面。
 *
 * 只有一种情况会走到这里：管理员在后台把密码重置成了默认口令，
 * 账号带着 must_change_password 标记登录。此时服务端 _middleware.js 会挡掉
 * 除 me / password / logout 之外的接口，所以这一页不挂导航、不请求任何内容数据——
 * 放出去也全是 403。
 *
 * 改完直接整页重载：让 boot0 重新问一次会话，标记清了才进正常页面。
 */
import { esc, toast } from "../lib/dom.js";
import { auth as authApi } from "../lib/api.js";

export function mountPasswordGate(root, user) {
  root.innerHTML = `
    <div class="shell shell-narrow pwd-gate">
      <div class="screen-ordinal">安全</div>
      <h1 class="h2" style="margin:12px 0 14px">先把密码改成你自己的</h1>
      <p class="lede">
        ${esc(user?.displayName || user?.username || "这个账号")} 的密码刚被管理员重置成默认口令。
        在改成新密码之前，站内其它功能暂时不可用。
      </p>

      <form class="card pwd-gate__form" data-gate-form>
        <!-- 密码管理器与无障碍检查都要求表单里有个 username 字段，这里只作标识，不提交 -->
        <input type="text" name="username" autocomplete="username" hidden readonly
          value="${esc(user?.username || "")}" />
        <label class="field">
          <span class="field__label">当前密码（默认口令）</span>
          <input class="input" name="currentPassword" type="password" autocomplete="current-password"
            required />
        </label>
        <label class="field">
          <span class="field__label">新密码</span>
          <input class="input" name="newPassword" type="password" autocomplete="new-password"
            placeholder="8–18 位，含大写、小写与数字" required />
        </label>
        <label class="field">
          <span class="field__label">再输一次</span>
          <input class="input" name="confirmPassword" type="password" autocomplete="new-password"
            required />
        </label>
        <p class="field__hint" data-gate-hint>
          新密码不能是默认口令。改完之后，其它设备上的登录会失效，需要重新登录。
        </p>
        <div class="pwd-gate__actions">
          <button class="btn btn--primary" type="submit">保存并继续</button>
          <button class="btn btn--quiet" type="button" data-gate-logout>退出登录</button>
        </div>
      </form>
    </div>
  `;

  const form = root.querySelector("[data-gate-form]");
  const hint = form.querySelector("[data-gate-hint]");
  const submit = form.querySelector('button[type="submit"]');

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const currentPassword = String(data.get("currentPassword") || "");
    const newPassword = String(data.get("newPassword") || "");
    const confirmPassword = String(data.get("confirmPassword") || "");

    if (!currentPassword) return toast("请填写当前密码", { type: "error" });
    if (newPassword !== confirmPassword) return toast("两次输入的新密码不一致", { type: "error" });

    submit.disabled = true;
    try {
      await authApi.changePassword(currentPassword, newPassword);
      hint.textContent = "密码已修改，正在进入站点……";
      window.location.reload();
    } catch (err) {
      toast(err.message || "修改失败", { type: "error" });
      submit.disabled = false;
    }
  });

  root.querySelector("[data-gate-logout]")?.addEventListener("click", async () => {
    try {
      await authApi.logout();
    } catch {
      /* 忽略：本地状态要清掉，服务端失败不该卡住人 */
    }
    window.location.href = "/";
  });
}
