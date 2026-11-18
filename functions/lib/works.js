/** 材料提交的数据访问：works + work_files，与案例/调研各自独立 */

import { maskName } from "./db.js";

const KINDS = ["case-report", "slides", "reading-report", "lit-review", "other"];
export const WORK_KINDS = KINDS;

export const KIND_LABEL = {
  "case-report": "案例分析报告",
  slides: "课堂展示课件",
  "reading-report": "读书报告",
  "lit-review": "文献评析",
  other: "其他材料",
};

export const VERDICT_LABEL = {
  excellent: "优秀",
  pass: "通过",
  return: "退回",
};

export const STATUS_LABEL = {
  submitted: "待批阅",
  returned: "已退回",
  reviewed: "已批阅",
  archived: "已归档",
};

function parseLinks(value) {
  try {
    const data = JSON.parse(value || "[]");
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function rowToWork(row) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind || "other",
    kindLabel: KIND_LABEL[row.kind] || KIND_LABEL.other,
    title: row.title,
    course: row.course || "",
    term: row.term || "",
    groupName: row.group_name || "",
    members: row.members || "",
    summary: row.summary || "",
    links: parseLinks(row.links_json),
    authorId: row.author_id,
    author: maskName(row.author_name) || "同学",
    status: row.status,
    verdict: row.verdict || "",
    comment: row.comment || "",
    commentPublic: Boolean(row.comment_public),
    reviewer: row.reviewer_name ? maskName(row.reviewer_name) : "",
    reviewedAt: row.reviewed_at || "",
    featured: Boolean(row.featured),
    featuredAt: row.featured_at || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at || "",
  };
}

export function rowToWorkFile(row) {
  if (!row) return null;
  return {
    id: row.id,
    workId: row.work_id || "",
    ownerId: row.owner_id,
    name: row.file_name || "附件",
    mime: row.mime || "application/octet-stream",
    size: Number(row.size) || 0,
    storage: row.storage || "r2",
    createdAt: row.created_at,
  };
}

/** 是否存在 works 表：迁移没跑时列表与提交都要能降级，而不是整块 500 */
export async function hasWorks(env) {
  try {
    const row = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'works'"
    ).first();
    return Boolean(row);
  } catch {
    return false;
  }
}

async function attachFiles(env, works) {
  if (!works.length) return works;
  const ids = works.map((w) => w.id);
  const marks = ids.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT * FROM work_files WHERE work_id IN (${marks}) ORDER BY created_at`
  )
    .bind(...ids)
    .all();
  const grouped = new Map();
  for (const row of results || []) {
    const file = rowToWorkFile(row);
    if (!grouped.has(file.workId)) grouped.set(file.workId, []);
    grouped.get(file.workId).push(file);
  }
  return works.map((w) => ({ ...w, files: grouped.get(w.id) || [] }));
}

export async function listWorks(
  env,
  { authorId = 0, course = "", term = "", kind = "", status = "", featuredOnly = false, limit = 60 } = {}
) {
  const where = [];
  const args = [];
  if (authorId) {
    where.push("author_id = ?");
    args.push(authorId);
  }
  if (featuredOnly) where.push("featured = 1 AND status != 'archived'");
  if (course) {
    where.push("course = ?");
    args.push(course);
  }
  if (term) {
    where.push("term = ?");
    args.push(term);
  }
  if (kind) {
    where.push("kind = ?");
    args.push(kind);
  }
  if (status) {
    where.push("status = ?");
    args.push(status);
  }
  const sql = `SELECT * FROM works${where.length ? ` WHERE ${where.join(" AND ")}` : ""}
    ORDER BY ${featuredOnly ? "COALESCE(featured_at, created_at)" : "created_at"} DESC LIMIT ?`;
  const { results } = await env.DB.prepare(sql)
    .bind(...args, Math.min(200, Math.max(1, Number(limit) || 60)))
    .all();
  return attachFiles(env, (results || []).map(rowToWork));
}

export async function getWork(env, id) {
  const row = await env.DB.prepare("SELECT * FROM works WHERE id = ?").bind(id).first();
  if (!row) return null;
  const [work] = await attachFiles(env, [rowToWork(row)]);
  return work;
}

export async function insertWork(env, data) {
  await env.DB.prepare(
    `INSERT INTO works (id, kind, title, course, term, group_name, members, summary,
       links_json, author_id, author_name, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?)`
  )
    .bind(
      data.id,
      data.kind,
      data.title,
      data.course || null,
      data.term || null,
      data.groupName || null,
      data.members || null,
      data.summary || null,
      JSON.stringify(data.links || []),
      data.authorId,
      data.authorName,
      data.now
    )
    .run();
}

/** 学生改稿：退回状态下的重交会回到 submitted，等教师再看一遍 */
export async function updateWorkContent(env, id, data) {
  await env.DB.prepare(
    `UPDATE works SET kind = ?, title = ?, course = ?, term = ?, group_name = ?, members = ?,
       summary = ?, links_json = ?, status = 'submitted', updated_at = ? WHERE id = ?`
  )
    .bind(
      data.kind,
      data.title,
      data.course || null,
      data.term || null,
      data.groupName || null,
      data.members || null,
      data.summary || null,
      JSON.stringify(data.links || []),
      data.now,
      id
    )
    .run();
}

export async function reviewWork(env, id, data) {
  await env.DB.prepare(
    `UPDATE works SET status = ?, verdict = ?, comment = ?, comment_public = ?,
       reviewer_id = ?, reviewer_name = ?, reviewed_at = ?, featured = ?,
       featured_at = ? WHERE id = ?`
  )
    .bind(
      data.status,
      data.verdict || null,
      data.comment || null,
      data.commentPublic ? 1 : 0,
      data.reviewerId,
      data.reviewerName,
      data.now,
      data.featured ? 1 : 0,
      data.featured ? data.now : null,
      id
    )
    .run();
}

export async function archiveWork(env, id) {
  await env.DB.prepare(
    "UPDATE works SET status = 'archived', featured = 0, updated_at = ? WHERE id = ?"
  )
    .bind(new Date().toISOString(), id)
    .run();
}

export async function countWorksByStatus(env) {
  if (!(await hasWorks(env))) return {};
  const { results } = await env.DB.prepare(
    "SELECT status, COUNT(*) AS n FROM works GROUP BY status"
  ).all();
  return Object.fromEntries((results || []).map((r) => [r.status, Number(r.n)]));
}

/* ————————— 附件 ————————— */

export async function insertWorkFile(env, data) {
  await env.DB.prepare(
    `INSERT INTO work_files (id, work_id, owner_id, file_name, mime, size, storage, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      data.id,
      data.workId || null,
      data.ownerId,
      data.fileName,
      data.mime,
      data.size,
      data.storage,
      data.now
    )
    .run();
}

