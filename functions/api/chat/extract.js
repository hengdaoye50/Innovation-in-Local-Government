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

const SYSTEM = `你是案例写作助教，负责把一段师生对话整理成可提交的案例梗概初稿。

严格约束：
1. 正文 1000–1500 字，中文，第三人称叙述。
2. 结构建议：改革的起因与背景 → 具体做了什么（可指认的动作） → 怎么推进的（组织、技术、考核手段） → 效果 → 代价、局限或争议。
3. 只使用对话中出现过的事实。对话没提到的数据、人名、时间点一律留空或用「据报道」等限定语，绝不编造。
4. 不要写成新闻通稿。避免「高度重视」「扎实推进」「成效显著」这类空话。
5. 不要用感叹号，不要出现「我」「我们」。
6. province 必须从给定列表中选择一个最贴近的；city 填地级市或区县名称。
7. domains 从给定列表中选 1–3 个。

只输出 JSON，不要任何解释文字：
{"title":"不超过 30 字的标题","province":"省级行政区全称","city":"市或区县","domains":["领域"],"body":"正文","summary":"80 字以内摘要"}`;

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
      maxTokens: 3000,
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
      domains,
      body: String(parsed.body || ""),
      summary: String(parsed.summary || "").slice(0, 200),
      wordCount: String(parsed.body || "").replace(/\s/g, "").length,
    });
  } catch (err) {
    return handleError(err);
  }
}
