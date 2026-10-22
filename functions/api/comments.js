/**
 * /api/comments
 *   GET  ?target_type=case|slide|post&target_id=xxx
 *   POST { target_type, target_id, body }
 */
import { ok, fail, methodNotAllowed, readJson, handleError, randomId, clientIp, rateLimit } from "../lib/http.js";
import { getSession, isStaff, checkBindings } from "../lib/auth.js";
import { listComments, insertComment } from "../lib/db.js";

const VALID_TYPES = new Set(["case", "slide", "post"]);
const MAX_LENGTH = 1200;

export async function onRequest(context) {
  const { request, env } = context;

  try {
    const missing = checkBindings(env);
    if (missing) return fail(missing, 503);

    if (request.method === "GET") {
      const url = new URL(request.url);
      const targetType = url.searchParams.get("target_type") || "";
      const targetId = url.searchParams.get("target_id") || "";
      if (!VALID_TYPES.has(targetType)) return fail("target_type 无效");
      if (!targetId) return fail("缺少 target_id");

      const items = await listComments(env, { targetType, targetId });
      return ok({ items });
    }

    if (request.method === "POST") {
      const session = await getSession(env, request);
      if (!session) return fail("登录后才能发表讨论", 401);

      const limit = rateLimit(`cmt:${clientIp(request)}`, { limit: 20, windowMs: 10 * 60_000 });
      if (!limit.allowed) return fail("发言过于频繁，请稍后再试", 429);

      const body = await readJson(request, 20_000);
      const targetType = String(body.target_type || "");
      const targetId = String(body.target_id || "");
      const text = String(body.body || "").trim();

      if (!VALID_TYPES.has(targetType)) return fail("target_type 无效");
      if (!targetId) return fail("缺少 target_id");
      if (!text) return fail("留言不能为空");
      if (text.length > MAX_LENGTH) return fail(`留言不超过 ${MAX_LENGTH} 字`);

      const comment = {
        id: randomId("cmt"),
        targetType,
        targetId,
        authorId: session.id,
        authorName: session.displayName,
        authorRole: isStaff(session) ? "teacher" : "student",
        body: text,
        now: new Date().toISOString(),
      };

      await insertComment(env, comment);
      return ok({
        id: comment.id,
        targetType,
        targetId,
        authorName: comment.authorName,
        authorRole: comment.authorRole,
        body: text,
        createdAt: comment.now,
      });
    }

    return methodNotAllowed(["GET", "POST"]);
  } catch (err) {
    return handleError(err);
  }
}
