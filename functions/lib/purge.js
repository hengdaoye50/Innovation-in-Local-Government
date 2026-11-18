/**
 * 邀请码与空账号的清理。
 *
 * 邀请码作废后已经是硬删除，「作废」按钮不再留 revoked_at 痕迹；
 * 这里兜住早期版本留下的软删除记录，免得列表里一直挂着一排「已作废」。
 *
 * 账号只清「停用 + 名下零内容」的那些：删账号是不可逆的，
 * 名下有案例、展位、留言、调研或批注的账号一律保留，宁可占一行也不误删同学的作品。
 */

/** 表不存在时（迁移没跑到的库）当作没有依赖，不让清理整体失败 */
async function tableExists(env, name) {
  const row = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
  )
    .bind(name)
    .first();
  return Boolean(row);
}

/** 账号「名下零内容」的判据，按库里实际存在的表拼出来 */
async function emptyAccountClause(env) {
  const owners = [
    ["cases", "author_id"],
    ["slides", "author_id"],
    ["comments", "author_id"],
    ["surveys", "author_id"],
    ["annotations", "author_id"],
    // 交过材料的学生不能删：材料与批阅结论还挂在他名下，删了人这些记录就再也对不上
    ["works", "author_id"],
  ];
  const clauses = [];
  for (const [table, column] of owners) {
    if (await tableExists(env, table)) {
      clauses.push(`NOT EXISTS (SELECT 1 FROM ${table} t WHERE t.${column} = u.id)`);
    }
  }
  if (await tableExists(env, "invites")) {
    // 签发过邀请码的账号（一般是教师）不能删：invites.created_by 有外键，
    // 而且那些码的来历还要能对上人
    clauses.push("NOT EXISTS (SELECT 1 FROM invites iv WHERE iv.created_by = u.id)");
  }
  return clauses.length ? clauses.join(" AND ") : "1 = 1";
}

/** 历史作废的邀请码：直接删掉，返回删除条数 */
export async function purgeRevokedInvites(env) {
  const result = await env.DB.prepare(
    "DELETE FROM invites WHERE revoked_at IS NOT NULL AND used_by IS NULL"
  ).run();
  return Number(result.meta?.changes) || 0;
}

/**
 * 停用的空账号。keepId 传当前管理员自己，自保用。
 * 返回 { users, skipped }——skipped 是「停用但名下有内容」的账号数，
 * 后台会把数字报出来，免得管理员以为已经清干净了。
 */
export async function purgeEmptyDisabledUsers(env, { keepId = 0 } = {}) {
  const emptyClause = await emptyAccountClause(env);

  const { results } = await env.DB.prepare(
    `SELECT u.id, u.username FROM users u
     WHERE u.status = 'disabled' AND u.role <> 'admin' AND u.id <> ?
       AND ${emptyClause}
     LIMIT 200`
  )
    .bind(Number(keepId) || 0)
    .all();
  const rows = results || [];

  let removed = 0;
  for (const row of rows) {
    try {
      // invites.used_by 有外键：先删掉这个账号用过的码（本来也是一次性的），再删账号
      await env.DB.batch([
        env.DB.prepare("DELETE FROM invites WHERE used_by = ?").bind(row.id),
        env.DB.prepare("DELETE FROM users WHERE id = ?").bind(row.id),
      ]);
      removed += 1;
    } catch {
      /* 还有没照顾到的外键就跳过，留给人工处理 */
    }
  }

  const kept = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM users u
     WHERE u.status = 'disabled' AND u.role <> 'admin' AND u.id <> ?
       AND NOT (${emptyClause})`
  )
    .bind(Number(keepId) || 0)
    .first();

  return { users: removed, skipped: Number(kept?.n) || 0 };
}
