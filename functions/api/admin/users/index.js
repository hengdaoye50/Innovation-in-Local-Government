/**
 * GET /api/admin/users —— 账号列表（仅 admin）
 *
 * 打开列表时顺手清掉「停用的空账号」：停用 + 名下零内容的，留着只是占位置。
 * 名下有作品的停用账号不会动，只把数字报回去（purged.skipped）。
 */
import { ok, fail, methodNotAllowed, handleError } from "../../../lib/http.js";
import { getSession, checkBindings, DEFAULT_RESET_PASSWORD } from "../../../lib/auth.js";
import { purgeEmptyDisabledUsers } from "../../../lib/purge.js";

export async function onRequest(context) {
  const { request, env } = context;

  try {
    const missing = checkBindings(env);
    if (missing) return fail(missing, 503);

    const session = await getSession(env, request);
    if (session?.role !== "admin") return fail("只有管理员可以管理账号", 403);

    if (request.method !== "GET") return methodNotAllowed(["GET"]);

    let purged = { users: 0, skipped: 0 };
    try {
      purged = await purgeEmptyDisabledUsers(env, { keepId: session.id });
    } catch {
      purged = { users: 0, skipped: 0 };
    }

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
         SUM(CASE WHEN role = 'student' THEN 1 ELSE 0 END) AS students,
         SUM(CASE WHEN role = 'observer' THEN 1 ELSE 0 END) AS observers
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
        observers: Number(counts?.observers) || 0,
      },
      purged,
      // 重置密码用的默认口令：随列表下发，前端确认窗与提示语直接用这个值，
      // 别在界面里另写一份，改了口令两边就会对不上。
      defaultPassword: DEFAULT_RESET_PASSWORD,
    });
  } catch (err) {
    return handleError(err);
  }
}
