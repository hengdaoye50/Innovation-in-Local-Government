/**
 * /api/survey-images
 *   POST 上传一张调研配图（请求体是图片二进制，登录用户即可，观察员除外）
 * /api/survey-images/:id
 *   GET    取图，内容不可变，长缓存
 *   DELETE 删除（仅上传者本人）
 *
 * 图片存 D1 而不是 R2：课程量级（几百张）、无需额外绑定与费用。
 * 前端上传前已压到长边 1600 / JPEG，单行远低于 D1 的行大小上限；这里再加一道硬上限兜底。
 * 不接收 SVG——SVG 能带脚本，放进正文等于给自己开一个 XSS 口子。
 */
import { ok, fail, methodNotAllowed, handleError, randomId, clientIp, rateLimit } from "../../lib/http.js";
import { getSession, isReadOnly, checkBindings } from "../../lib/auth.js";
import { insertSurveyImage, getSurveyImage, deleteSurveyImage } from "../../lib/db.js";

const MAX_BYTES = 1_500_000;

/** 按文件头判类型，不信 Content-Type，也不给伪造的 .png 留口子 */
function sniffMime(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.length > 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return "image/webp";
  }
  return "";
}

function toBytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return new Uint8Array(value);
  return null;
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const segments = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const id = segments[0] || "";

  try {
    const missing = checkBindings(env);
    if (missing) return fail(missing, 503);

    const method = request.method;

    if (!id && method === "POST") {
      const session = await getSession(env, request);
      if (!session) return fail("请先登录", 401);
      if (isReadOnly(session)) return fail("观察员账号只能浏览", 403);

      const limit = rateLimit(`survey-img:${clientIp(request)}`, { limit: 40, windowMs: 10 * 60_000 });
      if (!limit.allowed) return fail("传图太频繁了，过一会儿再试", 429);

      const declared = Number(request.headers.get("Content-Length") || 0);
      if (declared > MAX_BYTES) return fail("这张图太大了，换一张或让它小一点", 413);

      const buffer = await request.arrayBuffer();
      if (buffer.byteLength > MAX_BYTES) return fail("这张图太大了，换一张或让它小一点", 413);
      if (!buffer.byteLength) return fail("没有收到图片内容");

      const bytes = new Uint8Array(buffer);
      const mime = sniffMime(bytes);
      if (!mime) return fail("只支持 JPG / PNG / WebP", 415);

      const url = new URL(request.url);
      const width = Number(url.searchParams.get("w"));
      const height = Number(url.searchParams.get("h"));

      const imageId = randomId("img");
      await insertSurveyImage(env, {
        id: imageId,
        ownerId: session.id,
        mime,
        width: Number.isFinite(width) ? width : null,
        height: Number.isFinite(height) ? height : null,
        bytes,
        now: new Date().toISOString(),
      });

      return ok({ id: imageId, url: `/api/survey-images/${imageId}` });
    }

    if (id && method === "GET") {
      const row = await getSurveyImage(env, id);
      if (!row) return fail("图片不存在", 404);
      const bytes = toBytes(row.bytes);
      if (!bytes) return fail("图片已损坏", 500);
      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": row.mime || "application/octet-stream",
          "Content-Length": String(bytes.byteLength),
          // 图片 id 一经写入不再变化，可以放心长缓存
          "Cache-Control": "public, max-age=31536000, immutable",
          ETag: `"${id}"`,
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    if (id && method === "DELETE") {
      const session = await getSession(env, request);
      if (!session) return fail("请先登录", 401);
      const done = await deleteSurveyImage(env, id, session.id);
      if (!done) return fail("没有这张图，或者不是你传的", 404);
      return ok({ deleted: true });
    }

    return methodNotAllowed(["GET", "POST", "DELETE"]);
  } catch (err) {
    return handleError(err);
  }
}
