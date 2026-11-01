/**
 * /api/readings/:id/annotations
 *   GET  列出这篇文献的全部标注
 *   POST 新建一条标注 { paragraph_key, start_offset, end_offset, quote, color?, note? }
 *
 * 表结构见 migrations/0006_annotations.sql。线上若还没跑过迁移，
 * 这里用 CREATE TABLE IF NOT EXISTS 兜一次底，保证功能能先用起来。
 */
import { ok, fail, methodNotAllowed, readJson, handleError } from "../../../lib/http.js";
import { getSession, isReadOnly, checkBindings } from "../../../lib/auth.js";

// 与 public/data/readings/*.json 对应；未登记的文献不接受标注
const READING_IDS = new Set(["flyvbjerg-case-study"]);
const COLORS = new Set(["gold", "plum", "green"]);

const DDL = `CREATE TABLE IF NOT EXISTS annotations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  reading_id    TEXT    NOT NULL,
  author_id     INTEGER NOT NULL,
  author_name   TEXT,
  paragraph_key TEXT    NOT NULL,
  start_offset  INTEGER NOT NULL,
  end_offset    INTEGER NOT NULL,
  quote         TEXT,
  color         TEXT    NOT NULL DEFAULT 'gold',
  note          TEXT,
  created_at    TEXT    NOT NULL
)`;

async function ensureTable(env) {
  await env.DB.prepare(DDL).run();
}

function shape(row) {
  return {
    id: row.id,
    paragraphKey: row.paragraph_key,
    start: row.start_offset,
    end: row.end_offset,
    quote: row.quote || "",
    color: row.color || "gold",
    note: row.note || "",
    authorId: row.author_id,
    authorName: row.author_name || "同学",
    createdAt: row.created_at,
  };
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const id = String(Array.isArray(params?.id) ? params.id[0] : params?.id || "");

  try {
    const missing = checkBindings(env);
    if (missing) return fail(missing, 503);

    const session = await getSession(env, request);
    if (!session) return fail("请先登录", 401);
    if (!READING_IDS.has(id)) return fail("没有这篇文献", 404);

    await ensureTable(env);

    if (request.method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT * FROM annotations WHERE reading_id = ? ORDER BY paragraph_key, start_offset`
      )
        .bind(id)
        .all();
      return ok({ items: (results || []).map(shape) });
    }

    if (request.method === "POST") {
      if (isReadOnly(session)) return fail("观察员账号只能阅读，不能标注", 403);

      const body = await readJson(request, 4_000);
      const paragraphKey = String(body.paragraph_key || "");
      const start = Number(body.start_offset);
      const end = Number(body.end_offset);
      const quote = String(body.quote || "").slice(0, 600);
      const note = String(body.note || "").trim().slice(0, 600);
      const color = COLORS.has(String(body.color)) ? String(body.color) : "gold";

      if (!/^\d+-\d+$/.test(paragraphKey)) return fail("标注位置无效");
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) {
        return fail("选区无效");
      }
      if (!note && !quote) return fail("空标注没有意义");

      // 同一个人在同一段落的同一区间只留一条，重复提交视为更新边注
      const existing = await env.DB.prepare(
        `SELECT id FROM annotations
         WHERE reading_id = ? AND author_id = ? AND paragraph_key = ?
           AND start_offset = ? AND end_offset = ?`
      )
        .bind(id, session.id, paragraphKey, start, end)
        .first();

      if (existing) {
        await env.DB.prepare("UPDATE annotations SET note = ?, color = ? WHERE id = ?")
          .bind(note || null, color, existing.id)
          .run();
        return ok({ id: existing.id, updated: true });
      }

      const result = await env.DB.prepare(
        `INSERT INTO annotations
           (reading_id, author_id, author_name, paragraph_key, start_offset, end_offset, quote, color, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          id,
          session.id,
          session.username || "",
          paragraphKey,
          start,
          end,
          quote || null,
          color,
          note || null,
          new Date().toISOString()
        )
        .run();

      return ok({ id: result.meta?.last_row_id || null });
    }

    return methodNotAllowed(["GET", "POST"]);
  } catch (err) {
    return handleError(err);
  }
}
