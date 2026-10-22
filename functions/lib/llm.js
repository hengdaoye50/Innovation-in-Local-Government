/**
 * 模型调用（Fireworks）
 * 前端永远不接触密钥，全部经此转发。
 */

const DEFAULT_BASE = "https://api.fireworks.ai/inference/v1";
const DEFAULT_MODEL = "accounts/fireworks/models/deepseek-v4p1-flash";

function endpoint(env) {
  const base = (env.LLM_BASE || DEFAULT_BASE).replace(/\/$/, "");
  return base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
}

export function llmReady(env) {
  return Boolean(env.FIREWORKS_API_KEY);
}

/**
 * 非流式补全，返回纯文本。
 */
export async function complete(env, { system, messages, temperature = 0.4, maxTokens = 2000 }) {
  if (!env.FIREWORKS_API_KEY) {
    throw Object.assign(new Error("服务端未配置模型密钥"), { status: 503 });
  }
  const payload = {
    model: env.LLM_MODEL || DEFAULT_MODEL,
    messages: [{ role: "system", content: system }, ...messages],
    temperature,
    max_tokens: maxTokens,
  };

  const res = await fetch(endpoint(env), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.FIREWORKS_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error("[llm] upstream error", res.status, detail.slice(0, 300));
    throw Object.assign(new Error(`模型服务返回 ${res.status}`), { status: 502 });
  }

  const out = await res.json();
  return (out.choices?.[0]?.message?.content || "").trim();
}

/**
 * 流式补全，逐段回调文本增量。
 */
export async function stream(env, { system, messages, temperature = 0.5, maxTokens = 2000, onDelta }) {
  if (!env.FIREWORKS_API_KEY) {
    throw Object.assign(new Error("服务端未配置模型密钥"), { status: 503 });
  }
  const payload = {
    model: env.LLM_MODEL || DEFAULT_MODEL,
    messages: [{ role: "system", content: system }, ...messages],
    temperature,
    max_tokens: maxTokens,
    stream: true,
  };

  const res = await fetch(endpoint(env), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.FIREWORKS_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    console.error("[llm] stream error", res.status, detail.slice(0, 300));
    throw Object.assign(new Error(`模型服务返回 ${res.status}`), { status: 502 });
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const chunk = JSON.parse(data);
        const delta = chunk.choices?.[0]?.delta?.content || "";
        if (delta) {
          full += delta;
          onDelta?.(delta);
        }
      } catch {
        /* 跳过无法解析的分片 */
      }
    }
  }

  return full;
}
