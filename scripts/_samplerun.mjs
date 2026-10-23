// 模拟一次完整的学生协作流程，产出可用于评审的样例
const BASE = "https://innovation.jinhuazhang.top";

async function chat(messages) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  const text = await res.text();
  let meta = null;
  let full = "";
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e.meta?.sources) meta = e.meta;
      if (e.delta) full += e.delta;
      if (e.error) return { error: e.error, meta };
    } catch {
      /* 忽略 */
    }
  }
  return { text: full, meta };
}

(async () => {
  const history = [];
  const turns = [
    "老师让我们写一个地方政府创新案例。我在新闻上看到深圳搞了个「民意速办」平台，好像是集中处理民生诉求的。帮我查一下这到底是个什么，具体做了什么？",
    "那它跟 12345 热线有什么区别？我看报道里都在说「一件事」和「类案治理」，这两个词具体指什么，有没有实际的例子？",
    "好，我大概清楚了。它在别的城市能复制吗？哪些做法是深圳特有的、搬不走的？",
  ];

  for (let i = 0; i < turns.length; i++) {
    history.push({ role: "user", content: turns[i] });
    const r = await chat(history);
    if (r.error) return console.log("出错:", r.error);
    console.log(`第 ${i + 1} 轮助教回复（${(r.text || "").length} 字）`);
    history.push({ role: "assistant", content: r.text });
  }

  history.push({ role: "user", content: "我准备定稿了，帮我整理一份梗概初稿。" });

  const ex = await fetch(`${BASE}/api/chat/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript: history }),
  });
  const data = await ex.json();
  const d = data?.data || data;

  if (!d?.body) {
    console.log("抽取失败:", JSON.stringify(data).slice(0, 400));
    return;
  }

  const md = [
    `# ${d.title}`,
    "",
    `**地点**：${d.province} ${d.city} ${d.district || ""}`,
    `**领域**：${(d.domains || []).join("、")}`,
    `**字数**：${String(d.body).replace(/\s/g, "").length}`,
    `**摘要**：${d.summary}`,
    "",
    "---",
    "",
    d.body,
  ].join("\n");

  const fs = await import("node:fs");
  fs.writeFileSync("screenshots/sample-case.md", md, "utf8");

  const body = String(d.body);
  console.log("\n标题:", d.title);
  console.log("字数:", body.replace(/\s/g, "").length);
  console.log("段落数:", body.split(/\n{2,}/).filter(Boolean).length);
  const tail = body.slice(-200);
  console.log("\n结尾:", tail);
  console.log("\n命中局限类表述:", /局限|数据缺口|未见公开|待补充|口径冲突/.test(body) ? "有 ✗" : "无 ✓");
})();
