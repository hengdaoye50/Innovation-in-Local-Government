/**
 * 师生互联：一对一提问（thread + messages）与 office hour 预约。
 *
 * 与前几块的区别：这里没有任何公开内容——提问只有学生本人与教师看得到，
 * 预约也只有双方看得到。所以这一块的列表接口一律按「本人 / 教师」两种视角取数，
 * 没有「所有人可见」的分支。
 *
 * 时长与时段是固定档位，学生选期望档、老师批复时选同一套，
 * 两边才对得上、防撞也才有意义（见 SLOT_KEYS）。
 */

/** office hour 只在周三、周四排。0=周日，3=周三，4=周四 */
const OFFICE_DAYS = [3, 4];
const DAY_LABEL = { 3: "周三", 4: "周四" };

/** 固定时段档位，每档一小时。前后端必须用同一份，改这里就是改全站口径 */
export const SLOT_KEYS = ["09:00", "10:00", "11:00", "14:00", "15:00", "16:00", "17:00"];

/** 只接受未来 8 周内的日子，太远的约了也没意义 */
const MAX_DAYS_AHEAD = 56;

export const THREAD_STATUS = { open: "待回复", replied: "已回复" };
export const REQUEST_STATUS = {
  pending: "待批复",
  confirmed: "已确认",
  declined: "已婉拒",
  cancelled: "已撤回",
  done: "已完成",
};

export function slotLabel(slot) {
  const num = String(slot || "").slice(0, 2);
  return Number.isFinite(Number(num)) ? `${num}:00–${String(Number(num) + 1).padStart(2, "0")}:00` : slot;
}

/** 三个新表是否到位；迁移没跑时给一句可执行的说明，而不是让每条路由撞 500 */
const tableKnown = { value: null };
export async function hasConnect(env) {
  if (tableKnown.value !== null) return tableKnown.value;
  try {
    await env.DB.prepare("SELECT 1 FROM qa_threads LIMIT 1").first();
    await env.DB.prepare("SELECT 1 FROM office_hours LIMIT 1").first();
    tableKnown.value = true;
  } catch {
    tableKnown.value = false;
  }
  return tableKnown.value;
}

/** 东八区的「今天」。Workers 跑在 UTC，直接用 UTC 日期会在凌晨 0–8 点差一天 */
function todayInShanghai() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function parseDateParts(value) {
  const text = String(value || "").trim();
  const hit = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!hit) return null;
  const [y, m, d] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  const stamp = Date.UTC(y, m - 1, d);
  const date = new Date(stamp);
  // 2026-02-31 这类会自己进位，必须回读校验
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d, stamp, weekday: date.getUTCDay() };
}

export function dayLabel(dateStr) {
  const parts = parseDateParts(dateStr);
  return parts ? DAY_LABEL[parts.weekday] || "" : "";
}

/**
 * 校验学生填的期望日期：必须是周三或周四、不早于今天、不超过 8 周。
 * @returns {{ ok: boolean, message?: string }}
 */
export function validatePreferredDate(value) {
  const parts = parseDateParts(value);
  if (!parts) return { ok: false, message: "日期格式不对" };
  if (!OFFICE_DAYS.includes(parts.weekday)) {
    return { ok: false, message: "office hour 只排在周三与周四，请换个日子" };
  }
  const today = parseDateParts(todayInShanghai());
  if (parts.stamp < today.stamp) return { ok: false, message: "这个日子已经过去了" };
  if (parts.stamp - today.stamp > MAX_DAYS_AHEAD * 86400_000) {
    return { ok: false, message: "只能约未来 8 周以内的日子" };
  }
  return { ok: true };
}

export function isSlot(value) {
  return SLOT_KEYS.includes(String(value || ""));
}

/** 防撞用的键：同一日期 + 同一档位算同一时段 */
export function slotKey(date, slot) {
  return `${date} ${slot}`;
}

/** 未来 8 周内所有可约的周三 / 周四，供前端直接渲染成下拉 */
export function upcomingDays(weeks = 8) {
  const days = [];
  const start = parseDateParts(todayInShanghai());
  for (let i = 0; i <= weeks * 7; i += 1) {
    const stamp = start.stamp + i * 86400_000;
    const date = new Date(stamp);
    if (!OFFICE_DAYS.includes(date.getUTCDay())) continue;
    days.push({
      value: date.toISOString().slice(0, 10),
      label: `${date.getUTCMonth() + 1} 月 ${date.getUTCDate()} 日（${DAY_LABEL[date.getUTCDay()]}）`,
      weekday: DAY_LABEL[date.getUTCDay()],
    });
  }
  return days;
}

