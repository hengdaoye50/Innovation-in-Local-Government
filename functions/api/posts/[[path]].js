/**
 * /api/posts  列表  ?tag=&limit=
 * /api/posts/:id  详情
 * /api/posts  POST  创建（教师）
 */
import { ok, fail, methodNotAllowed, readJson, handleError, randomId } from "../../lib/http.js";
import { getSession, isStaff, checkBindings } from "../../lib/auth.js";
import { listPosts, getPost } from "../../lib/db.js";

export async function onRequest(context) {
  const { request, env, params } = context;
  const segments = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const id = segments[0] || "";

  try {
    const missing = checkBindings(env);
    if (missing) return fail(missing, 503);

    if (!id && request.method === "GET") {
      const url = new URL(request.url);
      const items = await listPosts(env, {
        tag: url.searchParams.get("tag") || "",
        limit: url.searchParams.get("limit") || 20,
      });
      return ok({ items });
    }

    if (id && request.method === "GET") {
      const post = await getPost(env, id);
      if (!post) return fail("文章不存在", 404);
      return ok(post);
    }

    if (!id && request.method === "POST") {
      const session = await getSession(env, request);
      if (!isStaff(session)) return fail("只有教师可以发布文章", 403);

      const body = await readJson(request, 200_000);
      const title = String(body.title || "").trim().slice(0, 120);
      if (!title) return fail("请填写标题");

      const postId = randomId("post");
      const text = String(body.body || "");
      await env.DB.prepare(
        `INSERT INTO posts (id, title, author, source_url, tags, excerpt, body, cover_url,
          status, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'published', ?)`
      )
        .bind(
          postId,
          title,
          String(body.author || session.displayName).slice(0, 40),
          String(body.sourceUrl || "").slice(0, 500),
          JSON.stringify(Array.isArray(body.tags) ? body.tags.slice(0, 5) : []),
          String(body.excerpt || text.replace(/\s+/g, " ").slice(0, 160)).slice(0, 200),
          text,
          String(body.coverUrl || "").slice(0, 500),
          new Date().toISOString()
        )
        .run();

      return ok({ id: postId });
    }

    return methodNotAllowed(["GET", "POST"]);
  } catch (err) {
    return handleError(err);
  }
}
