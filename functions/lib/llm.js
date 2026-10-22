/**
 * 模型调用
 * 默认 DeepSeek 官方 API，同时兼容 Fireworks —— 两者都是 OpenAI 兼容的
 * /chat/completions，差异只在 base、模型名和密钥变量名。
 * 前端永远不接触密钥，全部经此转发。
 */

const PROVIDERS = {
  deepseek: {
    base: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    keyEnv: "DEEPSEEK_API_KEY",
  },
  fireworks: {
    base: "https://api.fireworks.ai/inference/v1",
    model: "accounts/fireworks/models/deepseek-v4p1-flash",
    keyEnv: "FIREWORKS_API_KEY",
  },
};

function resolve(env) {
  const explicit = (env.LLM_PROVIDER || "").toLowerCase();
  const name =
    explicit && PROVIDERS[explicit]
      ? explicit
      : env.DEEPSEEK_API_KEY
        ? "deepseek"
        : env.FIREWORKS_API_KEY
          ? "fireworks"
          : "deepseek";

  const preset = PROVIDERS[name];
  return {
    name,
    base: (env.LLM_BASE || preset.base).replace(/\/$/, ""),
    model: env.LLM_MODEL || preset.model,
    key: env[preset.keyEnv] || env.DEEPSEEK_API_KEY || env.FIREWORKS_API_KEY || "",
  };
}

function endpoint(env) {
  const { base } = resolve(env);
  return base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
}

export function llmReady(env) {
  return Boolean(resolve(env).key);
}

export function llmModel(env) {
  return resolve(env).model;
}

function upstreamError(status, detail) {
  console.error("[llm] upstream error", status, String(detail).slice(0, 300));
  if (status === 401 || status === 403) {
    return Object.assign(new Error("模型密钥无效，请检查服务端配置"), { status: 503 });
  }
  if (status === 429) {
    return Object.assign(new Error("模型请求过于频繁，请稍后重试"), { status: 429 });
  }
  return Object.assign(new Error("模型服务暂时不可用"), { status: 502 });
}

/** 非流式补全 */
export async function complete(env, { system, messages, temperature = 0.4, maxTokens = 2000 }) {
  const { key, model } = resolve(env);
  if (!key) throw Object.assign(new Error("服务端未配置模型密钥"), { status: 503 });

  const res = await fetch(endpoint(env), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, ...messages],
      temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!res.ok) throw upstreamError(res.status, await res.text().catch(() => ""));

  const out = await res.json();
  return (out.choices?.[0]?.message?.content || "").trim();
}

/** 流式补全，逐段回调增量 */
export async function stream(env, { system, messages, temperature = 0.5, maxTokens = 2000, onDelta }) {
  const { key, model } = resolve(env);
  if (!key) throw Object.assign(new Error("服务端未配置模型密钥"), { status: 503 });

  const res = await fetch(endpoint(env), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, ...messages],
      temperature,
      max_tokens: maxTokens,
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    throw upstreamError(res.status, await res.text().catch(() => ""));
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
