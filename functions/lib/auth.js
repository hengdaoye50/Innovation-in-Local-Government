/**
 * 认证：PBKDF2 密码校验 + KV 会话
 * 与 polihot 一致的强度要求，但不保存任何可还原的密码副本。
 */

const SESSION_PREFIX = "auth:session:";
const SESSION_TTL = 60 * 60 * 24 * 7; // 7 天
const COOKIE_NAME = "ilg_session";

export function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

export function validateUsername(value) {
  const u = String(value || "").trim();
  if (!/^[A-Za-z0-9]+$/.test(u)) return { ok: false, message: "用户名只能包含字母和数字" };
  if (u.length < 6 || u.length > 24) return { ok: false, message: "用户名需为 6–24 位" };
  return { ok: true, value: u };
}

export function validatePassword(value) {
  const p = String(value || "");
  if (p.length < 8 || p.length > 18) return { ok: false, message: "密码长度需为 8–18 位" };
  if (!/[A-Z]/.test(p)) return { ok: false, message: "密码需包含大写字母" };
  if (!/[a-z]/.test(p)) return { ok: false, message: "密码需包含小写字母" };
  if (!/[0-9]/.test(p)) return { ok: false, message: "密码需包含数字" };
  return { ok: true, value: p };
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    key,
    256
  );
  return `pbkdf2$100000$${toHex(salt)}$${toHex(bits)}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, iterStr, saltHex, hashHex] = String(stored).split("$");
    if (scheme !== "pbkdf2") return false;
    const iterations = parseInt(iterStr, 10);
    if (!Number.isFinite(iterations) || iterations < 10000) return false;
    const salt = fromHex(saltHex);
    const expected = fromHex(hashHex);
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const bits = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
        key,
        expected.length * 8
      )
    );
    if (bits.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < bits.length; i += 1) diff |= bits[i] ^ expected[i];
    return diff === 0;
  } catch {
    return false;
  }
}

export function randomToken() {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * 6 位字母数字邀请码。
 * 字母表剔除了 I/O/0/1 这类易混字符，且强制至少各含一位字母与数字，
 * 避免出现「全是数字」这种容易被顺序猜到的组合。
 */
export function randomInviteCode() {
  const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const DIGITS = "23456789";
  const ALPHABET = LETTERS + DIGITS;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    let code = "";
    for (let i = 0; i < 6; i += 1) code += ALPHABET[bytes[i] % ALPHABET.length];
    if (/[A-Z]/.test(code) && /[0-9]/.test(code)) return code;
  }

  // 极端情况下兜底：直接拼一个确定混合的码
  const pick = (set, n) => {
    const bytes = crypto.getRandomValues(new Uint8Array(n));
    let s = "";
    for (let i = 0; i < n; i += 1) s += set[bytes[i] % set.length];
    return s;
  };
  return pick(DIGITS, 1) + pick(LETTERS, 4) + pick(DIGITS, 1);
}

export async function createSession(env, { userId, username, role }) {
  const token = randomToken();
  await env.SESSIONS.put(
    SESSION_PREFIX + token,
    JSON.stringify({ userId, username, role, createdAt: new Date().toISOString() }),
    { expirationTtl: SESSION_TTL }
  );
  return token;
}

export async function destroySession(env, token) {
  if (token) await env.SESSIONS.delete(SESSION_PREFIX + token);
}

export function sessionCookie(token) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function tokenFromRequest(request) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return match ? match[1] : null;
}

/** 取当前会话；用户被停用时立即失效 */
export async function getSession(env, request) {
  const token = tokenFromRequest(request);
  if (!token) return null;
  const raw = await env.SESSIONS.get(SESSION_PREFIX + token);
  if (!raw) return null;
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  const user = await env.DB.prepare(
    "SELECT id, username, display_name, role, status FROM users WHERE id = ?"
  )
    .bind(payload.userId)
    .first();
  if (!user || user.status !== "active") return null;
  return {
    token,
    id: user.id,
    username: user.username,
    displayName: user.display_name || user.username,
    role: user.role,
  };
}

export function isStaff(session) {
  return session?.role === "teacher" || session?.role === "admin";
}

export function publicUser(session) {
  if (!session) return null;
  return {
    id: session.id,
    username: session.username,
    displayName: session.displayName,
    role: session.role,
  };
}

/** 缺少必要绑定时的统一报错 */
export function checkBindings(env) {
  if (!env.DB) return "服务端缺少 D1 绑定（DB）";
  if (!env.SESSIONS) return "服务端缺少 KV 绑定（SESSIONS）";
  return null;
}
