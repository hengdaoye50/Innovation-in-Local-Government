/**
 * /api/works            GET 列表（?mine=1 / ?queue=1 / ?featured=1）  POST 提交
 * /api/works/:id        GET 详情  PUT 作者改稿  PATCH 教师批阅  DELETE 撤回 / 归档
 * /api/works/files      POST 上传附件
 * /api/works/files/:id  GET 取附件
 *
 * 这一块只做通道：不转格式、不生成缩略图、不跑模型。文件原样存、原样取，
 * PDF 与图片给浏览器内嵌预览，其余一律当附件下载。
 */
import { ok, fail, methodNotAllowed, readJson, handleError, randomId, clientIp, rateLimit } from "../../lib/http.js";
import { getSession, isStaff, isReadOnly, checkBindings } from "../../lib/auth.js";
import {
  listWorks,
  getWork,
  insertWork,
  updateWorkContent,
  reviewWork,
  archiveWork,
  hasWorks,
  insertWorkFile,
  getWorkFile,
  syncWorkFiles,
  filesOwnedBy,
  pruneOrphanWorkFiles,
  WORK_KINDS,
} from "../../lib/works.js";
import {
  MAX_FILE_BYTES,
  sniffFileType,
  verifyFileBytes,
  putBlob,
  getBlob,
  deleteBlob,
  dispositionFor,
  storageKind,
  storageReady,
} from "../../lib/blobstore.js";

const MAX_TITLE = 80;
const MAX_SUMMARY = 2000;
const MAX_FILES = 3;
const MAX_LINKS = 5;

