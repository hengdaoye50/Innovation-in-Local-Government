/**
 * /api/views  POST 记录一次访问 { targetType, targetId }
 *
 * 只记登录用户的访问：一是 DAU/WAU/MAU 要按人算，二是未登录访问多半是
 * 登录页本身，记了也没意义。一天内同一人看同一目标只留一条（靠唯一索引去重）。
 */
import { ok, fail, readJson, handleError, methodNotAllowed } from "../lib/http.js";
import { getSession, checkBindings } from "../lib/auth.js";

const VALID_TYPES = new Set(["case", "slide", "reading", "page"]);

export async function onRequest(context) {
  const { request, env } = context;

  try {
    const missing = checkBindings(env);
    if (missing) return fail(missing, 503);

    if (request.method !== "POST") return methodNotAllowed(["POST"]);

    const session = await getSession(env, request);
    if (!session) return ok({ recorded: false });

    const body = await readJson(request, 2_000);
    const targetType = String(body.targetType || "");
    const targetId = String(body.targetId || "").slice(0, 80);
    if (!VALID_TYPES.has(targetType) || !targetId) return ok({ recorded: false });

    const now = new Date();
    const day = now.toISOString().slice(0, 10);

    await env.DB.prepare(
      `INSERT INTO views (day, user_id, target_type, target_id, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (day, user_id, target_type, target_id) DO NOTHING`
    )
      .bind(day, session.id, targetType, targetId, now.toISOString())
      .run();

    return ok({ recorded: true });
  } catch (err) {
    // 埋点失败不能影响页面，一律吞掉报错
    return handleError(err);
  }
}
