/**
 * POST /api/chat/extract
 * 把对话整理成结构化案例初稿，供前端填入编辑器。
 */
import { ok, fail, readJson, handleError, clientIp, rateLimit } from "../../lib/http.js";
import { complete, llmReady } from "../../lib/llm.js";

const PROVINCES = [
  "北京市", "天津市", "河北省", "山西省", "内蒙古自治区",
  "辽宁省", "吉林省", "黑龙江省", "上海市", "江苏省",
  "浙江省", "安徽省", "福建省", "江西省", "山东省",
  "河南省", "湖北省", "湖南省", "广东省", "广西壮族自治区",
  "海南省", "重庆市", "四川省", "贵州省", "云南省",
  "西藏自治区", "陕西省", "甘肃省", "青海省", "宁夏回族自治区",
  "新疆维吾尔自治区", "台湾省", "香港特别行政区", "澳门特别行政区",
];

const DOMAINS = [
  "数字治理", "营商环境", "基层治理", "公共服务", "生态治理",
  "乡村振兴", "社会组织", "政务公开", "应急管理", "城市更新",
];

const SYSTEM = `你是案例写作导师，要把一段师生对话整理成一份完整的、可直接提交的案例梗概。

这份梗概的目标不是审查这个案例有多少材料缺口，而是把它讲清楚：
创新点到底在哪、怎么做的、别人能从中借鉴什么。

正文结构（按此顺序展开，不要加小标题，用自然段落衔接）：
1. 背景与起因：原来存在什么问题，为什么在这个时间点改革（简要，一两段）；
2. 创新点：与过去的做法相比，新在哪里——是流程重组、权责调整，还是技术让原本做不到的事变得可行。
   这是全文的核心，要写实，不要写成「引入先进理念」这类空话；
3. 具体做法：讲出来龙去脉。谁推动的、分几步推进、先做什么后做什么、
   过程中做过什么调整或遇到什么阻力。要让读者看明白这件事是怎么一步步发生的，
   而不是读一份要点清单。这一段是全文主体，要有过程感和叙事性；
4. 效果：有哪些可观察的变化，用具体的事例和数字说话；
5. 可推广的经验：别的城市能学什么，哪些做法依赖特殊条件学不了。

然后单独用最后一段交代边界：哪些信息尚不明确、哪些说法缺少公开依据、
哪些结论只能停在个案层面。**这一段不超过三句话**，点到为止，不要展开成小节。

写作要求（重要）：
- 前面五段要连贯完整地讲故事，不要在中间插入「材料未交代」「属于常识判断」
  「这一点需要核实」「据公开材料」这类打断阅读的插话。有拿不准的地方，留到最后一段统一说。
- 数字若有多个来源，选一个用，不在正文里反复辩证。
- 读者的体验应该是读完一篇完整的案例，而不是读一份带满脚注的报告。
- 篇幅目标 1200–1400 字，宁短勿长，不要超过 1500 字。

篇幅分配：「创新点 + 具体做法 + 可推广经验」合计不少于全文的六成。

如果是伪创新，另当别论：当这个做法只是换了名称、把本职常规工作包装成创新、
或仅停留在文件层面并未实际运行，就要在正文中说明它为什么算不上真正的创新，
依据是什么，这类案例的重心应放在「为什么是伪创新」的分析上。

其他约束：
- 正文 1000–1500 字，中文，第三人称叙述，不要用感叹号，不出现「我」「我们」。
- 文风：少用对偶翻案句。「不是…而是」「是…不是」「不在…而在」「A 而非 B」这类句式，
  全文最多出现一次，且只在确实要澄清一个常见误解时才用。
  多数情况下把两句话并置陈述即可——不要写「创新点不在系统建设，而在权责重组」，
  写「这次改革调整的是权责关系，系统只是承载」。
- 只使用对话中出现过的事实。对话没提到的数据、人名、时间点一律留空或用「据报道」限定，绝不编造。
- 不要写成新闻通稿，避免「高度重视」「扎实推进」「成效显著」这类空话。
- 正文只呈现内容本身，不得出现针对「这篇案例该怎么写」的元评述
  （如「案例可以写成…」「较稳妥的写法是…」「建议补充…」）。判断直接写成陈述句。
- province 必须从给定列表中选择一个最贴近的；city 填地级市；district 填区或县，
  只填对话里确实出现过的，拿不准就留空字符串。
- domains 从给定列表中选 1–3 个。

标题写法（很重要）：
- 结构为「地名 + 核心机制」，让人只看标题就知道这个案例的创新点在哪。
- 点机制，不要点规模。数量变化（多少个渠道并为多少个、覆盖多少人）只是表象，
  除非数量本身就是机制，否则不要写进标题。
- 避免宣传语：「成效显著」「打造新样板」「迈上新台阶」「探索新路径」一律不用。
- 不超过 30 字。
- 反例：「深圳民生诉求改革：557个渠道并为23个」（只说了规模，没说创新在哪）
- 好例：「深圳民生诉求改革：以事项清单锁定责任与时限」（点出机制）

只输出 JSON，不要任何解释文字：
{"title":"不超过 30 字的标题","province":"省级行政区全称","city":"市","district":"区或县","domains":["领域"],"body":"正文","summary":"80 字以内摘要"}`;

function parseJson(text) {
  if (!text) return null;
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
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

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") return fail("method not allowed", 405);

  try {
    if (!llmReady(env)) return fail("服务端未配置模型密钥", 503);

    const limit = rateLimit(`extract:${clientIp(request)}`, { limit: 10, windowMs: 10 * 60_000 });
    if (!limit.allowed) return fail("请求过于频繁，请稍后再试", 429);

    const body = await readJson(request, 80_000);
    const transcript = Array.isArray(body.transcript) ? body.transcript : [];
    if (!transcript.length) return fail("对话内容为空");

    const dialogue = transcript
      .filter((m) => m && m.role && m.content)
      .slice(-30)
      .map((m) => `${m.role === "user" ? "学生" : "助教"}：${String(m.content).slice(0, 1200)}`)
      .join("\n\n")
      .slice(0, 22_000);

    if (dialogue.length < 40) return fail("对话内容过少，先和助教聊几句再生成");

    const raw = await complete(env, {
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `可选的省级行政区：${PROVINCES.join("、")}
可选的领域标签：${DOMAINS.join("、")}

以下是对话记录：
"""
${dialogue}
"""`,
        },
      ],
      temperature: 0.4,
      // 要产出 1000–1500 字正文，叠加思考 token，额度必须放宽
      maxTokens: 8000,
    });

    const parsed = parseJson(raw);
    if (!parsed) return fail("模型返回格式无法解析，请重试", 502);

    const province = PROVINCES.includes(parsed.province) ? parsed.province : "";
    const domains = Array.isArray(parsed.domains)
      ? parsed.domains.filter((d) => DOMAINS.includes(d)).slice(0, 3)
      : [];

    return ok({
      title: String(parsed.title || "").slice(0, 60),
      province,
      city: String(parsed.city || "").slice(0, 30),
      district: String(parsed.district || "").slice(0, 30),
      domains,
      body: String(parsed.body || ""),
      summary: String(parsed.summary || "").slice(0, 200),
      wordCount: String(parsed.body || "").replace(/\s/g, "").length,
    });
  } catch (err) {
    return handleError(err);
  }
}
