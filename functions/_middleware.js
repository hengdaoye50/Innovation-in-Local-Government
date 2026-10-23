/**
 * 全站门禁：未登录访问页面入口时，让前端只渲染登录页。
 *
 * 只拦页面入口（/ 与 /index.html）：
 * 静态资源必须放行，否则登录页自己也加载不出来；
 * /api/* 也必须放行——登录、注册接口本身要能调通，
 * 写操作在各自接口内部已有鉴权。
 */
import { getSession } from "./lib/auth.js";

export async function onRequest(context) {
  const { request, env, next } = context;

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  const isPageEntry = path === "/" || path === "/index.html";
  if (!isPageEntry) return next();

  // 绑定缺失时不要卡住整个站点，交给后续接口报具体错误
  if (!env.DB || !env.SESSIONS) return next();

  const session = await getSession(env, request);
  if (session) return next();

  // 未登录：照常返回 index.html，但带上 gate 标记，
  // 前端看到它只渲染登录页，不去请求任何内容数据
  url.searchParams.set("gate", "1");
  return env.ASSETS.fetch(new Request(url.toString(), request));
}
