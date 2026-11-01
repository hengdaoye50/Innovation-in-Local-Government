/**
 * /api/admin/stats
 *   后台数据面板：活跃度、总量、近两周趋势、内容排行（浏览量 + 评论量）
 *
 * 口径说明写进返回值里，避免面板上出现没人说得清的数字：
 * 浏览量是按「人 / 天 / 内容」去重后的读过人数，不是刷新次数。
 */
import { ok, fail, handleError } from "../../lib/http.js";
import { getSession, isStaff, checkBindings } from "../../lib/auth.js";

async function hasViewsTable(env) {
  try {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'views'"
    ).all();
    return (results || []).length > 0;
  } catch {
    return false;
  }
}

/** 特定类型的浏览量 + 评论量排行 */
async function rankContent(env, type, limit = 12) {
  const { results } = await env.DB.prepare(
    `SELECT v.target_id AS id, COUNT(*) AS views
     FROM views v
     WHERE v.target_type = ?
     GROUP BY v.target_id
     ORDER BY views DESC
     LIMIT ?`
  )
    .bind(type, limit)
    .all();

  const rows = results || [];
  if (!rows.length) return [];

  // 评论量单独查一次再合并，避免在大表上做多表聚合
  const { results: comments } = await env.DB.prepare(
    `SELECT target_id AS id, COUNT(*) AS n FROM comments
     WHERE target_type = ? GROUP BY target_id`
  )
    .bind(type)
    .all();
  const commentMap = new Map((comments || []).map((c) => [c.id, c.n]));

  // 标题：三类内容分别取，缺的留空
  const table = { case: "cases", slide: "slides" }[type];
  const titles = new Map();
  if (table) {
    const { results: meta } = await env.DB.prepare(
      `SELECT id, title FROM ${table} WHERE id IN (${rows.map(() => "?").join(",")})`
    )
      .bind(...rows.map((r) => r.id))
      .all();
    for (const m of meta || []) titles.set(m.id, m.title);
  }

  return rows.map((r) => ({
    id: r.id,
    title: titles.get(r.id) || "",
    views: Number(r.views) || 0,
    comments: commentMap.get(r.id) || 0,
  }));
}

export async function onRequest(context) {
  const { request, env } = context;

  try {
    const missing = checkBindings(env);
    if (missing) return fail(missing, 503);

    const session = await getSession(env, request);
    if (!isStaff(session)) return fail("无权查看", 403);
    if (request.method !== "GET") return fail("method not allowed", 405);

    const empty = {
      hasData: false,
      active: { today: 0, week: 0, month: 0 },
      totals: { views: 0, users: 0, cases: 0, comments: 0 },
      trend: [],
      ranking: { case: [], slide: [], reading: [] },
    };

    if (!(await hasViewsTable(env))) return ok(empty);

    const [today, week, month] = await Promise.all([
      env.DB.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM views WHERE day = date('now')").first(),
      env.DB.prepare(
        "SELECT COUNT(DISTINCT user_id) AS n FROM views WHERE day >= date('now', '-6 days')"
      ).first(),
      env.DB.prepare(
        "SELECT COUNT(DISTINCT user_id) AS n FROM views WHERE day >= date('now', '-29 days')"
      ).first(),
    ]);

    const totalsRow = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM views) AS views,
         (SELECT COUNT(*) FROM users WHERE status = 'active') AS users,
         (SELECT COUNT(*) FROM cases WHERE status = 'published') AS cases,
         (SELECT COUNT(*) FROM comments) AS comments`
    ).first();

    const { results: trend } = await env.DB.prepare(
      `SELECT day, COUNT(DISTINCT user_id) AS users, COUNT(*) AS views
       FROM views WHERE day >= date('now', '-13 days')
       GROUP BY day ORDER BY day`
    ).all();

    return ok({
      hasData: true,
      active: {
        today: Number(today?.n) || 0,
        week: Number(week?.n) || 0,
        month: Number(month?.n) || 0,
      },
      totals: {
        views: Number(totalsRow?.views) || 0,
        users: Number(totalsRow?.users) || 0,
        cases: Number(totalsRow?.cases) || 0,
        comments: Number(totalsRow?.comments) || 0,
      },
      trend: (trend || []).map((r) => ({
        day: r.day,
        users: Number(r.users) || 0,
        views: Number(r.views) || 0,
      })),
      ranking: {
        case: await rankContent(env, "case"),
        slide: await rankContent(env, "slide"),
        reading: await rankContent(env, "reading"),
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
