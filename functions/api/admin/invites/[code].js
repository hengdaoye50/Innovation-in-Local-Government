/**
 * /api/admin/invites/:code
 *   PATCH  { note }  修改备注
 *   DELETE           作废（软删除：写 revoked_at，保留痕迹）
 *
 * 已使用的邀请码不允许改备注或作废——它已经是某个账号的来历记录。
 */
import { ok, fail, methodNotAllowed, readJson, handleError } from "../../../lib/http.js";
import { getSession, isStaff, checkBindings } from "../../../lib/auth.js";

export async function onRequest(context) {
  const { request, env, params } = context;

  try {
    const missing = checkBindings(env);
    if (missing) return fail(missing, 503);

    const session = await getSession(env, request);
    if (!isStaff(session)) return fail("无权访问", 403);

    const code = String(params.code || "").trim().toUpperCase();
    if (!code) return fail("缺少邀请码");

    const existing = await env.DB.prepare(
      "SELECT code, used_by, used_at, revoked_at FROM invites WHERE code = ?"
    )
      .bind(code)
      .first();
    if (!existing) return fail("邀请码不存在", 404);
    if (existing.used_by) return fail("该邀请码已被使用，不能再修改", 400);

    if (request.method === "PATCH") {
      const body = await readJson(request, 2_000);
      const note = String(body.note ?? "").trim().slice(0, 60);
      await env.DB.prepare("UPDATE invites SET note = ? WHERE code = ?")
        .bind(note || null, code)
        .run();
      return ok({ code, note });
    }

    if (request.method === "DELETE") {
      if (existing.revoked_at) return ok({ code, revoked: true });
      await env.DB.prepare("UPDATE invites SET revoked_at = ? WHERE code = ?")
        .bind(new Date().toISOString(), code)
        .run();
      return ok({ code, revoked: true });
    }

    return methodNotAllowed(["PATCH", "DELETE"]);
  } catch (err) {
    return handleError(err);
  }
}
