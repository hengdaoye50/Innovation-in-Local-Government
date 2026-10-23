/**
 * /api/cases
 *   GET    ?status=&province=&domain=&q=&limit=&offset=
 *   GET    /api/cases/points        地图用轻量列表
 *   GET    /api/cases/:id
 *   POST                             提交作品（需登录，自动质检）
 *   PATCH  /api/cases/:id            改状态（教师）
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
import { getSession, isStaff, checkBindings } from "../../lib/auth.js";
import {
  listCases,
  getCase,
  insertCase,
  updateCaseStatus,
  listCasePoints,
  countCasesToday,
} from "../../lib/db.js";
import { reviewCase } from "../../lib/review.js";

const VALID_STATUS = new Set(["pending", "published", "rejected", "hidden"]);
const DAILY_LIMIT = 5;

export async function onRequest(context) {
  const { request, env, params } = context;
  const segments = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const id = segments[0] || "";

  try {
    const missing = checkBindings(env);
    if (missing) return fail(missing, 503);

    const method = request.method;

    if (!id && method === "GET") return await listHandler(request, env);
    if (id === "points" && method === "GET") return ok(await listCasePoints(env));
    if (id && method === "GET") return await detailHandler(env, id);
    if (!id && method === "POST") return await createHandler(context);
    if (id && method === "PATCH") return await statusHandler(context, id);

    return methodNotAllowed(["GET", "POST", "PATCH"]);
  } catch (err) {
    return handleError(err);
  }
}

async function listHandler(request, env) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "";

  // 未指定状态时只看已发布；指定其它状态需要教师身份
  let effectiveStatus = "published";
  if (status) {
    if (status !== "published") {
      const session = await getSession(env, request);
      if (!isStaff(session)) return fail("无权查看该状态的案例", 403);
    }
    effectiveStatus = status;
  }

  const items = await listCases(env, {
    status: effectiveStatus,
    province: url.searchParams.get("province") || "",
    domain: url.searchParams.get("domain") || "",
    q: url.searchParams.get("q") || "",
    limit: url.searchParams.get("limit") || 100,
    offset: url.searchParams.get("offset") || 0,
  });

  return ok({ items });
}

async function detailHandler(env, id) {
  const item = await getCase(env, id);
  if (!item) return fail("案例不存在", 404);
  if (item.status === "hidden") return fail("该案例已下架", 410);
  return ok(item);
}

async function createHandler({ request, env }) {
  const session = await getSession(env, request);
  if (!session) return fail("请先登录再提交", 401);

  const limit = rateLimit(`case:${clientIp(request)}`, { limit: 10, windowMs: 10 * 60_000 });
  if (!limit.allowed) return fail("提交过于频繁，请稍后再试", 429);

  const today = await countCasesToday(env, session.id);
  if (today >= DAILY_LIMIT) {
    return fail(`每个账号每日最多提交 ${DAILY_LIMIT} 篇，明天再来`, 429);
  }

  const body = await readJson(request, 120_000);

  const title = String(body.title || "").trim().slice(0, 60);
  const province = String(body.province || "").trim();
  const city = String(body.city || "").trim().slice(0, 30);
  const district = String(body.district || "").trim().slice(0, 30);
  const text = String(body.body || "").trim();
  const domains = Array.isArray(body.domains)
    ? body.domains.map((d) => String(d).trim()).filter(Boolean).slice(0, 3)
    : [];
  const sources = Array.isArray(body.sources)
    ? body.sources
        .map((s) => ({
          url: String(s?.url || "").trim(),
          title: String(s?.title || "").trim().slice(0, 120),
        }))
        .filter((s) => /^https?:\/\//.test(s.url))
        .slice(0, 15)
    : [];

  if (!title) return fail("请填写标题");
  if (!province) return fail("请选择发生地省份");
  if (!text) return fail("正文不能为空");
  if (!domains.length) return fail("请至少选择 1 个创新领域");
  if (!sources.length) return fail("请至少添加 1 条有效来源链接");

  const lng = Number(body.lng);
  const lat = Number(body.lat);

  const verdict = await reviewCase(env, { title, province, city, body: text, domains, sources });
  const status = verdict.pass ? "published" : "rejected";

  const id = randomId("case");
  const now = new Date().toISOString();

  await insertCase(env, {
    id,
    title,
    province,
    city,
    district,
    lng: Number.isFinite(lng) ? lng : null,
    lat: Number.isFinite(lat) ? lat : null,
    domains,
    summary: text.replace(/\s+/g, " ").slice(0, 160),
    body: text,
    sources,
    authorId: session.id,
    authorName: session.displayName,
    status,
    year: String(new Date().getFullYear()),
    now,
  });

  return ok({
    id,
    status,
    review: verdict.review,
    problems: verdict.problems || [],
    warnings: verdict.warnings || [],
    score: verdict.score,
  });
}

async function statusHandler({ request, env }, id) {
  const session = await getSession(env, request);
  if (!isStaff(session)) return fail("只有教师可以修改作品状态", 403);

  const body = await readJson(request, 4_000);
  const status = String(body.status || "");
  if (!VALID_STATUS.has(status)) return fail("状态值无效");

  const existing = await getCase(env, id);
  if (!existing) return fail("案例不存在", 404);

  const changed = await updateCaseStatus(
    env,
    id,
    status,
    body.review !== undefined ? String(body.review).slice(0, 500) : undefined,
    body.score !== undefined ? Number(body.score) : undefined
  );
  if (!changed) return fail("更新失败", 500);

  return ok({ id, status });
}
