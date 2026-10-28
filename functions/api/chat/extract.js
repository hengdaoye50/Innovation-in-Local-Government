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

这份梗概只讲一件事。动笔前先想清楚：这次改革最核心的机制是什么，它到底改变了什么。
然后围绕这一件事展开——对话里的其他材料都要为它服务，撑不起主线的枝节宁可舍掉。
写成三件事并列，等于哪件都没讲透。

读者读完应该能回答三个问题：这次创新新在哪、具体怎么做的、别的城市能学什么。
但这三件事不必按固定段落罗列，按它们在你脑子里最自然的顺序写就行。

怎么写：
- 开头直接进入具体的困境或矛盾，不要用「近年来」「随着」这类背景综述起手。
- 用动词和具体名词。「职责边界不清」不如「同一个井盖，市政说归城管、城管说归住建」；
  「提升办理效率」不如「两小时内派到责任单位」。
- 抽象名词少用。「权责关系」「运行机制」「闭环」这类词，同一段里最多出现一个。
- 数字一次一个，用在关键处，不要一口气列五个百分比。
- 句子要有长短。陈述事实用短句；分析可以长一点。通篇都是四五十字的中长句最没劲。
- 段落第一句是判断或动作，不要「关于某某方面」「可观察的变化有几个」这种话题句。
- 避免「是…的」句式泛滥，比如「推动这项工作的是某某局，依托的是全市层面的授权」。
- 结尾不要总结陈词，留一个真正悬而未决的问题。

边界怎么交代：哪些信息尚不明确、哪些说法缺依据，放在最后两三句说清楚，
不要打断正文的叙事。

其他约束：
- 正文目标 1500 字左右。可以写得更长，不要为了压字数牺牲细节与过程感。
- 中文，第三人称叙述，不用感叹号，不出现「我」「我们」。
- 文风：少用对偶翻案句（「不是…而是」「是…不是」「不在…而在」「A 而非 B」），
  全文最多出现一次，且只在确实要澄清一个常见误解时才用。
  多数情况把两句并置陈述即可——不写「创新点不在系统建设，而在权责重组」，
  写「这次改革调整的是权责关系，系统只是承载」。
- 只使用对话中出现过的事实。对话没提到的数据、人名、时间点一律留空或用「据报道」限定，绝不编造。
- 不要写成新闻通稿，避免「高度重视」「扎实推进」「成效显著」这类空话。
- 正文只呈现内容本身，不得出现「案例可以写成…」「建议补充…」这类写作指导语。
- province 必须从给定列表中选择一个最贴近的；city 填地级市；district 填区或县，
  只填对话里确实出现过的，拿不准就留空字符串。
- domains 从给定列表中选 1–3 个。

如果是伪创新，另当别论：当这个做法只是换了名称、把本职常规工作包装成创新、
或仅停留在文件层面并未实际运行，正文就写它为什么算不上真正的创新、依据是什么。

标题写法：
- 「地名 + 核心机制」，让人只看标题就知道创新点在哪。
- 点机制不点规模。数量变化（多少个渠道并为多少个、覆盖多少人）只是表象，
  除非数量本身就是机制，否则不写进标题。
- 避免宣传语：「成效显著」「打造新样板」「迈上新台阶」「探索新路径」一律不用。
- 不超过 30 字。
- 反例：「深圳民生诉求改革：557个渠道并为23个」（只说了规模）
- 好例：「深圳民生诉求改革：以事项清单锁定责任与时限」（点出机制）

摘要（summary）：
- 90–130 字，一到三句。
- 这是一段**能独立成立的概括**，不是引导读者往下读的引子。
  直接陈述：这个创新是什么、它靠什么起作用、成立需要什么条件。
- 不要卖关子。禁止「真正…的却是」「值得注意的是」「且看」这类铺陈，
  也不要先描述现象再揭晓答案——摘要里没有悬念，只有判断。
- 最多保留一个关键数字。
- 反例（引子式，不合格）：「深圳把分散的民生诉求渠道归并到一个平台，真正改变工单走向的
  却是背后的职责清单……」（在卖关子，读者仍不知道创新是什么）
- 好例（摘要式）：「以一份可裁断的职责清单替代部门间的临时协商，是这次改革的核心：
  4177 项职责拆到可分拨的颗粒度，工单归属预先写定，争议由牵头机构当场裁决。
  它不依赖高技术投入，前提是市级握有能压住推诿的裁决权，缺这一条，清单只是职责自报的汇总。」

只输出 JSON，不要任何解释文字：
{"title":"不超过 30 字的标题","province":"省级行政区全称","city":"市","district":"区或县","domains":["领域"],"body":"正文","summary":"90-130 字的摘要"}`;

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
      summary: String(parsed.summary || "").slice(0, 240),
      wordCount: String(parsed.body || "").replace(/\s/g, "").length,
    });
  } catch (err) {
    return handleError(err);
  }
}
