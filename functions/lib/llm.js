/**
 * 模型调用
 * 走 DeepSeek 官方 API（OpenAI 兼容的 /chat/completions）。
 * 前端永远不接触密钥，全部经此转发。
 */

const PROVIDERS = {
  deepseek: {
    base: "https://api.deepseek.com/v1",
    // 注意：模型 ID 是 deepseek-flash，DeepSeek-V4.1-Flash-1017 只是版本名
    model: "deepseek-flash",
    keyEnv: "DEEPSEEK_API_KEY",
    // 思考模式开启，effort 拉满。注意两点连带影响：
    // 1) 该模式下 temperature 不生效（传了不报错但被忽略）；
    // 2) reasoning token 会占用 max_tokens 预算，所以调用方的上限要放宽。
    extra: { thinking: { type: "enabled" }, reasoning_effort: "high" },
  },
};

function resolve(env) {
  const preset = PROVIDERS.deepseek;
  return {
    name: "deepseek",
    base: (env.LLM_BASE || preset.base).replace(/\/$/, ""),
    model: env.LLM_MODEL || preset.model,
    key: env.DEEPSEEK_API_KEY || "",
    extra: preset.extra || {},
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
  const raw = String(detail || "").slice(0, 300);
  console.error("[llm] upstream error", status, raw);

  if (status === 401 || status === 403) {
    return Object.assign(new Error("模型密钥无效，请检查服务端配置"), { status: 503 });
  }
  if (status === 429) {
    return Object.assign(new Error("模型请求过于频繁，请稍后重试"), { status: 429 });
  }
  // 4xx 多为请求本身有问题（模型名不存在、参数不合法），
  // 把上游的简短说明带出来，否则只剩「服务不可用」没法排查
  if (status >= 400 && status < 500) {
    let reason = raw;
    try {
      const parsed = JSON.parse(raw);
      reason = parsed?.error?.message || parsed?.message || raw;
    } catch {
      /* 保持原文 */
    }
    return Object.assign(
      new Error(`模型请求被拒绝（${status}）：${String(reason).slice(0, 180)}`),
      { status: 502 }
    );
  }
  return Object.assign(new Error("模型服务暂时不可用"), { status: 502 });
}

/** 非流式补全 */
export async function complete(env, { system, messages, temperature = 0.4, maxTokens = 2000 }) {
  const { key, model, extra } = resolve(env);
  if (!key) throw Object.assign(new Error("服务端未配置模型密钥"), { status: 503 });

  const res = await fetch(endpoint(env), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, ...messages],
      temperature,
      max_tokens: maxTokens,
      ...extra,
    }),
  });

  if (!res.ok) throw upstreamError(res.status, await res.text().catch(() => ""));

  const out = await res.json();
  return (out.choices?.[0]?.message?.content || "").trim();
}

/** 流式补全，逐段回调增量 */
export async function stream(env, {
  system,
  messages,
  temperature = 0.5,
  maxTokens = 2000,
  onDelta,
  onThinking,
}) {
  const { key, model, extra } = resolve(env);
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
      ...extra,
    }),
  });

  if (!res.ok || !res.body) {
    throw upstreamError(res.status, await res.text().catch(() => ""));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let thinking = false;

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
        const d = chunk.choices?.[0]?.delta || {};

        // 思考模式下模型先吐 reasoning_content，正文可能十几秒才开始。
        // 首次出现时通知上层，避免前端一直停在「正在输入」像卡死。
        if (d.reasoning_content && !thinking) {
          thinking = true;
          onThinking?.();
        }

        const delta = d.content || "";
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
