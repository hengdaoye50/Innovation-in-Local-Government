/**
 * /api/slides  列表  ?course=&term=&limit=
 * /api/slides/:id  详情
 * /api/slides  POST  创建（教师）
 */
import { ok, fail, methodNotAllowed, readJson, handleError, randomId } from "../../lib/http.js";
import { getSession, isStaff, checkBindings } from "../../lib/auth.js";
import { listSlides, getSlide } from "../../lib/db.js";

export async function onRequest(context) {
  const { request, env, params } = context;
  const segments = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const id = segments[0] || "";

  try {
    const missing = checkBindings(env);
    if (missing) return fail(missing, 503);

    if (!id && request.method === "GET") {
      const url = new URL(request.url);
      const items = await listSlides(env, {
        course: url.searchParams.get("course") || "",
        term: url.searchParams.get("term") || "",
        limit: url.searchParams.get("limit") || 24,
      });
      return ok({ items });
    }

    if (id && request.method === "GET") {
      const slide = await getSlide(env, id);
      if (!slide || slide.status !== "published") return fail("展位不存在", 404);
      return ok(slide);
    }

    if (!id && request.method === "POST") {
      const session = await getSession(env, request);
      if (!isStaff(session)) return fail("只有教师可以上传展位", 403);

      const body = await readJson(request, 20_000);
      const title = String(body.title || "").trim().slice(0, 80);
      if (!title) return fail("请填写展位标题");

      const slideId = randomId("slide");
      await env.DB.prepare(
        `INSERT INTO slides (id, title, course, term, author_id, author_name, cover_url,
          file_url, description, slide_count, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?)`
      )
        .bind(
          slideId,
          title,
          String(body.course || "").slice(0, 40),
          String(body.term || "").slice(0, 20),
          session.id,
          session.displayName,
          String(body.coverUrl || "").slice(0, 500),
          String(body.fileUrl || "").slice(0, 500),
          String(body.description || "").slice(0, 2000),
          Number(body.slides) || 0,
          new Date().toISOString()
        )
        .run();

      return ok({ id: slideId });
    }

    return methodNotAllowed(["GET", "POST"]);
  } catch (err) {
    return handleError(err);
  }
}
