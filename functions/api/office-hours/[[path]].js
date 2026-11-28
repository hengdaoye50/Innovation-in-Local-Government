/**
 * /api/office-hours
 *   GET  ?mine=1（学生看自己的）  ?queue=1（教师看全部，可按 status 筛）
 *        教师视角额外返回 booked（已确认占用的时段）与 days / slots 两套档位
 *   POST { topic, note, preferDate, preferSlot }   提交预约申请（学生不填具体时间）
 * /api/office-hours/:id
 *   GET    详情（本人与教师）
 *   PATCH  教师批复 { status: confirmed|declined|done, date, slot, location, reply }
 *          学生撤回 { status: cancelled }
 *
 * 防撞：confirmed 写 slot_key，库上有 partial unique index；写之前先查一次是为了
 * 能回一句「这个时段已经约给谁了」，而不是让约束错误冒成 500。
 */
import {
  ok,
  fail,
  methodNotAllowed,
  readJson,
  handleError,
  randomId,
  rateLimit,
} from "../../lib/http.js";
import { getSession, isStaff, isReadOnly, checkBindings } from "../../lib/auth.js";
import {
  hasConnect,
  SLOT_KEYS,
  upcomingDays,
  validatePreferredDate,
  isSlot,
  slotKey,
  listOfficeHours,
  getOfficeHour,
  insertOfficeHour,
  findBookedSlot,
  listBookedSlots,
  decideOfficeHour,
  cancelOfficeHour,
} from "../../lib/connect.js";

const MAX_TOPIC = 80;
const MAX_NOTE = 600;

export async function onRequest(context) {
  const { request, env, params } = context;
  const segments = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const id = segments[0] || "";

  try {
    const missing = checkBindings(env);
    if (missing) return fail(missing, 503);
    if (!(await hasConnect(env))) {
      return fail("师生互联暂不可用：数据库迁移未完成，请先执行 0014 迁移", 503);
    }

    const method = request.method;

    if (!id && method === "GET") return await listHandler(request, env);
    if (!id && method === "POST") return await createHandler(request, env);
    if (id && method === "GET") return await detailHandler(request, env, id);
    if (id && method === "PATCH") return await decideHandler(request, env, id);

    return methodNotAllowed(["GET", "POST", "PATCH"]);
  } catch (err) {
    return handleError(err);
  }
}

async function listHandler(request, env) {
  const url = new URL(request.url);
  const session = await getSession(env, request);
  if (!session) return fail("请先登录", 401);

  if (url.searchParams.get("queue")) {
    if (!isStaff(session)) return fail("只有教师可以看预约队列", 403);
    const status = url.searchParams.get("status") || "";
    const items = await listOfficeHours(env, { status, limit: url.searchParams.get("limit") || 200 });
    return ok({
      items,
      booked: await listBookedSlots(env),
      days: upcomingDays(),
      slots: SLOT_KEYS,
    });
  }

  const items = await listOfficeHours(env, { studentId: session.id, limit: url.searchParams.get("limit") || 50 });
  return ok({ items, days: upcomingDays(), slots: SLOT_KEYS });
}

async function createHandler(request, env) {
  const session = await getSession(env, request);
  if (!session) return fail("请先登录再预约", 401);
  if (isReadOnly(session)) return fail("观察员账号只能浏览", 403);

  const limit = rateLimit(`office-hour:${session.id}`, { limit: 8, windowMs: 10 * 60_000 });
  if (!limit.allowed) return fail("预约提交过于频繁，请稍后再试", 429);

  const body = await readJson(request, 8_000);
  const topic = String(body.topic || "").trim().slice(0, MAX_TOPIC);
  const note = String(body.note || "").trim().slice(0, MAX_NOTE);
  const preferDate = String(body.preferDate || "").trim().slice(0, 10);
  const preferSlot = String(body.preferSlot || "").trim().slice(0, 5);

  if (!topic) return fail("写一句想聊什么，老师好提前准备");
  const day = validatePreferredDate(preferDate);
  if (!day.ok) return fail(day.message);
  if (!isSlot(preferSlot)) return fail("请选择一个期望时段");

  // 同一个人不必堆一串还没批的申请：先撤掉旧的，再收新的
  const pendingItems = await listOfficeHours(env, { studentId: session.id, limit: 200 });
  const open = pendingItems.filter((item) => item.status === "pending");
  if (open.length >= 2) {
    return fail("你还有两条待批复的申请，等老师批复后再提交新的", 409);
  }
  const duplicate = open.find(
    (item) => item.preferDate === preferDate && item.preferSlot === preferSlot
  );
  if (duplicate) return fail("同样的日期和时段已经提交过了，等老师批复即可", 409);

  const id = randomId("oh");
  const now = new Date().toISOString();
  await insertOfficeHour(env, {
    id,
    studentId: session.id,
    studentName: session.displayName || session.username,
    topic,
    note,
    preferDate,
    preferSlot,
    now,
  });

  return ok({ id, status: "pending" });
}

