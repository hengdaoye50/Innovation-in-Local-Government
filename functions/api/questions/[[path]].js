/**
 * /api/questions
 *   GET  ?mine=1（学生看自己的）  ?queue=1（教师看全部，可按 awaiting 筛）
 *   POST { subject, body }        新建一条提问（第一条消息就是正文）
 * /api/questions/:id
 *   GET  详情：thread + messages（只有本人与教师能看）
 *   POST /:id/messages { body }    在同一串里继续（学生追问 / 老师回复）
 *
 * 一对一私信：没有公开分支，任何列表接口都必须带「本人」或「教师」的身份。
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
  listThreads,
  getThread,
  listMessages,
  insertThread,
  appendMessage,
} from "../../lib/connect.js";

const MAX_SUBJECT = 80;
const MAX_BODY = 2000;

export async function onRequest(context) {
  const { request, env, params } = context;
  const segments = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const id = segments[0] || "";
  const action = segments[1] || "";

  try {
    const missing = checkBindings(env);
    if (missing) return fail(missing, 503);
    if (!(await hasConnect(env))) {
      return fail("师生互联暂不可用：数据库迁移未完成，请先执行 0014 迁移", 503);
    }

    const method = request.method;

    if (!id && method === "GET") return await listHandler(request, env);
    if (!id && method === "POST") return await createHandler(request, env);
    if (id && !action && method === "GET") return await detailHandler(request, env, id);
    if (id && action === "messages" && method === "POST") return await replyHandler(request, env, id);

    return methodNotAllowed(["GET", "POST"]);
  } catch (err) {
    return handleError(err);
  }
}

async function listHandler(request, env) {
  const url = new URL(request.url);
  const session = await getSession(env, request);
  if (!session) return fail("请先登录", 401);

  if (url.searchParams.get("queue")) {
    if (!isStaff(session)) return fail("只有教师可以看提问队列", 403);
    const awaiting = url.searchParams.get("awaiting") || "";
    const items = await listThreads(env, { awaiting, limit: url.searchParams.get("limit") || 100 });
    return ok({ items });
  }

  const items = await listThreads(env, {
    studentId: session.id,
    limit: url.searchParams.get("limit") || 50,
  });
  return ok({ items });
}

async function createHandler(request, env) {
  const session = await getSession(env, request);
  if (!session) return fail("请先登录再提问", 401);
  if (isReadOnly(session)) return fail("观察员账号只能浏览", 403);

  const limit = rateLimit(`question:${session.id}`, { limit: 10, windowMs: 10 * 60_000 });
  if (!limit.allowed) return fail("提问过于频繁，请稍后再试", 429);

  const body = await readJson(request, 8_000);
  const subject = String(body.subject || "").trim().slice(0, MAX_SUBJECT);
  const text = String(body.body || "").trim().slice(0, MAX_BODY);
  if (!subject) return fail("给这个问题起个标题，老师好知道在问什么");
  if (text.length < 5) return fail("问题太短了，至少写一句话");

  const threadId = randomId("qa");
  const now = new Date().toISOString();
  await insertThread(
    env,
    {
      id: threadId,
      studentId: session.id,
      studentName: session.displayName || session.username,
      subject,
      now,
    },
    {
      id: randomId("qam"),
      authorId: session.id,
      authorName: session.displayName || session.username,
      authorRole: session.role,
      body: text,
    }
  );

  return ok({ id: threadId, status: "open" });
}

async function detailHandler(request, env, id) {
  const session = await getSession(env, request);
  if (!session) return fail("请先登录", 401);

  const thread = await getThread(env, id);
  if (!thread) return fail("这个问题不存在", 404);
  const allowed = isStaff(session) || thread.studentId === session.id;
  // 与全站口径一致：看不见的对象一律当不存在，不用 403 暴露「有这么一条」
  if (!allowed) return fail("这个问题不存在", 404);

  const messages = await listMessages(env, id);
  return ok({ thread, messages });
}

async function replyHandler(request, env, id) {
  const session = await getSession(env, request);
  if (!session) return fail("请先登录", 401);
  if (isReadOnly(session)) return fail("观察员账号只能浏览", 403);

  const thread = await getThread(env, id);
  if (!thread) return fail("这个问题不存在", 404);
  const staff = isStaff(session);
  if (!staff && thread.studentId !== session.id) return fail("这个问题不存在", 404);

  const limit = rateLimit(`qa-reply:${session.id}`, { limit: 30, windowMs: 10 * 60_000 });
  if (!limit.allowed) return fail("回复过于频繁，请稍后再试", 429);

  const body = await readJson(request, 8_000);
  const text = String(body.body || "").trim().slice(0, MAX_BODY);
  if (!text) return fail("回复不能为空");

  await appendMessage(
    env,
    id,
    {
      id: randomId("qam"),
      authorId: session.id,
      authorName: session.displayName || session.username,
      authorRole: session.role,
      body: text,
      now: new Date().toISOString(),
    },
    { byStaff: staff }
  );

  return ok({ id, byStaff: staff });
}
