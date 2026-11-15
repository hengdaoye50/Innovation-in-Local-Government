/**
 * POST /api/admin/purge —— 手动一键清理（仅 admin）
 *
 * 清两样东西：历史作废的邀请码、停用的空账号（名下零内容）。
 * 名下有作品的停用账号不删，把数量放在 skipped 里返回。
 */
import { ok, fail, methodNotAllowed, handleError } from "../../lib/http.js";
import { getSession, checkBindings } from "../../lib/auth.js";
import { purgeRevokedInvites, purgeEmptyDisabledUsers } from "../../lib/purge.js";

export async function onRequest(context) {
  const { request, env } = context;

  try {
    const missing = checkBindings(env);
    if (missing) return fail(missing, 503);

    const session = await getSession(env, request);
    if (session?.role !== "admin") return fail("只有管理员可以清理", 403);

    if (request.method !== "POST") return methodNotAllowed(["POST"]);

    const invites = await purgeRevokedInvites(env);
    const users = await purgeEmptyDisabledUsers(env, { keepId: session.id });

    return ok({ invites, users: users.users, skipped: users.skipped });
  } catch (err) {
    return handleError(err);
  }
}
