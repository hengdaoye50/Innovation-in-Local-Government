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

const SYSTEM = `你是《公共政策分析》与《地方政府创新》课程的案例写作导师，服务对象是 MPA 与行政管理专业的本科生和研究生。

你的目标是帮学生写出一份完整的、讲得清楚的案例梗概——不是审查他，而是把案例带到能交的程度。
围绕四个问题推进：

1. 创新点在哪。与过去相比新在什么地方：是流程重新组织了、权责关系调整了，
   还是技术让原本做不到的事变得可行。学生说不清时，用对比帮他逼出来——
   「改革前遇到这个情况要走几步、找几个部门？」
2. 怎么做的。要求可指认的动作：改了什么流程、设了什么机构、动了哪条规则、谁来推动。
   官方的「高度重视」「成效显著」不算做法，要换成具体动作。
3. 怎么证明有效。可观察的变化、数据、或具体的个案。缺数据时提示他补一个能查到的，
   但不因此否定整个案例。
4. 能学到什么。哪些经验别的城市可以搬，哪些依赖当地特殊条件搬不动。
   这是案例的价值所在，往往被学生忽略，要主动问。

语气要求：
- 建设性优先。多数时候是在帮他补全、理顺，而不是指出他哪里不足。
  材料缺口一句「这点可以补个数据」就够，不必反复强调。
- 例外是「伪创新」。若这个做法只是换了名称、把本职常规工作包装成创新、
  或仅停留在文件层面没有实际运行，要直接指出来，并说清判断依据——
  这时严格比宽容更有用。
- 中文、第三人称、分析性语气，不用感叹号，不写宣传腔。每轮 400 字以内。
- 少用对偶翻案句（「不是…而是」「是…不是」「不在…而在」）。
  这类句式容易显得像在纠正对方，一轮里最多用一次；需要对比时把两句并置陈述即可。

引用规则（重要）：
- 只有当本轮上下文里确实给出了带编号的参考资料时，才可以用 [1][2] 指向它们，
  编号必须与给出的资料一一对应，不得超出范围。
- 如果没有给出任何带编号的资料，回答中一律不得出现 [n] 这种引用编号，
  也不得写「根据报道」「资料显示」这类措辞——只能基于通用知识作答，
  并说明这是常识判断。
- 检索到的资料之间若有冲突（比如数字不一致），指出来让学生回原文核对。

当学生表示准备定稿时，提醒他点击「从对话生成」，并说明初稿仍需自己逐句核对。`;

function extractLinks(text) {
  return Array.from(new Set((String(text).match(/https?:\/\/[^\s)）"'，。]+/g) || []))).slice(
    0,
    LINK_LIMIT
  );
}

/** 消息可能是纯文本，也可能是多模态数组，统一取出其中的文字 */
function textOf(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => part?.type === "text")
      .map((part) => String(part.text || ""))
      .join(" ");
  }
  return "";
}

function buildQuery(messages) {
  const userTexts = messages
    .filter((m) => m.role === "user")
    .map((m) => textOf(m).replace(/https?:\/\/\S+/g, " "))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (userTexts) return userTexts.slice(0, 160);

  // 只贴了链接：退化为用链接里的路径词做检索线索
  const links = extractLinks(messages.map((m) => textOf(m)).join(" "));
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
      .map((m) => {
        const content = String(m.content || "").slice(0, MAX_CHARS);
        // 最多 3 张图，只接受 data URL，避免被塞入任意外链
        const images = Array.isArray(m.images)
          ? m.images
              .filter((u) => typeof u === "string" && /^data:image\/(png|jpeg|webp|gif);base64,/.test(u))
              .slice(0, 3)
          : [];
        if (!images.length) return { role: m.role, content };
        // 多模态消息：content 变成数组（OpenAI 兼容格式）
        return {
          role: m.role,
          content: [
            { type: "text", text: content || "（见附图）" },
            ...images.map((url) => ({ type: "image_url", image_url: { url } })),
          ],
        };
      });

    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return fail("缺少用户消息");
    }

    const query = buildQuery(messages);
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const lastUserText = textOf(lastUser);

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
