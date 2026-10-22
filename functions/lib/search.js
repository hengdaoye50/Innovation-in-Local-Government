/**
 * 检索适配层
 * provider 由环境变量 SEARCH_PROVIDER 决定：tavily | serper | brave | none
 * 统一返回 [{ title, url, snippet, publishedAt }]，条数硬上限 15。
 */

export const LINK_LIMIT = 15;

const GOVERNMENT_HINTS = [
  ".gov.cn",
  "gov.cn",
  "people.com.cn",
  "xinhuanet.com",
  "news.cn",
  "gmw.cn",
  "cctv.com",
  "thepaper.cn",
  "caixin.com",
  "infzm.com",
  "cnki.net",
];

export function searchReady(env) {
  const provider = (env.SEARCH_PROVIDER || "none").toLowerCase();
  return provider !== "none" && Boolean(env.SEARCH_API_KEY);
}

export function providerName(env) {
  return (env.SEARCH_PROVIDER || "none").toLowerCase();
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normalize(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "spm", "from"].forEach((k) =>
      u.searchParams.delete(k)
    );
    return u.toString();
  } catch {
    return url;
  }
}

/** 同域名 + 标题高度相似视为重复，避免 15 条全是同一篇稿子的转载 */
function dedupe(items) {
  const seenUrls = new Set();
  const byDomain = new Map();
  const out = [];

  for (const item of items) {
    if (!item?.url) continue;
    const url = normalize(item.url);
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);

    const domain = domainOf(url);
    const titleKey = (item.title || "").replace(/[\s\W]/g, "").slice(0, 18);
    const bucket = byDomain.get(domain) || new Set();
    if (titleKey && bucket.has(titleKey)) continue;
    if (titleKey) bucket.add(titleKey);
    byDomain.set(domain, bucket);

    out.push({ ...item, url });
  }

  return out;
}

/** 政务与主流媒体优先，其余按原顺序补位 */
function rank(items) {
  const score = (item) => {
    const d = domainOf(item.url);
    if (GOVERNMENT_HINTS.some((h) => d.endsWith(h))) return 2;
    if (d.endsWith(".edu.cn")) return 2;
    return 1;
  };
  return [...items].sort((a, b) => score(b) - score(a));
}

async function tavily(env, query, limit) {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: env.SEARCH_API_KEY,
      query,
      search_depth: "advanced",
      max_results: limit,
      include_answer: false,
    }),
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}`);
  const data = await res.json();
  return (data.results || []).map((r) => ({
    title: r.title || r.url,
    url: r.url,
    snippet: (r.content || "").slice(0, 400),
    publishedAt: r.published_date || "",
  }));
}

async function serper(env, query, limit) {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": env.SEARCH_API_KEY,
    },
    body: JSON.stringify({ q: query, num: Math.min(20, limit), hl: "zh-cn", gl: "cn" }),
  });
  if (!res.ok) throw new Error(`Serper ${res.status}`);
  const data = await res.json();
  return (data.organic || []).map((r) => ({
    title: r.title || r.link,
    url: r.link,
    snippet: (r.snippet || "").slice(0, 400),
    publishedAt: r.date || "",
  }));
}

async function brave(env, query, limit) {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(20, limit)));
  url.searchParams.set("country", "cn");
  url.searchParams.set("search_lang", "zh-hans");
  const res = await fetch(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": env.SEARCH_API_KEY },
  });
  if (!res.ok) throw new Error(`Brave ${res.status}`);
  const data = await res.json();
  return (data.web?.results || []).map((r) => ({
    title: r.title || r.url,
    url: r.url,
    snippet: (r.description || "").slice(0, 400),
    publishedAt: r.age || "",
  }));
}

/**
 * 执行检索。未配置时有返回空数组，让对话退化为纯模型模式。
 */
export async function search(env, query, { limit = LINK_LIMIT } = {}) {
  const provider = providerName(env);
  if (provider === "none" || !env.SEARCH_API_KEY) return [];

  const capped = Math.min(LINK_LIMIT, Math.max(1, limit));

  try {
    let raw = [];
    if (provider === "tavily") raw = await tavily(env, query, capped);
    else if (provider === "serper") raw = await serper(env, query, capped);
    else if (provider === "brave") raw = await brave(env, query, capped);
    else return [];

    return rank(dedupe(raw)).slice(0, capped);
  } catch (err) {
    // 检索失败不阻断对话，退化为纯模型回答
    console.error("[search] failed:", err.message);
    return [];
  }
}

/** 把检索结果压成提示词片段 */
export function formatSources(items) {
  if (!items.length) return "";
  return items
    .map((s, i) => `[${i + 1}] ${s.title}\n${s.url}\n${s.snippet}`)
    .join("\n\n")
    .slice(0, 9000);
}
