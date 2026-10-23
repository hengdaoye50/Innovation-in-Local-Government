// 验证贴链接后是否真的抓取正文
const BASE = "https://innovation.jinhuazhang.top";
const URL_IN_Q = "https://www.zjrd.gov.cn/sylf/fggg/202603/t20260326_186670.shtml";

(async () => {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        {
          role: "user",
          content: `这篇规定的核心内容是什么？${URL_IN_Q} 用三点概括，并说明它对「一网通办」提出了哪些具体要求。`,
        },
      ],
    }),
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
        if (e.meta) meta = e.meta;
        if (e.delta) full += e.delta;
        if (e.error) return console.log("错误:", e.error);
      } catch {
        /* 忽略 */
      }
    }
  }

  console.log("耗时:", Date.now() - t0, "ms");
  console.log("抓取到的页面:", JSON.stringify(meta?.fetched || []));
  console.log("检索来源数:", meta?.sources?.length || 0);
  console.log("\n回答:\n" + full.slice(0, 500));
})();
