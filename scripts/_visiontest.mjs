// 验证多模态：发一张红色图片，看模型能否读到
const BASE = "https://innovation.jinhuazhang.top";

// 1x1 纯红 PNG
const RED_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

(async () => {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        {
          role: "user",
          content: "这张图片是什么颜色？只回答颜色名。",
          images: [RED_PNG],
        },
      ],
    }),
  });

  console.log("HTTP:", res.status);
  const text = await res.text();
  let full = "";
  let err = null;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e.delta) full += e.delta;
      if (e.error) err = e.error;
    } catch {
      /* 忽略 */
    }
  }
  if (err) {
    console.log("接口错误:", err);
    return;
  }
  console.log("模型回答:", full.trim().slice(0, 120));
  console.log(
    /红|red/i.test(full) ? "读到图片内容 ✓" : "未识别出颜色（可能不支持图像或格式不对）"
  );
})();
