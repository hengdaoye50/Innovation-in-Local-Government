/**
 * /api/surveys
 *   GET  ?limit=  列出已发布的调研足迹
 *   POST 新建（登录用户即可，观察员除外）
 * /api/surveys/:id
 *   GET    详情
 *   DELETE 作者本人或教师下架
 *
 * 与案例不同：这里不跑模型质检。游记没有「创新点」可判，硬判只会把人逼成汇报腔。
 */
import {
  ok,
  fail,
  methodNotAllowed,
  readJson,
  handleError,
  randomId,
  clientIp,
  rateLimit,
} from "../../lib/http.js";
import { getSession, isStaff, isReadOnly, checkBindings } from "../../lib/auth.js";
import { listSurveys, getSurvey, insertSurvey, hideSurvey } from "../../lib/db.js";

const MAX_BODY = 20_000;

export async function onRequest(context) {
  const { request, env, params } = context;
  const segments = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const id = segments[0] || "";

  try {
    const missing = checkBindings(env);
    if (missing) return fail(missing, 503);

    const method = request.method;

    if (!id && method === "GET") {
      const url = new URL(request.url);
      const items = await listSurveys(env, { limit: url.searchParams.get("limit") || 60 });
      return ok({ items });
    }

    if (id && method === "GET") {
      const item = await getSurvey(env, id);
      if (!item || item.status !== "published") return fail("这条记录不存在", 404);
      return ok(item);
    }

    if (!id && method === "POST") {
      const session = await getSession(env, request);
      if (!session) return fail("请先登录", 401);
      if (isReadOnly(session)) return fail("观察员账号只能浏览", 403);

      const limit = rateLimit(`survey:${clientIp(request)}`, { limit: 6, windowMs: 10 * 60_000 });
      if (!limit.allowed) return fail("提交过于频繁，请稍后再试", 429);

      const body = await readJson(request, MAX_BODY + 4_000);
      const title = String(body.title || "").trim().slice(0, 80);
      const province = String(body.province || "").trim();
      const city = String(body.city || "").trim().slice(0, 30);
      const district = String(body.district || "").trim().slice(0, 30);
      const text = String(body.body || "").trim();
      const visitedAt = String(body.visitedAt || "").trim().slice(0, 10);

      if (!title) return fail("给这次调研起个标题");
      if (!province) return fail("请选择调研地点");
      if (text.length < 80) return fail("正文太短了，至少写几句话记录你看到的");

      const lng = Number(body.lng);
      const lat = Number(body.lat);

      const surveyId = randomId("survey");
      await insertSurvey(env, {
        id: surveyId,
        title,
        province,
        city,
        district,
        lng: Number.isFinite(lng) ? lng : null,
        lat: Number.isFinite(lat) ? lat : null,
        body: text.slice(0, MAX_BODY),
        authorId: session.id,
        authorName: session.displayName || session.username,
        visitedAt,
        now: new Date().toISOString(),
      });

      return ok({ id: surveyId, status: "published" });
    }

    if (id && method === "DELETE") {
      const session = await getSession(env, request);
      if (!session) return fail("请先登录", 401);

      const item = await getSurvey(env, id);
      if (!item) return fail("这条记录不存在", 404);

      const ownIt = item.authorId && item.authorId === session.id;
      if (!ownIt && !isStaff(session)) return fail("只能删除自己的记录", 403);

      await hideSurvey(env, id);
      return ok({ hidden: true });
    }

    return methodNotAllowed(["GET", "POST", "DELETE"]);
  } catch (err) {
    return handleError(err);
  }
}
