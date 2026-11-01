/**
 * /api/readings/:id/annotations/:aid
 *   DELETE 删除标注。本人可以删自己的，教师与管理员可以删任意一条。
 */
import { ok, fail, handleError } from "../../../../lib/http.js";
import { getSession, isStaff, checkBindings } from "../../../../lib/auth.js";

export async function onRequest(context) {
  const { request, env, params } = context;
  const readingId = String(Array.isArray(params?.id) ? params.id[0] : params?.id || "");
  const aid = Number(Array.isArray(params?.aid) ? params.aid[0] : params?.aid);

  try {
    const missing = checkBindings(env);
    if (missing) return fail(missing, 503);

    const session = await getSession(env, request);
    if (!session) return fail("请先登录", 401);

    if (request.method !== "DELETE") return fail("method not allowed", 405);
    if (!Number.isInteger(aid) || aid <= 0) return fail("标注不存在", 404);

    const row = await env.DB.prepare(
      "SELECT id, author_id FROM annotations WHERE id = ? AND reading_id = ?"
    )
      .bind(aid, readingId)
      .first();
    if (!row) return fail("标注不存在", 404);

    if (row.author_id !== session.id && !isStaff(session)) {
      return fail("只能删除自己的标注", 403);
    }

    await env.DB.prepare("DELETE FROM annotations WHERE id = ?").bind(aid).run();
    return ok({ deleted: true });
  } catch (err) {
    return handleError(err);
  }
}