function readPayload(body) {
  const kind = WORK_KINDS.includes(String(body.kind || "")) ? String(body.kind) : "other";
  const links = Array.isArray(body.links)
    ? body.links
        .map((l) => ({
          title: String(l?.title || "").trim().slice(0, 80),
          url: String(l?.url || "").trim().slice(0, 500),
        }))
        .filter((l) => /^https?:\/\//i.test(l.url))
        .slice(0, MAX_LINKS)
    : [];
  const files = Array.isArray(body.files)
    ? body.files.map((f) => String(f || "").trim()).filter(Boolean).slice(0, MAX_FILES)
    : [];
  return {
    kind,
    title: String(body.title || "").trim().slice(0, MAX_TITLE),
    course: String(body.course || "").trim().slice(0, 40),
    term: String(body.term || "").trim().slice(0, 20),
    groupName: String(body.groupName || "").trim().slice(0, 40),
    members: String(body.members || "").trim().slice(0, 300),
    summary: String(body.summary || "").trim().slice(0, MAX_SUMMARY),
    links,
    files,
  };
}

/** 只有被择优展出、且已批阅的作品对非作者可见；评语按 comment_public 决定给不给看 */
function canView(work, session) {
  if (!work) return false;
  if (session && (isStaff(session) || work.authorId === session.id)) return true;
  return work.featured && work.status !== "archived" && work.status !== "submitted";
}

function shapeForViewer(work, session) {
  const own = Boolean(session && (work.authorId === session.id || isStaff(session)));
  return {
    ...work,
    comment: own || work.commentPublic ? work.comment : "",
    reviewer: own || work.commentPublic ? work.reviewer : "",
    commentVisible: own || work.commentPublic,
    canEdit: Boolean(session && work.authorId === session.id && work.status !== "reviewed"),
  };
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const segments = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const first = segments[0] || "";
  const second = segments[1] || "";

  try {
    const missing = checkBindings(env);
    if (missing) return fail(missing, 503);

    // 迁移没跑时给出可执行的说明，而不是让每条路由各撞一个「no such table」500。
    // 取附件（GET /works/files/:id）不依赖 works 表，放行。
    const readExistingFile = first === "files" && Boolean(second) && request.method === "GET";
    if (!readExistingFile && !(await hasWorks(env))) {
      return fail("材料提交暂不可用：数据库迁移未完成，请先执行 0012 迁移", 503);
    }

    /* —— 附件上传 —— */
    if (first === "files" && !second && request.method === "POST") {
      const session = await getSession(env, request);
      if (!session) return fail("请先登录", 401);
      if (isReadOnly(session)) return fail("观察员账号只能浏览", 403);

      const limit = rateLimit(`work-file:${clientIp(request)}`, {
        limit: 30,
        windowMs: 10 * 60_000,
      });
      if (!limit.allowed) return fail("传得太频繁了，过一会儿再试", 429);

      const url = new URL(request.url);
      const fileName = String(url.searchParams.get("name") || "附件").slice(0, 120);
      const rule = sniffFileType(fileName);
      if (!rule) {
        return fail("只收 Word（.docx / .doc）与 PDF（.pdf），课件请另存为 PDF 再上传", 415);
      }

      const length = Number(request.headers.get("content-length") || 0);
      if (length > MAX_FILE_BYTES) return fail("单个文件不超过 20MB", 413);

      const buffer = await request.arrayBuffer();
      if (!buffer.byteLength) return fail("文件是空的");
      if (buffer.byteLength > MAX_FILE_BYTES) return fail("单个文件不超过 20MB", 413);

      // 扩展名之外再验一次文件头：改个后缀就想混进来的文件过不去
      const verdict = verifyFileBytes(fileName, new Uint8Array(buffer));
      if (!verdict.ok) return fail(verdict.reason, 415);

      const fileId = randomId("wf");
      const storage = await putBlob(env, fileId, buffer, verdict.mime);
      try {
        await insertWorkFile(env, {
          id: fileId,
          ownerId: session.id,
          fileName,
          mime: verdict.mime,
          size: buffer.byteLength,
          storage,
          now: new Date().toISOString(),
        });
      } catch (err) {
        // 元信息写不进去就把已经落盘的对象删掉，否则存储里会留下永远查不到的字节
        await deleteBlob(env, fileId, storage);
        throw err;
      }

      return ok({ id: fileId, name: fileName, size: buffer.byteLength, storage });
    }

    /* —— 附件读取 —— */
    if (first === "files" && second && request.method === "GET") {
      const file = await getWorkFile(env, second);
      if (!file) return fail("附件不存在", 404);

      const session = await getSession(env, request);
      if (file.workId) {
        const work = await getWork(env, file.workId);
        if (!canView(work, session)) return fail("附件不存在", 404);
      } else if (!session || (file.ownerId !== session.id && !isStaff(session))) {
        // 还没挂到任何材料上的附件，只有上传者本人与教师能取
        return fail("附件不存在", 404);
      }

      const blob = await getBlob(env, file.id, file.storage);
      if (!blob) return fail("附件已失效", 404);

      return new Response(blob.bytes, {
        headers: {
          "Content-Type": file.mime,
          "Content-Length": String(file.size || blob.bytes.byteLength || 0),
          "Content-Disposition": dispositionFor(file.mime, file.name),
          "Cache-Control": "private, max-age=600",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    /* —— 列表 —— */
    if (!first && request.method === "GET") {
      const url = new URL(request.url);
      const session = await getSession(env, request);

      if (url.searchParams.get("mine")) {
        if (!session) return fail("请先登录", 401);
        const items = await listWorks(env, {
          authorId: session.id,
          limit: url.searchParams.get("limit") || 50,
        });
        return ok({ items: items.map((w) => shapeForViewer(w, session)) });
      }

      if (url.searchParams.get("queue")) {
        if (!isStaff(session)) return fail("只有教师可以看批阅队列", 403);
        const items = await listWorks(env, {
          course: url.searchParams.get("course") || "",
          term: url.searchParams.get("term") || "",
          kind: url.searchParams.get("kind") || "",
          status: url.searchParams.get("status") || "",
          limit: url.searchParams.get("limit") || 100,
        });
        return ok({
          items: items.map((w) => shapeForViewer(w, session)),
          storage: storageKind(env),
        });
      }

      if (url.searchParams.get("featured")) {
        const items = await listWorks(env, {
          featuredOnly: true,
          course: url.searchParams.get("course") || "",
          term: url.searchParams.get("term") || "",
          limit: url.searchParams.get("limit") || 24,
        });
        return ok({
          items: items
            .filter((w) => w.status === "reviewed" || w.status === "archived")
            .map((w) => shapeForViewer(w, session)),
        });
      }

      // 不带参数：已经登录的学生看自己的，教师看全部待批
      if (!session) return fail("请先登录", 401);
      const items = isStaff(session)
        ? await listWorks(env, { limit: url.searchParams.get("limit") || 60 })
        : await listWorks(env, { authorId: session.id, limit: url.searchParams.get("limit") || 60 });
      return ok({ items: items.map((w) => shapeForViewer(w, session)) });
    }

    /* —— 提交 —— */
    if (!first && request.method === "POST") {
      const session = await getSession(env, request);
      if (!session) return fail("请先登录", 401);
      if (isReadOnly(session)) return fail("观察员账号只能浏览", 403);

      const limit = rateLimit(`work:${clientIp(request)}`, { limit: 12, windowMs: 10 * 60_000 });
      if (!limit.allowed) return fail("提交过于频繁，请稍后再试", 429);

      const data = readPayload(await readJson(request, 40_000));
      if (!data.title) return fail("给这份材料起个标题");
      if (!data.files.length && !data.links.length) {
        return fail("至少交一个文件，或者填一个在线文档链接");
      }
      // 附件必须是自己传的：别的材料的附件 id 会随公开列表下发，不拦就能被挂走
      const stolen = await filesOwnedBy(env, data.files, [session.id]);
      if (stolen.length) return fail("附件已失效，请重新上传后再提交", 409);

      const workId = randomId("work");
      const now = new Date().toISOString();
      await insertWork(env, {
        id: workId,
        ...data,
        authorId: session.id,
        authorName: session.displayName || session.username,
        now,
      });
      const stale = await syncWorkFiles(env, workId, data.files, { removeOld: false });
      for (const file of stale) await deleteBlob(env, file.id, file.storage);
      for (const file of await pruneOrphanWorkFiles(env, session.id)) {
        await deleteBlob(env, file.id, file.storage);
      }

      return ok({ id: workId, status: "submitted", storage: storageKind(env), ready: storageReady(env) });
    }

    /* —— 详情 —— */
    if (first && !second && request.method === "GET") {
      const work = await getWork(env, first);
      if (!work) return fail("这份材料不存在", 404);
      const session = await getSession(env, request);
      if (!canView(work, session)) return fail("这份材料不存在", 404);
      return ok(shapeForViewer(work, session));
    }

    /* —— 作者改稿 / 重交 —— */
    if (first && !second && request.method === "PUT") {
      const session = await getSession(env, request);
      if (!session) return fail("请先登录", 401);
      const work = await getWork(env, first);
      if (!work) return fail("这份材料不存在", 404);
      if (work.authorId !== session.id) return fail("只能改自己交的材料", 403);
      if (work.status === "reviewed") {
        return fail("教师已经批阅过了，要改请先请教师退回", 409);
      }
      // 归档是教师（或作者撤回）之后的终态，不能让一次改稿把它拉回批阅队列
      if (work.status === "archived") {
        return fail("这份材料已归档，如需重新提交请新建一份", 409);
      }

      const data = readPayload(await readJson(request, 40_000));
      if (!data.title) return fail("给这份材料起个标题");
      if (!data.files.length && !data.links.length) {
        return fail("至少交一个文件，或者填一个在线文档链接");
      }
      const stolen = await filesOwnedBy(env, data.files, [session.id, work.authorId]);
      if (stolen.length) return fail("附件已失效，请重新上传后再提交", 409);

      await updateWorkContent(env, first, { ...data, now: new Date().toISOString() });
      const stale = await syncWorkFiles(env, first, data.files);
      for (const file of stale) await deleteBlob(env, file.id, file.storage);
      for (const file of await pruneOrphanWorkFiles(env, session.id)) {
        await deleteBlob(env, file.id, file.storage);
      }
      return ok({ id: first, status: "submitted" });
    }

    /* —— 教师批阅 —— */
    if (first && !second && request.method === "PATCH") {
      const session = await getSession(env, request);
      if (!session) return fail("请先登录", 401);
      if (!isStaff(session)) return fail("只有教师可以批阅", 403);

      const work = await getWork(env, first);
      if (!work) return fail("这份材料不存在", 404);

      const body = await readJson(request, 8_000);
      const verdict = ["excellent", "pass", "return"].includes(String(body.verdict || ""))
        ? String(body.verdict)
        : "";
      const comment = String(body.comment || "").trim().slice(0, 2000);
      if (!verdict) return fail("请选择批阅结论");
      if (!comment) return fail("批阅要留一句评语");

      const featured = Boolean(body.featured) && verdict !== "return";
      await reviewWork(env, first, {
        status: verdict === "return" ? "returned" : "reviewed",
        verdict,
        comment,
        commentPublic: Boolean(body.commentPublic),
        reviewerId: session.id,
        reviewerName: session.displayName || session.username,
        featured,
        now: new Date().toISOString(),
      });
      return ok({ id: first, verdict, featured });
    }

    /* —— 撤回 / 归档 —— */
    if (first && !second && request.method === "DELETE") {
      const session = await getSession(env, request);
      if (!session) return fail("请先登录", 401);
      const work = await getWork(env, first);
      if (!work) return fail("这份材料不存在", 404);

      const own = work.authorId === session.id;
      if (!own && !isStaff(session)) return fail("只能撤回自己交的材料", 403);
      if (own && work.status === "reviewed" && !isStaff(session)) {
        return fail("已批阅的材料不能自己撤回，请找教师处理", 409);
      }

      await archiveWork(env, first);
      return ok({ archived: true });
    }

    return methodNotAllowed(["GET", "POST", "PUT", "PATCH", "DELETE"]);
  } catch (err) {
    return handleError(err);
  }
}
