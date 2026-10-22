/**
 * /api/auth/*
 *   POST register  { username, password, invite }
 *   POST login     { username, password }
 *   POST logout
 *   GET  me
 */
import {
  ok,
  fail,
  methodNotAllowed,
  readJson,
  handleError,
  clientIp,
  rateLimit,
  withCookie,
} from "../../lib/http.js";
import {
  validateUsername,
  validatePassword,
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  sessionCookie,
  clearSessionCookie,
  tokenFromRequest,
  getSession,
  publicUser,
  checkBindings,
} from "../../lib/auth.js";

export async function onRequest(context) {
  const { request, env, params } = context;
  const segments = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const action = segments[0] || "";

  try {
    const missing = checkBindings(env);
    if (missing) return fail(missing, 503);

    if (action === "me") {
      if (request.method !== "GET") return methodNotAllowed(["GET"]);
      const session = await getSession(env, request);
      return ok({ user: publicUser(session) });
    }

    if (request.method !== "POST") return methodNotAllowed(["POST"]);

    if (action === "register") return await register(context);
    if (action === "login") return await login(context);
    if (action === "logout") return await logout(context);

    return fail("未知的认证操作", 404);
  } catch (err) {
    return handleError(err);
  }
}

async function register({ request, env }) {
  const limit = rateLimit(`reg:${clientIp(request)}`, { limit: 6, windowMs: 10 * 60_000 });
  if (!limit.allowed) return fail("尝试过于频繁，请稍后再试", 429);

  const body = await readJson(request, 8_000);
  const invite = String(body.invite || "").trim().toUpperCase();
  if (!invite) return fail("请填写邀请码");

  const name = validateUsername(body.username);
  if (!name.ok) return fail(name.message);
  const pwd = validatePassword(body.password);
  if (!pwd.ok) return fail(pwd.message);

  const inviteRow = await env.DB.prepare("SELECT code, used_by FROM invites WHERE code = ?")
    .bind(invite)
    .first();
  if (!inviteRow) return fail("邀请码无效");
  if (inviteRow.used_by) return fail("该邀请码已被使用");

  const exists = await env.DB.prepare("SELECT id FROM users WHERE username = ?")
    .bind(name.value)
    .first();
  if (exists) return fail("用户名已被占用");

  const passwordHash = await hashPassword(pwd.value);
  const now = new Date().toISOString();

  const result = await env.DB.prepare(
    "INSERT INTO users (username, password_hash, display_name, role, status, created_at) VALUES (?, ?, ?, 'student', 'active', ?)"
  )
    .bind(name.value, passwordHash, name.value, now)
    .run();

  const userId = result.meta?.last_row_id;
  if (!userId) return fail("注册失败，请重试", 500);

  // 邀请码一次性使用
  const consumed = await env.DB.prepare(
    "UPDATE invites SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL"
  )
    .bind(userId, now, invite)
    .run();
  if (!consumed.meta?.changes) {
    await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
    return fail("该邀请码已被使用");
  }

  const token = await createSession(env, { userId, username: name.value, role: "student" });
  return withCookie(
    ok({
      user: { id: userId, username: name.value, displayName: name.value, role: "student" },
    }),
    sessionCookie(token)
  );
}

async function login({ request, env }) {
  const limit = rateLimit(`login:${clientIp(request)}`, { limit: 10, windowMs: 10 * 60_000 });
  if (!limit.allowed) return fail("尝试过于频繁，请稍后再试", 429);

  const body = await readJson(request, 4_000);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!username || !password) return fail("请填写用户名与密码");

  const user = await env.DB.prepare(
    "SELECT id, username, password_hash, display_name, role, status FROM users WHERE username = ?"
  )
    .bind(username)
    .first();

  // 用户不存在也执行一次哈希比较，避免通过响应时间探测账号是否存在
  const stored = user?.password_hash || "pbkdf2$100000$00$00";
  const valid = await verifyPassword(password, stored);
  if (!user || !valid) return fail("用户名或密码不正确", 401);
  if (user.status !== "active") return fail("该账号已被停用，请联系任课教师", 403);

  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?")
    .bind(now, user.id)
    .run();

  const token = await createSession(env, {
    userId: user.id,
    username: user.username,
    role: user.role,
  });

  const res = ok({
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name || user.username,
      role: user.role,
    },
  });
  return withCookie(res, sessionCookie(token));
}

async function logout({ request, env }) {
  const token = tokenFromRequest(request);
  await destroySession(env, token);
  return withCookie(ok({ loggedOut: true }), clearSessionCookie());
}
