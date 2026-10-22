/**
 * 生成首个教师账号的 SQL。
 * 密码哈希在本地用 WebCrypto 计算，明文不落盘、不进仓库。
 *
 * 用法：
 *   node scripts/seed-admin.mjs <用户名> <密码> [角色] [--out=路径]
 *   node scripts/seed-admin.mjs teacher01 Xxxx1234 teacher --out=migrations/0002_seed_admin.sql
 * 然后执行：
 *   npx wrangler d1 execute DB --remote --file=migrations/0002_seed_admin.sql
 */
import { webcrypto } from "node:crypto";
import { writeFileSync } from "node:fs";

const { subtle } = webcrypto;

const args = process.argv.slice(2).filter((a) => !a.startsWith("--out="));
const outArg = process.argv.slice(2).find((a) => a.startsWith("--out="));
const [username, password, role = "admin"] = args;

if (!username || !password) {
  console.error("用法：node scripts/seed-admin.mjs <用户名> <密码> [admin|teacher]");
  process.exit(1);
}
if (!/^[A-Za-z0-9]{6,24}$/.test(username)) {
  console.error("用户名需为 6–24 位字母或数字");
  process.exit(1);
}
if (password.length < 8 || password.length > 18) {
  console.error("密码长度需为 8–18 位");
  process.exit(1);
}
if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
  console.error("密码需同时包含大写字母、小写字母与数字");
  process.exit(1);
}
if (!["admin", "teacher"].includes(role)) {
  console.error("角色只能是 admin 或 teacher");
  process.exit(1);
}

const toHex = (buf) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

const salt = webcrypto.getRandomValues(new Uint8Array(16));
const key = await subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
  "deriveBits",
]);
const bits = await subtle.deriveBits(
  { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
  key,
  256
);
const hash = `pbkdf2$100000$${toHex(salt)}$${toHex(bits)}`;

const now = new Date().toISOString();
const escape = (s) => String(s).replace(/'/g, "''");

const sql = `-- 首个 ${role} 账号：${username}
-- 生成时间：${now}
INSERT INTO users (username, password_hash, display_name, role, status, created_at)
VALUES ('${escape(username)}', '${hash}', '${escape(username)}', '${role}', 'active', '${now}')
ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, role = excluded.role;
`;

if (outArg) {
  const target = outArg.slice("--out=".length);
  writeFileSync(target, sql, "utf8");
  console.log(`已写入 ${target}（用户名 ${username}，角色 ${role}）`);
} else {
  process.stdout.write(sql);
}
