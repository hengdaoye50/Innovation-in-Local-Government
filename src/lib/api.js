/** API 客户端 —— 所有请求都走 Pages Functions */

const BASE = "";

class ApiError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

async function request(path, { method = "GET", body, signal, headers = {} } = {}) {
  const init = {
    method,
    credentials: "same-origin",
    signal,
    headers: { Accept: "application/json", ...headers },
  };

  if (body !== undefined) {
    if (body instanceof FormData) {
      init.body = body;
    } else {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
  }

  let res;
  try {
    res = await fetch(BASE + path, init);
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new ApiError("网络连接失败，请检查网络后重试", 0);
  }

  const text = await res.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { ok: false, error: text.slice(0, 240) };
    }
  }

  if (!res.ok) {
    throw new ApiError(
      payload?.error || `请求失败（${res.status}）`,
      res.status,
      payload?.detail
    );
  }

  return payload?.data !== undefined ? payload.data : payload;
}

export const api = {
  get: (path, opts) => request(path, { ...opts, method: "GET" }),
  post: (path, body, opts) => request(path, { ...opts, method: "POST", body }),
  patch: (path, body, opts) => request(path, { ...opts, method: "PATCH", body }),
  del: (path, opts) => request(path, { ...opts, method: "DELETE" }),
};

export { ApiError };

/* —— 各业务域 —— */

export const auth = {
  me: () => api.get("/api/auth/me"),
  login: (username, password) => api.post("/api/auth/login", { username, password }),
  register: (username, password, invite) =>
    api.post("/api/auth/register", { username, password, invite }),
  logout: () => api.post("/api/auth/logout", {}),
};

export const cases = {
  list: (params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
    ).toString();
    return api.get(`/api/cases${q ? `?${q}` : ""}`);
  },
  detail: (id) => api.get(`/api/cases/${encodeURIComponent(id)}`),
  create: (payload) => api.post("/api/cases", payload),
  setStatus: (id, status) => api.patch(`/api/cases/${encodeURIComponent(id)}`, { status }),
};

export const slides = {
  list: (params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
    ).toString();
    return api.get(`/api/slides${q ? `?${q}` : ""}`);
  },
  detail: (id) => api.get(`/api/slides/${encodeURIComponent(id)}`),
};

export const posts = {
  list: (params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
    ).toString();
    return api.get(`/api/posts${q ? `?${q}` : ""}`);
  },
  detail: (id) => api.get(`/api/posts/${encodeURIComponent(id)}`),
};

export const comments = {
  list: (targetType, targetId) =>
    api.get(`/api/comments?target_type=${targetType}&target_id=${encodeURIComponent(targetId)}`),
  create: (targetType, targetId, body) =>
    api.post("/api/comments", { target_type: targetType, target_id: targetId, body }),
};

export const admin = {
  invites: () => api.get("/api/admin/invites"),
  createInvite: (role = "student") => api.post("/api/admin/invites", { role }),
  pending: () => api.get("/api/admin/cases?status=pending"),
  users: () => api.get("/api/admin/users"),
  setUserRole: (id, role) => api.patch(`/api/admin/users/${id}`, { role }),
  setUserStatus: (id, status) => api.patch(`/api/admin/users/${id}`, { status }),
};

/**
 * 流式对话：逐段回调，返回完整文本。
 * 后端约定 line-delimited JSON：{"delta":"..."} / {"done":true} / {"error":"..."}
 */
export async function streamChat({ messages, signal, onDelta, onMeta }) {
  const res = await fetch("/api/chat", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    signal,
  });

  if (!res.ok || !res.body) {
    let detail = "";
    try {
      detail = (await res.json())?.error || "";
    } catch {
      /* ignore */
    }
    throw new ApiError(detail || `对话服务不可用（${res.status}）`, res.status);
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

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let event;
      try {
        event = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (event.error) throw new ApiError(event.error, 502);
      if (event.meta && onMeta) onMeta(event.meta);
      if (event.delta) {
        full += event.delta;
        onDelta?.(event.delta, full);
      }
      if (event.done) return full;
    }
  }

  return full;
}