/* —————————————— 提问 —————————————— */

function shapeThread(row) {
  if (!row) return null;
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_name || "同学",
    subject: row.subject,
    status: row.status,
    awaiting: row.awaiting,
    messageCount: Number(row.message_count) || 0,
    lastBody: row.last_body || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function shapeMessage(row) {
  return {
    id: row.id,
    threadId: row.thread_id,
    authorId: row.author_id,
    authorName: row.author_name || "同学",
    authorRole: row.author_role,
    body: row.body,
    createdAt: row.created_at,
  };
}

export async function listThreads(env, { studentId = null, awaiting = "", limit = 50 } = {}) {
  const where = [];
  const binds = [];
  if (studentId) {
    where.push("student_id = ?");
    binds.push(studentId);
  }
  if (awaiting) {
    where.push("awaiting = ?");
    binds.push(awaiting);
  }
  const sql = `SELECT * FROM qa_threads
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY updated_at DESC LIMIT ?`;
  const { results } = await env.DB.prepare(sql)
    .bind(...binds, Math.min(200, Number(limit) || 50))
    .all();
  return (results || []).map(shapeThread);
}

export async function getThread(env, id) {
  const row = await env.DB.prepare("SELECT * FROM qa_threads WHERE id = ?").bind(id).first();
  return shapeThread(row);
}

export async function listMessages(env, threadId) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM qa_messages WHERE thread_id = ? ORDER BY created_at, id"
  )
    .bind(threadId)
    .all();
  return (results || []).map(shapeMessage);
}

export async function insertThread(env, thread, firstMessage) {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO qa_threads
         (id, student_id, student_name, subject, status, awaiting, message_count, last_body, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'open', 'staff', 1, ?, ?, ?)`
    ).bind(
      thread.id,
      thread.studentId,
      thread.studentName,
      thread.subject,
      firstMessage.body.slice(0, 200),
      thread.now,
      thread.now
    ),
    env.DB.prepare(
      `INSERT INTO qa_messages (id, thread_id, author_id, author_name, author_role, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      firstMessage.id,
      thread.id,
      firstMessage.authorId,
      firstMessage.authorName,
      firstMessage.authorRole,
      firstMessage.body,
      thread.now
    ),
  ]);
}

/**
 * 追加一条消息并把「轮到谁」翻面：
 * 学生发完等老师（awaiting=staff，状态回到待回复）；老师发完等学生（awaiting=student，已回复）。
 */
export async function appendMessage(env, threadId, message, { byStaff }) {
  const nextAwaiting = byStaff ? "student" : "staff";
  const nextStatus = byStaff ? "replied" : "open";
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO qa_messages (id, thread_id, author_id, author_name, author_role, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      message.id,
      threadId,
      message.authorId,
      message.authorName,
      message.authorRole,
      message.body,
      message.now
    ),
    env.DB.prepare(
      `UPDATE qa_threads
          SET status = ?, awaiting = ?, message_count = message_count + 1,
              last_body = ?, updated_at = ?
        WHERE id = ?`
    ).bind(nextStatus, nextAwaiting, message.body.slice(0, 200), message.now, threadId),
  ]);
}

export async function countThreads(env, { awaiting = "" } = {}) {
  const row = awaiting
    ? await env.DB.prepare("SELECT COUNT(*) AS n FROM qa_threads WHERE awaiting = ?").bind(awaiting).first()
    : await env.DB.prepare("SELECT COUNT(*) AS n FROM qa_threads").first();
  return Number(row?.n) || 0;
}

/* —————————————— office hour 预约 —————————————— */

