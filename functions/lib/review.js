/**
 * 案例质检：一次模型调用给出结构化结论
 * 通过则直接发布，不通过退回并说明理由，教师仍可覆盖。
 */
import { complete, llmReady } from "./llm.js";

const MIN_WORDS = 1000;
const MAX_WORDS = 1500;
const LINK_LIMIT = 15;

const SYSTEM = `你是《地方政府创新》课程的助教，负责审核本科与 MPA 学生提交的案例梗概。

判断的核心是一句话：这份梗概有没有把一个创新讲清楚。
不要因为它「数据不够全」就判不合格——案例写作在本科与 MPA 阶段本来就常常拿不到完整数据。

评估维度，按重要性排序：
1. 创新点是否说清：与过去相比新在哪里，是流程重组、权责调整，还是技术让原本做不到的事变得可行。
   这是最重要的维度。只写「引入先进理念」「提升治理水平」而不落到具体变化的，视为没说清。
2. 做法是否可指认：有没有具体动作、推进手段、推动主体（改了什么流程、设了什么机构、动了哪条规则）。
   通篇「高度重视」「扎实推进」的，视为没写做法。
3. 效果是否有依据：有数据、个案或可观察的变化。只给形容词的，在评语里提醒补，但不必因此退回。
4. 是否点出可推广的经验：哪些能学、哪些学不了。缺失时在评语里提醒，不作为退回理由。
5. 叙述：第三人称分析性叙述，不是新闻复制，也不是第一人称感想。
6. 篇幅：最低 1000 字，不足视为不合格；1500 字仅为建议上限，超出只提醒精简，不判不合格。

注意：案例写作的目标是一篇连贯的叙述作品。
- **不要因为缺少「局限」「代价」「争议」的独立章节而扣分或判不合格**。
- 但**正文主体被插话打断**是减分项：如果在讲做法的过程中不断插入
  「材料未交代」「需要核实」「属于常识判断」这类句子，说明叙事不连贯，
  应在评语里提醒把它压缩到最后一段。

伪创新要判不合格：如果这个做法只是换了名称、把本职常规工作包装成创新、
或仅停留在文件层面并未实际运行，判 false，并在 problems 里说清依据。

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

  // 硬性门槛：不满足则退回，学生改完可重提
  const ruleProblems = [];
  if (words < MIN_WORDS) ruleProblems.push(`正文 ${words} 字，少于 ${MIN_WORDS} 字下限`);
  if (!data.province) ruleProblems.push("缺少发生地省份");
  if (!linkCount) ruleProblems.push("缺少有效来源链接");
  if (linkCount > LINK_LIMIT) ruleProblems.push(`来源超过 ${LINK_LIMIT} 条上限`);

  // 篇幅上限只作提醒，不阻断：本意是别写太长，不是判不合格
  const warnings = [];
  if (words > MAX_WORDS) {
    warnings.push(`正文 ${words} 字，超出建议的 ${MAX_WORDS} 字，可考虑精简到 1000–1500 字`);
  }

  if (!llmReady(env)) {
    const pass = ruleProblems.length === 0;
    const reviewText = pass
      ? `自动校验通过（模型质检未启用，仅检查了篇幅与必填项）。${
          warnings.length ? `提示：${warnings.join("；")}。` : ""
        }`
      : `自动校验未通过：${ruleProblems.join("；")}。`;
    return {
      pass,
      score: pass ? 70 : 40,
      review: reviewText,
      problems: ruleProblems,
      warnings,
    };
  }

  try {
    const raw = await complete(env, {
      system: SYSTEM,
      messages: [{ role: "user", content: buildUserPrompt(data) }],
      temperature: 0.2,
      // 思考模式会先消耗 reasoning token，额度需覆盖「思考 + JSON 结论」
      maxTokens: 2500,
    });
    const parsed = parseModelJson(raw);

    if (!parsed || typeof parsed.pass !== "boolean") {
      throw new Error("模型返回格式无法解析");
    }

    const problems = Array.isArray(parsed.problems) ? parsed.problems.slice(0, 3) : [];
    const merged = [...new Set([...ruleProblems, ...problems])];
    // 只有硬性问题才决定是否退回；篇幅超限只进 warnings
    const pass = parsed.pass && ruleProblems.length === 0;

    return {
      pass,
      score: Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 60))),
      review: String(parsed.comment || "").slice(0, 300),
      problems: merged,
      warnings,
    };
  } catch (err) {
    console.error("[review] model failed:", err.message);
    return {
      pass: ruleProblems.length === 0,
      score: ruleProblems.length === 0 ? 70 : 40,
      review: ruleProblems.length
        ? `自动校验未通过：${ruleProblems.join("；")}。`
        : `自动校验通过（模型质检暂时不可用，仅检查了篇幅与必填项）。${
            warnings.length ? `提示：${warnings.join("；")}。` : ""
          }`,
      problems: ruleProblems,
    };
  }
}

const SLIDE_SYSTEM = `你是《地方政府创新》与《公共政策分析》课程的课堂评委，正在看学生小组的汇报展位。

根据标题、课程与描述，给出一段评语与分数。要求：
1. 先指出这个选题的问题意识是否清楚——它想回答什么，这个问法有没有价值；
2. 再看论证链条是否完整：有没有把「做法」和「说法」分开，有没有提到代价或争议；
3. 给一条具体、可执行的改进建议，不要泛泛而谈；
4. 语气像认真听课的老师，不客套，也不用感叹号。

只输出 JSON，不要解释文字：
{"score": 0-100 的整数, "comment": "80-140 字评语"}`;

/**
 * 课堂展位的模型评语。未配置模型时返回 null，界面保持「待评」。
 */
export async function reviewSlide(env, slide) {
  if (!llmReady(env) || !slide?.title) return null;

  try {
    const raw = await complete(env, {
      system: SLIDE_SYSTEM,
      messages: [
        {
          role: "user",
          content: `标题：${slide.title}
课程：${slide.course || "未注明"}
描述：${slide.description || "（未填写）"}`,
        },
      ],
      temperature: 0.4,
      maxTokens: 2000,
    });

    const parsed = parseModelJson(raw);
    if (!parsed) return null;

    const comment = String(parsed.comment || "").trim();
    if (!comment) return null;

    const score = Math.round(Number(parsed.score));
    return {
      review: comment.slice(0, 400),
      score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null,
    };
  } catch (err) {
    console.error("[review:slide] failed:", err.message);
    return null;
  }
}
