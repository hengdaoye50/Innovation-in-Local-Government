/** D1 访问层：把行记录与 JSON 字段的转换收敛在这里 */

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    const data = JSON.parse(value);
    return Array.isArray(data) ? data : fallback;
  } catch {
    return fallback;
  }
}

export function rowToCase(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    province: row.province,
    city: row.city || "",
    lng: row.lng,
    lat: row.lat,
    domains: parseJson(row.domains, []),
    summary: row.summary || "",
    body: row.body,
    sources: parseJson(row.sources_json, []),
    author: row.author_name || "同学作品",
    authorId: row.author_id,
    status: row.status,
    aiReview: row.ai_review || "",
    aiScore: row.ai_score,
    year: row.year || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToSlide(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    course: row.course || "",
    term: row.term || "",
    author: row.author_name || "匿名",
    coverUrl: row.cover_url || "",
    fileUrl: row.file_url || "",
    description: row.description || "",
    slides: row.slide_count || 0,
    aiReview: row.ai_review || "",
    aiScore: row.ai_score,
    status: row.status,
    createdAt: row.created_at,
  };
}

export function rowToPost(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    author: row.author || "",
    sourceUrl: row.source_url || "",
    tags: parseJson(row.tags, []),
    excerpt: row.excerpt || "",
    body: row.body || "",
    coverUrl: row.cover_url || "",
    publishedAt: row.published_at,
  };
}

export function rowToComment(row) {
  if (!row) return null;
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    authorId: row.author_id,
    authorName: row.author_name || "匿名",
    authorRole: row.author_role,
    body: row.body,
    createdAt: row.created_at,
  };
}

const CASE_COLUMNS = `id, title, province, city, lng, lat, domains, summary, body,
  sources_json, author_id, author_name, status, ai_review, ai_score, year,
  created_at, updated_at`;

export async function listCases(env, { status, province, domain, q, limit = 100, offset = 0 } = {}) {
  const where = [];
  const binds = [];

  if (status) {
    where.push("status = ?");
    binds.push(status);
  } else {
    where.push("status = 'published'");
  }
  if (province) {
    where.push("province = ?");
    binds.push(province);
  }
  if (domain) {
    where.push("domains LIKE ?");
    binds.push(`%${domain}%`);
  }
  if (q) {
    where.push("(title LIKE ? OR summary LIKE ? OR body LIKE ?)");
    const like = `%${q}%`;
    binds.push(like, like, like);
  }

  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 100));
  const safeOffset = Math.max(0, Number(offset) || 0);
  binds.push(safeLimit, safeOffset);

  const sql = `SELECT ${CASE_COLUMNS} FROM cases
    WHERE ${where.join(" AND ")}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?`;

  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return (results || []).map(rowToCase);
}

export async function getCase(env, id) {
  const row = await env.DB.prepare(`SELECT ${CASE_COLUMNS} FROM cases WHERE id = ?`)
    .bind(id)
    .first();
  return rowToCase(row);
}

export async function insertCase(env, data) {
  await env.DB.prepare(
    `INSERT INTO cases (id, title, province, city, lng, lat, domains, summary, body,
      sources_json, author_id, author_name, status, year, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      data.id,
      data.title,
      data.province,
      data.city || null,
      data.lng ?? null,
      data.lat ?? null,
      JSON.stringify(data.domains || []),
      data.summary || null,
      data.body,
      JSON.stringify(data.sources || []),
      data.authorId,
      data.authorName,
      data.status,
      data.year || null,
      data.now,
      data.now
    )
    .run();
}

export async function updateCaseStatus(env, id, status, aiReview, aiScore) {
  const sets = ["status = ?", "updated_at = ?"];
  const binds = [status, new Date().toISOString()];
  if (aiReview !== undefined) {
    sets.push("ai_review = ?");
    binds.push(aiReview);
  }
  if (aiScore !== undefined) {
    sets.push("ai_score = ?");
    binds.push(aiScore);
  }
  binds.push(id);
  const result = await env.DB.prepare(`UPDATE cases SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();
  return result.meta?.changes > 0;
}

export async function listSlides(env, { limit = 24, course, term } = {}) {
  const where = ["status = 'published'"];
  const binds = [];
  if (course) {
    where.push("course = ?");
    binds.push(course);
  }
  if (term) {
    where.push("term = ?");
    binds.push(term);
  }
  binds.push(Math.min(100, Math.max(1, Number(limit) || 24)));
  const { results } = await env.DB.prepare(
    `SELECT * FROM slides WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ?`
  )
    .bind(...binds)
    .all();
  return (results || []).map(rowToSlide);
}

export async function getSlide(env, id) {
  const row = await env.DB.prepare("SELECT * FROM slides WHERE id = ?").bind(id).first();
  return rowToSlide(row);
}

export async function listPosts(env, { limit = 20, tag } = {}) {
  const where = ["status = 'published'"];
  const binds = [];
  if (tag) {
    where.push("tags LIKE ?");
    binds.push(`%${tag}%`);
  }
  binds.push(Math.min(100, Math.max(1, Number(limit) || 20)));
  const { results } = await env.DB.prepare(
    `SELECT * FROM posts WHERE ${where.join(" AND ")} ORDER BY published_at DESC LIMIT ?`
  )
    .bind(...binds)
    .all();
  return (results || []).map(rowToPost);
}

export async function getPost(env, id) {
  const row = await env.DB.prepare("SELECT * FROM posts WHERE id = ?").bind(id).first();
  return rowToPost(row);
}

export async function listComments(env, { targetType, targetId, limit = 200 }) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM comments
     WHERE target_type = ? AND target_id = ? AND status = 'visible'
     ORDER BY created_at ASC
     LIMIT ?`
  )
    .bind(targetType, targetId, Math.min(500, Number(limit) || 200))
    .all();
  return (results || []).map(rowToComment);
}

export async function insertComment(env, data) {
  await env.DB.prepare(
    `INSERT INTO comments (id, target_type, target_id, author_id, author_name, author_role, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      data.id,
      data.targetType,
      data.targetId,
      data.authorId,
      data.authorName,
      data.authorRole,
      data.body,
      data.now
    )
    .run();
}

export async function countCases(env, status) {
  const row = await env.DB.prepare(
    status ? "SELECT COUNT(*) AS n FROM cases WHERE status = ?" : "SELECT COUNT(*) AS n FROM cases"
  )
    .bind(...(status ? [status] : []))
    .first();
  return Number(row?.n) || 0;
}

export async function countCasesToday(env, authorId) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM cases WHERE author_id = ? AND date(created_at) = date('now')"
  )
    .bind(authorId)
    .first();
  return Number(row?.n) || 0;
}

/** 供地图使用的轻量列表：只取落点与标签 */
export async function listCasePoints(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, title, province, city, lng, lat, domains, author_name, year
     FROM cases
     WHERE status = 'published' AND lng IS NOT NULL AND lat IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 1000`
  ).all();
  return (results || []).map((row) => ({
    id: row.id,
    title: row.title,
    province: row.province,
    city: row.city || "",
    lng: row.lng,
    lat: row.lat,
    domains: parseJson(row.domains, []),
    author: row.author_name || "同学作品",
    year: row.year || "",
  }));
}