async function detailHandler(request, env, id) {
  const session = await getSession(env, request);
  if (!session) return fail("请先登录", 401);

  const item = await getOfficeHour(env, id);
  if (!item) return fail("这条预约不存在", 404);
  if (!isStaff(session) && item.studentId !== session.id) return fail("这条预约不存在", 404);
  return ok(item);
}

async function decideHandler(request, env, id) {
  const session = await getSession(env, request);
  if (!session) return fail("请先登录", 401);

  const item = await getOfficeHour(env, id);
  if (!item) return fail("这条预约不存在", 404);

  const staff = isStaff(session);
  const own = item.studentId === session.id;
  if (!staff && !own) return fail("这条预约不存在", 404);

  const body = await readJson(request, 8_000);
  const status = String(body.status || "");
  const reply = String(body.reply || "").trim().slice(0, MAX_NOTE);
  const now = new Date().toISOString();

  /* —— 学生撤回：只能撤自己的，且只在还没结束时 —— */
  if (status === "cancelled") {
    if (staff) {
      // 教师不替学生撤回；教师走婉拒（declined）才留得下说明
      return fail("教师请用「婉拒」而不是撤回", 400);
    }
    if (!["pending", "confirmed"].includes(item.status)) {
      return fail("这条预约已经结束，撤不回了", 409);
    }
    await cancelOfficeHour(env, id, now);
    return ok({ id, status: "cancelled" });
  }

  if (!staff) return fail("只有教师可以批复预约", 403);
  if (isReadOnly(session)) return fail("观察员账号只能浏览", 403);

  /* —— 教师婉拒 —— */
  if (status === "declined") {
    if (["cancelled", "declined", "done"].includes(item.status)) {
      return fail("这条预约已经结束", 409);
    }
    await decideOfficeHour(env, id, {
      status: "declined",
      reply,
      byId: session.id,
      byName: session.displayName || session.username,
      now,
    });
    return ok({ id, status: "declined" });
  }

  /* —— 教师标记完成 —— */
  if (status === "done") {
    if (item.status !== "confirmed") return fail("只有已确认的预约才能标记完成", 409);
    await decideOfficeHour(env, id, {
      status: "done",
      date: item.scheduledDate,
      slot: item.scheduledSlot,
      location: item.location,
      reply: reply || item.reply,
      byId: session.id,
      byName: session.displayName || session.username,
      now,
    });
    return ok({ id, status: "done" });
  }

  /* —— 教师确认并给出具体时间 —— */
  if (status !== "confirmed") return fail("状态值无效");
  const date = String(body.date || "").trim().slice(0, 10);
  const slot = String(body.slot || "").trim().slice(0, 5);
  const location = String(body.location || "").trim().slice(0, 60);

  const day = validatePreferredDate(date);
  if (!day.ok) return fail(day.message);
  if (!isSlot(slot)) return fail("请选择一个时段");

  if (item.status === "cancelled" || item.status === "declined" || item.status === "done") {
    return fail("这条预约已经结束，不能再确认", 409);
  }

  const key = slotKey(date, slot);
  const taken = await findBookedSlot(env, key, id);
  if (taken) {
    return fail(`这个时段已经约给 ${taken.studentName} 了，请换一个`, 409, "slot_taken");
  }

  try {
    await decideOfficeHour(env, id, {
      status: "confirmed",
      date,
      slot,
      location,
      reply,
      byId: session.id,
      byName: session.displayName || session.username,
      now,
    });
  } catch (err) {
    // 并发确认撞上 unique index：翻译成人话，别让约束错误冒成 500
    if (/UNIQUE|constraint/i.test(String(err?.message || ""))) {
      return fail("这个时段刚刚已经被人约走了，请刷新后换一个", 409, "slot_taken");
    }
    throw err;
  }

  return ok({ id, status: "confirmed", date, slot, location, slotKey: key });
}
