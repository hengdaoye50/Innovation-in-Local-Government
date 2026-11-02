/**
 * /api/slides  列表  ?course=&term=&limit=
 * /api/slides/:id  详情
 * /api/slides  POST  创建（教师）
 */
import { ok, fail, methodNotAllowed, readJson, handleError, randomId } from "../../lib/http.js";
import { getSession, isStaff, checkBindings } from "../../lib/auth.js";
import { listSlides, getSlide, hasSlideVisibility } from "../../lib/db.js";
import { reviewSlide } from "../../lib/review.js";

export async function onRequest(context) {
  const { request, env, params } = context;
  const segments = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const id = segments[0] || "";
  const sub = segments[1] || "";

  try {
    const missing = checkBindings(env);
    if (missing) return fail(missing, 503);

    // /api/slides/:id/file：把存在 KV 里的演示文件原样吐回去
    if (id && sub === "file" && request.method === "GET") {
      return await fileHandler(env, request, id);
    }

    // /api/slides/:id/file  PUT：上传演示文件（只收 PDF）
    if (id && sub === "file" && request.method === "PUT") {
      const session = await getSession(env, request);
      if (!isStaff(session)) return fail("只有教师可以上传演示文件", 403);

      const slide = await getSlide(env, id);
      if (!slide) return fail("展位不存在", 404);

      const type = request.headers.get("content-type") || "";
      if (!type.includes("application/pdf")) {
        return fail("演示文件只收 PDF，请把 PPT 另存为 PDF 再上传", 415);
      }

      const buf = await request.arrayBuffer();
      if (!buf.byteLength) return fail("文件是空的");
      // KV 单值上限 25MB，留点余量
      if (buf.byteLength > 20 * 1024 * 1024) {
        return fail("PDF 超过 20MB，请压缩后再传", 413);
      }

      await env.SESSIONS.put(`slidefile:${id}`, buf);
      await env.DB.prepare("UPDATE slides SET file_url = ? WHERE id = ?")
        .bind(`/api/slides/${id}/file`, id)
        .run();

      return ok({ bytes: buf.byteLength, fileUrl: `/api/slides/${id}/file` });
    }

    // /api/slides/:id/review：重跑一次模型评语（教师用，也能救回一直「待评」的展位）
    if (id && sub === "review" && request.method === "POST") {
      const session = await getSession(env, request);
      if (!isStaff(session)) return fail("只有教师可以发起评语", 403);

      const slide = await getSlide(env, id);
      if (!slide) return fail("展位不存在", 404);

      const verdict = await reviewSlide(env, {
        title: slide.title,
        course: slide.course,
        description: slide.description,
      });
      if (!verdict) return fail("模型没有返回评语，请检查服务端密钥", 503);

      await env.DB.prepare("UPDATE slides SET ai_review = ?, ai_score = ? WHERE id = ?")
        .bind(verdict.review, verdict.score, id)
        .run();
      return ok({ review: verdict.review, score: verdict.score });
    }

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
        hasVisibility: await hasSlideVisibility(env),
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
      // 可见性：private 只有上传者与管理员能看，默认公开。
      // 迁移没跑时不能悄悄降级成公开——那等于把以为私密的东西放出去了，
      // 直接拒绝并说明原因，让人先去跑迁移。
      const allowPrivate = await hasSlideVisibility(env);
      if (body.visibility === "private" && !allowPrivate) {
        return fail("私有展位暂不可用：数据库迁移未完成，请先执行 0007 迁移", 503);
      }
      const visibility = body.visibility === "private" ? "private" : "public";

      if (allowPrivate) {
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
      } else {
        // 迁移没跑：退化成原来那条语句，先让上传能用
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
            author,
            String(body.coverUrl || "").slice(0, 500),
            String(body.fileUrl || "").slice(0, 500),
            description,
            Number(body.slides) || 0,
            new Date().toISOString()
          )
          .run();
      }

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

/**
 * 演示文件：上传时转成 PDF 存进 KV（键 slidefile:<id>），这里原样返回。
 * 存 PDF 而不是 pptx，是因为浏览器能直接内嵌预览，不需要第三方服务。
 */
async function fileHandler(env, request, id) {
  const slide = await getSlide(env, id);
  if (!slide || slide.status !== "published") return fail("展位不存在", 404);

  // 私有展位的文件也要按人拦，否则拿到 id 就能绕过列表直接下载
  if (slide.visibility === "private") {
    const session = await getSession(env, request);
    const allowed = session && (session.role === "admin" || session.id === slide.authorId);
    if (!allowed) return fail("展位不存在", 404);
  }

  const data = await env.SESSIONS.get(`slidefile:${id}`, "arrayBuffer");
  if (!data) return fail("这个展位还没有上传演示文件", 404);

  return new Response(data, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${id}.pdf"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
