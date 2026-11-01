/**
 * /api/admin/invites
 *   GET  列出邀请码
 *   POST 生成新邀请码 { role: 'student' | 'teacher', note? }
 *
 * 只有 admin 能签发教师邀请码；teacher 只能签发学生邀请码。
 */
import { ok, fail, methodNotAllowed, readJson, handleError } from "../../../lib/http.js";
import { getSession, isStaff, randomInviteCode, checkBindings } from "../../../lib/auth.js";

export async function onRequest(context) {
  const { request, env } = context;

  try {
    const missing = checkBindings(env);
    if (missing) return fail(missing, 503);

    const session = await getSession(env, request);
    if (!isStaff(session)) return fail("无权访问", 403);

    if (request.method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT i.code, i.role, i.note, i.created_at, i.used_at, i.revoked_at,
                u.username AS used_by_name
         FROM invites i
         LEFT JOIN users u ON u.id = i.used_by
         ORDER BY i.created_at DESC
         LIMIT 200`
      ).all();
      return ok({
        items: (results || []).map((r) => ({
          code: r.code,
          role: r.role || "student",
          note: r.note || "",
          createdAt: r.created_at,
          used: Boolean(r.used_at),
          usedBy: r.used_by_name || "",
          usedAt: r.used_at || "",
          revoked: Boolean(r.revoked_at),
          revokedAt: r.revoked_at || "",
        })),
      });
    }

    if (request.method === "POST") {
      const body = await readJson(request, 2_000);
      const wanted = String(body.role || "student");
      if (!["student", "teacher"].includes(wanted)) return fail("角色只能是 student 或 teacher");

      // 提权边界：只有管理员能发教师邀请码
      if (wanted === "teacher" && session.role !== "admin") {
        return fail("只有管理员可以签发教师邀请码", 403);
      }

      const note = String(body.note || "").trim().slice(0, 60);
      // 批量上限 200：一个班一次发完够用，也挡住误操作把表刷爆
      const count = Math.min(200, Math.max(1, Number(body.count) || 1));

      if (count === 1) {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const code = randomInviteCode();
          try {
            await env.DB.prepare(
              "INSERT INTO invites (code, role, note, created_by, created_at) VALUES (?, ?, ?, ?, ?)"
            )
              .bind(code, wanted, note || null, session.id, new Date().toISOString())
              .run();
            return ok({ code, role: wanted, note, count: 1 });
          } catch (err) {
            if (attempt === 4) throw err;
          }
        }
        return fail("生成失败，请重试", 500);
      }

      // 批量：先在内存里生成互不重复的码，再用 batch 一次写入（D1 batch 是事务性的）。
      // 万一撞上已有记录整批回滚，重试时换一批码。
      const now = new Date().toISOString();
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const codes = new Set();
        while (codes.size < count) codes.add(randomInviteCode());
        const list = [...codes];
        try {
          await env.DB.batch(
            list.map((code) =>
              env.DB.prepare(
                "INSERT INTO invites (code, role, note, created_by, created_at) VALUES (?, ?, ?, ?, ?)"
              ).bind(code, wanted, note || null, session.id, now)
            )
          );
          return ok({
            items: list.map((code) => ({ code, role: wanted, note })),
            count: list.length,
          });
        } catch (err) {
          if (attempt === 2) throw err;
        }
      }
      return fail("批量生成失败，请重试", 500);
    }

    return methodNotAllowed(["GET", "POST"]);
  } catch (err) {
    return handleError(err);
  }
}
