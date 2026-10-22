/** HTTP 与响应工具 */

export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN",
};

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...SECURITY_HEADERS,
      ...extraHeaders,
    },
  });
}

export function ok(data, headers) {
  return json({ ok: true, data }, 200, headers);
}

/** 复制响应并追加 Cookie（Response 的 headers 是不可变的） */
export function withCookie(response, cookie) {
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", cookie);
  return new Response(response.body, { status: response.status, headers });
}

export function fail(message, status = 400, detail) {
  return json({ ok: false, error: message, ...(detail ? { detail } : {}) }, status);
}

export function methodNotAllowed(allowed = ["GET"]) {
  return json({ ok: false, error: "method not allowed" }, 405, {
    Allow: allowed.join(", "),
  });
}

/** 读取 JSON 请求体，带大小上限 */
export async function readJson(request, limitBytes = 200_000) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > limitBytes) {
    throw Object.assign(new Error("请求体过大"), { status: 413 });
  }
  const text = await request.text();
  if (text.length > limitBytes) {
    throw Object.assign(new Error("请求体过大"), { status: 413 });
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("请求体不是合法 JSON"), { status: 400 });
  }
}

/** 把异常统一转成响应，避免把内部堆栈暴露给前端 */
export function handleError(err) {
  const status = Number(err?.status) || 500;
  const message =
    status >= 500 ? "服务暂时不可用，请稍后重试" : err?.message || "请求无法处理";
  if (status >= 500) console.error("[api]", err);
  return fail(message, status);
}

export function clientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/** 简易内存限流（同一实例内有效，够挡住误触与脚本刷量） */
const buckets = new Map();

export function rateLimit(key, { limit = 20, windowMs = 60_000 } = {}) {
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || now - entry.start > windowMs) {
    buckets.set(key, { start: now, count: 1 });
    return { allowed: true, remaining: limit - 1 };
  }
  entry.count += 1;
  if (entry.count > limit) {
    return { allowed: false, remaining: 0, retryAfter: Math.ceil((entry.start + windowMs - now) / 1000) };
  }
  return { allowed: true, remaining: limit - entry.count };
}

export function randomId(prefix = "") {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  const body = [...bytes].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 14);
  return prefix ? `${prefix}_${body}` : body;
}

export function nowIso() {
  return new Date().toISOString();
}
