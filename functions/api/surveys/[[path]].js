/**
 * /api/surveys
 *   GET  ?limit=  列出已发布的调研足迹
 *   POST 新建（登录用户即可，观察员除外）
 * /api/surveys/:id
 *   GET    详情（作者与教师能看见自己被下架的那条）
 *   PUT    作者本人或教师修改，状态不变
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
import {
  listSurveys,
  listMySurveys,
  getSurvey,
  insertSurvey,
  updateSurvey,
  hideSurvey,
  syncSurveyImages,
  pruneOrphanImages,
  referencedImageIds,
} from "../../lib/db.js";

const MAX_BODY = 20_000;
const MAX_IMAGES = 9;

/** 新建与修改共用一套字段整理，避免两处校验慢慢跑偏 */
function readSurveyPayload(body) {
  return {
    title: String(body.title || "").trim().slice(0, 80),
    province: String(body.province || "").trim().slice(0, 20),
    city: String(body.city || "").trim().slice(0, 30),
    district: String(body.district || "").trim().slice(0, 30),
    body: String(body.body || "").trim(),
    visitedAt: String(body.visitedAt || "").trim().slice(0, 10),
    lng: Number(body.lng),
    lat: Number(body.lat),
  };
}

function validateSurvey(data, { body }) {
  if (!data.title) return "给这次调研起个标题";
  if (!data.province) return "请选择调研地点";
  if (data.body.length < 80) return "正文太短了，至少写几句话记录你看到的";
  if (body && referencedImageIds(data.body).length > MAX_IMAGES) {
    return `一篇里最多放 ${MAX_IMAGES} 张照片`;
  }
  return "";
}

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
      // ?mine=1：个人页要看自己交过的全部记录，不分状态
      if (url.searchParams.get("mine")) {
        const session = await getSession(env, request);
        if (!session) return fail("请先登录", 401);
        const items = await listMySurveys(
          env,
          session.id,
          url.searchParams.get("limit") || 30
        );
        return ok({ items });
      }
      const items = await listSurveys(env, { limit: url.searchParams.get("limit") || 60 });
      return ok({ items });
    }

    if (id && method === "GET") {
      const item = await getSurvey(env, id);
      if (!item) return fail("这条记录不存在", 404);
      if (item.status !== "published") {
        const session = await getSession(env, request);
        const ownIt = session && (item.authorId === session.id || isStaff(session));
        if (!ownIt) return fail("这条记录不存在", 404);
      }
      return ok(item);
    }

    if (!id && method === "POST") {
      const session = await getSession(env, request);
      if (!session) return fail("请先登录", 401);
      if (isReadOnly(session)) return fail("观察员账号只能浏览", 403);

      const limit = rateLimit(`survey:${clientIp(request)}`, { limit: 6, windowMs: 10 * 60_000 });
      if (!limit.allowed) return fail("提交过于频繁，请稍后再试", 429);

      const raw = await readJson(request, MAX_BODY + 4_000);
      const data = readSurveyPayload(raw);
      const invalid = validateSurvey(data, { body: true });
      if (invalid) return fail(invalid);

      const surveyId = randomId("survey");
      await insertSurvey(env, {
        id: surveyId,
        ...data,
        lng: Number.isFinite(data.lng) ? data.lng : null,
        lat: Number.isFinite(data.lat) ? data.lat : null,
        body: data.body.slice(0, MAX_BODY),
        authorId: session.id,
        authorName: session.displayName || session.username,
        now: new Date().toISOString(),
      });
      await syncSurveyImages(env, surveyId, data.body);
      await pruneOrphanImages(env, session.id);

      return ok({ id: surveyId, status: "published" });
    }

    if (id && method === "PUT") {
      const session = await getSession(env, request);
      if (!session) return fail("请先登录", 401);

      const item = await getSurvey(env, id);
      if (!item) return fail("这条记录不存在", 404);

      const ownIt = item.authorId && item.authorId === session.id;
      if (!ownIt && !isStaff(session)) return fail("只能修改自己的记录", 403);

      const limit = rateLimit(`survey-edit:${clientIp(request)}`, {
        limit: 24,
        windowMs: 10 * 60_000,
      });
      if (!limit.allowed) return fail("改得太频繁了，过一会儿再试", 429);

      const raw = await readJson(request, MAX_BODY + 4_000);
      const data = readSurveyPayload(raw);
      const invalid = validateSurvey(data, { body: true });
      if (invalid) return fail(invalid);

      await updateSurvey(env, id, {
        ...data,
        lng: Number.isFinite(data.lng) ? data.lng : null,
        lat: Number.isFinite(data.lat) ? data.lat : null,
        body: data.body.slice(0, MAX_BODY),
        now: new Date().toISOString(),
      });
      // 图片归属按正文引用算：教师改学生的稿，学生传的图也得留在正文里
      await syncSurveyImages(env, id, data.body);
      await pruneOrphanImages(env, session.id);

      const fresh = await getSurvey(env, id);
      return ok(fresh || { id });
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

    return methodNotAllowed(["GET", "POST", "PUT", "DELETE"]);
  } catch (err) {
    return handleError(err);
  }
}
