/**
 * /api/admin/invites
 *   GET  列出邀请码
 *   POST 生成新邀请码
 */
import { ok, fail, methodNotAllowed, handleError } from "../../lib/http.js";
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
        `SELECT i.code, i.created_at, i.used_at, u.username AS used_by_name
         FROM invites i
         LEFT JOIN users u ON u.id = i.used_by
         ORDER BY i.created_at DESC
         LIMIT 100`
      ).all();
      return ok({
        items: (results || []).map((r) => ({
          code: r.code,
          createdAt: r.created_at,
          used: Boolean(r.used_at),
          usedBy: r.used_by_name || "",
        })),
      });
    }

    if (request.method === "POST") {
      // 生成并落库，重试几次以避开极小概率的编码碰撞
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = randomInviteCode();
        try {
          await env.DB.prepare(
            "INSERT INTO invites (code, created_by, created_at) VALUES (?, ?, ?)"
          )
            .bind(code, session.id, new Date().toISOString())
            .run();
          return ok({ code });
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
