/**
 * 用本机的 FIREWORKS_API_KEY 跑一次展位评语，输出可直接写库的 SQL。
 * 提示词与 functions/lib/review.js 里的 SLIDE_SYSTEM 保持一致，
 * 这样离线触发出来的评语和走上传流程生成的是一套口径。
 *
 * 用法：node scripts/gen-slide-review.mjs <id> "<标题>" "<课程>" "<描述>"
 */
import { writeFileSync } from "node:fs";

const [id, title, course, description] = process.argv.slice(2);
if (!id || !title) {
  console.error("usage: node scripts/gen-slide-review.mjs <id> <title> [course] [description]");
  process.exit(1);
}

const SYSTEM = `你是《地方政府创新》与《公共政策分析》课程的课堂评委，正在看学生小组的汇报展位。

根据标题、课程与描述，给出一段评语与分数。要求：
1. 先指出这个选题的问题意识是否清楚——它想回答什么，这个问法有没有价值；
2. 再看论证链条是否完整：有没有把「做法」和「说法」分开，有没有提到代价或争议；
3. 给一条具体、可执行的改进建议，不要泛泛而谈；
4. 语气像认真听课的老师，不客套，也不用感叹号。

只输出 JSON，不要解释文字：
{"score": 0-100 的整数, "comment": "80-140 字评语"}`;

const KEY = process.env.FIREWORKS_API_KEY;
if (!KEY) {
  console.error("缺少 FIREWORKS_API_KEY");
  process.exit(1);
}

const res = await fetch("https://api.fireworks.ai/inference/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
  body: JSON.stringify({
    model: "accounts/fireworks/models/deepseek-v4p1-flash",
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `标题：${title}\n课程：${course || "未注明"}\n描述：${description || "（未填写）"}`,
      },
    ],
    temperature: 0.4,
    max_tokens: 2000,
  }),
});

if (!res.ok) {
  console.error("上游返回", res.status, (await res.text()).slice(0, 300));
  process.exit(1);
}

const data = await res.json();
const raw = data?.choices?.[0]?.message?.content || "";
const start = raw.indexOf("{");
const end = raw.lastIndexOf("}");
if (start < 0 || end <= start) {
  console.error("模型没有返回 JSON：", raw.slice(0, 200));
  process.exit(1);
}

const parsed = JSON.parse(raw.slice(start, end + 1));
const comment = String(parsed.comment || "").trim().slice(0, 400);
const score = Math.round(Number(parsed.score));

const q = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const sql = `UPDATE slides SET ai_review = ${q(comment)}, ai_score = ${
  Number.isFinite(score) ? score : "NULL"
} WHERE id = ${q(id)};\n`;

writeFileSync(".wrangler/slide-review.sql", sql, "utf-8");
console.log("score:", score);
console.log("comment:", comment);
