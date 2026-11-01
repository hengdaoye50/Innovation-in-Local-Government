/**
 * /api/slides  列表  ?course=&term=&limit=
 * /api/slides/:id  详情
 * /api/slides  POST  创建（教师）
 */
import { ok, fail, methodNotAllowed, readJson, handleError, randomId } from "../../lib/http.js";
import { getSession, isStaff, checkBindings } from "../../lib/auth.js";
import { listSlides, getSlide } from "../../lib/db.js";
import { reviewSlide } from "../../lib/review.js";

export async function onRequest(context) {
  const { request, env, params } = context;
  const segments = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const id = segments[0] || "";

  try {
    const missing = checkBindings(env);
    if (missing) return fail(missing, 503);

    if (!id && request.method === "GET") {
      const url = new URL(request.url);
      // 私有展位要按访问者过滤，所以列表这里也要取会话
      const session = await getSession(env, request);
      const items = await listSlides(env, {
        course: url.searchParams.get("course") || "",
        term: url.searchParams.get("term") || "",
        limit: url.searchParams.get("limit") || 24,
        viewerId: session?.id || 0,
        isAdmin: session?.role === "admin",
      });
      return ok({ items });
    }

    if (id && request.method === "GET") {
      const slide = await getSlide(env, id);
      if (!slide || slide.status !== "published") return fail("展位不存在", 404);

      // 私有展位：只有上传者本人和管理员能打开，其余一律当作不存在
      if (slide.visibility === "private") {
        const session = await getSession(env, request);
        const allowed = session && (session.role === "admin" || session.id === slide.authorId);
        if (!allowed) return fail("展位不存在", 404);
      }
      return ok(slide);
    }

    if (!id && request.method === "POST") {
      const session = await getSession(env, request);
      if (!isStaff(session)) return fail("只有教师可以上传展位", 403);

      const body = await readJson(request, 200_000);
      const title = String(body.title || "").trim().slice(0, 80);
      if (!title) return fail("请填写展位标题");

      const slideId = randomId("slide");
      const description = String(body.description || "").slice(0, 2000);
      const author = String(body.author || "").trim().slice(0, 40) || session.displayName;
      // 可见性：private 只有上传者与管理员能看，默认公开
      const visibility = body.visibility === "private" ? "private" : "public";

      await env.DB.prepare(
        `INSERT INTO slides (id, title, course, term, author_id, author_name, cover_url,
          file_url, description, slide_count, status, visibility, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?)`
      )
        .bind(
          slideId,
          title,
          String(body.course || "").slice(0, 40),
          String(body.term || "").slice(0, 20),
          session.id,
          author,
          String(body.coverUrl || "").slice(0, 500),
          String(body.fileUrl || "").slice(0, 500),
          description,
          Number(body.slides) || 0,
          visibility,
          new Date().toISOString()
        )
        .run();

      // 模型评语异步生成，不阻塞上传响应；没有配密钥时保持「待评」
      context.waitUntil(
        reviewSlide(env, { title, course: String(body.course || ""), description }).then(
          async (verdict) => {
            if (!verdict) return;
            await env.DB.prepare("UPDATE slides SET ai_review = ?, ai_score = ? WHERE id = ?")
              .bind(verdict.review, verdict.score, slideId)
              .run();
          }
        )
      );

      return ok({ id: slideId });
    }

    return methodNotAllowed(["GET", "POST"]);
  } catch (err) {
    return handleError(err);
  }
}
