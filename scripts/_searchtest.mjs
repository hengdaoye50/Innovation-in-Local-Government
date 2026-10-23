// 验证检索与抓取是否真的生效
const BASE = "https://innovation.jinhuazhang.top";

async function chat(question) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: question }] }),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let meta = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (e.meta?.sources) meta = e.meta;
        if (e.delta) full += e.delta;
        if (e.error) return { status: 200, error: e.error };
      } catch {
        /* 忽略 */
      }
    }
  }
  return { status: res.status, meta, text: full, ms: Date.now() - t0 };
}

(async () => {
  console.log("=== 场景一：需要检索的问题 ===");
  const r1 = await chat("浙江省「最多跑一次」改革 2026 年有什么新进展？给出具体来源。");
  console.log("状态:", r1.status, "| 耗时:", r1.ms + "ms");
  if (r1.meta) {
    console.log("检索启用:", r1.meta.searchEnabled);
    console.log("来源数:", r1.meta.sources?.length || 0);
    (r1.meta.sources || []).slice(0, 5).forEach((s, i) => {
      console.log(`  [${i + 1}] ${s.title}`);
      console.log(`      ${s.url}`);
      if (s.publishedAt) console.log(`      ${s.publishedAt}`);
    });
  } else {
    console.log("未收到 meta");
  }
  console.log("回答:", (r1.text || r1.error || "").slice(0, 300));
})();
