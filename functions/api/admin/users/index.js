/**
 * GET /api/admin/users —— 账号列表（仅 admin）
 */
import { ok, fail, methodNotAllowed, handleError } from "../../../lib/http.js";
import { getSession, checkBindings } from "../../../lib/auth.js";

export async function onRequest(context) {
  const { request, env } = context;

  try {
    const missing = checkBindings(env);
    if (missing) return fail(missing, 503);

    const session = await getSession(env, request);
    if (session?.role !== "admin") return fail("只有管理员可以管理账号", 403);

    if (request.method !== "GET") return methodNotAllowed(["GET"]);

    const { results } = await env.DB.prepare(
      `SELECT id, username, display_name, role, status, created_at, last_login_at
       FROM users
       ORDER BY
         CASE role WHEN 'admin' THEN 0 WHEN 'teacher' THEN 1 ELSE 2 END,
         created_at DESC
       LIMIT 500`
    ).all();

    const counts = await env.DB.prepare(
      `SELECT
         SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) AS admins,
         SUM(CASE WHEN role = 'teacher' THEN 1 ELSE 0 END) AS teachers,
         SUM(CASE WHEN role = 'student' THEN 1 ELSE 0 END) AS students
       FROM users`
    ).first();

    return ok({
      items: (results || []).map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.display_name || u.username,
        role: u.role,
        status: u.status,
        createdAt: u.created_at,
        lastLoginAt: u.last_login_at || "",
        isSelf: u.id === session.id,
      })),
      counts: {
        admins: Number(counts?.admins) || 0,
        teachers: Number(counts?.teachers) || 0,
        students: Number(counts?.students) || 0,
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
