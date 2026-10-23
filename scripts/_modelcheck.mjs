// 验证模型 ID 是否可用：直接问一句，看后端是否报 model not found
const BASE = "https://innovation.jinhuazhang.top";

(async () => {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "只回两个字：在线" }] }),
  });

  console.log("HTTP:", res.status);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let error = null;

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
        if (e.delta) full += e.delta;
        if (e.error) error = e.error;
      } catch {
        /* 忽略 */
      }
    }
  }

  if (error) console.log("接口返回错误:", error);
  console.log("模型输出:", full.slice(0, 200) || "（空）");
})();
