/**
 * /api/readings/:id/mindmap
 *   GET 取文献的思维导图。首次请求时由模型生成，结果存进 KV 复用。
 *
 * 为什么缓存：导图只看结构、不看时效，一篇文献生成一次就够了；
 * 每次访问都调模型既慢又费额度。
 */
import { ok, fail, handleError } from "../../../lib/http.js";
import { getSession, isStaff, checkBindings } from "../../../lib/auth.js";
import { complete, llmReady } from "../../../lib/llm.js";

// 与 public/data/readings/*.json 里的章节结构对应，模型只负责提炼要点
const OUTLINE = {
  "flyvbjerg-case-study": {
    title: "Five Misunderstandings About Case-Study Research（案例研究的五个误解）",
    sections: [
      "Abstract｜摘要",
      "Introduction｜引言",
      "The Conventional Wisdom About Case-study research｜关于案例研究的成见",
      "The Role of Cases in Human Learning｜案例在人的学习中的作用",
      "Cases as ‘Black Swans’｜案例作为「黑天鹅」",
      "Strategies for Case Selection｜案例选择策略",
      "Do Case Studies Contain a Subjective Bias?｜案例研究带有主观偏见吗",
      "The Irreducible Quality of Good Case Narratives｜好的案例叙事不可化约的品质",
      "Conclusions｜结论",
    ],
    hint: "文章驳斥关于案例研究的五个误解：(1) 理论知识比实践知识更有价值；(2) 单个案例无法推广；(3) 案例只能用于假设生成；(4) 案例研究偏向验证；(5) 难以概括具体案例。",
  },
};

const SYSTEM = `你在为一门公共管理课程做文献导读。读给定文献的章节清单与要点提示，
把整篇文章的论证脉络整理成一张思维导图，用中文。

只输出 JSON，不要任何解释文字，结构如下：
{
  "root": "整篇文章要回答的核心问题（一句话）",
  "branches": [
    { "title": "分支标题", "points": ["要点一", "要点二"] }
  ]
}

要求：
- branches 控制在 4 到 6 个，对应文章的主要论证板块，不要按章节一一罗列；
- 每个分支下 2 到 4 条要点，每条是一句完整的判断，不是关键词堆叠；
- 用课程语境的中文，术语首次出现时可在括号里附英文；
- 不要编造文章里没有的内容。`;

async function buildMindmap(env, meta) {
  const prompt = `文献：${meta.title}\n\n章节：\n${meta.sections
    .map((s, i) => `${i + 1}. ${s}`)
    .join("\n")}\n\n要点提示：${meta.hint}`;

  const raw = await complete(env, {
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    maxTokens: 1600,
  });

  // 模型偶尔会用 ```json 包一层，剥掉再解析
  const text = String(raw || "")
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型没有返回可解析的结构");
  const parsed = JSON.parse(text.slice(start, end + 1));
  if (!parsed?.root || !Array.isArray(parsed?.branches) || !parsed.branches.length) {
    throw new Error("模型返回的导图结构不完整");
  }
  return {
    root: String(parsed.root).slice(0, 200),
    branches: parsed.branches.slice(0, 6).map((b) => ({
      title: String(b?.title || "").slice(0, 80),
      points: (Array.isArray(b?.points) ? b.points : [])
        .slice(0, 4)
        .map((p) => String(p).slice(0, 160)),
    })),
  };
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const id = String(Array.isArray(params?.id) ? params.id[0] : params?.id || "");

  try {
    const missing = checkBindings(env);
    if (missing) return fail(missing, 503);

    const session = await getSession(env, request);
    if (!session) return fail("请先登录", 401);

    if (request.method !== "GET") return fail("method not allowed", 405);
    if (!OUTLINE[id]) return fail("没有这篇文献", 404);
    if (!llmReady(env)) return fail("服务端未配置模型密钥", 503);

    const cacheKey = `reading:mindmap:${id}`;
    const cached = await env.SESSIONS.get(cacheKey);
    if (cached) return ok({ mindmap: JSON.parse(cached), cached: true });

    const mindmap = await buildMindmap(env, OUTLINE[id]);
    await env.SESSIONS.put(cacheKey, JSON.stringify(mindmap));
    return ok({ mindmap, cached: false });
  } catch (err) {
    return handleError(err);
  }
}
