/**
 * 案例质检：一次模型调用给出结构化结论
 * 通过则直接发布，不通过退回并说明理由，教师仍可覆盖。
 */
import { complete, llmReady } from "./llm.js";

const MIN_WORDS = 1000;
const MAX_WORDS = 1500;
const LINK_LIMIT = 15;

const SYSTEM = `你是《地方政府创新》课程的助教，负责审核本科与 MPA 学生提交的案例梗概。

评估维度：
1. 篇幅：正文（不含标点外的空白）应在 1000–1500 字之间。
2. 要素：必须交代清楚 发生地（省/市或县）、实施主体、改革的具体动作、时间或阶段、可观察的效果或争议。
3. 叙述：应为第三人称的分析性叙述，不是新闻报道的复制，也不是第一人称感想。
4. 具体性：要有可指认的做法细节（改了什么流程、设了什么机构、动了什么规则），不能只有「高度重视」「成效显著」这类空话。
5. 平衡：提到代价、局限或争议者更佳，但不作为否决条件。

只输出 JSON，不要任何解释文字，格式：
{"pass": true 或 false, "score": 0-100 的整数, "problems": ["具体问题，最多 3 条"], "comment": "给学生的 40-80 字评语，指出一处优点与一处可改进"}`;

function zhLength(text) {
  return String(text || "").replace(/\s/g, "").length;
}

/** 结构化提示词里带上硬指标，让模型不必自己数 */
function buildUserPrompt(data) {
  const words = zhLength(data.body);
  return `标题：${data.title}
发生地：${data.province}${data.city ? ` · ${data.city}` : ""}
领域标签：${(data.domains || []).join("、") || "未填"}
正文实测字数：${words}
来源链接：${(data.sources || []).length} 条

正文：
"""
${String(data.body || "").slice(0, 6000)}
"""`;
}

function parseModelJson(text) {
  if (!text) return null;
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * 返回 { pass, score, review }。
 * 模型不可用时退化为规则校验，保证提交链路不被卡死。
 */
export async function reviewCase(env, data) {
  const words = zhLength(data.body);
  const linkCount = (data.sources || []).filter((s) => /^https?:\/\//.test(s.url || "")).length;

  const ruleProblems = [];
  if (words < MIN_WORDS) ruleProblems.push(`正文 ${words} 字，少于 ${MIN_WORDS} 字下限`);
  if (words > MAX_WORDS) ruleProblems.push(`正文 ${words} 字，超过 ${MAX_WORDS} 字上限`);
  if (!data.province) ruleProblems.push("缺少发生地省份");
  if (!linkCount) ruleProblems.push("缺少有效来源链接");
  if (linkCount > LINK_LIMIT) ruleProblems.push(`来源超过 ${LINK_LIMIT} 条上限`);

  if (!llmReady(env)) {
    return {
      pass: ruleProblems.length === 0,
      score: ruleProblems.length === 0 ? 70 : 40,
      review: ruleProblems.length
        ? `自动校验未通过：${ruleProblems.join("；")}。`
        : "自动校验通过（模型质检未启用，仅检查了篇幅与必填项）。",
      problems: ruleProblems,
    };
  }

  try {
    const raw = await complete(env, {
      system: SYSTEM,
      messages: [{ role: "user", content: buildUserPrompt(data) }],
      temperature: 0.2,
      maxTokens: 700,
    });
    const parsed = parseModelJson(raw);

    if (!parsed || typeof parsed.pass !== "boolean") {
      throw new Error("模型返回格式无法解析");
    }

    const problems = Array.isArray(parsed.problems) ? parsed.problems.slice(0, 3) : [];
    const merged = [...new Set([...ruleProblems, ...problems])];
    const pass = parsed.pass && ruleProblems.length === 0;

    return {
      pass,
      score: Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 60))),
      review: String(parsed.comment || "").slice(0, 300),
      problems: merged,
    };
  } catch (err) {
    console.error("[review] model failed:", err.message);
    return {
      pass: ruleProblems.length === 0,
      score: ruleProblems.length === 0 ? 70 : 40,
      review: ruleProblems.length
        ? `自动校验未通过：${ruleProblems.join("；")}。`
        : "自动校验通过（模型质检暂时不可用，仅检查了篇幅与必填项）。",
      problems: ruleProblems,
    };
  }
}
