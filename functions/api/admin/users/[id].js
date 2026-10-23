/**
 * PATCH /api/admin/users/:id  { role?, status? }
 *
 * 只有 admin 可访问。改角色与停用都做了自保：不能把自己降级或停用，
 * 避免把最后一个管理员锁在门外。
 */
import { ok, fail, methodNotAllowed, readJson, handleError } from "../../../lib/http.js";
import { getSession, checkBindings } from "../../../lib/auth.js";

const ROLES = new Set(["student", "teacher", "admin"]);
const STATUSES = new Set(["active", "disabled"]);

export async function onRequest(context) {
  const { request, env, params } = context;

  try {
    const missing = checkBindings(env);
    if (missing) return fail(missing, 503);

    const session = await getSession(env, request);
    if (session?.role !== "admin") return fail("只有管理员可以管理账号", 403);

    if (request.method !== "PATCH") return methodNotAllowed(["PATCH"]);

    const targetId = Number(params.id);
    if (!Number.isFinite(targetId)) return fail("账号 ID 无效");

    const body = await readJson(request, 4_000);
    const sets = [];
    const binds = [];

    if (body.role !== undefined) {
      const role = String(body.role);
      if (!ROLES.has(role)) return fail("角色无效");
      if (targetId === session.id && role !== "admin") {
        return fail("不能降低自己的权限，请让另一位管理员操作", 400);
      }
      sets.push("role = ?");
      binds.push(role);
    }

    if (body.status !== undefined) {
      const status = String(body.status);
      if (!STATUSES.has(status)) return fail("状态无效");
      if (targetId === session.id && status !== "active") {
        return fail("不能停用自己的账号", 400);
      }
      sets.push("status = ?");
      binds.push(status);
    }

    if (!sets.length) return fail("没有要修改的字段");

    binds.push(targetId);
    const result = await env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...binds)
      .run();
    if (!result.meta?.changes) return fail("账号不存在或未发生变化", 404);

    const updated = await env.DB.prepare(
      "SELECT id, username, display_name, role, status FROM users WHERE id = ?"
    )
      .bind(targetId)
      .first();

    return ok({
      id: updated.id,
      username: updated.username,
      displayName: updated.display_name || updated.username,
      role: updated.role,
      status: updated.status,
    });
  } catch (err) {
    return handleError(err);
  }
}
