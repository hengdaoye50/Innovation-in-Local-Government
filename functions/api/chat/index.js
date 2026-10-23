/**
 * POST /api/chat
 * 流式对话（NDJSON）：{"meta":{sources}} / {"delta":"..."} / {"done":true} / {"error":"..."}
 * 检索结果先于模型输出下发，前端据此展示来源列表。
 */
import { fail, readJson, handleError, clientIp, rateLimit, ok } from "../../lib/http.js";
import {
  search,
  fetchPage,
  searchReady,
  formatSources,
  LINK_LIMIT,
  providerName,
} from "../../lib/search.js";
import { stream as llmStream, llmReady } from "../../lib/llm.js";

const MAX_TURNS = 24;
const MAX_CHARS = 8000;

const SYSTEM = `你是《公共政策分析》与《地方政府创新》课程的案例写作助教，服务对象是 MPA 与行政管理专业的本科生和研究生。

你的任务不是替学生写作业，而是帮他们把一条新闻变成一个有解释力的案例。遵循这些原则：

1. 先确认事实再谈评价。学生给出的链接或描述里若缺少关键信息（谁在做、什么时候开始、具体改了什么、效果如何、谁提出异议），直接指出缺哪一项，并说明可以从哪里补。
2. 把「做法」和「说法」分开。官方表述中的「高度重视」「显著成效」不算证据，要追问可观察的动作与数据。
3. 多说一句代价。任何便利都有成本承担方：前台简化往往意味着后台加压，数字化往往排除一部分人。请引导学生把这个写出来。
4. 引用规则（重要）：
   - 只有当本轮上下文里确实给出了带编号的参考资料时，才可以用 [1][2] 指向它们，
     并且编号必须与给出的资料一一对应，不得超出范围。
   - 如果没有给出任何带编号的资料，回答中一律不得出现 [n] 这种引用编号，
     也不得写「根据报道」「资料显示」这类措辞——只能基于通用知识作答，
     并明确说明这是常识判断、未经核实。
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
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const lastUserText = lastUser?.content || "";

    // 学生贴的链接直接抓正文：比只拿到标题有用得多。
    // 最多两篇，单篇限 8000 字，控制成本与上下文占用。
    const pastedLinks = extractLinks(lastUserText).slice(0, 2);
    const pages = [];
    if (searchReady(env)) {
      for (const url of pastedLinks) {
        const page = await fetchPage(env, url);
        if (page) pages.push({ url, ...page });
      }
    }

    const sources =
      searchReady(env) && query
        ? await search(env, query, {
            oriQuestion: lastUserText,
            // 检索条数收在 8 条：15 条会把上下文撑得很大，
            // 首字延迟明显变长，而多出来的末位结果对回答帮助有限
            limit: 8,
          })
        : [];

    const blocks = [SYSTEM];

    if (pages.length) {
      blocks.push(
        `以下是学生贴出的链接正文，请以它们为主要依据，并注意区分「报道中的说法」与「可核实的做法」：\n\n${pages
          .map(
            (p, i) =>
              `【链接 ${i + 1}】${p.title || p.url}\n${p.url}\n"""\n${p.content.slice(0, 6000)}\n"""`
          )
          .join("\n\n")}`
      );
    }

    if (sources.length) {
      blocks.push(
        `以下是检索到的参考资料，请优先基于它们回答，并在提到具体事实时对应编号：\n\n${formatSources(
          sources
        )}`
      );
    }

    if (!pages.length && !sources.length) {
      blocks.push(
        `本轮没有取得任何来源：${
          providerName(env) === "none" ? "检索服务未接入" : "检索无结果或抓取失败"
        }。\n` +
          `因此回答中不得出现任何 [n] 形式的引用编号，不得声称「根据报道」「资料显示」，` +
          `也不得写出具体的 URL。只能基于通用知识作答，并明确提示这部分需要学生自行核实。`
      );
    }

    const system = blocks.join("\n\n---\n\n");

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
            fetched: pages.map((p) => ({ url: p.url, title: p.title })),
            searchEnabled: sources.length > 0 || pages.length > 0,
          },
        });

        try {
          await llmStream(env, {
            system,
            messages,
            temperature: 0.5,
            // 思考模式的 reasoning token 也占 max_tokens，留足余量
            maxTokens: 4000,
            onThinking: () => send({ meta: { thinking: true } }),
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
