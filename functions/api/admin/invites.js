/**
 * /api/admin/invites
 *   GET  列出邀请码
 *   POST 生成新邀请码 { role: 'student' | 'teacher' }
 *
 * 只有 admin 能签发教师邀请码；teacher 只能签发学生邀请码。
 */
import { ok, fail, methodNotAllowed, handleError, readJson } from "../../lib/http.js";
import { getSession, isStaff, randomInviteCode, checkBindings } from "../../lib/auth.js";

export async function onRequest(context) {
  const { request, env } = context;

  try {
    const missing = checkBindings(env);
    if (missing) return fail(missing, 503);

    const session = await getSession(env, request);
    if (!isStaff(session)) return fail("无权访问", 403);

    if (request.method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT i.code, i.role, i.created_at, i.used_at, u.username AS used_by_name
         FROM invites i
         LEFT JOIN users u ON u.id = i.used_by
         ORDER BY i.created_at DESC
         LIMIT 100`
      ).all();
      return ok({
        items: (results || []).map((r) => ({
          code: r.code,
          role: r.role || "student",
          createdAt: r.created_at,
          used: Boolean(r.used_at),
          usedBy: r.used_by_name || "",
        })),
      });
    }

    if (request.method === "POST") {
      const body = await readJson(request, 2_000);
      const wanted = String(body.role || "student");
      if (!["student", "teacher"].includes(wanted)) return fail("角色只能是 student 或 teacher");

      // 提权边界：只有管理员能发教师邀请码
      if (wanted === "teacher" && session.role !== "admin") {
        return fail("只有管理员可以签发教师邀请码", 403);
      }

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = randomInviteCode();
        try {
          await env.DB.prepare(
            "INSERT INTO invites (code, role, created_by, created_at) VALUES (?, ?, ?, ?)"
          )
            .bind(code, wanted, session.id, new Date().toISOString())
            .run();
          return ok({ code, role: wanted });
        } catch (err) {
          if (attempt === 4) throw err;
        }
      }
      return fail("生成失败，请重试", 500);
    }

    return methodNotAllowed(["GET", "POST"]);
  } catch (err) {
    return handleError(err);
  }
}