function shapeOfficeHour(row) {
  if (!row) return null;
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_name || "同学",
    topic: row.topic,
    note: row.note || "",
    preferDate: row.prefer_date,
    preferSlot: row.prefer_slot,
    preferDay: dayLabel(row.prefer_date),
    status: row.status,
    slotKey: row.slot_key || "",
    scheduledDate: row.scheduled_date || "",
    scheduledSlot: row.scheduled_slot || "",
    scheduledDay: row.scheduled_date ? dayLabel(row.scheduled_date) : "",
    location: row.location || "",
    reply: row.reply || "",
    decidedBy: row.decided_by || null,
    decidedByName: row.decided_by_name || "",
    decidedAt: row.decided_at || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listOfficeHours(env, { studentId = null, status = "", limit = 100 } = {}) {
  const where = [];
  const binds = [];
  if (studentId) {
    where.push("student_id = ?");
    binds.push(studentId);
  }
  if (status) {
    where.push("status = ?");
    binds.push(status);
  }
  const { results } = await env.DB.prepare(
    `SELECT * FROM office_hours
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY created_at DESC LIMIT ?`
  )
    .bind(...binds, Math.min(300, Number(limit) || 100))
    .all();
  return (results || []).map(shapeOfficeHour);
}

export async function getOfficeHour(env, id) {
  const row = await env.DB.prepare("SELECT * FROM office_hours WHERE id = ?").bind(id).first();
  return shapeOfficeHour(row);
}

export async function insertOfficeHour(env, data) {
  await env.DB.prepare(
    `INSERT INTO office_hours
       (id, student_id, student_name, topic, note, prefer_date, prefer_slot, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  )
    .bind(
      data.id,
      data.studentId,
      data.studentName,
      data.topic,
      data.note || null,
      data.preferDate,
      data.preferSlot,
      data.now,
      data.now
    )
    .run();
}

/** 已确认占用的时段：写 slot_key 时由 unique index 兜底，但先查一次才能给出「被谁占了」 */
export async function findBookedSlot(env, key, excludeId = "") {
  const row = await env.DB.prepare(
    "SELECT id, student_name, scheduled_date, scheduled_slot FROM office_hours WHERE slot_key = ? AND id <> ?"
  )
    .bind(key, excludeId || "")
    .first();
  return row
    ? {
        id: row.id,
        studentName: row.student_name || "同学",
        date: row.scheduled_date,
        slot: row.scheduled_slot,
      }
    : null;
}

/** 老师后台要看的那张「已经排了谁的时段」表 */
export async function listBookedSlots(env, { limit = 100 } = {}) {
  const { results } = await env.DB.prepare(
    `SELECT id, student_name, scheduled_date, scheduled_slot, topic
       FROM office_hours
      WHERE status IN ('confirmed', 'done') AND slot_key IS NOT NULL
      ORDER BY scheduled_date, scheduled_slot LIMIT ?`
  )
    .bind(Math.min(300, Number(limit) || 100))
    .all();
  return (results || []).map((row) => ({
    id: row.id,
    studentName: row.student_name || "同学",
    topic: row.topic,
    date: row.scheduled_date,
    slot: row.scheduled_slot,
    key: `${row.scheduled_date} ${row.scheduled_slot}`,
  }));
}

/**
 * 老师的批复：确认（给具体时间与地点）、婉拒、或标记完成。
 * 确认时写 slot_key；其它状态一律把它清空，否则作废的预约会永久占住一个时段。
 */
export async function decideOfficeHour(env, id, { status, date, slot, location, reply, byId, byName, now }) {
  const key = status === "confirmed" ? slotKey(date, slot) : null;
  await env.DB.prepare(
    `UPDATE office_hours
        SET status = ?,
            slot_key = ?,
            scheduled_date = CASE WHEN ? = 'confirmed' THEN ? ELSE NULL END,
            scheduled_slot = CASE WHEN ? = 'confirmed' THEN ? ELSE NULL END,
            location = CASE WHEN ? = 'confirmed' THEN ? ELSE NULL END,
            reply = ?,
            decided_by = ?,
            decided_by_name = ?,
            decided_at = ?,
            updated_at = ?
      WHERE id = ?`
  )
    .bind(
      status,
      key,
      status,
      date,
      status,
      slot,
      status,
      location || null,
      reply || null,
      byId,
      byName,
      now,
      now,
      id
    )
    .run();
}

/** 学生撤回：只动状态，并把占位键清掉 */
export async function cancelOfficeHour(env, id, now) {
  await env.DB.prepare(
    `UPDATE office_hours
        SET status = 'cancelled', slot_key = NULL, updated_at = ?
      WHERE id = ?`
  )
    .bind(now, id)
    .run();
}

export async function countOfficeHours(env, { status = "" } = {}) {
  const row = status
    ? await env.DB.prepare("SELECT COUNT(*) AS n FROM office_hours WHERE status = ?").bind(status).first()
    : await env.DB.prepare("SELECT COUNT(*) AS n FROM office_hours").first();
  return Number(row?.n) || 0;
}
