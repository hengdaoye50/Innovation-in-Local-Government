/**
 * POST /api/chat
 * 流式对话（NDJSON）：{"meta":{sources}} / {"delta":"..."} / {"done":true} / {"error":"..."}
 * 检索结果先于模型输出下发，前端据此展示来源列表。
 */
import { fail, readJson, handleError, clientIp, rateLimit, ok } from "../../lib/http.js";
import { search, searchReady, formatSources, LINK_LIMIT, providerName } from "../../lib/search.js";
import { stream as llmStream, llmReady } from "../../lib/llm.js";

const MAX_TURNS = 24;
const MAX_CHARS = 8000;

const SYSTEM = `你是《公共政策分析》与《地方政府创新》课程的案例写作助教，服务对象是 MPA 与行政管理专业的本科生和研究生。

你的任务不是替学生写作业，而是帮他们把一条新闻变成一个有解释力的案例。遵循这些原则：

1. 先确认事实再谈评价。学生给出的链接或描述里若缺少关键信息（谁在做、什么时候开始、具体改了什么、效果如何、谁提出异议），直接指出缺哪一项，并说明可以从哪里补。
2. 把「做法」和「说法」分开。官方表述中的「高度重视」「显著成效」不算证据，要追问可观察的动作与数据。
3. 多说一句代价。任何便利都有成本承担方：前台简化往往意味着后台加压，数字化往往排除一部分人。请引导学生把这个写出来。
4. 主动提供检索线索。若参考资料中已有可用来源，指出哪一条最有价值；若没有，明确说明「目前没有可核实的来源」，不要编造事实、数据或链接。
5. 保持中文、第三人称、分析性语气。不要用感叹号，不要写宣传腔。
6. 每轮回答控制在 400 字以内，宁可多问一句也不要一次讲完。

当学生表示准备定稿时，提醒他点击「从对话生成」，并说明初稿需要他自己逐句核对。`;

function extractLinks(text) {
  return Array.from(new Set((String(text).match(/https?:\/\/[^\s)）"'，。]+/g) || []))).slice(
    0,
    LINK_LIMIT
  );
}

function buildQuery(messages) {
  const userTexts = messages
    .filter((m) => m.role === "user")
    .map((m) => String(m.content || "").replace(/https?:\/\/\S+/g, " "))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (userTexts) return userTexts.slice(0, 160);

  // 只贴了链接：退化为用链接里的路径词做检索线索
  const links = extractLinks(messages.map((m) => m.content).join(" "));
  if (links.length) {
    try {
      const u = new URL(links[0]);
      return `${u.hostname} ${decodeURIComponent(u.pathname).replace(/[/_-]+/g, " ")}`.slice(0, 120);
    } catch {
      return "";
    }
  }
  return "";
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "POST") {
    return fail("method not allowed", 405);
  }

  try {
    if (!llmReady(env)) return fail("服务端未配置模型密钥，请联系管理员", 503);

    const limit = rateLimit(`chat:${clientIp(request)}`, { limit: 30, windowMs: 10 * 60_000 });
    if (!limit.allowed) return fail("对话请求过于频繁，请稍后再试", 429);

    const body = await readJson(request, 60_000);
    const raw = Array.isArray(body.messages) ? body.messages : [];

    const messages = raw
      .filter((m) => m && (m.role === "user" || m.role === "assistant"))
      .slice(-MAX_TURNS)
      .map((m) => ({
        role: m.role,
        content: String(m.content || "").slice(0, MAX_CHARS),
      }));

    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return fail("缺少用户消息");
    }

    const query = buildQuery(messages);
    const sources = searchReady(env) && query ? await search(env, query) : [];

    const system = sources.length
      ? `${SYSTEM}\n\n以下是检索到的参考资料，请优先基于它们回答，并在提到具体事实时对应编号：\n\n${formatSources(sources)}`
      : `${SYSTEM}\n\n当前没有可用的检索结果${providerName(env) === "none" ? "（检索服务尚未接入）" : ""}。不要虚构来源。`;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj) => {
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
          } catch {
            /* 客户端已断开 */
          }
        };

        send({
          meta: {
            sources,
            searchEnabled: sources.length > 0,
          },
        });

        try {
          await llmStream(env, {
            system,
            messages,
            temperature: 0.5,
            maxTokens: 1400,
            onDelta: (delta) => send({ delta }),
          });
          send({ done: true });
        } catch (err) {
          console.error("[chat] stream failed:", err.message);
          send({ error: "模型服务暂时不可用，请稍后重试" });
        } finally {
          try {
            controller.close();
          } catch {
            /* 已关闭 */
          }
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
