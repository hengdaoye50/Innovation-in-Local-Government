/**
 * /api/comments
 *   GET  ?target_type=case|slide|post&target_id=xxx
 *   POST { target_type, target_id, body }
 */
import { ok, fail, methodNotAllowed, readJson, handleError, randomId, clientIp, rateLimit } from "../lib/http.js";
import { getSession, isStaff, isReadOnly, checkBindings } from "../lib/auth.js";
import { listComments, insertComment, getCase, getSlide } from "../lib/db.js";
import { getWork } from "../lib/works.js";

const VALID_TYPES = new Set(["case", "slide", "post", "reading", "work"]);
const MAX_LENGTH = 1200;

/**
 * 留言挂在某个对象上，读写都得先确认这个对象对当前访问者可见。
 * 否则私有展位、别人的退回材料都能靠留言流反查出来（读）或被塞垃圾（写）。
 */
async function canTouchTarget(env, session, type, id) {
  if (type === "case") {
    const item = await getCase(env, id);
    if (!item) return false;
    if (item.status === "published") return true;
    return Boolean(session && (isStaff(session) || item.authorId === session.id));
  }
  if (type === "slide") {
    const item = await getSlide(env, id);
    if (!item || item.status !== "published") return false;
    if (item.visibility !== "private") return true;
    return Boolean(session && (isStaff(session) || item.authorId === session.id));
  }
  if (type === "work") {
    const work = await getWork(env, id);
    if (!work) return false;
    if (session && (isStaff(session) || work.authorId === session.id)) return true;
    return Boolean(work.featured && work.status !== "archived" && work.status !== "submitted");
  }
  if (type === "post") return true;
  // reading：正文是静态 JSON，留言挂 id 即可，没有私有态
  return true;
}

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

      const session = await getSession(env, request);
      if (!(await canTouchTarget(env, session, targetType, targetId))) {
        // 与详情页同口径：看不见的对象，留言流也当作不存在
        return ok({ items: [] });
      }

      const items = await listComments(env, { targetType, targetId });
      return ok({ items });
    }

    if (request.method === "POST") {
      const session = await getSession(env, request);
      if (!session) return fail("登录后才能发表讨论", 401);
      if (isReadOnly(session)) return fail("观察员账号只能浏览，不能参与讨论", 403);

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
      if (!(await canTouchTarget(env, session, targetType, targetId))) {
        return fail("这条内容不存在或你无权参与讨论", 404);
      }

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
