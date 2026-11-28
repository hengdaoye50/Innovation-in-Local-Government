/**
 * /api/connect/summary
 *   教师后台的角标：还有多少提问等人回、多少预约等批复。
 *   单独一条轻接口，是为了让后台一进来就能把数字挂在页签上，不必先把两个队列都拉下来。
 */
import { ok, fail, handleError } from "../../lib/http.js";
import { getSession, isStaff, checkBindings } from "../../lib/auth.js";
import { hasConnect, countThreads, countOfficeHours } from "../../lib/connect.js";

export async function onRequest(context) {
  const { request, env } = context;

  try {
    const missing = checkBindings(env);
    if (missing) return fail(missing, 503);

    const session = await getSession(env, request);
    if (!isStaff(session)) return fail("无权查看", 403);
    if (request.method !== "GET") return fail("method not allowed", 405);

    if (!(await hasConnect(env))) {
      // 迁移没跑时给 0，而不是让后台因为一个角标整页报错
      return ok({ available: false, questionsAwaiting: 0, requestsPending: 0 });
    }

    return ok({
      available: true,
      questionsAwaiting: await countThreads(env, { awaiting: "staff" }),
      requestsPending: await countOfficeHours(env, { status: "pending" }),
    });
  } catch (err) {
    return handleError(err);
  }
}
