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
      // 只保留带 sources 的 meta，thinking 事件会覆盖
      if (e.meta?.sources) meta = e.meta;
      if (e.meta?.thinking && !meta) meta = { ...(meta || {}), thinking: true };
      if (e.delta) full += e.delta;
      if (e.error) return { error: e.error, meta };
    } catch {
      /* 忽略 */
    }
  }
  return { text: full, meta };
}

function showSources(meta) {
  const s = meta?.sources || [];
  if (!s.length) return;
  console.log(`\n  ── 检索到 ${s.length} 条来源 ──`);
  s.slice(0, 8).forEach((x, i) => console.log(`  [${i + 1}] ${x.title}`));
}

(async () => {
  const history = [];

  const turns = [
    "老师让我们写一个地方政府创新案例。我在新闻上看到深圳搞了个「民意速办」平台，好像是集中处理民生诉求的。帮我查一下这到底是个什么，具体做了什么？",
    "那它跟 12345 热线有什么区别？我看报道里都在说「一件事」和「类案治理」，这两个词具体指什么，有没有实际的例子？",
    "好，我大概清楚了。请问在写案例的时候，还需要特别注意补充哪些信息？我担心只写了做法，写不出效果和代价。",
  ];

  for (let i = 0; i < turns.length; i++) {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`【学生 第 ${i + 1} 轮】${turns[i]}`);
    history.push({ role: "user", content: turns[i] });

    const t0 = Date.now();
    const r = await chat(history);
    if (r.error) {
      console.log("出错:", r.error);
      return;
    }
    console.log(`\n【助教】(${Date.now() - t0}ms)`);
    console.log(r.text);
    showSources(r.meta);
    history.push({ role: "assistant", content: r.text });
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log("【学生】我准备定稿了，帮我整理一份梗概初稿。");
  history.push({ role: "user", content: "我准备定稿了，帮我整理一份梗概初稿。" });

  const t1 = Date.now();
  const ex = await fetch(`${BASE}/api/chat/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript: history }),
  });
  const data = await ex.json();
  console.log(`\n【抽取结果】(${Date.now() - t1}ms) HTTP ${ex.status}`);

  const d = data?.data || data;
  if (d?.body) {
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
      "",
      "---",
      "",
      "## 对话中引用的来源",
      "",
      ...[...new Set(history.filter((m) => m.role === "assistant").flatMap(() => []))],
    ].join("\n");

    const fs = await import("node:fs");
    fs.writeFileSync("screenshots/sample-case.md", md, "utf8");
    console.log("\n已写入 screenshots/sample-case.md");
    console.log(`标题：${d.title}`);
    console.log(`地点：${d.province} ${d.city} ${d.district || ""}`);
    console.log(`领域：${(d.domains || []).join("、")}`);
    console.log(`字数：${String(d.body).replace(/\s/g, "").length}`);
    console.log(`摘要：${d.summary}`);
  } else {
    console.log("抽取失败:", JSON.stringify(data).slice(0, 400));
  }
})();