export async function getWorkFile(env, id) {
  const row = await env.DB.prepare("SELECT * FROM work_files WHERE id = ?").bind(id).first();
  return rowToWorkFile(row);
}

/** 这些附件 id 里，有哪些不属于给定的人（作者本人或正在操作的人） */
export async function filesOwnedBy(env, ids, ownerIds) {
  if (!ids.length) return [];
  const owners = ownerIds.filter((id) => Number.isFinite(Number(id)) && Number(id) > 0);
  if (!owners.length) return ids;
  try {
    const marks = ids.map(() => "?").join(",");
    const ownerMarks = owners.map(() => "?").join(",");
    const { results } = await env.DB.prepare(
      `SELECT id FROM work_files WHERE id IN (${marks}) AND owner_id IN (${ownerMarks})`
    )
      .bind(...ids, ...owners)
      .all();
    const ok = new Set((results || []).map((r) => r.id));
    return ids.filter((id) => !ok.has(id));
  } catch (err) {
    // 表还没建（迁移未跑）时不拦提交，交给上层的 hasWorks 守卫报错
    if (/no such table/i.test(String(err?.message || ""))) return [];
    throw err;
  }
}

/** 附件本体从对象存储里删掉时用得到 */
export async function dropWorkFileRows(env, ids) {
  if (!ids.length) return;
  const marks = ids.map(() => "?").join(",");
  await env.DB.prepare(`DELETE FROM work_files WHERE id IN (${marks})`)
    .bind(...ids)
    .run();
}

/**
 * 提交/改稿后对齐附件：正文里点名的附件挂到这份材料上，
 * 之前挂在这份材料、这次没交的文件删掉元信息并清对象存储。
 *
 * 归属不按上传者过滤会让「知道附件 id 就能把它挂到自己材料上」成立，
 * 而 featured 列表会把附件 id 原样下发；所以挂之前先由调用方校验归属（filesOwnedBy）。
 */
export async function syncWorkFiles(env, workId, ids, { removeOld = true } = {}) {
  if (ids.length) {
    const marks = ids.map(() => "?").join(",");
    await env.DB.prepare(
      `UPDATE work_files SET work_id = ? WHERE id IN (${marks})`
    )
      .bind(workId, ...ids)
      .run();
  }
  let stale = [];
  if (removeOld) {
    const query = ids.length
      ? env.DB.prepare(
          `SELECT * FROM work_files WHERE work_id = ? AND id NOT IN (${ids.map(() => "?").join(",")})`
        ).bind(workId, ...ids)
      : env.DB.prepare("SELECT * FROM work_files WHERE work_id = ?").bind(workId);
    const { results } = await query.all();
    stale = (results || []).map(rowToWorkFile);
    if (stale.length) {
      const marks = stale.map(() => "?").join(",");
      await env.DB.prepare(`DELETE FROM work_files WHERE id IN (${marks})`)
        .bind(...stale.map((f) => f.id))
        .run();
    }
  }
  return stale;
}

/** 传了附件却没提交的会一直漂着；过一天之后清掉 */
export async function pruneOrphanWorkFiles(env, ownerId, { limit = 20 } = {}) {
  const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { results } = await env.DB.prepare(
    "SELECT * FROM work_files WHERE owner_id = ? AND work_id IS NULL AND created_at < ? LIMIT ?"
  )
    .bind(ownerId, cutoff, limit)
    .all();
  const stale = (results || []).map(rowToWorkFile);
  if (!stale.length) return stale;
  const marks = stale.map(() => "?").join(",");
  await env.DB.prepare(`DELETE FROM work_files WHERE id IN (${marks})`)
    .bind(...stale.map((f) => f.id))
    .run();
  return stale;
}

export async function filesOfWork(env, workId) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM work_files WHERE work_id = ? ORDER BY created_at"
  )
    .bind(workId)
    .all();
  return (results || []).map(rowToWorkFile);
}
