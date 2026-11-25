/**
 * 全局闸口：被管理员重置过密码的账号，在改成自己的密码之前只能用认证接口。
 *
 * 为什么拦在服务端：站点是静态壳 + 接口取数，页面本身不含数据，
 * 前端把路由挡住只是皮——地址栏直接敲 #/works 就绕过去了。
 * 所以这里只认 /api/ 请求：静态资源放行，认证三件套（me / password / logout）放行，
 * 其余一律 403，前端看到 detail 后把人带到改密界面。
 *
 * 每次判定要多读一次 KV + D1，因此不对静态资源生效。
 */
import { fail } from "./lib/http.js";
import { getSession } from "./lib/auth.js";

const ALLOWED = new Set(["/api/auth/me", "/api/auth/password", "/api/auth/logout"]);

export async function onRequest(context) {
  const { request, env, next } = context;
  const { pathname } = new URL(request.url);

  if (!pathname.startsWith("/api/") || ALLOWED.has(pathname)) return next();

  try {
    const session = await getSession(env, request);
    if (session?.mustChangePassword) {
      return fail("请先修改密码", 403, "password_change_required");
    }
  } catch {
    // 绑定缺失或 KV 抖动不在这里兜：让请求继续走，由各接口自己报错，
    // 别把一次基础设施故障变成「所有人被要求改密码」
  }
  return next();
}
